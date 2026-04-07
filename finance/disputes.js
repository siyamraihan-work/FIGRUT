const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

exports.reportIssue = functions.https.onCall(async (data, context) => {
  const { requestId, reason } = data;
  
  // Freeze Status
  await db.collection('requests').doc(requestId).update({
    status: 'DISPUTED',
    dispute: {
      opened_at: admin.firestore.FieldValue.serverTimestamp(),
      reason: reason
    }
  });
  
  return { success: true };
});