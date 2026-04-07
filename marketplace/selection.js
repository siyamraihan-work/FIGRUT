const functions = require('firebase-functions');
const admin = require('firebase-admin');
// Initialize Stripe with your Secret Key
const stripe = require('stripe')(functions.config().stripe.secret_key);
const db = admin.firestore();

/**
 * ACCEPT BID
 * Purpose: The Customer selects a winner.
 * Actions:
 * 1. Reads System Config to determine Fees.
 * 2. Calculates the Total Charge (Bid + Trust Fee) and Platform Commission.
 * 3. Creates a Stripe "Hold" (Manual Capture) on the Customer's card.
 * 4. Sets up the Split Payment so the Agent gets paid automatically later.
 * 5. Atomically updates the database to close the auction.
 */
exports.acceptBid = functions.runWith({ minInstances: 1 }).https.onCall(async (data, context) => {
  // 1. SECURITY: Login Required
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to accept a bid.');
  }

  const { requestId, bidId, paymentMethodId } = data;
  const customerUid = context.auth.uid;

  console.log(`🤝 Processing Acceptance: Req ${requestId} -> Bid ${bidId}`);

  // 2. FETCH ALL DATA (Parallel Reads for Performance)
  // We need: The Bid, The Request, The Customer Profile, and System Config
  const [bidSnap, reqSnap, custSnap, configSnap] = await Promise.all([
    db.doc(`requests/${requestId}/bids/${bidId}`).get(),
    db.doc(`requests/${requestId}`).get(),
    db.collection('customers').doc(customerUid).get(),
    db.doc('system/config').get()
  ]);

  // 3. VALIDATION CHECKS
  if (!bidSnap.exists || !reqSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Bid or Request not found.');
  }
  
  const bid = bidSnap.data();
  const req = reqSnap.data();
  const cust = custSnap.data();

  // Verify Ownership
  if (req.customer.uid !== customerUid) {
    throw new functions.https.HttpsError('permission-denied', 'This is not your request.');
  }
  
  // Verify State
  if (req.status !== 'BIDDING_OPEN') {
    throw new functions.https.HttpsError('failed-precondition', 'This request is no longer open.');
  }

  // Verify Agent Payout Setup
  const agentDoc = await db.collection('agents').doc(bid.agent.uid).get();
  const agentStripeId = agentDoc.data().financials?.stripe_connect_id;
  
  if (!agentStripeId) {
    throw new functions.https.HttpsError('failed-precondition', 'Agent is not set up to receive payments.');
  }

  // 4. APPLY DYNAMIC PRICING (From System Config)
  const config = configSnap.data() || {};
  
  // Defaults: $2.99 Trust Fee, 10% Commission
  const TRUST_FEE_CENTS = config.pricing?.trust_fee_cents ?? 299;
  const COMMISSION_PCT = config.pricing?.platform_commission_percent ?? 0.10;

  // 5. CALCULATE FINANCIALS
  const bidAmountCents = Math.round(bid.offer.amount * 100);
  
  // Total to Charge Customer = Agent Bid + Trust Fee
  const totalChargeCents = bidAmountCents + TRUST_FEE_CENTS;
  
  // Platform Revenue = Trust Fee + (Commission % of Bid)
  const commissionCents = Math.round(bidAmountCents * COMMISSION_PCT);
  const totalPlatformFeeCents = TRUST_FEE_CENTS + commissionCents;

  try {
    // 6. STRIPE: CREATE PAYMENT INTENT (The "Hold")
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalChargeCents,
      currency: 'usd',
      customer: cust.stripe_customer_id,
      payment_method: paymentMethodId,
      confirm: true,               // Attempt to authorize immediately
      capture_method: 'manual',    // <--- IMPORTANT: Holds funds, does not charge yet.
      
      // SPLIT PAYMENT LOGIC
      application_fee_amount: totalPlatformFeeCents, // This stays in your Stripe account
      transfer_data: {
        destination: agentStripeId, // The remainder goes to the Agent's Stripe account
      },
      on_behalf_of: agentStripeId, // Shows Agent Name on Customer Bank Statement (Reduces disputes)
      
      metadata: {
        requestId: requestId,
        bidId: bidId,
        agentUid: bid.agent.uid,
        customerUid: customerUid,
        type: 'SERVICE_HOLD'
      }
    });

    // Check if 3D Secure (SCA) or other auth is needed
    if (paymentIntent.status !== 'requires_capture' && paymentIntent.status !== 'succeeded') {
      throw new functions.https.HttpsError('aborted', 'Payment authorization failed. Please try a different card.');
    }

    // 7. ATOMIC DB TRANSACTION (The "Handshake")
    await db.runTransaction(async (t) => {
      // Re-read request inside transaction to prevent race conditions
      const liveReq = await t.get(reqSnap.ref);
      if (liveReq.data().status !== 'BIDDING_OPEN') {
        throw new functions.https.HttpsError('aborted', 'Request was just taken by someone else.');
      }

      // A. Update Request Status & Details
      t.update(reqSnap.ref, {
        status: 'ASSIGNED',
        winning_bid: {
          bid_id: bidId,
          agent_uid: bid.agent.uid,
          agent_name: bid.agent.name,
          agent_tier: bid.agent.tier,
          final_price: bid.offer.amount
        },
        financials: {
          stripe_pi_id: paymentIntent.id,
          
          // Store raw numbers for analytics later
          total_charged: totalChargeCents / 100,
          platform_fee: totalPlatformFeeCents / 100,
          trust_fee: TRUST_FEE_CENTS / 100,
          agent_payout: (totalChargeCents - totalPlatformFeeCents) / 100,
          
          payment_status: 'AUTHORIZED',
          authorized_at: admin.firestore.FieldValue.serverTimestamp()
        },
        'auction_mechanics.closed_at': admin.firestore.FieldValue.serverTimestamp()
      });

      // B. Create Secure Chat Room
      // Initialize the messages subcollection so they can start talking
      const welcomeMsgRef = reqSnap.ref.collection('messages').doc();
      t.set(welcomeMsgRef, {
        text: "System: Bid accepted. Funds secured. You may now chat safely.",
        sender_role: 'system',
        created_at: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    return { success: true };

  } catch (error) {
    console.error("Accept Bid Error:", error);
    // Return a clean error message to the client
    throw new functions.https.HttpsError('internal', error.message || "Payment processing failed.");
  }
});