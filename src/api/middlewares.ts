import {
  defineMiddlewares,
  validateAndTransformBody,
  validateAndTransformQuery,
} from "@medusajs/framework/http"

import {
  GetAdminAbandonedCartsSchema,
  PostAdminAbandonedCartSchema,
  PostAdminAbandonedCartSendSchema,
} from "./admin/abandoned-carts/validators"

export const ABANDONED_CART_LIST_FIELDS = [
  "id",
  "cart_id",
  "email",
  "customer_id",
  "sales_channel_id",
  "currency_code",
  "locale",
  "item_count",
  "subtotal",
  "status",
  "stage_index",
  "cart_updated_at",
  "last_notified_at",
  "recovered_at",
  "converted_at",
  "order_id",
  "created_at",
  "updated_at",
]

export default defineMiddlewares({
  routes: [
    {
      matcher: "/admin/abandoned-carts",
      method: "GET",
      middlewares: [
        validateAndTransformQuery(GetAdminAbandonedCartsSchema, {
          defaults: ABANDONED_CART_LIST_FIELDS,
          isList: true,
          defaultLimit: 20,
        }),
      ],
    },
    {
      // Also matched by POST /admin/abandoned-carts/sweep, which sends no body.
      // Every field here is optional, so that request passes through untouched.
      matcher: "/admin/abandoned-carts/:id",
      method: "POST",
      middlewares: [validateAndTransformBody(PostAdminAbandonedCartSchema)],
    },
    {
      matcher: "/admin/abandoned-carts/:id/send",
      method: "POST",
      middlewares: [validateAndTransformBody(PostAdminAbandonedCartSendSchema)],
    },
  ],
})
