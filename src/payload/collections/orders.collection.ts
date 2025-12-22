import type { CollectionConfig } from "payload";

export const Orders: CollectionConfig = {
  slug: "orders",

  admin: {
    useAsTitle: "orderNumber",
  },

  /**
   * Orders are created and updated exclusively by backend processes
   * (Shopify webhooks, internal jobs).
   *
   * They are readable by admins for support/debug purposes.
   * They are NOT writable by public users.
   */
  access: {
    read: ({ req }) => {
      // Admins can read
      if (req.user) return true;

      // Internal backend processes (webhooks, jobs)
      if ((req as any).isInternal) return true;

      return false;
    },
    create: ({ req }) => Boolean((req as any).isInternal) || Boolean(req.user),
    update: ({ req }) => Boolean((req as any).isInternal) || Boolean(req.user), // webhook (no user)
    delete: ({ req }) => Boolean(req.user),
  },

  fields: [
    {
      name: "orderNumber",
      label: "Numéro de commande",
      type: "text",
      required: true,
      unique: true, // business-level idempotency key
    },
    {
      name: "customerEmail",
      label: "Email du client",
      type: "email",
      required: true,
    },
    {
      name: "status",
      label: "Statut",
      type: "select",
      options: ["paid", "pending", "cancelled"],
      defaultValue: "paid",
    },
    {
      name: "plates",
      label: "Plaque(s) NFC",
      type: "relationship",
      relationTo: "plates",
      hasMany: true,
      index: true,
      admin: {
        description: "Toutes les plaques générées pour cette commande.",
      },
    },
    {
      name: "activated",
      label: "Activé",
      type: "checkbox",
      defaultValue: false,
    },
  ],
};
