const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * UPDATE SYSTEM CONFIG
 * Purpose: Allows Admin to change fees, timeouts, and maintenance mode live.
 * Access: ADMIN ONLY
 */
exports.updateSystemConfig = functions.https.onCall(async (data, context) => {
  // Admin Only
  if (!context.auth || !context.auth.token.admin) {
    throw new functions.https.HttpsError('permission-denied', 'Admins only.');
  }

  const { pricing, dispatch, maintenance } = data;

  // Basic safety checks
  if (pricing) {
    if (pricing.platform_commission_percent < 0 || pricing.platform_commission_percent > 0.5) {
      throw new functions.https.HttpsError('invalid-argument', 'Commission must be between 0% and 50%.');
    }
  }

  // 3. WRITE TO DB
  // We use set with { merge: true } so partial updates don't wipe other settings
  await db.doc('system/config').set({
    pricing: {
      trust_fee_cents: pricing?.trust_fee_cents ?? 299,
      platform_commission_percent: pricing?.platform_commission_percent ?? 0.10,
    },
    dispatch: {
      bidding_window_hours: dispatch?.bidding_window_hours ?? 2,
      search_radius_km: dispatch?.search_radius_km ?? 50
    },
    maintenance: {
      is_app_down: maintenance?.is_app_down ?? false,
      maintenance_message: maintenance?.maintenance_message || "We are upgrading our servers. Back shortly!"
    },
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_by: context.auth.uid
  }, { merge: true });

  return { success: true, message: "System config updated successfully." };
});