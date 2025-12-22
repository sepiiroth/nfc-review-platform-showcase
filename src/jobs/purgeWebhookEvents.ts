import type { Payload } from 'payload'

type PurgeOptions = {
  /**
   * Interval between purge runs.
   * Default: once per day.
   */
  everyMs?: number

  /**
   * Retention window in days.
   * Default: 30 days.
   */
  keepDays?: number
}

async function purgeOnce(payload: Payload, keepDays: number) {
  /**
   * We compute a cutoff date and delete only "final" webhook events older than that.
   *
   * Why only final statuses (processed/failed)?
   * - `received` can be useful for investigating "stuck" deliveries
   * - deleting it too aggressively can reduce debugging visibility
   *
   * You can extend the purge to include very old `received` events if needed.
   */
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000).toISOString()

  await payload.delete({
    collection: 'webhook-events',
    where: {
      and: [
        { createdAt: { less_than: cutoff } },
        { status: { in: ['processed', 'failed'] } },
      ],
    },
    // In production, this should run as an internal backend process.
    // If you implement access rules based on `req.isInternal`, you can avoid overrideAccess.
    overrideAccess: true,
  })
}

/**
 * Starts a lightweight in-process purge loop.
 *
 * Notes:
 * - This is intentionally "best effort": it must never crash the app.
 * - In a larger architecture, this could be moved to a real scheduler (cron, queue worker).
 */
export function startWebhookEventsPurge(payload: Payload, opts: PurgeOptions = {}) {
  const everyMs = opts.everyMs ?? 24 * 60 * 60 * 1000 // 24h
  const keepDays = opts.keepDays ?? 30

  // Run once at boot to keep the DB tidy even if the service restarts infrequently.
  purgeOnce(payload, keepDays).catch((err) => {
    payload.logger?.error?.(err, 'Webhook events purge failed (boot)')
  })

  // Then run periodically (best effort).
  setInterval(() => {
    purgeOnce(payload, keepDays).catch((err) => {
      payload.logger?.error?.(err, 'Webhook events purge failed (interval)')
    })
  }, everyMs)
}
