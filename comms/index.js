const functions = require('firebase-functions');
const admin = require('firebase-admin');
//npm install twilio
const Twilio = require('twilio');

//Regex Censor
const BLACKLIST = /(\d{10})|(\d{3}-\d{3}-\d{4})|(venmo)|(cash app)|(@)/i;

exports.security = {
  censorChat: functions.firestore
    .document('requests/{reqId}/messages/{msgId}')
    .onCreate(async (snap, context) => {
      const msg = snap.data();
      if (msg.sender_role === 'system') return;

      if (BLACKLIST.test(msg.text)) {
        console.log(`🚨 Leak detected in ${context.params.reqId}`);
        await snap.ref.update({
          text: " *** [REDACTED: Do not share contact info] *** ",
          flagged: true
        });
      }
    })
};

// 2. VOICE BRIDGE (Masked Calling)
exports.voice = {
  getSafeCallToken: functions.https.onCall((data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');
    
    //functions:config:set twilio.sid="..."
    const accountSid = functions.config().twilio.sid;
    const apiKey = functions.config().twilio.api_key;
    const apiSecret = functions.config().twilio.api_secret;

    const AccessToken = Twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    // Create a "Grant" for this specific user
    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: functions.config().twilio.app_sid,
      incomingAllow: true,
    });

    const token = new AccessToken(accountSid, apiKey, apiSecret, { identity: context.auth.uid });
    token.addGrant(voiceGrant);

    return { token: token.toJwt() };
  })
};