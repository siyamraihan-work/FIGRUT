const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

// 1. Agent submits docs
exports.requestVerification = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');
  
  const { licenseUrl, insuranceUrl } = data;

  await db.collection('agents').doc(context.auth.uid).update({
    'verification.status': 'UNDER_REVIEW',
    'verification.documents': {
      license: licenseUrl,
      insurance: insuranceUrl,
      submitted_at: admin.firestore.FieldValue.serverTimestamp()
    }
  });

  return { success: true };
});

// 2. Admin approves/rejects
exports.processVerification = functions.https.onCall(async (data, context) => {
  if (!context.auth.token.admin) throw new functions.https.HttpsError('permission-denied', 'Admin only');

  const { agentUid, decision, reason } = data; // 'APPROVE' or 'REJECT'
  
  const updates = {};
  if (decision === 'APPROVE') {
    updates['verification.status'] = 'VERIFIED';
    updates['controls.is_online'] = true; // Unlock account
  } else {
    updates['verification.status'] = 'REJECTED';
    updates['verification.reason'] = reason;
    updates['controls.is_online'] = false;
  }

  await db.collection('agents').doc(agentUid).update(updates);
  return { success: true };
});