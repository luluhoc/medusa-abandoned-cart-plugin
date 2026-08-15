import { randomBytes } from "crypto"

import { MedusaService } from "@medusajs/framework/utils"

import { AbandonedCart } from "./models/abandoned-cart"
import { AbandonedCartNotification } from "./models/abandoned-cart-notification"
import { resolveOptions } from "./options"
import {
  ABANDONED_CART_STATUSES,
  type AbandonedCartModuleOptions,
  type AbandonedCartStatus,
  type ResolvedAbandonedCartOptions,
  type ResolvedStage,
} from "./types"

/** The subset of an abandoned cart record the scheduling logic needs. */
type SchedulableRecord = {
  status: AbandonedCartStatus | string
  stage_index: number
  cart_updated_at: string | Date
}

export type AbandonedCartStats = {
  counts: Record<AbandonedCartStatus, number>
  total: number
  /** Carts that received at least one notification. */
  notified: number
  /** Share of notified carts that came back through a recovery link. */
  recovery_rate: number
  /** Share of notified carts that ended in an order. */
  conversion_rate: number
  /** Recovered subtotal per currency, from carts that converted. */
  recovered_value: { currency_code: string; amount: number }[]
}

/** How many converted carts `getStats` sums to compute recovered value. */
const RECOVERED_VALUE_SAMPLE_SIZE = 1000

export default class AbandonedCartModuleService extends MedusaService({
  AbandonedCart,
  AbandonedCartNotification,
}) {
  protected readonly options_: ResolvedAbandonedCartOptions

  constructor(container: unknown, options: AbandonedCartModuleOptions = {}) {
    // eslint-disable-next-line prefer-rest-params
    super(...arguments)

    this.options_ = resolveOptions(options)
  }

  getOptions(): ResolvedAbandonedCartOptions {
    return this.options_
  }

  getStages(): ResolvedStage[] {
    return this.options_.stages
  }

  getStage(idOrIndex: string | number): ResolvedStage | undefined {
    if (typeof idOrIndex === "number") {
      return this.options_.stages[idOrIndex]
    }

    return this.options_.stages.find((stage) => stage.id === idOrIndex)
  }

  /**
   * Returns the stage that is due for a record, or `null` when nothing should
   * be sent — because the sequence is finished, the record left the funnel, or
   * the next stage's delay has not elapsed yet.
   */
  getDueStage(
    record: SchedulableRecord,
    now: number = Date.now()
  ): ResolvedStage | null {
    const stage = this.options_.stages[record.stage_index]

    if (!stage) {
      return null
    }

    if (["converted", "dismissed", "expired"].includes(record.status)) {
      return null
    }

    if (record.status === "recovered" && this.options_.stopAfterRecovery) {
      return null
    }

    const dueAt = new Date(record.cart_updated_at).getTime() + stage.delayMs

    return now >= dueAt ? stage : null
  }

  generateRecoveryToken(): string {
    return randomBytes(24).toString("base64url")
  }

  /**
   * Builds the link that goes into the recovery email. Returns `null` when no
   * `storefrontUrl` is configured — the template can then build its own link
   * from the `token` passed in the notification payload.
   */
  buildRecoveryUrl(token: string, cartId: string): string | null {
    if (!this.options_.storefrontUrl) {
      return null
    }

    const path = this.options_.recoveryPath
      .replace("{token}", encodeURIComponent(token))
      .replace("{cart_id}", encodeURIComponent(cartId))

    return `${this.options_.storefrontUrl}${path.startsWith("/") ? "" : "/"}${path}`
  }

  async getStats(
    filters: { created_at?: { $gte?: Date; $lte?: Date } } = {}
  ): Promise<AbandonedCartStats> {
    const counts = {} as Record<AbandonedCartStatus, number>

    await Promise.all(
      ABANDONED_CART_STATUSES.map(async (status) => {
        const [, count] = await this.listAndCountAbandonedCarts(
          { ...filters, status },
          { take: 1, select: ["id"] }
        )

        counts[status] = count
      })
    )

    const total = ABANDONED_CART_STATUSES.reduce(
      (sum, status) => sum + counts[status],
      0
    )
    const notified =
      counts.notified + counts.recovered + counts.converted + counts.expired

    const converted = await this.listAbandonedCarts(
      { ...filters, status: "converted" },
      {
        take: RECOVERED_VALUE_SAMPLE_SIZE,
        select: ["id", "subtotal", "currency_code"],
      }
    )

    const byCurrency = new Map<string, number>()
    for (const record of converted) {
      const currency = (record.currency_code ?? "unknown").toLowerCase()
      const amount = Number(record.subtotal ?? 0)

      byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + amount)
    }

    return {
      counts,
      total,
      notified,
      recovery_rate: notified
        ? (counts.recovered + counts.converted) / notified
        : 0,
      conversion_rate: notified ? counts.converted / notified : 0,
      recovered_value: [...byCurrency.entries()].map(
        ([currency_code, amount]) => ({ currency_code, amount })
      ),
    }
  }
}
