import { defineLink } from "@medusajs/framework/utils"
import OrderModule from "@medusajs/medusa/order"

import AbandonedCartModule from "../modules/abandoned-cart"

export default defineLink(
  {
    linkable: AbandonedCartModule.linkable.abandonedCart.id,
    field: "order_id",
  },
  OrderModule.linkable.order,
  {
    readOnly: true,
  }
)
