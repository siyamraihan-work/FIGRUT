const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * 1. MONITOR STALE REQUESTS (The "Concierge" Trigger)
 * Frequency: Every 15 minutes
 * Logic: Finds jobs that are 30 mins old with 0 bids. Alerts Staff.
 */
exports.monitorStaleRequests = functions.pubsub.schedule('every 15 minutes').onRun(async (context) => {
  console.log("🕵️‍♀️ Scanning for stale requests...");
  
  const now = Date.now();
  const thirtyMinsAgo = new Date(now - (30 * 60 * 1000));
  
  // Query: Status=OPEN, Bids=0, Created < 30m ago, Not yet Alerted
  const snapshot = await db.collection('requests')
    .where('status', '==', 'BIDDING_OPEN')
    .where('auction_mechanics.bid_count', '==', 0)
    .where('job_details.created_at', '<', admin.firestore.Timestamp.fromDate(thirtyMinsAgo))
    .where('internal.concierge_alert_sent', '==', false)
    .limit(50) // Batch limit for safety
    .get();

  if (snapshot.empty) return null;

  const batch = db.batch();
  let alertCount = 0;

  snapshot.forEach(doc => {
    // Mark as alerted so we don't spam
    batch.update(doc.ref, { 'internal.concierge_alert_sent': true });
    alertCount++;
  });

  await batch.commit();

  // Send Alert to "Staff" Topic
  if (alertCount > 0) {
    console.log(`🚨 Alerting Staff for ${alertCount} dying requests.`);
    await admin.messaging().sendToTopic('staff_alerts', {
      notification: {
        title: "🚨 Concierge Alert",
        body: `${alertCount} requests have 0 bids. Act now to save the sale.`
      },
      data: {
        type: 'CONCIERGE_URGENT',
        count: alertCount.toString()
      }
    });
  }
});

/**
 * 2. AUTO-CAPTURE FUNDS (The "Zombie" Cleaner)
 * Frequency: Every 60 minutes
 * Logic: Finds jobs marked COMPLETED > 24 hours ago that are still just AUTHORIZED. Captures them.
 */
exports.autoCaptureFunds = functions.pubsub.schedule('every 60 minutes').onRun(async (context) => {
  console.log("💰 Scanning for auto-capture opportunities...");

  const twentyFourHoursAgo = new Date(Date.now() - (24 * 60 * 60 * 1000));

  // Query: Status=COMPLETED, Payment=AUTHORIZED, Completed < 24h ago
  const snapshot = await db.collection('requests')
    .where('status', '==', 'COMPLETED')
    .where('financials.payment_status', '==', 'AUTHORIZED')
    .where('timeline.completed_at', '<', admin.firestore.Timestamp.fromDate(twentyFourHoursAgo))
    .limit(20) // Process in small batches to avoid timeouts
    .get();

  if (snapshot.empty) return null;

  const stripe = require('stripe')(functions.config().stripe.secret_key);

  // Note: We cannot use a Batch for Stripe calls, so we loop with Promise.all
  const promises = snapshot.docs.map(async (doc) => {
    const req = doc.data();
    const piId = req.financials.stripe_pi_id;

    if (!piId) return;

    try {
      // Execute Capture
      await stripe.paymentIntents.capture(piId);

      // Update DB
      await doc.ref.update({
        'financials.payment_status': 'CAPTURED',
        'financials.captured_at': admin.firestore.FieldValue.serverTimestamp(),
        'financials.capture_method': 'AUTO_CRON',
        'status': 'PAID' // Move to final state
      });
      console.log(`✅ Auto-captured ${piId} for Req ${doc.id}`);

    } catch (err) {
      console.error(`❌ Failed to capture ${doc.id}:`, err.message);
      // Optional: Write to an 'errors' collection for manual review
    }
  });

  await Promise.all(promises);
});

/**
 * 3. AUCTION EXPIRY MONITOR (The "Cleaner")
 * Frequency: Every 30 minutes
 * Logic: Closes auctions that have passed their deadline.
 */
exports.monitorAuctions = functions.pubsub.schedule('every 30 minutes').onRun(async (context) => {
  const now = admin.firestore.Timestamp.now();

  const snapshot = await db.collection('requests')
    .where('status', '==', 'BIDDING_OPEN')
    .where('auction_mechanics.closes_at', '<', now)
    .get();

  if (snapshot.empty) return null;

  const batch = db.batch();
  
  snapshot.forEach(doc => {
    const data = doc.data();
    
    // If bids exist, we notify customer to pick one.
    // If NO bids exist, we mark as EXPIRED.
    if (data.auction_mechanics.bid_count === 0) {
      batch.update(doc.ref, { status: 'EXPIRED' });
    } else {
      // Just flag it so frontend shows "Time's Up!"
      batch.update(doc.ref, { 'auction_mechanics.is_expired': true });
    }
  });

  await batch.commit();
});