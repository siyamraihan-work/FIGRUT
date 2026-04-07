const functions = require('firebase-functions');
const admin = require('firebase-admin');
const stripe = require('stripe')(functions.config().stripe.secret_key);
const db = admin.firestore();

/**
 * 1. AGENT REQUESTS EXTRA FUNDS
 * Input: Amount, Reason, Photo Evidence
 */
exports.createChangeOrder = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');
  
  const { requestId, extraAmount, reason, proofPhotoUrl } = data;
  const agentUid = context.auth.uid;

  // Validate inputs
  if (!extraAmount || extraAmount <= 0) throw new functions.https.HttpsError('invalid-argument', 'Amount must be positive');
  if (!proofPhotoUrl) throw new functions.https.HttpsError('invalid-argument', 'Evidence photo required');

  const reqRef = db.collection('requests').doc(requestId);
  
  // Atomic Write
  await db.runTransaction(async (t) => {
    const reqDoc = await t.get(reqRef);
    const req = reqDoc.data();

    if (req.status !== 'ASSIGNED') throw new functions.https.HttpsError('failed-precondition', 'Job not active');
    if (req.winning_bid.agent_uid !== agentUid) throw new functions.https.HttpsError('permission-denied', 'Not your job');

    // Create the Change Order Sub-document
    const changeOrderRef = reqRef.collection('change_orders').doc();
    
    t.set(changeOrderRef, {
      id: changeOrderRef.id,
      amount: Number(extraAmount),
      reason: reason,
      proof_photo: proofPhotoUrl,
      status: 'PENDING', // PENDING | ACCEPTED | REJECTED
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });

    // Notify Customer (Trigger logic would handle this normally, but we flag it here)
    t.update(reqRef, { 'internal.has_pending_change': true });
  });

  return { success: true };
});

/**
 * 2. CUSTOMER ACCEPTS OR REJECTS
 * If Accepted: Immediately charge the difference.
 */
exports.resolveChangeOrder = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');

  const { requestId, changeOrderId, action, paymentMethodId } = data; // action: 'ACCEPT' or 'REJECT'
  const customerUid = context.auth.uid;

  const reqRef = db.collection('requests').doc(requestId);
  const changeRef = reqRef.collection('change_orders').doc(changeOrderId);

  // A. FETCH DATA
  const [reqDoc, changeDoc, configDoc] = await Promise.all([
    reqRef.get(),
    changeRef.get(),
    db.doc('system/config').get()
  ]);

  const req = reqDoc.data();
  const change = changeDoc.data();
  const config = configDoc.data() || {};

  if (req.customer.uid !== customerUid) throw new functions.https.HttpsError('permission-denied', 'Not your request');
  if (change.status !== 'PENDING') throw new functions.https.HttpsError('failed-precondition', 'Already resolved');

  // B. HANDLE REJECTION
  if (action === 'REJECT') {
    await changeRef.update({ status: 'REJECTED' });
    return { success: true, message: 'Change order rejected.' };
  }

  // C. HANDLE ACCEPTANCE (The Money Move)
  // We perform an IMMEDIATE charge for the extra amount. 
  // We do not "Hold" this; we capture it immediately because the agent is already on site working.

  // Calculate Split
  const extraAmountCents = Math.round(change.amount * 100);
  const commissionPct = config.pricing?.platform_commission_percent ?? 0.10;
  const platformFeeCents = Math.round(extraAmountCents * commissionPct);
  
  // Get Agent Stripe ID
  const agentDoc = await db.collection('agents').doc(req.winning_bid.agent_uid).get();
  const agentStripeId = agentDoc.data().financials.stripe_connect_id;

  try {
    // CHARGE THE CARD (Separate Transaction)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: extraAmountCents,
      currency: 'usd',
      customer: await getStripeCustomerId(customerUid), // Helper function
      payment_method: paymentMethodId, // Customer must confirm card again for new amount
      confirm: true, // Charge immediately
      application_fee_amount: platformFeeCents,
      transfer_data: { destination: agentStripeId },
      on_behalf_of: agentStripeId,
      metadata: { requestId, type: 'CHANGE_ORDER', parent_pi: req.financials.stripe_pi_id }
    });

    // D. UPDATE DB
    const batch = db.batch();
    
    // Update Change Order Status
    batch.update(changeRef, { 
      status: 'ACCEPTED',
      stripe_pi_id: paymentIntent.id,
      resolved_at: admin.firestore.FieldValue.serverTimestamp()
    });

    // Update Main Request Totals
    // We increment the total so the invoice looks correct at the end
    batch.update(reqRef, {
      'financials.total_charged': admin.firestore.FieldValue.increment(extraAmountCents / 100),
      'financials.agent_payout': admin.firestore.FieldValue.increment((extraAmountCents - platformFeeCents) / 100),
      'financials.platform_fee': admin.firestore.FieldValue.increment(platformFeeCents / 100),
      'internal.has_pending_change': false
    });

    await batch.commit();
    return { success: true };

  } catch (error) {
    console.error("Change Order Failed:", error);
    throw new functions.https.HttpsError('internal', 'Payment failed. Please check your card.');
  }
});

// Helper to get ID (You probably have this in utils already)
async function getStripeCustomerId(uid) {
  const doc = await db.collection('customers').doc(uid).get();
  return doc.data().stripe_customer_id;
}