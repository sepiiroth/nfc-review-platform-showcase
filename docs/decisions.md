# Technical Decisions

This document records the key architectural and technical decisions made for the
Shopify → Payload NFC plate generation system.

The goal is to explain **why** things are done this way, not just **how**.

---

## DEC-001 — Verify Shopify webhooks using HMAC on the raw body

**Decision**  
Webhook authenticity is verified using the `x-shopify-hmac-sha256` header,
computed against the **raw request body**.

**Rationale**
- Shopify signs the exact raw payload
- Parsing or mutating the body before verification breaks the signature
- Ensures requests cannot be forged or tampered with

**Consequences**
- The request body must be read as text
- No body-parsing middleware can run before verification

---

## DEC-002 — Persist webhook deliveries early for anti-replay protection

**Decision**  
Each webhook delivery is persisted immediately using `webhookId` as a unique key.

**Rationale**
- Shopify retries webhooks on timeout or non-2xx responses
- Multiple deliveries of the same event are expected
- Database-level uniqueness is the safest anti-replay mechanism

**Consequences**
- Duplicate deliveries are detected reliably
- Duplicate webhook deliveries return `200 OK` immediately
- Requires retention management for the `webhook-events` collection

---

## DEC-003 — Orders are idempotent by `orderNumber`

**Decision**  
Orders are created or updated using `orderNumber` as a business-level idempotency key.

**Rationale**
- The same Shopify order may be delivered multiple times
- Upsert semantics guarantee a single consistent order record
- Simplifies reconciliation and support workflows

**Consequences**
- `orderNumber` must be unique at the database level
- Order updates must be carefully scoped to avoid overwriting valid data

---

## DEC-004 — Plates use deterministic idempotency keys (`sourceKey`)

**Decision**  
Each NFC plate is uniquely identified by a deterministic `sourceKey`:

sourceKey = ${orderNumber}|${lineItemId}|${index}


**Rationale**
- Prevents duplicate plate creation on retries or concurrency
- Avoids distributed locks or transactional complexity
- Leverages database uniqueness guarantees

**Consequences**
- Requires stable identifiers from Shopify (`lineItemId`)
- Source key format must never change after deployment

---

## DEC-005 — Pack size inferred from Shopify variant naming

**Decision**  
The number of plates per line item is inferred by parsing
`variant_title` and `name` (e.g. `"5 Plaques"`).

**Rationale**
- Packs are represented as Shopify variants
- Shopify does not expose pack size as structured data by default
- Silent defaults would cause under- or over-generation of plates

**Consequences**
- Variant naming must follow a strict convention
- Unsupported or unknown pack sizes cause the webhook to fail safely
- A future improvement could map `variant_id → packSize`

---

## DEC-006 — Fail fast on invalid business data

**Decision**  
If critical business data is invalid (pack size, review URL, missing IDs),
the webhook is marked as failed and returns `200 OK`.

**Rationale**
- Retrying cannot fix invalid payloads
- Generating incorrect physical output is worse than failing
- Shopify retries must be explicitly stopped

**Consequences**
- Errors are visible in `webhook-events`
- Support intervention is required for corrections

---

## DEC-007 — Minimal webhook responses

**Decision**  
The webhook always returns an empty response body with an appropriate HTTP status.

**Rationale**
- Shopify ignores the response body
- Only the HTTP status code affects retries
- Keeps the endpoint simple and focused

**Consequences**
- Debugging relies on logs and `webhook-events`
- No client-facing feedback through the webhook channel

---

## DEC-008 — Email notifications are best-effort only

**Decision**  
Internal email notifications are optional and must never fail the webhook.

**Rationale**
- Email is not part of the system’s correctness
- External email providers may fail independently
- Database state remains the source of truth

**Consequences**
- Notification failures are logged
- Support can rely on the admin dashboard if emails are missed