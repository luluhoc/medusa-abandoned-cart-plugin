import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { ABANDONED_CART_MODULE } from "../../modules/abandoned-cart"
import type AbandonedCartModuleService from "../../modules/abandoned-cart/service"
import type { AbandonedCartCandidate } from "../../modules/abandoned-cart/types"

export type UpsertAbandonedCartsStepInput = {
  carts: AbandonedCartCandidate[]
}

export type UpsertAbandonedCartsStepOutput = {
  created: number
  updated: number
  created_ids: string[]
}

type UpsertCompensation = {
  created_ids: string[]
  previous: Record<string, unknown>[]
}

/** Statuses that detection must never touch again. */
const TERMINAL_STATUSES = ["converted", "dismissed"]

/**
 * Creates a tracking record for every newly-detected cart, and refreshes the
 * snapshot (email, item count, subtotal, last activity) of the ones already
 * tracked.
 */
export const upsertAbandonedCartsStep = createStep(
  "upsert-abandoned-carts",
  async (
    input: UpsertAbandonedCartsStepInput,
    { container }
  ): Promise<StepResponse<UpsertAbandonedCartsStepOutput, UpsertCompensation>> => {
    const service = container.resolve<AbandonedCartModuleService>(
      ABANDONED_CART_MODULE
    )
    const options = service.getOptions()
    const candidates = input.carts ?? []

    if (!candidates.length) {
      return new StepResponse(
        { created: 0, updated: 0, created_ids: [] },
        { created_ids: [], previous: [] }
      )
    }

    const cartIds = candidates.map((candidate) => candidate.cart_id)
    const existing = await service.listAbandonedCarts(
      { cart_id: cartIds },
      { take: cartIds.length }
    )
    const existingByCartId = new Map(
      existing.map((record) => [record.cart_id, record])
    )

    const toCreate: Record<string, unknown>[] = []
    const toUpdate: Record<string, unknown>[] = []
    const previous: Record<string, unknown>[] = []

    for (const candidate of candidates) {
      const record = existingByCartId.get(candidate.cart_id)

      if (!record) {
        toCreate.push({
          cart_id: candidate.cart_id,
          token: service.generateRecoveryToken(),
          email: candidate.email,
          customer_id: candidate.customer_id,
          sales_channel_id: candidate.sales_channel_id,
          region_id: candidate.region_id,
          currency_code: candidate.currency_code,
          locale: candidate.locale,
          item_count: candidate.item_count,
          subtotal: candidate.subtotal,
          cart_updated_at: new Date(candidate.cart_updated_at),
          status: "pending",
          stage_index: 0,
        })
        continue
      }

      if (TERMINAL_STATUSES.includes(record.status)) {
        continue
      }

      const previousActivity = new Date(record.cart_updated_at).getTime()
      const currentActivity = new Date(candidate.cart_updated_at).getTime()
      const hasNewActivity = currentActivity > previousActivity

      const update: Record<string, unknown> = {
        id: record.id,
        email: candidate.email,
        customer_id: candidate.customer_id,
        sales_channel_id: candidate.sales_channel_id,
        region_id: candidate.region_id,
        currency_code: candidate.currency_code,
        locale: candidate.locale,
        item_count: candidate.item_count,
        subtotal: candidate.subtotal,
        cart_updated_at: new Date(candidate.cart_updated_at),
      }

      // The shopper touched the cart again after we already contacted them.
      if (hasNewActivity && options.resetOnActivity && record.stage_index > 0) {
        update.stage_index = 0
        update.status = "pending"
      }

      const unchanged =
        !hasNewActivity &&
        record.email === candidate.email &&
        record.locale === candidate.locale &&
        record.item_count === candidate.item_count &&
        Number(record.subtotal ?? 0) === candidate.subtotal

      if (unchanged) {
        continue
      }

      previous.push({
        id: record.id,
        email: record.email,
        customer_id: record.customer_id,
        sales_channel_id: record.sales_channel_id,
        region_id: record.region_id,
        currency_code: record.currency_code,
        locale: record.locale,
        item_count: record.item_count,
        subtotal: record.subtotal,
        cart_updated_at: record.cart_updated_at,
        stage_index: record.stage_index,
        status: record.status,
      })
      toUpdate.push(update)
    }

    const created = toCreate.length
      ? await service.createAbandonedCarts(toCreate)
      : []

    if (toUpdate.length) {
      await service.updateAbandonedCarts(toUpdate)
    }

    const createdIds = created.map((record) => record.id)

    return new StepResponse(
      {
        created: createdIds.length,
        updated: toUpdate.length,
        created_ids: createdIds,
      },
      { created_ids: createdIds, previous }
    )
  },
  async (compensation, { container }) => {
    if (!compensation) {
      return
    }

    const service = container.resolve<AbandonedCartModuleService>(
      ABANDONED_CART_MODULE
    )

    if (compensation.created_ids.length) {
      await service.deleteAbandonedCarts(compensation.created_ids)
    }

    if (compensation.previous.length) {
      await service.updateAbandonedCarts(compensation.previous)
    }
  }
)
