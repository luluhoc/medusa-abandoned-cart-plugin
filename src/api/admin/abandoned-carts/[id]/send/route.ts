import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { ABANDONED_CART_MODULE } from "../../../../../modules/abandoned-cart"
import type AbandonedCartModuleService from "../../../../../modules/abandoned-cart/service"
import { sendAbandonedCartNotificationsWorkflow } from "../../../../../workflows/send-abandoned-cart-notifications"
import type { PostAdminAbandonedCartSendSchemaType } from "../../validators"

/**
 * `POST /admin/abandoned-carts/:id/send`
 *
 * Sends the record's next stage right away, ignoring its delay. Pass
 * `stage_id` in the body to re-send a specific stage instead.
 */
export const POST = async (
  req: MedusaRequest<PostAdminAbandonedCartSendSchemaType>,
  res: MedusaResponse
) => {
  const service = req.scope.resolve<AbandonedCartModuleService>(
    ABANDONED_CART_MODULE
  )

  const [record] = await service.listAbandonedCarts(
    { id: req.params.id },
    { take: 1 }
  )

  if (!record) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Abandoned cart ${req.params.id} was not found`
    )
  }

  const { result } = await sendAbandonedCartNotificationsWorkflow(
    req.scope
  ).run({
    input: {
      ids: [req.params.id],
      force: true,
      stage_id: req.validatedBody?.stage_id,
    },
  })

  res.json({ result })
}
