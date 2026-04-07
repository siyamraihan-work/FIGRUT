const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();
const stripe = require('stripe')(functions.config().stripe.secret_key);

/**
 * CREATE CUSTOMER PROFILE
 * Triggered after the user signs up with Firebase Auth on the phone.
 */
exports.createCustomerProfile = functions.https.onCall(async (data, context) => {
  // 1. AUTH CHECK
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }

  const { name, email, fcmToken } = data;
  const uid = context.auth.uid;

  try {
    // 2. CREATE STRIPE CUSTOMER (The "Payer")
    const customer = await stripe.customers.create({
      email: email,
      name: name,
      metadata: { firebaseUid: uid }
    });

    // 3. SAVE TO FIRESTORE
    await db.collection('customers').doc(uid).set({
      uid: uid,
      display_name: name,
      email: email,
      stripe_customer_id: customer.id, // CRITICAL: Used in selection.js to charge them
      fcm_token: fcmToken || null,     // Used in triggers.js to send alerts
      saved_addresses: [],             // Array of { street, zip, geo }
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });

    // 4. SYNC ROLE TO USER DOC
    await db.collection('users').doc(uid).set({
      role: 'customer',
      email: email
    }, { merge: true });

    return { success: true };

  } catch (error) {
    console.error("Customer Creation Failed:", error);
    throw new functions.https.HttpsError('internal', "Could not create profile");
  }
});

/**
 * UPDATE FCM TOKEN
 * Called when the user opens the app to ensure notifications work.
 */
exports.updateCustomerFcm = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');
  await db.collection('customers').doc(context.auth.uid).update({
    fcm_token: data.fcmToken
  });
  return { success: true };
});