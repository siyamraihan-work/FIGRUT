const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * SUBMIT REVIEW
 * Purpose: Customer rates the Agent. System updates the Agent's public score.
 */
exports.submitReview = functions.https.onCall(async (data, context) => {
  // 1. AUTH CHECK
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');

  const { requestId, rating, text } = data;
  const customerUid = context.auth.uid;

  // 2. VALIDATION
  if (!rating || rating < 1 || rating > 5) {
    throw new functions.https.HttpsError('invalid-argument', 'Rating must be 1-5.');
  }

  const reqRef = db.collection('requests').doc(requestId);

  // 3. ATOMIC TRANSACTION (Read + Write)
  await db.runTransaction(async (t) => {
    const reqDoc = await t.get(reqRef);
    const req = reqDoc.data();

    // A. Verify Ownership & State
    if (!reqDoc.exists) throw new functions.https.HttpsError('not-found', 'Job not found');
    if (req.customer.uid !== customerUid) throw new functions.https.HttpsError('permission-denied', 'Not your job');
    
    // Only allow rating if job is DONE
    if (!['COMPLETED', 'PAID'].includes(req.status)) {
      throw new functions.https.HttpsError('failed-precondition', 'Job not finished yet');
    }
    
    // Prevent double-rating
    if (req.internal?.has_review) {
      throw new functions.https.HttpsError('already-exists', 'You already reviewed this job');
    }

    const agentUid = req.winning_bid.agent_uid;
    const agentRef = db.collection('agents').doc(agentUid);
    const agentDoc = await t.get(agentRef);
    const agent = agentDoc.data();

    // B. CALCULATE NEW METRICS (The Math)
    const oldRating = agent.metrics?.rating_avg || 0;
    const oldCount = agent.metrics?.review_count || 0;
    
    const newCount = oldCount + 1;
    // Formula: ((CurrentAvg * Count) + NewScore) / NewCount
    const newRatingRaw = ((oldRating * oldCount) + rating) / newCount;
    // Round to 2 decimals (e.g. 4.87)
    const newRating = Math.round(newRatingRaw * 100) / 100;

    // C. WRITE UPDATES
    
    // 1. Create the Review Document (Publicly visible in Agent's profile)
    const reviewRef = agentRef.collection('reviews').doc(); // Auto ID
    t.set(reviewRef, {
      id: reviewRef.id,
      customer_name: req.customer.display_name || "Customer", // Privacy: First name only usually
      rating: rating,
      text: text || "",
      request_id: requestId,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });

    // Gamification update
    let newTier = agent.metrics.tier; // Default to current

    // LOGIC: Upgrade/Downgrade based on stats
    if (newCount > 20 && newRating >= 4.8) {
      newTier = 'GOLD';
    } else if (newCount > 5 && newRating >= 4.5) {
      newTier = 'SILVER';
    } else if (newRating < 3.0) {
      // Alert Admin: This agent sucks
      newTier = 'AT_RISK'; 
    }

    // 2. Update Agent's Aggregate Score
    t.update(agentRef, {
      'metrics.rating_avg': newRating,
      'metrics.review_count': newCount,
      'metrics.tier': newTier
    });

    // 3. Mark Request as Reviewed (To prevent duplicates)
    t.update(reqRef, {
      'internal.has_review': true,
      'review_id': reviewRef.id
    });
  });

  return { success: true };
});