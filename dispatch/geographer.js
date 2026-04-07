const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { Client } = require("@googlemaps/google-maps-services-js");
const geofire = require('geofire-common'); // Run: npm install geofire-common

const mapClient = new Client({});

exports.calculateTerritory = functions.firestore
  .document('agents/{agentId}')
  .onUpdate(async (change, context) => {
    const after = change.after.data();
    const before = change.before.data();

    // 1. Debounce
    if (after.profile.base_address === before.profile.base_address && 
        after.profile.radius_miles === before.profile.radius_miles) return;

    // 2. Geocode Address -> Lat/Lng
    const res = await mapClient.geocode({
      params: {
        address: after.profile.base_address,
        key: functions.config().google.maps_key
      }
    });

    if (res.data.results.length === 0) return;
    const loc = res.data.results[0].geometry.location;
    const lat = loc.lat;
    const lng = loc.lng;

    // 3. GENERATE GEOHASH (Precision 8 is roughly +/- 20m)
    const hash = geofire.geohashForLocation([lat, lng]);

    // 4. SAVE COMPUTED DATA
    // We store the lat/lng and hash so we can query "Radius" later
    await change.after.ref.update({
      'territory.geo_point': new admin.firestore.GeoPoint(lat, lng),
      'territory.geohash': hash,
      'territory.radius_miles': after.profile.radius_miles
    });
});