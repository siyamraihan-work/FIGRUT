const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

exports.placeBid = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');
  const { requestId, amount, proposal } = data;
  const agentUid = context.auth.uid;

  return db.runTransaction(async (t) => {
    const reqRef = db.collection('requests').doc(requestId);
    const reqDoc = await t.get(reqRef);
    const req = reqDoc.data();

    // Validations
    if (req.status !== 'BIDDING_OPEN') throw new functions.https.HttpsError('failed-precondition', 'Closed');
    
    // Get Agent Details for Snapshot
    const agentDoc = await t.get(db.collection('agents').doc(agentUid));
    const agentData = agentDoc.data();

    // Create Bid
    const bidRef = reqRef.collection('bids').doc();
    t.set(bidRef, {
      bid_id: bidRef.id,
      agent: {
        uid: agentUid,
        name: agentData.profile.business_name,
        tier: agentData.metrics?.tier || 'BRONZE',
        rating: agentData.metrics?.rating_avg || 0
      },
      offer: { amount: Number(amount), proposal: proposal },
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });

    // Update Lowest Bid Tracker
    const currentLow = req.auction_mechanics.lowest_bid || 999999;
    t.update(reqRef, {
      'auction_mechanics.bid_count': admin.firestore.FieldValue.increment(1),
      'auction_mechanics.lowest_bid': Math.min(currentLow, Number(amount))
    });

    return { success: true };
  });
});