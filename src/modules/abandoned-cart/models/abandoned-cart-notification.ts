import { model } from "@medusajs/framework/utils"

import { AbandonedCart } from "./abandoned-cart"

/** An audit trail entry: one attempt to send one stage to one shopper. */
export const AbandonedCartNotification = model
  .define("abandoned_cart_notification", {
    id: model.id({ prefix: "abcartnotif" }).primaryKey(),
    stage_id: model.text(),
    stage_index: model.number(),
    channel: model.text(),
    template: model.text(),
    /** The locale this attempt was rendered in, `null` when none resolved. */
    locale: model.text().nullable(),
    to: model.text(),
    /** The id of the record created by the Notification Module, when sending succeeded. */
    notification_id: model.text().nullable(),
    /** The provider error message, when sending failed. */
    error: model.text().nullable(),
    sent_at: model.dateTime().nullable(),
    abandoned_cart: model.belongsTo(() => AbandonedCart, {
      mappedBy: "notifications",
    }),
  })
  .indexes([
    {
      on: ["abandoned_cart_id", "stage_id"],
    },
  ])
