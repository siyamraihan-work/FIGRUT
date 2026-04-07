const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * HELPER: LOCATION OBFUSCATOR
 * Purpose: Adds random noise (~100-300m) to coordinates.
 * Why: Allows agents to calculate travel distance without revealing the exact house.
 */
function getFuzzedLocation(lat, lng) {
  // 1 degree lat is ~111km. 0.002 degrees is approx ~200 meters.
  // We add a random offset between -0.002 and +0.002
  const offset = 0.002; 
  
  const latNoise = (Math.random() - 0.5) * offset * 2;
  const lngNoise = (Math.random() - 0.5) * offset * 2;

  return {
    lat: lat + latNoise,
    lng: lng + lngNoise
  };
}

/**
 * CREATE SERVICE REQUEST
 * Purpose: Customers post a job to the marketplace.
 * Features:
 * - Checks Maintenance Mode
 * - Calculates Dynamic Deadline
 * - Fuzzes Location for Privacy
 * - Separates Public vs Private Data
 */
exports.createServiceRequest = functions.https.onCall(async (data, context) => {
  // 1. SECURITY: Login Required
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to post a request.');
  }

  // 2. FETCH SYSTEM CONFIG
  // Check for Maintenance Mode and get dynamic timeout settings
  const configDoc = await db.doc('system/config').get();
  const config = configDoc.data() || {}; 

  if (config.maintenance?.is_app_down) {
    throw new functions.https.HttpsError(
      'unavailable', 
      config.maintenance.maintenance_message || "System is under maintenance. Please try again later."
    );
  }

  // 3. VALIDATE INPUTS
  const { serviceSlug, description, address, photos, scheduleTime } = data;

  // Expected address object: { street, city, state, zip, geo: {lat, lng}, access_code? }
  if (!serviceSlug || !description) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing service type or description.');
  }
  if (!address || !address.zip || !address.geo || !address.street) {
    throw new functions.https.HttpsError('invalid-argument', 'Complete address required (Street, Zip, and Coordinates).');
  }

  // 4. GENERATE FUZZED LOCATION (Privacy Layer)
  // This is what Agents see BEFORE they win the bid.
  const publicGeo = getFuzzedLocation(address.geo.lat, address.geo.lng);

  // 5. CALCULATE DEADLINE
  const windowHours = config.dispatch?.bidding_window_hours || 2; // Default 2 hours
  const deadline = new Date(Date.now() + (windowHours * 60 * 60 * 1000)); 

  // 6. CONSTRUCT DATA
  const ref = db.collection('requests').doc();
  const customerUid = context.auth.uid;

  const requestData = {
    request_id: ref.id,
    
    // --- PUBLIC DATA (Visible to Bidders) ---
    customer: { 
      uid: customerUid, 
      zip_code: address.zip,
      // Fuzzed coordinates for distance calculation
      geo: { 
        lat: publicGeo.lat, 
        lng: publicGeo.lng 
      },
      // Generic label (e.g., "Tucson, AZ 85719")
      vicinity: `${address.city}, ${address.zip}`
    },

    job_details: {
      service_slug: serviceSlug,
      description: description,
      photos: photos || [], // Array of URLs
      // If scheduleTime is null, it means "ASAP"
      scheduled_for: scheduleTime ? admin.firestore.Timestamp.fromDate(new Date(scheduleTime)) : "ASAP",
      created_at: admin.firestore.FieldValue.serverTimestamp()
    },

    // --- PRIVATE DATA (The Vault) ---
    // Only the assigned agent can read this field (via Firestore Rules)
    location_secure: {
      full_address: `${address.street}, ${address.city}, ${address.state} ${address.zip}`,
      street: address.street,
      city: address.city,
      state: address.state,
      zip: address.zip,
      // Real coordinates for navigation AFTER winning
      geo: address.geo,
      access_code: address.access_code || null
    },

    // --- STATUS & STATE ---
    status: 'BIDDING_OPEN', // Transitions: BIDDING_OPEN -> ASSIGNED -> COMPLETED -> PAID
    
    auction_mechanics: {
      closes_at: admin.firestore.Timestamp.fromDate(deadline),
      bid_count: 0,
      lowest_bid: null,
      is_expired: false
    },
    
    // --- OPS / DEBUGGING ---
    internal: {
      config_version: config.updated_at || 'initial', 
      concierge_alert_sent: false,
      has_review: false
    }
  };

  // 7. WRITE TO DB
  await ref.set(requestData);

  return { 
    success: true, 
    requestId: ref.id,
    expiresAt: deadline.toISOString(),
    fuzzedLocation: publicGeo // Return this just so frontend can verify if needed
  };
});