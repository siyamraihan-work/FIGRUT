# FIGRUT

A modular **Firebase backend for an on-demand home service marketplace**.

This project is designed as a strong backend foundation for a platform where customers can request home services, agents can bid on jobs, payments can be held and captured securely, and the system can automate dispatch, notifications, and operational monitoring.

It is built in a way that feels practical for a student project, but it also follows ideas that are used in real production systems: domain separation, background triggers, scheduled jobs, role-based access, payment workflows, and operational config management.

---

## Project Overview

FIGRUT is a backend-first marketplace system for home services such as plumbing, cleaning, repairs, or similar on-demand work.

At a high level, the backend supports:

- **Customer onboarding**
- **Agent onboarding and verification**
- **Service request creation**
- **Competitive bidding by agents**
- **Bid acceptance and secure payment authorization**
- **Job completion workflow**
- **Dispute reporting**
- **Push notifications and communication safety**
- **Geo-based dispatch support**
- **Admin-controlled live configuration**
- **Scheduled automation using Firebase Pub/Sub jobs**

The current version is centered around **Firebase Cloud Functions + Firestore + Stripe + Firebase Messaging**.

A natural next step for this project is to evolve it into a more advanced async architecture using **Kafka, containers, and Kubernetes** once the MVP logic is stable.

---

## Tech Stack

### Current stack

- **Firebase Cloud Functions** for backend logic
- **Firestore** for application data
- **Firebase Authentication** for user identity
- **Firebase Cloud Messaging (FCM)** for notifications
- **Stripe** for payments, holds, transfers, and webhook processing
- **Google Maps API** for geocoding and territory calculation
- **Twilio** for masked calling / communication support
- **Node.js** runtime for serverless function modules

### Future-ready extension

This project can be extended into an advanced architecture with:

- **Kafka** for asynchronous event streaming
- **Docker** for containerization
- **Kubernetes** for orchestration and scaling
- **Microservices** for splitting marketplace, identity, finance, dispatch, and communication into independently deployable services

---

## Main Features

### 1. Identity domain

The identity layer handles customer and agent setup.

**Implemented ideas in the codebase:**
- Create customer profiles
- Create agent profiles
- Link customer accounts with Stripe customer records
- Link agent accounts with Stripe Connect accounts
- Save role information into Firestore
- Submit verification documents
- Approve or reject agent verification through admin-only logic

This gives the marketplace a basic trust and compliance flow instead of letting any user immediately behave as a provider.

---

### 2. Marketplace domain

This is the core business logic of the platform.

**Implemented ideas in the codebase:**
- Customers create service requests
- Request data is split into **public** and **private** sections
- Public location is fuzzed for privacy before agent selection
- Agents place bids on open jobs
- Customers accept bids
- Accepted bids trigger a payment authorization workflow
- Agents complete jobs with proof-of-work photos
- Customers can cancel requests
- Change-order logic is introduced for extra work scenarios
- Review / job lifecycle hooks are partially represented in the structure

This is a good marketplace design because it protects the customer’s exact address before a provider is selected and also gives room for future workflow expansion.

---

### 3. Finance domain

The finance layer is designed around trust and controlled money movement.

**Implemented ideas in the codebase:**
- Stripe payment intent authorization during bid acceptance
- Manual capture model for safer post-completion charging
- Platform fee and trust fee calculation
- Stripe webhook processing as the source of truth for payment state
- Dispute reporting
- Refund / failed payment / canceled hold handling

This design is stronger than charging immediately because it reduces risk when a job has not yet been completed.

---

### 4. Dispatch domain

The dispatch layer supports location-aware provider matching.

**Implemented ideas in the codebase:**
- Geocoding an agent’s base address
- Saving coordinates and geohash into Firestore
- Storing service radius for future geographic querying

This makes it possible to later build fast local matching and smarter service-area search.

---

### 5. Communications domain

The communications layer helps keep interaction safer and more platform-controlled.

**Implemented ideas in the codebase:**
- Chat censorship trigger for contact-leak prevention
- Detection of phone numbers and payment handles in messages
- Twilio token generation for masked voice calling

This is useful in marketplaces because direct off-platform contact can bypass trust, payment, and dispute systems.

---

### 6. Admin / ops domain

The backend includes live system configuration so the platform can be adjusted without redeploying code.

**Implemented ideas in the codebase:**
- Update pricing config
- Update dispatch settings
- Enable maintenance mode
- Store config changes in Firestore
- Restrict config mutation to admin users

This makes the backend more operationally flexible and more realistic.

---

### 7. Automation and background jobs

The system already includes scheduled logic that behaves like an operational autopilot.

**Implemented ideas in the codebase:**
- Detect stale requests with zero bids
- Alert staff when jobs are dying in the marketplace
- Auto-capture authorized funds after completion delay
- Monitor auctions and mark expired jobs
- Send bid notifications to customers
- Notify agents when a matching request is created

This is one of the more advanced parts of the project because it shows the system is not only request-response based; it also reacts over time.

---

## Project Structure

```text
FIGRUT/
├── index.js
├── admin/
│   └── config.js
├── comms/
│   └── index.js
├── dispatch/
│   └── geographer.js
├── finance/
│   ├── disputes.js
│   └── webhooks.js
├── identity/
│   ├── customers.js
│   ├── onbording.js
│   └── verification.js
├── marketplace/
│   ├── bidding.js
│   ├── change_order.js
│   ├── cron.js
│   ├── requests.js
│   ├── reviews.js
│   ├── selection.js
│   ├── triggers.js
│   └── workflow.js
└── seo.js
```

### Structure notes

The project is organized by domain, which is a strong design choice because it keeps related logic together.

That said, the current codebase appears to be in a **transition/refactor stage**. For example, `index.js` references paths like `./domains/...` while the uploaded folder structure currently stores modules directly under folders such as `identity/`, `marketplace/`, `finance/`, and so on.

So this repository already shows a good architecture direction, but it may need a small cleanup pass before deployment.

---

## Core Backend Flow

A simplified end-to-end flow looks like this:

1. A user signs in with Firebase Auth.
2. A customer creates a profile and gets linked to a Stripe customer.
3. An agent creates a provider profile and gets linked to Stripe Connect.
4. The agent submits verification documents.
5. An admin approves the agent.
6. A customer creates a service request.
7. Matching agents are notified.
8. Agents place bids.
9. The customer accepts one bid.
10. Stripe creates a payment authorization hold.
11. The job is completed and proof is uploaded.
12. Funds are captured later through workflow logic or scheduled automation.
13. If something goes wrong, dispute logic can be triggered.

---

## Why this project is strong

I think this project stands out because it is not just a CRUD backend.

It already includes several real marketplace concerns that many student projects skip:

- trust and verification
- secure payment handling
- role separation
- privacy-aware location sharing
- event-driven triggers
- scheduled automation
- admin operations
- communication safety

So even though it is still an evolving codebase, the system design direction is very solid and feels much closer to an actual startup MVP than a basic classroom backend.

---

## Suggested Firestore Collections

Based on the code, the backend appears to revolve around collections like these:

- `users`
- `customers`
- `agents`
- `requests`
- `requests/{requestId}/bids`
- `system/config`

Additional collections can naturally be added later for:

- disputes
- reviews
- change orders
- payout logs
- audit logs
- support tickets
- analytics snapshots

---

## Environment / configuration needs

To run this backend properly, the following external configuration is expected:

### Firebase config

- Firebase project setup
- Firestore enabled
- Firebase Authentication enabled
- Firebase Cloud Messaging enabled
- Cloud Functions enabled

### Secret/config values

The code expects secret config values such as:

- `stripe.secret_key`
- `stripe.webhook_secret`
- `google.maps_key`
- `twilio.sid`
- `twilio.api_key`
- `twilio.api_secret`
- `twilio.app_sid`

Example Firebase config commands:

```bash
firebase functions:config:set stripe.secret_key="YOUR_STRIPE_SECRET"
firebase functions:config:set stripe.webhook_secret="YOUR_WEBHOOK_SECRET"
firebase functions:config:set google.maps_key="YOUR_GOOGLE_MAPS_KEY"
firebase functions:config:set twilio.sid="YOUR_TWILIO_SID"
firebase functions:config:set twilio.api_key="YOUR_TWILIO_API_KEY"
firebase functions:config:set twilio.api_secret="YOUR_TWILIO_API_SECRET"
firebase functions:config:set twilio.app_sid="YOUR_TWILIO_APP_SID"
```

---

## Local setup

A typical local setup would look like this:

```bash
npm install -g firebase-tools
firebase login
firebase init functions
npm install firebase-admin firebase-functions stripe @googlemaps/google-maps-services-js geofire-common twilio cors
firebase emulators:start
```

Then deploy with:

```bash
firebase deploy --only functions
```

> Note: this repository upload did not include a visible `package.json`, so dependency installation and scripts may still need to be finalized as part of repository cleanup.

---

## Example capabilities by module

### `identity/`
Handles provider onboarding, customer creation, verification, and role sync.

### `marketplace/`
Handles request creation, bids, bid acceptance, lifecycle changes, and scheduled marketplace automation.

### `finance/`
Handles disputes and Stripe webhook-driven money state transitions.

### `dispatch/`
Handles geocoding and territory calculations for service coverage.

### `comms/`
Handles chat safety and secure voice call token generation.

### `admin/`
Handles system-level operational configuration.

### `seo.js`
Exposes public marketplace data for discovery-like use cases.

---

## Current limitations / cleanup opportunities

This backend has a very promising structure, but from the uploaded snapshot, a few things should be cleaned up before calling it production-ready:

- `index.js` path imports appear inconsistent with the current folder structure
- `identity/onbording.js` appears to have a spelling issue in the filename
- Some modules seem more complete than others
- The repository snapshot does not show package metadata files needed for deployment
- Firestore security rules are not included here, but they are critical for a marketplace like this
- API contracts and request/response documentation can be expanded

These are normal issues for an evolving student project and do not take away from the quality of the architecture direction.

---

## Next Step: Advanced Async Architecture

The current Firebase version works well as a practical MVP backend.

The next major upgrade can be to move toward an **advanced async containerized microservice architecture**.

### Suggested next evolution

- Keep Firebase/Auth for fast iteration, or replace parts gradually
- Split domains into services such as:
  - Identity Service
  - Marketplace Service
  - Finance Service
  - Dispatch Service
  - Notification Service
  - Admin / Config Service
- Use **Kafka** for asynchronous events such as:
  - request created
  - bid placed
  - bid accepted
  - job completed
  - dispute opened
  - payout captured
- Containerize services with **Docker**
- Orchestrate with **Kubernetes**
- Add Redis for caching and fast lookup
- Add API gateway and centralized observability

### Why this matters

This would make the backend more scalable, more fault-tolerant, and much closer to enterprise-grade architecture, while still keeping the current Firebase version as a fast and effective MVP.

---

## Resume-friendly summary

This project demonstrates backend work in:

- Firebase Cloud Functions
- Firestore data modeling
- Stripe payment workflow design
- serverless event-driven architecture
- role-based backend access control
- geo-dispatch logic
- scheduled job automation
- communication safety features
- marketplace workflow engineering

---

## Final note

This repository shows a backend that is trying to solve real marketplace problems instead of only building a simple demo app.

To me, that is what makes it valuable.
It feels like a student project with serious engineering ambition behind it.
It is already strong as a Firebase-based MVP, and it has a very clear path toward an async microservice upgrade with Kafka, containers, and Kubernetes in the next stage.

---

## Author

**Md Raihan Islam Siyam**  
Backend / marketplace systems project
