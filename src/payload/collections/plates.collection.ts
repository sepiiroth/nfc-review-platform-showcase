import type { CollectionConfig } from 'payload'

export const Plates: CollectionConfig = {
  slug: 'plates',

  admin: {
    useAsTitle: 'slug',
  },

  /**
   * Plates represent physical NFC tags.
   *
   * Invariants:
   * - A plate is uniquely identified by its `sourceKey`
   * - sourceKey guarantees idempotency during Shopify webhook retries
   * - Plates are created automatically by backend processes only
   */
  access: {
    read: () => true, // public read (for /p/:slug)
    create: ({ req }) => Boolean((req as any).isInternal) || Boolean(req.user), // webhook
    update: ({ req }) => Boolean(req.user), // admin only
    delete: ({ req }) => Boolean(req.user),
  },

  fields: [
    {
      name: 'slug',
      label: 'URL publique',
      type: 'text',
      required: true,
      unique: true,
    },
    {
      name: 'order',
      label: 'Commande liée',
      type: 'relationship',
      relationTo: 'orders',
      required: true,
    },
    {
      name: 'googleReviewUrl',
      label: 'Google Review',
      type: 'text',
      required: true,
    },
    {
      name: 'status',
      label: 'Statut',
      type: 'select',
      options: ['pending', 'activated'],
      defaultValue: 'pending',
    },
    {
      name: 'sourceKey',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description: 'Deterministic idempotency key: orderNumber|lineItemId|index',
      },
    },
    {
      name: 'activatedAt',
      label: 'Activé le',
      type: 'date',
    },
  ],
}
