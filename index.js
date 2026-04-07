/**
 * INDEX.JS - THE API GATEWAY
 * This file maps Cloud Functions to your modular logic files.
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions');

// Initialize the Admin SDK (Required for all other files to work)
admin.initializeApp();

// ==========================================================
// IDENTITY DOMAIN
// ==========================================================
const onboarding = require('./domains/identity/onboarding');
const verification = require('./domains/identity/verification');
const customers = require('./domains/identity/customers');

// Agent Actions
exports.createAgentProfile = onboarding.createAgentProfile;
exports.requestVerification = verification.requestVerification;

// Customer Actions
exports.createCustomerProfile = customers.createCustomerProfile;
exports.updateCustomerFcm = customers.updateCustomerFcm;

// Admin Actions (Gatekeeper)
exports.processVerification = verification.processVerification;


// ==========================================================
// MARKETPLACE DOMAIN
// ==========================================================
const requests = require('./domains/marketplace/requests');
const bidding = require('./domains/marketplace/bidding');
const selection = require('./domains/marketplace/selection');
const workflow = require('./domains/marketplace/workflow');
const triggers = require('./domains/marketplace/triggers');
const cron = require('./domains/marketplace/cron');

// Customer Actions
exports.createServiceRequest = requests.createServiceRequest;
exports.acceptBid = selection.acceptBid;
exports.cancelRequest = workflow.cancelRequest;

// Agent Actions
exports.placeBid = bidding.placeBid;
exports.completeJob = workflow.completeJob;

// Background Triggers 
exports.onRequestCreated = triggers.onRequestCreated; // Geo-Dispatch
exports.onBidPlaced = triggers.onBidPlaced;           // Customer Alert

// Scheduled Tasks (The "Autopilot")
exports.monitorAuctions = cron.monitorAuctions;       // Closes expired bids
exports.monitorStaleRequests = cron.monitorStaleRequests; // Concierge Alerts
exports.autoCaptureFunds = cron.autoCaptureFunds;     // Cleans up "Zombie" money


// ==========================================================
// 3. FINANCE DOMAIN
// ==========================================================
const disputes = require('./domains/finance/disputes');
const webhooks = require('./domains/finance/webhooks');

exports.reportIssue = disputes.reportIssue;
exports.resolveDispute = disputes.resolveDispute; // Admin Only
exports.stripeWebhook = webhooks.stripeWebhook;   // Public HTTP Endpoint


// ==========================================================
// 4. DISPATCH DOMAIN
// ==========================================================
const geographer = require('./domains/dispatch/geographer');

// Trigger: Runs when Agent updates address
exports.calculateTerritory = geographer.calculateTerritory;


// ==========================================================
// 5. COMMS DOMAIN
// ==========================================================
const comms = require('./domains/comms');

exports.censorChat = comms.security.censorChat;
exports.getSafeCallToken = comms.voice.getSafeCallToken;


// ==========================================================
// 6. PUBLIC DOMAIN
// ==========================================================
const seo = require('./domains/public/seo');

exports.getMarketplaceData = seo.getMarketplaceData;


// ==========================================================
// 7. ADMIN DOMAIN
// ==========================================================
const adminConfig = require('./domains/admin/config');

exports.updateSystemConfig = adminConfig.updateSystemConfig;