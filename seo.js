const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();
const cors = require('cors')({ origin: true });

exports.getMarketplaceData = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    const { zip, service } = req.query;

    const agents = await db.collection('agents')
      .where('territory.covered_zips', 'array-contains', zip)
      .where(`skills.${service}.active`, '==', true)
      .limit(10).get();

    const result = [];
    agents.forEach(doc => {
      const d = doc.data();
      result.push({ name: d.profile.business_name, rating: d.metrics.rating_avg });
    });

    res.json({ agents: result });
  });
});