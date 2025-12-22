# Shopify → Payload NFC Plates (Showcase)

This repository is a **technical showcase** of a production integration that generates **NFC plates** from **Shopify orders** using **Payload CMS**.

When a customer purchases NFC packs (1 / 2 / 5 plates), Shopify triggers an `orders/paid` webhook.  
The backend verifies authenticity (HMAC), prevents replays, and generates exactly the right number of plates **idempotently**.

> Note: This repo is an anonymized extract for portfolio purposes. No client secrets or production data are included.

---

## Problem

We sell physical NFC plates. Each plate must point to a public URL:

- `/p/:slug` (our domain) → redirects to the final Google Review URL

Key constraints:

- Shopify webhooks can be retried multiple times.
- The system must be safe under concurrency (duplicate deliveries, parallel processing).
- Pack variants exist: a line item can represent **1 / 2 / 5 plates**, and `quantity` can be > 1.
- We must never create duplicate plates.

---

## Solution Overview

### Flow

1. Shopify sends `orders/paid` webhook
2. Backend validates:
   - topic header
   - webhook delivery ID (anti-replay)
   - HMAC signature (authenticity)
3. Persist webhook-event early (unique webhookId)
4. Upsert order (unique orderNumber)
5. Compute real number of plates:
   - `units = quantity × packSize`
   - packSize inferred from `variant_title` (e.g. `"... / 5 Plaques"`)
6. Create plates idempotently with deterministic keys
7. Mark webhook-event processed
8. Notify internal support email with generated plate links

---

## Key Technical Points

### 1) Authenticity (HMAC)

Shopify signs the **raw request body** with a shared secret.  
We recompute the HMAC SHA-256 digest and compare using timing-safe equality.

Why: prevents forged/tampered webhook calls.

### 2) Anti-replay

Each webhook delivery contains a unique `x-shopify-webhook-id`.

We store it in `webhook-events.webhookId` (unique index).  
If Shopify retries the same delivery, the insert fails and we return **200** to stop retries.

### 3) Idempotence for plates

Plates are created with a deterministic unique key:

`sourceKey = ${orderNumber}|${lineItemId}|${index}`

- `orderNumber`: business-level order identifier
- `lineItemId`: stable Shopify line item identifier
- `index`: unit within the computed pack quantity

A **unique index** on `plates.sourceKey` enforces this at the DB level.

### 4) Pack variants support

Shopify line items include `variant_title` such as:

`"blanc / 5 Plaques"`

We infer pack size from this string and compute:

`units = quantity × packSize`

If pack size cannot be inferred, the webhook is marked as failed (no silent under-generation).

---

## Data Model

- **orders**
  - `orderNumber` (unique)
  - `customerEmail`
  - `status`
  - `plates[]`
  - `activated`

- **plates**
  - `slug` (unique public id)
  - `googleReviewUrl`
  - `sourceKey` (unique idempotency key)
  - `status`, `activatedAt`

- **webhook-events**
  - `webhookId` (unique)
  - `topic`
  - `status` (received / processed / failed)
  - `orderNumber`, `error`
  - timestamps

More details: see `docs/data-model.md`.

---

---

## Technical Documentation

This repository includes detailed technical documentation to explain
the architectural choices, data model, and operational behavior.

- **Architecture overview**  
  `docs/architecture.md`  
  High-level system design, data flow, and responsibilities.

- **Technical decisions**  
  `docs/decisions.md`  
  Rationale behind idempotency, webhook handling, pack inference, and safety choices.

- **Data model**  
  `docs/data-model.md`  
  Collections, invariants, and relationships.

- **Runbook**  
  `docs/runbook.md`  
  How to operate, debug, and maintain the system in production.


## Files to review

- Webhook handler: `src/webhook/orders-paid.endpoint.ts`
- Collections:
  - `src/payload/collections/orders.collection.ts`
  - `src/payload/collections/plates.collection.ts`
  - `src/payload/collections/webhook-events.collection.ts`
- Utilities:
  - `src/utils/verifyShopifyHmac.ts`
  - `src/utils/getPackSize.ts`
  - `src/utils/extractGroups.ts`

---

## Local testing (anonymized)

This repo is not a full runnable app; it focuses on the core integration logic.

- Example payload: `examples/shopify-webhook-payload.sample.json`
- Environment template: `examples/env.example`

---

## Roadmap

- V2: redirect analytics (count scans per plate)
- V2: admin dashboards for plate usage
- V2: optional customer portal for management

---

## Author

Rafael — Frontend/Fullstack developer (React/Next + backend integrations)
