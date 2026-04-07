const functions = require('firebase-functions');
const admin = require('firebase-admin');
const stripe = require('stripe')(functions.config().stripe.secret_key);
const db = admin.firestore();

/**
 * STRIPE WEBHOOK HANDLER
 * The "Source of Truth" for all money movement.
 * We do not trust the client app. We trust this file.
 */
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = functions.config().stripe.webhook_secret;

  let event;

  // 1. SECURITY: Verify the Event Signature
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
  } catch (err) {
    console.error(`⚠️ Webhook Signature Verification Failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const intent = event.data.object;
  // We attached requestId to metadata in selection.js. This is crucial now.
  const requestId = intent.metadata ? intent.metadata.requestId : null;

  if (!requestId) {
    // Some events (like account updates) might not have a requestId. Ignore them safely.
    console.log(`Event ${event.type} received without Request ID.`);
    return res.json({ received: true });
  }

  const reqRef = db.collection('requests').doc(requestId);

  try {
    // 2. IDEMPOTENCY CHECK & LOGIC SWITCH
    // We check the DB state before writing to ensure we don't process duplicates.

    switch (event.type) {
      
      // A. THE HOLD IS SUCCESSFUL (Customer Card Validated)
      case 'payment_intent.amount_capturable_updated':
        console.log(`🔒 Funds Authorized (Held) for Req: ${requestId}`);
        
        await db.runTransaction(async (t) => {
          const doc = await t.get(reqRef);
          // Only update if not already authorized
          if (doc.data().financials.payment_status !== 'AUTHORIZED') {
            t.update(reqRef, {
              'financials.payment_status': 'AUTHORIZED',
              'financials.auth_expires_at': admin.firestore.Timestamp.fromDate(new Date(Date.now() + (7 * 24 * 60 * 60 * 1000))) // Holds last ~7 days
            });
          }
        });
        break;

      // B. THE CAPTURE IS SUCCESSFUL (Money in the Bank)
      case 'payment_intent.succeeded':
        console.log(`💰 Funds Captured for Req: ${requestId}`);
        
        await db.runTransaction(async (t) => {
          const doc = await t.get(reqRef);
          // This event might fire 2 seconds after we manually captured it.
          // We only update if it says 'AUTHORIZED' or 'PROCESSING'.
          if (doc.data().financials.payment_status !== 'CAPTURED') {
            t.update(reqRef, {
              status: 'PAID',
              'financials.payment_status': 'CAPTURED',
              'financials.captured_at': admin.firestore.FieldValue.serverTimestamp()
            });
          }
        });
        break;

      // C. THE PAYMENT FAILED (Card Declined / Fraud / Insufficient Funds)
      case 'payment_intent.payment_failed':
        const failureReason = intent.last_payment_error ? intent.last_payment_error.message : 'Unknown error';
        console.error(`Payment Failed for Req: ${requestId} - ${failureReason}`);

        await reqRef.update({
          status: 'PAYMENT_FAILED', // Frontend triggers "Update Card" screen
          'financials.payment_status': 'FAILED',
          'financials.failure_reason': failureReason
        });
        
        // TRIGGER ALERT: Tell the Agent to STOP driving!
        // (You would trigger a Push Notification function here)
        break;

      // D. THE HOLD WAS RELEASED (Refund/Cancellation)
      case 'payment_intent.canceled':
        console.log(`↩️ Hold Released for Req: ${requestId}`);
        await reqRef.update({
          status: 'CANCELLED',
          'financials.payment_status': 'VOIDED'
        });
        break;

      // E. A REFUND WAS ISSUED (Dispute Resolution)
      case 'charge.refunded':
        console.log(`Refund processed for Req: ${requestId}`);
        await reqRef.update({
          status: 'REFUNDED',
          'financials.payment_status': 'REFUNDED'
        });
        break;

      default:
        // Handle unexpected event types
        console.log(`Unhandled event type ${event.type}`);
    }

    // Return 200 to Stripe immediately
    res.json({ received: true });

  } catch (error) {
    console.error(`Error handling webhook for ${requestId}:`, error);
    // Return 500 so Stripe knows to retry later (e.g. if Firestore was down)
    res.status(500).send('Internal Server Error');
  }
});