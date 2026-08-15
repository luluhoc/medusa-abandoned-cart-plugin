import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { ABANDONED_CART_MODULE } from "../../modules/abandoned-cart"
import type AbandonedCartModuleService from "../../modules/abandoned-cart/service"
import type { AbandonedCartCandidate } from "../../modules/abandoned-cart/types"

export type FindAbandonedCartCandidatesStepInput = {
  limit?: number
  offset?: number
}

export type FindAbandonedCartCandidatesStepOutput = {
  carts: AbandonedCartCandidate[]
  /** Total carts matching the detection filters, for pagination. */
  count: number
  /** Carts returned by this page, before the in-memory thresholds were applied. */
  scanned: number
}

/**
 * Finds carts that went quiet long enough to qualify as abandoned.
 *
 * The database filters cover what Postgres can answer cheaply (open cart, last
 * activity inside the window, sales channel); item count, subtotal and
 * "registered customer" thresholds are applied in memory afterwards, because
 * they depend on the cart's line items.
 */
export const findAbandonedCartCandidatesStep = createStep(
  "find-abandoned-cart-candidates",
  async (
    input: FindAbandonedCartCandidatesStepInput,
    { container }
  ): Promise<StepResponse<FindAbandonedCartCandidatesStepOutput>> => {
    const service = container.resolve<AbandonedCartModuleService>(
      ABANDONED_CART_MODULE
    )
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const options = service.getOptions()

    const now = Date.now()
    // A cart is only interesting once it has been quiet for at least as long as
    // the first stage's delay, and not so long that it has gone cold.
    const quietSince = new Date(now - options.stages[0].delayMs)
    const notOlderThan = new Date(now - options.maxAgeMs)

    const filters: Record<string, unknown> = {
      completed_at: null,
      updated_at: {
        $lt: quietSince,
        $gte: notOlderThan,
      },
    }

    if (options.requireEmail) {
      filters.email = { $ne: null }
    }

    if (options.salesChannelIds.length) {
      filters.sales_channel_id = options.salesChannelIds
    }

    const { data: carts, metadata } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "email",
        "customer_id",
        "currency_code",
        "region_id",
        "sales_channel_id",
        "updated_at",
        "metadata",
        "items.id",
        "items.quantity",
        "items.unit_price",
        "customer.id",
        "customer.has_account",
      ],
      filters,
      pagination: {
        skip: input.offset ?? 0,
        take: input.limit ?? options.batchSize,
        order: {
          updated_at: "ASC",
        },
      },
    })

    const candidates: AbandonedCartCandidate[] = []

    for (const cart of carts) {
      const items = cart.items ?? []

      if (items.length < options.minItems) {
        continue
      }

      if (options.requireEmail && !cart.email) {
        continue
      }

      if (options.onlyRegisteredCustomers && !cart.customer?.has_account) {
        continue
      }

      const subtotal = items.reduce(
        (sum, item) =>
          sum + Number(item.unit_price ?? 0) * Number(item.quantity ?? 0),
        0
      )

      if (subtotal < options.minSubtotal) {
        continue
      }

      candidates.push({
        cart_id: cart.id,
        email: cart.email ?? null,
        customer_id: cart.customer_id ?? null,
        sales_channel_id: cart.sales_channel_id ?? null,
        region_id: cart.region_id ?? null,
        currency_code: cart.currency_code ?? null,
        item_count: items.length,
        subtotal,
        cart_updated_at: new Date(cart.updated_at).toISOString(),
        metadata: (cart.metadata as Record<string, unknown>) ?? null,
      })
    }

    return new StepResponse({
      carts: candidates,
      count: metadata?.count ?? 0,
      scanned: carts.length,
    })
  }
)
