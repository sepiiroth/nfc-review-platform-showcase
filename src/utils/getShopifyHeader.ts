/**
 * Retrieves a Shopify header value in a runtime-agnostic way.
 *
 * Payload can run on different adapters (Fetch API, Express, etc.),
 * so headers may be exposed differently depending on the environment.
 */
export function getShopifyHeader(req: any, key: string): string | null {
  return (
    req?.headers?.get?.(key) ||
    req?.headers?.get?.(key.toLowerCase()) ||
    req?.headers?.[key] ||
    req?.headers?.[key.toLowerCase()] ||
    null
  )
}
