# Data Model

This project uses three core collections:

- `orders` — one record per Shopify order (idempotent)
- `plates` — one record per physical NFC plate (unique)
- `webhook-events` — one record per Shopify webhook delivery (anti-replay + observability)

The model is designed around **idempotency** and **auditability**.

## orders

### Purpose
Represents a Shopify order and acts as the parent entity for all generated plates.

### Key fields
- `orderNumber` (text, required, unique)  
  Business-level idempotency key. Ensures a Shopify order maps to a single record.
- `customerEmail` (email, required)
- `status` (select: paid/pending/cancelled)
- `plates` (relationship hasMany → `plates`)  
  List of all plates generated for this order.
- `activated` (boolean)  
  Indicates whether plate generation has completed.

### Indexing
- Unique index on `orderNumber` is required for idempotent upsert.

## plates

### Purpose
Represents a **single physical NFC plate**.

A plate is identified publicly by `slug` and redirects to `googleReviewUrl` via `/p/:slug`.

### Key fields
- `slug` (text, required, unique)  
  Public identifier used by NFC tags (`/p/:slug`).
- `order` (relationship → `orders`, required)
- `googleReviewUrl` (text, required)  
  Final destination for redirection.
- `sourceKey` (text, required, unique, indexed)  
  Deterministic idempotency key used to prevent duplicates under retries/concurrency.
- `status` (select: pending/activated)
- `activatedAt` (date)

### Idempotency invariant
`sourceKey = ${orderNumber}|${lineItemId}|${index}`

This ensures that generating the same plates again results in duplicates being rejected at DB level.

### Indexing
- Unique index on `slug` (public uniqueness)
- Unique + indexed `sourceKey` (idempotency and fast lookup)

## webhook-events

### Purpose
Tracks each Shopify webhook delivery for:

- Anti-replay protection (unique `webhookId`)
- Observability / audits
- Debugging failures without relying on logs only

### Key fields
- `provider` (select, default: shopify)
- `webhookId` (text, required, unique, indexed)  
  Unique per webhook delivery. Used to stop reprocessing retries.
- `topic` (text, required, indexed)
- `orderNumber` (text, indexed, optional)  
  Filled once extracted from the payload.
- `status` (select: received/processed/failed, indexed)
- `error` (textarea, optional)
- timestamps (`createdAt`, `updatedAt`)

### Indexing
- Unique index on `webhookId` is critical for anti-replay.

## Relationships

- One `order` has many `plates`
- Each `plate` belongs to one `order`

`webhook-events` is intentionally decoupled from orders to remain a delivery-level log.

## Notes / trade-offs

### Why store `webhook-events` instead of relying only on logs?
- Retries are common with webhooks
- Persisting delivery state makes failures observable and auditable
- Helps support/debugging without searching server logs

### Why not delete webhook-events immediately after success?
- Keeping a short retention window enables audits and debugging
- A purge job can remove finalized events after X days (e.g. 30)
