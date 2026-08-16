import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { ABANDONED_CART_MODULE } from "../../modules/abandoned-cart"
import type AbandonedCartModuleService from "../../modules/abandoned-cart/service"
import type { ResolvedStage } from "../../modules/abandoned-cart/types"

export type SelectDueAbandonedCartsStepInput = {
  /** Restrict the selection to these tracking record ids. */
  ids?: string[]
  /** Maximum number of records to select. Defaults to `notificationBatchSize`. */
  limit?: number
  /** Ignore the stage delays and send right away. */
  force?: boolean
  /** Send this specific stage instead of the record's next one. Requires `force`. */
  stage_id?: string
  /** Send in this locale instead of the one resolved from the cart. */
  locale?: string
}

export type DueAbandonedCart = {
  record_id: string
  cart_id: string
  token: string
  to: string
  locale: string | null
  stage: ResolvedStage
  cart: Record<string, any>
}

export type SelectDueAbandonedCartsStepOutput = {
  items: DueAbandonedCart[]
  /** Records that left the funnel and should be closed instead of notified. */
  stale: { record_id: string; status: string }[]
}

export const selectDueAbandonedCartsStep = createStep(
  "select-due-abandoned-carts",
  async (
    input: SelectDueAbandonedCartsStepInput,
    { container }
  ): Promise<StepResponse<SelectDueAbandonedCartsStepOutput>> => {
    const service = container.resolve<AbandonedCartModuleService>(
      ABANDONED_CART_MODULE
    )
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const options = service.getOptions()
    const now = Date.now()

    const overrideLocale = input.locale ? service.matchLocale(input.locale) : null

    if (input.locale && !overrideLocale) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Unsupported abandoned cart locale "${input.locale}".`
      )
    }

    const records = input.ids?.length
      ? await service.listAbandonedCarts(
          { id: input.ids },
          { take: input.ids.length }
        )
      : await service.listAbandonedCarts(
          {
            status: ["pending", "notified"],
            stage_index: { $lt: options.stages.length },
          },
          {
            take: input.limit ?? options.notificationBatchSize,
            order: { cart_updated_at: "ASC" },
          }
        )

    if (!records.length) {
      return new StepResponse({ items: [], stale: [] })
    }

    const pending: { record: (typeof records)[number]; stage: ResolvedStage }[] =
      []

    for (const record of records) {
      let stage: ResolvedStage | null | undefined

      if (input.force) {
        stage = input.stage_id
          ? service.getStage(input.stage_id)
          : service.getStage(record.stage_index) ??
            service.getStage(options.stages.length - 1)

        if (input.stage_id && !stage) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `Unknown abandoned cart stage "${input.stage_id}".`
          )
        }

        if (record.status === "converted") {
          stage = null
        }
      } else {
        stage = service.getDueStage(record, now)
      }

      if (stage) {
        pending.push({ record, stage })
      }
    }

    if (!pending.length) {
      return new StepResponse({ items: [], stale: [] })
    }

    const cartIds = pending.map(({ record }) => record.cart_id)

    const { data: carts } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "email",
        "currency_code",
        "completed_at",
        "sales_channel_id",
        "metadata",
        "items.*",
        "customer.*",
        "shipping_address.*",
        "region.*",
      ],
      filters: { id: cartIds },
    })

    const cartsById = new Map(carts.map((cart) => [cart.id, cart]))

    const items: DueAbandonedCart[] = []
    const stale: { record_id: string; status: string }[] = []

    for (const { record, stage } of pending) {
      const cart = cartsById.get(record.cart_id)

      if (!cart) {
        // The cart is gone — nothing left to recover.
        stale.push({ record_id: record.id, status: "expired" })
        continue
      }

      if (cart.completed_at) {
        // The order-placed subscriber normally handles this; this is the
        // fallback for carts completed without an emitted event.
        stale.push({ record_id: record.id, status: "converted" })
        continue
      }

      if (!cart.items?.length) {
        stale.push({ record_id: record.id, status: "expired" })
        continue
      }

      const to = record.email ?? cart.email

      if (!to) {
        stale.push({ record_id: record.id, status: "expired" })
        continue
      }

      items.push({
        record_id: record.id,
        cart_id: record.cart_id,
        token: record.token,
        to,
        // Resolved against the live cart, so a shopper who switched language
        // since detection gets the email in the language they last used. The
        // stored locale is the fallback when nothing resolves any more.
        locale:
          overrideLocale ??
          service.resolveLocaleForCart(cart) ??
          service.matchLocale(record.locale),
        stage,
        cart,
      })
    }

    return new StepResponse({ items, stale })
  }
)
