import { defineLink } from "@medusajs/framework/utils"
import CartModule from "@medusajs/medusa/cart"

import AbandonedCartModule from "../modules/abandoned-cart"

export default defineLink(
  {
    linkable: AbandonedCartModule.linkable.abandonedCart.id,
    field: "cart_id",
  },
  CartModule.linkable.cart,
  {
    readOnly: true,
  }
)
