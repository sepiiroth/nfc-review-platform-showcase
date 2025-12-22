import { getPackSize } from "./getPackSize";

/**
 * Extracts Google-related line items from a Shopify order payload.
 *
 * For each line_item containing a Google URL in its properties,
 * this function returns a group describing:
 * - reviewUrl: the raw Google Business URL provided by the customer
 * - quantity: number of NFC plates to generate
 * - lineItemId: a STABLE identifier used for idempotency
 *
 * IMPORTANT:
 * - This function MUST be deterministic.
 * - lineItemId MUST be stable across webhook retries.
 */
export function extractGroups(body: any): Array<{
  reviewUrl: string;
  units: number;
  lineItemId: string;
}> {
  const lineItems = Array.isArray(body?.line_items) ? body.line_items : [];

  const groups: Array<{
    reviewUrl: string;
    units: number;
    lineItemId: string;
  }> = [];

  for (const item of lineItems) {
    /**
     * Shopify line items can have custom properties
     * provided via the product form or cart.
     */

    const props = item?.properties;

    const reviewUrl = Array.isArray(props)
      ? findReviewUrlInProperties(props)
      : null;

    // Ignore line items that are not related to Google/NFC
    if (!reviewUrl) continue;

    /**
     * Quantity fallback logic:
     * - quantity (standard)
     * - current_quantity (edge cases / adjustments)
     * - default to 1 to avoid generating 0 plates
     */
    const quantityRaw = Number(item?.quantity ?? item?.current_quantity ?? 1);
    const quantity =
      Number.isFinite(quantityRaw) && quantityRaw > 0 ? quantityRaw : 1;

    const packSize = getPackSize(item);

    // For V1, better to fail than to generate the wrong number of plates.
    if (!packSize) {
      throw new Error("NO PACK SIZE");
    }

    /**
     * line_item.id is guaranteed to be stable by Shopify
     * and MUST be used for idempotency.
     *
     * ❗ IMPORTANT:
     * We intentionally DO NOT generate a random fallback here.
     * If lineItemId is missing, idempotency would be broken.
     * This case should be handled as a fatal business error upstream.
     */
    if (!item?.id && !item?.admin_graphql_api_id) {
      continue; // or throw, depending on your strictness
    }

    const lineItemId = String(item.id ?? item.admin_graphql_api_id);

    const units = quantity * packSize;

    groups.push({ reviewUrl, units, lineItemId });
  }

  return groups;
}

/**
 * Attempts to extract a Google-related URL from Shopify line item properties.
 *
 * Strategy:
 * 1. Look for an exact property name: "google_business_url"
 * 2. Fallback to any property containing "google" in its name
 *
 * This makes the system resilient to theme / form variations.
 */
function findReviewUrlInProperties(properties: any[]): string | null {
  if (!Array.isArray(properties)) return null;

  // Preferred explicit property name
  const exact = properties.find(
    (p: any) =>
      String(p?.name ?? "")
        .trim()
        .toLowerCase() === "google_business_url"
  );

  if (exact?.value) {
    return String(exact.value).trim();
  }

  // Fallback for looser naming conventions
  const loose = properties.find((p: any) =>
    String(p?.name ?? "")
      .toLowerCase()
      .includes("google")
  );

  if (loose?.value) {
    return String(loose.value).trim();
  }

  return null;
}
