import { createHash, randomBytes, randomUUID } from "crypto"

import type { Context } from "@medusajs/framework/types"
import { InjectManager, MedusaContext, MedusaService } from "@medusajs/framework/utils"

import {
  applyTemplatePattern,
  baseLanguage,
  matchSupportedLocale,
  normalizeLocale,
  pickForLocale,
} from "../../utils/locale"
import { AbandonedCart } from "./models/abandoned-cart"
import { AbandonedCartDelivery } from "./models/abandoned-cart-delivery"
import { execute, updateState } from "./persistence"
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
  last_notified_at?: string | Date | null
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

export default class AbandonedCartModuleService extends MedusaService({
  AbandonedCart,
  AbandonedCartNotification,
  AbandonedCartDelivery,
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

    // Keep cumulative cart deadlines, with a spacing backstop after a late send.
    const previousStage = this.options_.stages[record.stage_index - 1]
    const lastSentAt = record.last_notified_at && new Date(record.last_notified_at).getTime()
    const spacedDueAt = previousStage && lastSentAt
      ? Math.max(dueAt, lastSentAt + stage.delayMs - previousStage.delayMs)
      : dueAt
    return now >= spacedDueAt ? stage : null
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

  @InjectManager()
  async updateState(before: any, data: Record<string, unknown>, @MedusaContext() context: Context = {}) {
    return updateState(context, before, data)
  }

  @InjectManager()
  async convertCart(id: string, orderId: string, @MedusaContext() context: Context = {}) {
    const rows = await execute(context, `UPDATE abandoned_cart SET status = 'converted', converted_at = coalesce(converted_at, now()),
      order_id = ?, revision = revision + 1, updated_at = now() WHERE id = ? AND deleted_at IS NULL
      AND (order_id IS NULL OR order_id = ?) AND (status <> 'converted' OR order_id IS NULL) RETURNING *`, [orderId, id, orderId])
    return rows[0] ?? null
  }

  @InjectManager()
  async noteAttempt(id: string, @MedusaContext() context: Context = {}) {
    const now = Date.now()
    await execute(context, "UPDATE abandoned_cart SET attempt_order = ?, raw_attempt_order = ?::jsonb WHERE id = ? AND deleted_at IS NULL",
      [now, JSON.stringify({ value: String(now), precision: 20 }), id])
  }

  @InjectManager()
  async claimDelivery(key: string, recordId: string, notificationKey: string, @MedusaContext() context: Context = {}) {
    const token = randomUUID()
    const id = "abdelivery_" + createHash("sha256").update(key).digest("hex")
    const inserted = await execute(context, `INSERT INTO abandoned_cart_delivery
      (id, delivery_key, abandoned_cart_id, state, claim_token, claim_expires_at, idempotency_key)
      VALUES (?, ?, ?, 'reserved', ?, now() + interval '2 minutes', ?) ON CONFLICT DO NOTHING RETURNING *`,
      [id, key, recordId, token, notificationKey])
    if (inserted.length) return { owned: true, row: inserted[0] }
    const [existing] = await execute(context, `SELECT * FROM abandoned_cart_delivery WHERE delivery_key = ? AND deleted_at IS NULL`, [key])
    if (!existing) throw new Error("Delivery claim unavailable")
    const renewed = await execute(context, `UPDATE abandoned_cart_delivery SET claim_token = ?, claim_expires_at = now() + interval '2 minutes', updated_at = now()
      WHERE id = ? AND state = 'reserved' AND claim_expires_at < now() RETURNING *`, [token, existing.id])
    return { owned: !!renewed.length, row: renewed[0] ?? existing }
  }

  @InjectManager()
  async beginDelivery(claim: any, notificationKey: string, intent: unknown = null, @MedusaContext() context: Context = {}) {
    const rows = await execute(context, `UPDATE abandoned_cart_delivery SET state = 'invoking', idempotency_key = ?, result = ?::jsonb, updated_at = now()
      WHERE id = ? AND state = 'reserved' AND claim_token = ? AND claim_expires_at > now() RETURNING *`, [notificationKey, JSON.stringify(intent), claim.id, claim.claim_token])
    return rows[0] ?? null
  }

  @InjectManager()
  async acceptDelivery(claim: any, result: any, @MedusaContext() context: Context = {}) {
    await execute(context, `UPDATE abandoned_cart_delivery SET state = 'accepted', result = ?::jsonb, updated_at = now()
      WHERE id = ? AND claim_token = ? AND state IN ('reserved', 'invoking')`, [JSON.stringify(result), claim.id, claim.claim_token])
  }

  @InjectManager()
  async retryDelivery(claim: any, @MedusaContext() context: Context = {}) {
    // Only called after the native notification ledger proves failure (or before invocation).
    await execute(context, `UPDATE abandoned_cart_delivery SET state = 'reserved', claim_expires_at = now() - interval '1 second', updated_at = now()
      WHERE id = ? AND claim_token = ? AND state IN ('reserved', 'invoking')`, [claim.id, claim.claim_token])
  }

  @InjectManager()
  async getStats(filters: { created_at?: { $gte?: Date; $lte?: Date } } = {}, @MedusaContext() context: Context = {}): Promise<AbandonedCartStats> {
    const where = ["deleted_at IS NULL"]
    const params: unknown[] = []
    for (const [operator, date] of [[">=", filters.created_at?.$gte], ["<=", filters.created_at?.$lte]] as const) {
      if (date) { where.push(`created_at ${operator} ?`); params.push(date) }
    }
    const rows = await execute(context, `WITH filtered AS (SELECT status, locale, currency_code, subtotal FROM abandoned_cart WHERE ${where.join(" AND ")})
      SELECT 'status' AS kind, status, NULL::text AS locale, NULL::text AS currency_code, count(*)::text AS count, NULL::text AS amount FROM filtered GROUP BY status
      UNION ALL SELECT 'locale', status, locale, NULL::text, count(*)::text, NULL::text FROM filtered WHERE locale IN (SELECT jsonb_array_elements_text(?::jsonb)) GROUP BY status, locale
      UNION ALL SELECT 'value', NULL::text, NULL::text, lower(coalesce(currency_code, 'unknown')), NULL::text, sum(coalesce(subtotal, 0))::text
      FROM filtered WHERE status = 'converted' GROUP BY lower(coalesce(currency_code, 'unknown'))`, [...params, JSON.stringify(this.options_.locales)])
    const counts = Object.fromEntries(ABANDONED_CART_STATUSES.map(status => [status, 0])) as Record<AbandonedCartStatus, number>
    for (const row of rows.filter(row => row.kind === "status")) counts[row.status] = Number(row.count)
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
    const notified = NOTIFIED_STATUSES.reduce((sum, status) => sum + counts[status], 0)
    const by_locale = this.options_.locales.map(locale => {
      const group = rows.filter(row => row.kind === "locale" && row.locale === locale)
      return { locale, total: group.reduce((sum, row) => sum + Number(row.count), 0),
        notified: group.filter(row => NOTIFIED_STATUSES.includes(row.status)).reduce((sum, row) => sum + Number(row.count), 0),
        converted: Number(group.find(row => row.status === "converted")?.count ?? 0) }
    })
    return { counts, total, notified, recovery_rate: notified ? (counts.recovered + counts.converted) / notified : 0,
      conversion_rate: notified ? counts.converted / notified : 0,
      recovered_value: rows.filter(row => row.kind === "value").map(row => ({ currency_code: row.currency_code, amount: Number(row.amount) })), by_locale }
  }
}
