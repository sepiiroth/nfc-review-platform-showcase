# Runbook

This document explains how to operate, debug, and maintain the
Shopify → Payload NFC plate generation system in production.

---

## Normal operation

### Expected behavior
- Shopify sends an `orders/paid` webhook
- Endpoint returns `200 OK`
- One order record exists per Shopify order
- Plates are created exactly once
- Webhook event status transitions to `processed`

---

## Monitoring checklist

Regularly monitor:
- Error logs from the webhook endpoint
- `webhook-events` with status `failed`
- Unexpected growth in `webhook-events` collection
- Email delivery failures (non-blocking)

---

## Common issues & resolutions

### Issue: Duplicate webhook deliveries

**Symptoms**
- Multiple webhook deliveries with the same `webhookId`

**Expected behavior**
- Only the first delivery is processed
- Subsequent deliveries return `200 OK`
- No duplicate orders or plates are created

**Action**
- None (expected behavior)

---

### Issue: Webhook marked as `failed`

**Symptoms**
- `webhook-events.status = failed`

**Common causes**
- Invalid JSON payload
- Missing `orderNumber` or `customerEmail`
- Unsupported pack size
- Invalid Google review URL

**Action**
1. Inspect `webhook-events.error`
2. Fix the Shopify product / variant / customer input
3. Manually trigger a new valid order if needed

---

### Issue: Plates missing or incorrect count

**Symptoms**
- Order exists but plate count is incorrect

**Likely causes**
- Variant naming does not match supported pack sizes
- Pack inference logic failed

**Action**
- Verify Shopify variant titles
- Ensure pack sizes are strictly `1`, `2`, or `5 Plaques`
- Re-run generation manually if required

---

### Issue: Email notification not received

**Symptoms**
- Plates created but no email received

**Notes**
- Email is best-effort and non-critical

**Action**
- Check email provider logs
- Verify environment variables
- Rely on admin UI as source of truth

---

## Safe maintenance tasks

### Purging webhook events

Old finalized webhook events can be safely deleted.

Recommended policy:
- Keep last 30 days
- Delete events with status `processed` or `failed`

This does NOT affect system correctness.

---

### Environment variable rotation

When rotating secrets:
- Update `SHOPIFY_WEBHOOK_SECRET`
- Redeploy backend
- Verify webhook delivery via Shopify test webhook

---

## What NOT to do

- Do NOT remove unique indexes (`orderNumber`, `sourceKey`, `webhookId`)
- Do NOT generate random idempotency keys
- Do NOT silently default pack sizes
- Do NOT fail the webhook because of email errors

---

## Recovery guarantees

Thanks to idempotency:
- Reprocessing the same webhook is always safe
- Partial failures do not corrupt state
- Database remains the single source of truth
