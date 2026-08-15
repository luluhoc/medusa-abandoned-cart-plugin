import { defineLink } from "@medusajs/framework/utils"
import CustomerModule from "@medusajs/medusa/customer"

import AbandonedCartModule from "../modules/abandoned-cart"

export default defineLink(
  {
    linkable: AbandonedCartModule.linkable.abandonedCart.id,
    field: "customer_id",
  },
  CustomerModule.linkable.customer,
  {
    readOnly: true,
  }
)
