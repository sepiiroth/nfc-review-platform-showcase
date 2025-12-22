/**
 * Detects duplicate / unique constraint errors in a database-agnostic way.
 *
 * This is required to make idempotent operations safe
 * under concurrency and webhook retries.
 */
export function isDuplicateKeyError(err: any): boolean {
  const s = String(
    err?.message ??
      err?.data?.message ??
      err?.data?.errors?.[0]?.message ??
      err?.errors?.[0]?.message ??
      err,
  ).toLowerCase()

  return (
    err?.code === 11000 || // MongoDB duplicate key
    s.includes('e11000') ||
    s.includes('duplicate') ||
    s.includes('unique') ||
    s.includes('already exists') ||
    s.includes('has already been taken')
  )
}
