import type { Endpoint } from 'payload'
import crypto from 'crypto'

import { normalizeGoogleReviewLinkStrict } from '@/lib/utils/normalizeGoogleReviewLinkStrict'
import { extractGoogleGroupsFromShopify } from '@/lib/utils/extractGoogleGroupsFromShopify'
import { getShopifyHeader } from '@/lib/utils/getShopifyHeader'
import { checkShopifySignature } from '@/lib/utils/verifyShopifyHmac'
import { isDuplicateKeyError } from '@/lib/utils/isDuplicateKeyError'
import { buildEmailHtml } from '@/lib/buildEmailtml'

/**
 * Shopify Webhook — orders/paid
 *
 * IMPORTANT CONSTRAINTS:
 * - Shopify webhooks can be retried multiple times.
 * - Shopify only cares about the HTTP status code (2xx = success).
 * - The response body is ignored by Shopify.
 *
 * GOALS OF THIS ENDPOINT:
 * - Verify authenticity (HMAC)
 * - Prevent replay / duplicates (webhookId + idempotency)
 * - Create exactly one order and the correct number of plates
 * - Never create duplicates, even under retries or concurrency
 * - Keep full observability via `webhook-events`
 */

export const shopifyOrdersPaidWebhook: Endpoint = {
  path: '/shopify/webhook/orders-paid',
  method: 'post',

  handler: async (req) => {
    // Mark this request as internal (trusted backend process)
    ;(req as any).isInternal = true
    const webReq = req as unknown as Request

    /**
     * We must read the RAW body as text.
     * Shopify HMAC verification depends on the exact raw payload
     * (any JSON parsing or mutation would invalidate the signature).
     */
    const rawBody = await webReq.text()

    /**
     * Shopify sends critical metadata in HTTP headers:
     * - topic: why this webhook was triggered
     * - webhookId: unique ID for this delivery (anti-replay)
     * - hmac: signature proving the request comes from Shopify
     */
    const topic = getShopifyHeader(req, 'x-shopify-topic')
    const webhookId = getShopifyHeader(req, 'x-shopify-webhook-id')
    const hmac = getShopifyHeader(req, 'x-shopify-hmac-sha256')

    /* ------------------------------------------------------------------ */
    /* 1) SECURITY & VALIDATION GATES                                      */
    /* ------------------------------------------------------------------ */

    /**
     * Topic gate:
     * This endpoint is strictly dedicated to `orders/paid`.
     * Any other topic is rejected immediately.
     */
    if (topic !== 'orders/paid') {
      return new Response(null, { status: 401 })
    }

    /**
     * webhookId is mandatory for anti-replay.
     * Without it, we cannot guarantee idempotency.
     */
    if (!webhookId) {
      return new Response(null, { status: 401 })
    }

    /**
     * HMAC verification:
     * Ensures the request truly comes from Shopify
     * and was not forged or tampered with.
     */
    const verifySignature = process.env.SHOPIFY_WEBHOOK_VERIFY_SIGNATURE !== 'false'

    if (verifySignature) {
      try {
        if (!checkShopifySignature(rawBody, hmac)) {
          return new Response(null, { status: 401 })
        }
      } catch {
        // Misconfiguration (missing secret, crypto error, etc.)
        return new Response(null, { status: 500 })
      }
    }

    /* ------------------------------------------------------------------ */
    /* 2) ANTI-REPLAY INITIALIZATION                                       */
    /* ------------------------------------------------------------------ */

    /**
     * We persist the webhook event as early as possible.
     *
     * Why:
     * - Shopify retries webhooks on timeout or error.
     * - We must ensure the same webhookId is processed only once.
     * - A unique index on webhook-events.webhookId enforces this at DB level.
     */
    let eventId: string | null = null

    /**
     * Helper to update the webhook-event safely.
     * This must NEVER break the webhook execution.
     */
    const markEvent = async (data: Record<string, any>) => {
      if (!eventId) return
      try {
        await req.payload.update({
          collection: 'webhook-events',
          id: eventId,
          data,
        })
      } catch (e) {
        // Observability only — webhook must continue
        req.payload.logger?.error?.(e, 'Failed to update webhook-event')
      }
    }

    try {
      const event = await req.payload.create({
        collection: 'webhook-events',
        data: {
          provider: 'shopify',
          webhookId,
          topic,
          status: 'received',
        },
      })
      eventId = event.id
    } catch (err: any) {
      /**
       * Duplicate webhookId means Shopify retried an already
       * processed webhook.
       *
       * We MUST return 200 so Shopify stops retrying.
       */
      if (isDuplicateKeyError(err)) {
        return new Response(null, { status: 200 })
      }
      return new Response(null, { status: 500 })
    }

    /* ------------------------------------------------------------------ */
    /* 3) PAYLOAD PARSING & BASIC DATA                                     */
    /* ------------------------------------------------------------------ */

    let body: any
    try {
      body = JSON.parse(rawBody)
    } catch {
      await markEvent({ status: 'failed', error: 'Invalid JSON body' })
      // Permanent error → no retry
      return new Response(null, { status: 200 })
    }

    /**
     * orderNumber is our business-level unique identifier.
     * It is used as the idempotency key for orders.
     */
    const orderNumber = String(body?.order_number ?? body?.name ?? '')
    const customerEmail = String(body?.email ?? body?.customer?.email ?? '')

    if (!orderNumber || !customerEmail) {
      await markEvent({
        status: 'failed',
        error: 'Missing orderNumber or customerEmail',
      })
      return new Response(null, { status: 200 })
    }

    /* ------------------------------------------------------------------ */
    /* 4) GOOGLE GROUP EXTRACTION                                          */
    /* ------------------------------------------------------------------ */

    /**
     * Each group represents a line_item containing a Google URL
     * and a quantity (number of plates to generate).
     */
    const groups = extractGoogleGroupsFromShopify(body)

    if (!groups.length) {
      await markEvent({
        status: 'failed',
        orderNumber,
        error: 'No Google URL found in line_items',
      })
      return new Response(null, { status: 200 })
    }

    if (groups.some((g) => !g.units || g.units <= 0)) {
      await markEvent({
        status: 'failed',
        orderNumber,
        error: 'Unable to infer pack size from variant_title/name (expected 1/2/5 Plaques).',
      })
      return new Response(null, { status: 200 })
    }

    /* ------------------------------------------------------------------ */
    /* 5) UPSERT ORDER (IDEMPOTENT)                                        */
    /* ------------------------------------------------------------------ */

    /**
     * Orders are upserted to guarantee idempotency:
     * processing the same Shopify order multiple times
     * must always result in a single consistent order record.
     */
    const existing = await req.payload.find({
      collection: 'orders',
      where: { orderNumber: { equals: orderNumber } },
      limit: 1,
    })

    const order = existing.docs[0]
      ? await req.payload.update({
          collection: 'orders',
          id: existing.docs[0].id,
          data: {
            customerEmail,
            status: 'paid',
          },
        })
      : await req.payload.create({
          collection: 'orders',
          data: {
            orderNumber,
            customerEmail,
            status: 'paid',
            activated: false,
          },
        })

    /* ------------------------------------------------------------------ */
    /* 6) PLATE CREATION (STRICTLY IDEMPOTENT)                             */
    /* ------------------------------------------------------------------ */

    /**
     * We fetch existing plates to build a set of already-used sourceKeys.
     * This avoids recreating plates during retries.
     */
    const existingPlates = await req.payload.find({
      collection: 'plates',
      where: { order: { equals: order.id } },
      limit: 500,
    })

    const existingSourceKeys = new Set(
      existingPlates.docs.map((p: any) => String(p.sourceKey)).filter(Boolean),
    )

    /**
     * This array only contains plates created during THIS execution.
     * Used for notifications.
     */
    const createdPlates: Array<{
      slug: string
      reviewUrl: string
      publicUrl: string
    }> = []

    /**
     * We generate plates idempotently using a deterministic `sourceKey`.
     *
     * sourceKey = `${orderNumber}|${lineItemId}|${index}`
     *
     * Why this works:
     * - orderNumber → identifies the Shopify order
     * - lineItemId  → identifies the product line (stable)
     * - index       → identifies the unit within the quantity
     *
     * This guarantees:
     * - No duplicate plates on webhook retries
     * - Safety under concurrent executions
     *
     * A UNIQUE index on `plates.sourceKey` enforces this at DB level.
     */
    for (const g of groups) {
      if (!g.lineItemId) {
        await markEvent({
          status: 'failed',
          orderNumber,
          error: 'Missing lineItemId (idempotence impossible)',
        })
        return new Response(null, { status: 200 })
      }

      const reviewUrl = normalizeGoogleReviewLinkStrict(g.reviewUrl)
      if (!reviewUrl) {
        await markEvent({
          status: 'failed',
          orderNumber,
          error: `Invalid Google review URL: ${g.reviewUrl}`,
        })
        return new Response(null, { status: 200 })
      }

      for (let i = 0; i < g.units; i++) {
        const sourceKey = `${orderNumber}|${g.lineItemId}|${i}`
        if (existingSourceKeys.has(sourceKey)) continue

        try {
          const slug = crypto.randomBytes(6).toString('hex')

          await req.payload.create({
            collection: 'plates',
            data: {
              slug,
              order: order.id,
              sourceKey,
              googleReviewUrl: reviewUrl,
              status: 'activated',
              activatedAt: new Date().toISOString(),
            },
          })

          existingSourceKeys.add(sourceKey)

          createdPlates.push({
            slug,
            reviewUrl,
            publicUrl: `/p/${slug}`,
          })
        } catch (err: any) {
          /**
           * If another concurrent process created the same plate
           * between our checks, the unique index will throw.
           * We safely ignore duplicate key errors.
           */
          if (!isDuplicateKeyError(err)) throw err
        }
      }
    }

    /* ------------------------------------------------------------------ */
    /* 7) FINALIZATION                                                     */
    /* ------------------------------------------------------------------ */

    /**
     * Re-fetch plates to ensure we have the authoritative final state,
     * even in case of concurrent executions.
     */
    const finalPlates = await req.payload.find({
      collection: 'plates',
      where: { order: { equals: order.id } },
      limit: 500,
    })

    await req.payload.update({
      collection: 'orders',
      id: order.id,
      data: {
        activated: true,
        plates: finalPlates.docs.map((p: any) => p.id),
      },
    })

    await markEvent({
      status: 'processed',
      orderNumber,
      createdPlatesCount: createdPlates.length,
    })

    /* ------------------------------------------------------------------ */
    /* 8) OPTIONAL ADMIN NOTIFICATION                                      */
    /* ------------------------------------------------------------------ */

    const notifyTo = process.env.PLATES_NOTIFICATION_EMAIL
    const publicBaseUrl = process.env.PUBLIC_APP_URL || ''

    if (notifyTo && createdPlates.length > 0) {
      try {
        await req.payload.sendEmail({
          to: notifyTo,
          subject: `Nouvelles plaques NFC — Commande ${orderNumber}`,
          html: buildEmailHtml({
            orderNumber,
            customerEmail,
            createdPlates,
            publicBaseUrl,
          }),
        })
      } catch (e) {
        // Email failure must never affect webhook delivery
        req.payload.logger?.error?.(e, 'Admin email notification failed')
      }
    }

    /* ------------------------------------------------------------------ */
    /* 9) MINIMAL SUCCESS RESPONSE                                         */
    /* ------------------------------------------------------------------ */

    // Shopify only checks the HTTP status code.
    // 200 tells Shopify the webhook was successfully handled.
    return new Response(null, { status: 200 })
  },
}
