const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * COMPLETE JOB
 * Requires: Proof of Work (Photo)
 * Action: Marks complete, starts 24h Auto-Capture timer.
 */
exports.completeJob = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');
  
  const { requestId, afterPhotoUrl } = data;
  const agentUid = context.auth.uid;

  if (!afterPhotoUrl) {
    throw new functions.https.HttpsError('invalid-argument', 'Proof of work required.');
  }

  const reqRef = db.collection('requests').doc(requestId);

  return db.runTransaction(async (t) => {
    const doc = await t.get(reqRef);
    const req = doc.data();

    if (req.winning_bid.agent_uid !== agentUid) {
      throw new functions.https.HttpsError('permission-denied', 'Not your job.');
    }
    if (req.status !== 'ASSIGNED') {
      throw new functions.https.HttpsError('failed-precondition', 'Job not active.');
    }

    t.update(reqRef, {
      status: 'COMPLETED',
      'timeline.completed_at': admin.firestore.FieldValue.serverTimestamp(),
      'evidence.after_photo': afterPhotoUrl
    });
  });
});

/**
 * CANCEL REQUEST
 * Logic: Checks cancellation policy logic.
 */
exports.cancelRequest = functions.https.onCall(async (data, context) => {
  const { requestId } = data;
  const uid = context.auth.uid;

  const reqRef = db.collection('requests').doc(requestId);
  const doc = await reqRef.get();
  const req = doc.data();

  // Only Customer can cancel (Agents "Forfeit")
  if (req.customer.uid !== uid) throw new functions.https.HttpsError('permission-denied', 'Not owner');

  // Simple Logic: If Bidding Open -> Free. If Assigned -> Warning.
  if (req.status === 'BIDDING_OPEN') {
    await reqRef.update({ status: 'CANCELLED' });
    return { success: true, fee: 0 };
  } else {
    // If assigned, you might trigger a Stripe Capture for a cancellation fee here.
    // For MVP, we just mark cancelled and manual review.
    await reqRef.update({ status: 'CANCELLED_LATE' });
    return { success: true, message: 'Cancellation recorded.' };
  }
});