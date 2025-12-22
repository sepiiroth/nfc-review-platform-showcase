import crypto from 'crypto'

/**
 * Verifies the authenticity of a Shopify webhook using HMAC SHA-256.
 *
 * Shopify signs the RAW request body with a shared secret.
 * We recompute the signature and compare it using a timing-safe check.
 */
export function checkShopifySignature(rawBody: string, hmacHeader: string | null): boolean {
  if (!hmacHeader) return false

  const secret = process.env.SHOPIFY_WEBHOOK_SECRET
  if (!secret) {
    throw new Error('SHOPIFY_WEBHOOK_SECRET missing')
  }

  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')

  const a = Buffer.from(digest)
  const b = Buffer.from(hmacHeader)

  // Prevent timing attacks
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
