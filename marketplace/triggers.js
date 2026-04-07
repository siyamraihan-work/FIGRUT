const functions = require('firebase-functions');
const admin = require('firebase-admin');
const geofire = require('geofire-common');
const db = admin.firestore();

/**
 * TRIGGER: ON REQUEST CREATED
 * PURPOSE: Find the right agents and blast notifications.
 * STRATEGY: 
 * 1. Geo-Query (Find agents physically nearby).
 * 2. Filter (Check Skills, Verification, Online Status).
 * 3. Priority Dispatch (Gold Tier gets head start).
 */
exports.onRequestCreated = functions.firestore
  .document('requests/{reqId}')
  .onCreate(async (snap, context) => {
    const req = snap.data();
    const service = req.job_details.service_slug;
    
    // 1. GET CUSTOMER LOCATION
    // Ideally, the frontend sends a precise Lat/Lng in req.customer.geo
    // If not, we fall back to a "Zip Code Center" (Mocked here, but you'd query a Zip DB)
    let center = [0, 0]; 
    if (req.customer.geo && req.customer.geo.lat) {
      center = [req.customer.geo.lat, req.customer.geo.lng];
    } else {
      console.log("⚠️ No precise location. Creating request without Dispatch.");
      return;
    }

    console.log(`🔎 Dispatching Service: ${service} near [${center}]`);

    // 2. GEOFIRE QUERY (The "Coarse" Filter)
    // We look for any agent within 50km (approx 30 miles) to start
    const radiusInM = 50 * 1000; 
    const bounds = geofire.geohashQueryBounds(center, radiusInM);
    
    const promises = [];
    for (const b of bounds) {
      const q = db.collection('agents')
        .orderBy('territory.geohash')
        .startAt(b[0])
        .endAt(b[1]);
      promises.push(q.get());
    }

    // Execute all queries in parallel
    const snapshots = await Promise.all(promises);
    
    const goldTokens = [];
    const bronzeTokens = [];

    // 3. IN-MEMORY FILTERING (The "Fine" Filter)
    const processedAgentIds = new Set(); // Prevent duplicates from overlapping geohashes

    for (const snap of snapshots) {
      for (const doc of snap.docs) {
        // Skip duplicates
        if (processedAgentIds.has(doc.id)) continue;
        processedAgentIds.add(doc.id);

        const agent = doc.data();

        // A. SAFETY CHECKS
        // Must be Verified, Online, and have a Push Token
        if (agent.verification.status !== 'VERIFIED') continue;
        if (!agent.controls.is_online) continue;
        if (!agent.controls.fcm_token) continue;

        // B. SKILL CHECK
        // Must offer the specific service (e.g., 'plumbing') and have it active
        if (!agent.skills[service]?.active) continue;

        // C. PRECISE DISTANCE CHECK
        // Calculate exact distance using Haversine formula
        const agentLat = agent.territory.geo_point.latitude;
        const agentLng = agent.territory.geo_point.longitude;
        const distanceInKm = geofire.distanceBetween([agentLat, agentLng], center);
        const distanceInMiles = distanceInKm * 0.621371;

        // Does the customer fall within THIS agent's specific radius?
        // Agent A might do 5 miles, Agent B might do 50 miles.
        if (distanceInMiles <= agent.territory.radius_miles) {
          
          // D. SEGMENTATION (Gamification)
          if (agent.metrics?.tier === 'GOLD') {
            goldTokens.push(agent.controls.fcm_token);
          } else {
            bronzeTokens.push(agent.controls.fcm_token);
          }
        }
      }
    }

    console.log(`🚀 Matches Found: ${goldTokens.length} Gold, ${bronzeTokens.length} Bronze`);

    // 4. CONSTRUCT HIGH-PRIORITY PAYLOAD
    // This payload is designed to wake up sleeping phones
    const payload = {
      notification: {
        title: "New Job Opportunity! 💰",
        body: `${req.job_details.description.substring(0, 50)}...`,
        clickAction: "FLUTTER_NOTIFICATION_CLICK" 
      },
      android: {
        priority: 'high',
        ttl: 3600 * 1000, // 1 hour time-to-live
        notification: {
          channelId: 'urgent_leads',
          icon: 'ic_stat_work'
        }
      },
      apns: {
        payload: {
          aps: {
            'content-available': 1, // Wakes up iOS background process
            sound: 'default',
            alert: {
              title: "New Job Opportunity! 💰",
              body: `${req.job_details.description.substring(0, 50)}...`
            }
          }
        }
      },
      data: {
        requestId: context.params.reqId,
        type: 'NEW_LEAD',
        service: service
      }
    };

    // 5. SEND WAVE 1 (GOLD)
    if (goldTokens.length > 0) {
      await admin.messaging().sendToDevice(goldTokens, payload);
    }

    // 6. SEND WAVE 2 (BRONZE)
    // We verify if bronze agents exist before waiting
    if (bronzeTokens.length > 0) {
      // NOTE: Cloud Functions have a timeout. Ensure your function timeout 
      // is set to > 70s in Firebase console if using a 60s delay.
      console.log("⏳ Waiting 60s for Gold exclusivity...");
      await new Promise(resolve => setTimeout(resolve, 60000));

      // Re-check: Did someone already take the job? (Optional optimization)
      // const freshReq = await snap.ref.get();
      // if (freshReq.data().status !== 'BIDDING_OPEN') return;

      console.log("🔔 Notifying Bronze Agents...");
      await admin.messaging().sendToDevice(bronzeTokens, payload);
    }
});

/**
 * TRIGGER: ON BID PLACED
 * PURPOSE: Notify the customer immediately so they can book.
 */
exports.onBidPlaced = functions.firestore
  .document('requests/{reqId}/bids/{bidId}')
  .onCreate(async (snap, context) => {
    const bid = snap.data();
    
    // 1. Fetch Parent Request to get Customer ID
    const reqRef = db.collection('requests').doc(context.params.reqId);
    const reqSnap = await reqRef.get();
    const req = reqSnap.data();

    if (!req) return;

    // 2. Fetch Customer Profile to get FCM Token
    const customerDoc = await db.collection('customers').doc(req.customer.uid).get();
    const token = customerDoc.data().fcm_token;

    if (!token) return;

    // 3. Send Notification
    const payload = {
      notification: {
        title: "New Bid Received! 🏷️",
        body: `${bid.agent.name} offered $${bid.offer.amount}. Tap to view.`
      },
      android: {
        notification: { channelId: 'updates' }
      },
      data: {
        requestId: context.params.reqId,
        bidId: context.params.bidId,
        type: 'BID_RECEIVED'
      }
    };

    await admin.messaging().sendToDevice(token, payload);
});