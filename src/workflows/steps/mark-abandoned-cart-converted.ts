import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { ABANDONED_CART_MODULE } from "../../modules/abandoned-cart"
import type AbandonedCartModuleService from "../../modules/abandoned-cart/service"

export type MarkAbandonedCartConvertedStepInput = {
  order_id: string
  /** Skips the order → cart lookup when the caller already knows the cart. */
  cart_id?: string
}

export type MarkAbandonedCartConvertedStepOutput = {
  record: Record<string, any> | null
}

type ConvertedCompensation = {
  previous: Record<string, unknown> | null
}

/**
 * Closes the loop on a tracked cart that turned into an order, which is what
 * makes the recovery numbers in the admin dashboard meaningful.
 */
export const markAbandonedCartConvertedStep = createStep(
  "mark-abandoned-cart-converted",
  async (
    input: MarkAbandonedCartConvertedStepInput,
    { container }
  ): Promise<
    StepResponse<MarkAbandonedCartConvertedStepOutput, ConvertedCompensation>
  > => {
    const service = container.resolve<AbandonedCartModuleService>(
      ABANDONED_CART_MODULE
    )
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    let cartId = input.cart_id

    if (!cartId) {
      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["id", "cart.id"],
        filters: { id: input.order_id },
      })

      cartId = orders?.[0]?.cart?.id
    }

    if (!cartId) {
      return new StepResponse({ record: null }, { previous: null })
    }

    const [record] = await service.listAbandonedCarts(
      { cart_id: cartId },
      { take: 1 }
    )

    if (!record) {
      return new StepResponse({ record: null }, { previous: null })
    }

    const previous = {
      id: record.id,
      status: record.status,
      converted_at: record.converted_at,
      order_id: record.order_id,
    }

    const [updated] = await service.updateAbandonedCarts([
      {
        id: record.id,
        status: "converted",
        converted_at: record.converted_at ?? new Date(),
        order_id: input.order_id,
      },
    ])

    return new StepResponse({ record: updated }, { previous })
  },
  async (compensation, { container }) => {
    if (!compensation?.previous) {
      return
    }

    const service = container.resolve<AbandonedCartModuleService>(
      ABANDONED_CART_MODULE
    )

    await service.updateAbandonedCarts([compensation.previous])
  }
)
