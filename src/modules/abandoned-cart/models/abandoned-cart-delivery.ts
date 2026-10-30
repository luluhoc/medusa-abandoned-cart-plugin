import { model } from "@medusajs/framework/utils"

/** Durable claim and receipt, separate from the workflow's later audit write. */
export const AbandonedCartDelivery = model.define("abandoned_cart_delivery", {
  id: model.id({ prefix: "abdelivery" }).primaryKey(),
  delivery_key: model.text().unique(),
  abandoned_cart_id: model.text(),
  state: model.text().default("reserved"),
  claim_token: model.text(),
  claim_expires_at: model.dateTime(),
  idempotency_key: model.text(),
  result: model.json().nullable(),
}).indexes([{ on: ["abandoned_cart_id"] }])
