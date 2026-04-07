const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();
// Load Stripe with the secret key from environment config
const stripe = require('stripe')(functions.config().stripe.secret_key);

/**
 * CREATE AGENT PROFILE & STRIPE ACCOUNT
 * * Steps:
 * 1. Validates user is logged in.
 * 2. Creates a "Stripe Express" account for them (so they can get paid).
 * 3. Saves their profile to Firestore.
 * 4. Generates a one-time link for them to enter bank info on Stripe.
 */
exports.createAgentProfile = functions.https.onCall(async (data, context) => {
  // 1. SECURITY CHECK
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to sign up.');
  }

  const { businessName, address, radius, services } = data;
  const uid = context.auth.uid;
  const email = context.auth.token.email;

  try {
    console.log(`👷 Starting Onboarding for ${uid} (${businessName})`);

    // 2. CREATE STRIPE EXPRESS ACCOUNT
    // This creates a blank "wallet" for the agent in your Stripe system.
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US', // Hardcoded for MVP, make dynamic later if needed
      email: email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: 'individual', // Simplifies verification requirements
      business_profile: {
        name: businessName,
        product_description: 'Home Services Provider',
      },
    });

    console.log(`Stripe Account Created: ${account.id}`);

    // 3. WRITE TO FIRESTORE (Parallel Writes for Speed)
    const batch = db.batch();

    // A. Create the Agent Document
    const agentRef = db.collection('agents').doc(uid);
    batch.set(agentRef, {
      uid: uid,
      profile: {
        business_name: businessName,
        base_address: address, // Triggers 'geographer' function to calculate Zips
        radius_miles: Number(radius) || 20,
        avatar_url: null // They can upload this later
      },
      skills: services || {}, // e.g., { "plumbing": { active: true } }
      
      // Verification starts as PENDING until they upload ID
      verification: { 
        status: 'PENDING',
        documents: {}
      },
      
      // Gamification starts at Bronze
      metrics: { 
        tier: 'BRONZE', 
        rating_avg: 0, 
        jobs_completed: 0,
        response_rate: 100 
      },
      
      // Financials link to the Stripe ID we just made
      financials: {
        stripe_connect_id: account.id,
        charges_enabled: false, // Will become true after they finish Stripe setup
        payouts_enabled: false  // Will become true after they add a bank account
      },
      
      controls: {
        is_online: false, // Cannot go online until verified
        fcm_token: null
      },
      
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });

    // B. Update the User Role
    const userRef = db.collection('users').doc(uid);
    batch.set(userRef, {
      role: 'agent',
      email: email,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await batch.commit();

    // 4. GENERATE ONBOARDING LINK
    // This URL redirects the user to Stripe's secure hosted page
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: 'https://yourapp.com/agent/onboarding_failed', // User hit "Back" or errored
      return_url: 'https://yourapp.com/agent/dashboard',       // User finished successfully
      type: 'account_onboarding',
    });

    console.log(`🔗 Generated Link: ${accountLink.url}`);

    // 5. RETURN URL TO FRONTEND
    // The App should immediately open this URL in a Webview or Browser
    return { 
      success: true, 
      onboardingUrl: accountLink.url 
    };

  } catch (error) {
    console.error("Onboarding Failed:", error);
    throw new functions.https.HttpsError('internal', error.message || "Failed to create agent profile.");
  }
});