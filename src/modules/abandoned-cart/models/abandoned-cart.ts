import { model } from "@medusajs/framework/utils"

import { AbandonedCartNotification } from "./abandoned-cart-notification"

/**
 * One tracked cart. There is at most one record per cart, created the first
 * time the sweep sees the cart go quiet and updated on every sweep afterwards.
 */
export const AbandonedCart = model
  .define("abandoned_cart", {
    id: model.id({ prefix: "abcart" }).primaryKey(),
    cart_id: model.text(),
    /** Opaque token used to build the recovery link that goes into the email. */
    token: model.text(),
    email: model.text().nullable(),
    customer_id: model.text().nullable(),
    sales_channel_id: model.text().nullable(),
    region_id: model.text().nullable(),
    currency_code: model.text().nullable(),
    item_count: model.number().default(0),
    subtotal: model.bigNumber().nullable(),
    status: model
      .enum([
        "pending",
        "notified",
        "recovered",
        "converted",
        "dismissed",
        "expired",
      ])
      .default("pending"),
    /** Number of stages already sent, i.e. the index of the next stage to send. */
    stage_index: model.number().default(0),
    /** The cart's `updated_at` as of the last sweep — the start of the "quiet" period. */
    cart_updated_at: model.dateTime(),
    last_notified_at: model.dateTime().nullable(),
    /** Set when the shopper comes back through a recovery link. */
    recovered_at: model.dateTime().nullable(),
    /** Set when the cart is completed into an order. */
    converted_at: model.dateTime().nullable(),
    order_id: model.text().nullable(),
    metadata: model.json().nullable(),
    notifications: model.hasMany(() => AbandonedCartNotification, {
      mappedBy: "abandoned_cart",
    }),
  })
  .indexes([
    {
      on: ["cart_id"],
      unique: true,
    },
    {
      on: ["token"],
      unique: true,
    },
    {
      on: ["status", "stage_index"],
    },
    {
      on: ["email"],
    },
  ])
