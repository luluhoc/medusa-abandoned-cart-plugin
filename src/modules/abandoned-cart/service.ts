import { randomBytes } from "crypto"

import { MedusaService } from "@medusajs/framework/utils"

import {
  applyTemplatePattern,
  baseLanguage,
  matchSupportedLocale,
  normalizeLocale,
  pickForLocale,
} from "../../utils/locale"
import { AbandonedCart } from "./models/abandoned-cart"
import { AbandonedCartNotification } from "./models/abandoned-cart-notification"
import { resolveOptions } from "./options"
import {
  ABANDONED_CART_STATUSES,
  type AbandonedCartLocaleContext,
  type AbandonedCartModuleOptions,
  type AbandonedCartStatus,
  type ResolvedAbandonedCartOptions,
  type ResolvedStage,
  type StageDelivery,
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
  /**
   * The same funnel per configured locale. Empty when the store hasn't set
   * `locales` — without that list there is no bounded set to count over.
   */
  by_locale: {
    locale: string
    total: number
    notified: number
    converted: number
  }[]
}

/** Statuses that mean at least one reminder went out. */
const NOTIFIED_STATUSES: AbandonedCartStatus[] = [
  "notified",
  "recovered",
  "converted",
  "expired",
]

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

  getSupportedLocales(): string[] {
    return this.options_.locales
  }

  /**
   * Normalizes a locale tag and constrains it to the configured `locales`.
   *
   * `"FR_ca"` becomes `"fr-CA"`; with `locales: ["fr"]` it becomes `"fr"`,
   * because a `fr-CA` shopper is better served by the French template than by
   * no translation at all. Returns `null` when the tag is unusable or the
   * store has no matching locale.
   */
  matchLocale(value: unknown): string | null {
    const locale = normalizeLocale(value)

    return locale ? matchSupportedLocale(locale, this.options_.locales) : null
  }

  /**
   * Picks the locale to send a cart in, first match wins:
   *
   * 1. the `resolveLocale` option, if the store provides one;
   * 2. the cart's metadata, then the customer's, under `localeMetadataKey`;
   * 3. the shipping country, the region, then the sales channel;
   * 4. `defaultLocale`.
   */
  resolveLocale(context: AbandonedCartLocaleContext): string | null {
    const options = this.options_
    const key = options.localeMetadataKey

    const candidates: unknown[] = [
      options.resolveLocale?.(context),
      context.cart_metadata?.[key],
      context.customer_metadata?.[key],
      context.country_code
        ? options.localeByCountry[context.country_code.toLowerCase()]
        : undefined,
      context.region_id
        ? options.localeByRegion[context.region_id.toLowerCase()]
        : undefined,
      context.sales_channel_id
        ? options.localeBySalesChannel[context.sales_channel_id.toLowerCase()]
        : undefined,
      options.defaultLocale,
    ]

    for (const candidate of candidates) {
      const locale = this.matchLocale(candidate)

      if (locale) {
        return locale
      }
    }

    return null
  }

  /**
   * The same, from a cart as returned by Query. Detection and notification ask
   * for different field sets, so every source here is optional.
   */
  resolveLocaleForCart(cart: Record<string, any>): string | null {
    return this.resolveLocale({
      cart_id: cart.id ?? null,
      email: cart.email ?? null,
      customer_id: cart.customer_id ?? cart.customer?.id ?? null,
      region_id: cart.region_id ?? cart.region?.id ?? null,
      sales_channel_id: cart.sales_channel_id ?? null,
      country_code: cart.shipping_address?.country_code ?? null,
      currency_code: cart.currency_code ?? null,
      cart_metadata: (cart.metadata as Record<string, unknown>) ?? null,
      customer_metadata:
        (cart.customer?.metadata as Record<string, unknown>) ?? null,
    })
  }

  /**
   * What a stage sends for one locale: the translated template id and the
   * merged payload data.
   *
   * Template resolution, most specific first: the stage's own `templates` map,
   * the top-level `templates` map, `templatePattern` applied to the stage's
   * template, and finally the stage's template untranslated — so a locale you
   * haven't translated yet still gets an email.
   */
  getStageDelivery(stage: ResolvedStage, locale?: string | null): StageDelivery {
    const options = this.options_

    const template =
      pickForLocale(stage.templates, locale) ??
      pickForLocale(options.templates, locale) ??
      (locale && options.templatePattern
        ? applyTemplatePattern(options.templatePattern, stage.template, locale)
        : undefined) ??
      stage.template

    return {
      template,
      channel: stage.channel,
      data: {
        ...options.notificationData,
        ...(pickForLocale(options.localeData, locale) ?? {}),
        ...stage.data,
        ...(pickForLocale(stage.localeData, locale) ?? {}),
      },
    }
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
   *
   * A locale picks the matching entry in `storefrontUrlByLocale` and
   * `recoveryPathByLocale`, and fills `{locale}` / `{lang}` in the path. With
   * no locale those placeholders collapse away, so `"/{lang}/cart/{token}"`
   * degrades to `"/cart/…"` rather than emitting a literal `{lang}`.
   */
  buildRecoveryUrl(
    token: string,
    cartId: string,
    locale?: string | null
  ): string | null {
    const origin =
      pickForLocale(this.options_.storefrontUrlByLocale, locale) ??
      this.options_.storefrontUrl

    if (!origin) {
      return null
    }

    const path = (
      pickForLocale(this.options_.recoveryPathByLocale, locale) ??
      this.options_.recoveryPath
    )
      .replace(/\{token\}/g, encodeURIComponent(token))
      .replace(/\{cart_id\}/g, encodeURIComponent(cartId))
      .replace(/\{locale\}/g, locale ? encodeURIComponent(locale) : "")
      .replace(
        /\{lang\}/g,
        locale ? encodeURIComponent(baseLanguage(locale)) : ""
      )
      .replace(/\/{2,}/g, "/")

    return `${origin}${path.startsWith("/") ? "" : "/"}${path}`
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
    const notified = NOTIFIED_STATUSES.reduce(
      (sum, status) => sum + counts[status],
      0
    )

    const byLocale = await Promise.all(
      this.options_.locales.map(async (locale) => {
        const [total, notifiedCount, convertedCount] = await Promise.all(
          [
            {},
            { status: NOTIFIED_STATUSES },
            { status: "converted" },
          ].map(async (statusFilter) => {
            const [, count] = await this.listAndCountAbandonedCarts(
              { ...filters, ...statusFilter, locale },
              { take: 1, select: ["id"] }
            )

            return count
          })
        )

        return {
          locale,
          total,
          notified: notifiedCount,
          converted: convertedCount,
        }
      })
    )

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
      by_locale: byLocale,
    }
  }
}
