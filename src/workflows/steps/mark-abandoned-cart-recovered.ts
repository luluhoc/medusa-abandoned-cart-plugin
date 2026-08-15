import { MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { ABANDONED_CART_MODULE } from "../../modules/abandoned-cart"
import type AbandonedCartModuleService from "../../modules/abandoned-cart/service"

export type MarkAbandonedCartRecoveredStepInput = {
  id?: string
  token?: string
  cart_id?: string
}

export type MarkAbandonedCartRecoveredStepOutput = {
  record: Record<string, any> | null
}

type RecoveredCompensation = {
  previous: Record<string, unknown> | null
}

/**
 * Marks a tracked cart as recovered — the shopper clicked the recovery link and
 * came back. Idempotent: clicking the link twice keeps the first timestamp.
 */
export const markAbandonedCartRecoveredStep = createStep(
  "mark-abandoned-cart-recovered",
  async (
    input: MarkAbandonedCartRecoveredStepInput,
    { container }
  ): Promise<
    StepResponse<MarkAbandonedCartRecoveredStepOutput, RecoveredCompensation>
  > => {
    const service = container.resolve<AbandonedCartModuleService>(
      ABANDONED_CART_MODULE
    )

    const filters: Record<string, unknown> = {}

    if (input.id) {
      filters.id = input.id
    } else if (input.token) {
      filters.token = input.token
    } else if (input.cart_id) {
      filters.cart_id = input.cart_id
    } else {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "One of `id`, `token` or `cart_id` is required to mark a cart as recovered."
      )
    }

    const [record] = await service.listAbandonedCarts(filters, { take: 1 })

    if (!record) {
      return new StepResponse({ record: null }, { previous: null })
    }

    // Converted carts already reached the end of the funnel.
    if (record.status === "converted") {
      return new StepResponse({ record }, { previous: null })
    }

    const previous = {
      id: record.id,
      status: record.status,
      recovered_at: record.recovered_at,
    }

    const [updated] = await service.updateAbandonedCarts([
      {
        id: record.id,
        status: "recovered",
        recovered_at: record.recovered_at ?? new Date(),
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
