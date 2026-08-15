import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { markAbandonedCartRecoveredWorkflow } from "../../../../workflows/mark-abandoned-cart-recovered"

/**
 * `GET /store/abandoned-carts/:token`
 *
 * The endpoint behind the recovery link in the email. It resolves the token to
 * a cart id and records the visit, so the storefront can set its cart cookie
 * and send the shopper back to checkout.
 *
 * Recording the visit is idempotent — following the link twice keeps the first
 * `recovered_at` timestamp.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { result } = await markAbandonedCartRecoveredWorkflow(req.scope).run({
    input: { token: req.params.token },
  })

  const record = result.record

  if (!record) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "This recovery link is no longer valid."
    )
  }

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: ["id", "completed_at"],
    filters: { id: record.cart_id },
  })

  const cart = carts?.[0]

  if (!cart) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "This recovery link is no longer valid."
    )
  }

  res.json({
    cart_id: cart.id,
    completed: Boolean(cart.completed_at),
  })
}
