import type { CollectionConfig } from 'payload'

export const WebhookEvents: CollectionConfig = {
  slug: 'webhook-events',

  admin: {
    useAsTitle: 'webhookId',
  },

  /**
   * Webhook events are used for:
   * - Anti-replay protection
   * - Debugging & observability
   * - Support audits
   *
   * They should never be modified by public users.
   */
  access: {
    read: ({ req }) => Boolean(req.user),
    create: () => true, // webhook
    update: () => true, // webhook
    delete: ({ req }) => Boolean(req.user),
  },

  fields: [
    {
      name: 'provider',
      type: 'select',
      required: true,
      options: [{ label: 'Shopify', value: 'shopify' }],
      defaultValue: 'shopify',
    },
    {
      name: 'webhookId',
      type: 'text',
      required: true,
      unique: true, // anti-replay guarantee
      index: true,
    },
    {
      name: 'topic',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'orderNumber',
      type: 'text',
      index: true,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      options: [
        { label: 'Received', value: 'received' },
        { label: 'Processed', value: 'processed' },
        { label: 'Failed', value: 'failed' },
      ],
      defaultValue: 'received',
      index: true,
    },
    {
      name: 'error',
      type: 'textarea',
    },
  ],

  timestamps: true,
}
