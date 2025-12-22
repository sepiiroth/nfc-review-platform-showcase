# Security

This project receives **Shopify webhooks** and performs automated backend actions (order upsert + NFC plate generation).  
Because webhooks are exposed publicly, we must treat every request as untrusted and apply strict security gates.

---

## Threat model

### What we must protect against
- **Forged webhook calls** (attacker calls the endpoint directly)
- **Payload tampering** (request body modified in transit)
- **Replay attacks** (same delivery processed multiple times)
- **Concurrency issues** (parallel executions creating duplicates)
- **Operational failures** that cause Shopify to retry aggressively

### What we *do not* rely on
- Client IP allowlists (can change, not sufficient alone)
- Request body parsing before verification (breaks signature validation)
- Response body (Shopify ignores it)

---

## Webhook authenticity (HMAC)

Shopify signs webhook requests using **HMAC SHA-256**.

### How it works
- Shopify sends a signature in the header: `x-shopify-hmac-sha256`
- The signature is computed from the **raw request body** and a shared secret (`SHOPIFY_WEBHOOK_SECRET`)
- We recompute the HMAC server-side and compare it to the header

### Why we read the RAW body
HMAC verification depends on the exact byte payload.  
If we parse or mutate JSON before verification, the signature can become invalid.

### Timing-safe comparison
We use a timing-safe equality check (`crypto.timingSafeEqual`) to avoid timing attacks.

---

## Request validation gates

We reject early if any of the following conditions are not met:

1. **Topic gate**  
   Header `x-shopify-topic` must equal `orders/paid`.  
   This prevents accidental routing of unrelated webhooks to this endpoint.

2. **Webhook ID required**  
   Header `x-shopify-webhook-id` must be present.  
   We use it for strict anti-replay protection.

3. **HMAC signature check (optional flag)**  
   Controlled by `SHOPIFY_WEBHOOK_VERIFY_SIGNATURE` (defaults to enabled).  
   In production, signature verification should always be enabled.

---

## Anti-replay protection (webhookId)

Shopify can retry the same delivery multiple times.  
To ensure **each webhook delivery is processed at most once**, we persist a webhook event early:

- Collection: `webhook-events`
- Unique field: `webhookId` (unique index)

### Behavior
- First delivery: `webhook-events` insert succeeds → continue processing
- Retry delivery: insert fails with a duplicate key error → return `200 OK`

Returning `200` is critical: Shopify stops retrying only on a successful HTTP status code.

---

## Idempotency guarantees

### Orders: idempotent upsert
Shopify can send duplicates or retries for the same order.  
We ensure a single consistent order record using:

- `orders.orderNumber` as the business-level idempotency key (unique)

Processing the same order multiple times results in:
- one order document updated to the latest consistent state

### Plates: strict idempotent creation with deterministic key
Plates must never be duplicated.

We generate a deterministic unique key:

`sourceKey = ${orderNumber}|${lineItemId}|${index}`

- `orderNumber`: identifies the Shopify order
- `lineItemId`: stable Shopify line item identifier
- `index`: unit index within the computed number of plates for that item

A **unique index** on `plates.sourceKey` enforces the invariant at the DB level.

#### Concurrency safety
Even if two processes run in parallel:
- both compute the same `sourceKey`
- only one insert wins
- the other gets a duplicate key error and safely ignores it

---

## Pack variants validation

The final number of plates to create is:

`units = quantity × packSize`

Where `packSize` is inferred from `variant_title` / `name` (e.g. `"… / 5 Plaques"`).

If packSize cannot be inferred, we fail the webhook event (no silent default).  
This prevents business-critical under-generation (e.g. generating 2 instead of 10 plates).

---

## Observability & incident response

Every webhook delivery is tracked in `webhook-events` with:
- `status`: `received` → `processed` or `failed`
- `error` when failing

This makes it possible to:
- audit what happened for a given order
- identify repeated retries
- debug failures without relying on external logs only

---

## Retention (optional)

Webhook events are operational logs and can be purged after a retention window (e.g. 30 days).  
A lightweight in-process purge job can delete old finalized events (`processed/failed`) to keep the DB tidy.
