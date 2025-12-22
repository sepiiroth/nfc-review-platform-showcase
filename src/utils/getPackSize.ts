/**
 * Infers the pack size (number of NFC plates per unit) from a Shopify line_item.
 *
 * Context:
 * - Packs are represented as variants (e.g. "blanc / 5 Plaques").
 * - Shopify sends this information in `variant_title` and sometimes `name`.
 *
 * Why this function matters:
 * - The final number of plates to generate is: units = quantity * packSize
 * - If packSize is not detected, generating a default would silently create
 *   the wrong number of plates (critical business error).
 *
 * Business rules:
 * - Only the supported pack sizes are allowed (1, 2, 5)
 * - If the variant naming changes and we can't infer the size, we return null
 *   so the webhook can mark the event as failed and notify support.
 */
export function getPackSize(item: any): number | null {
  const variant = String(item?.variant_title ?? '').toLowerCase()
  const name = String(item?.name ?? '').toLowerCase()

  // We search in both fields for resilience (Shopify payload variations)
  const hay = `${variant} ${name}`

  // Matches: "5 Plaques", "5 plaque"
  // Example: "blanc / 5 Plaques" -> packSize = 5
  const m = hay.match(/(?:^|[^\d])(\d+)\s*plaque(?:s)?\b/i)
  if (!m) return null

  const n = Number(m[1])
  if (!Number.isFinite(n)) return null

  // Restrict to known pack sizes to avoid unexpected variants (e.g. "10 Plaques")
  if (n === 1 || n === 2 || n === 5) return n

  return null
}
