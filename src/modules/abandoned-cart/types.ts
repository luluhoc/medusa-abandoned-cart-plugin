/**
 * A duration expressed either as a string with a unit (`"30m"`, `"4h"`, `"2d"`,
 * `"1w"`) or as a plain number, which is interpreted as **minutes**.
 */
export type Duration = string | number

export type AbandonedCartStatus =
  | "pending"
  | "notified"
  | "recovered"
  | "converted"
  | "dismissed"
  | "expired"

export const ABANDONED_CART_STATUSES: AbandonedCartStatus[] = [
  "pending",
  "notified",
  "recovered",
  "converted",
  "dismissed",
  "expired",
]

/**
 * One step of the recovery sequence. Delays are cumulative and always measured
 * from the cart's last activity, so `[{ delay: "1h" }, { delay: "24h" }]` sends
 * the first email one hour after the cart went quiet, and the second one 24
 * hours after the cart went quiet (i.e. 23 hours after the first email).
 */
export type AbandonedCartStageOptions = {
  /** Stable identifier, stored on every sent notification. Defaults to `stage-<index>`. */
  id?: string
  /** How long the cart must have been inactive before this stage is sent. */
  delay: Duration
  /** Notification provider template id. Falls back to the top-level `template` option. */
  template?: string
  /**
   * Per-locale template ids for this stage, keyed by locale tag
   * (`{ fr: "d-reminder-fr" }`). Takes precedence over the top-level
   * `templates` map and over `templatePattern`.
   */
  templates?: Record<string, string>
  /** Notification channel. Falls back to the top-level `channel` option (`"email"`). */
  channel?: string
  /** Extra static data merged into the notification payload's `data`. */
  data?: Record<string, unknown>
  /** Per-locale additions to this stage's `data`, keyed by locale tag. */
  localeData?: Record<string, Record<string, unknown>>
}

/**
 * Everything known about a cart when its locale is resolved. Passed to the
 * `resolveLocale` option so a store can implement its own rule.
 */
export type AbandonedCartLocaleContext = {
  cart_id: string | null
  email: string | null
  customer_id: string | null
  region_id: string | null
  sales_channel_id: string | null
  country_code: string | null
  currency_code: string | null
  cart_metadata: Record<string, unknown> | null
  customer_metadata: Record<string, unknown> | null
}

export type AbandonedCartModuleOptions = {
  /** Master switch for the scheduled sweep. Default: `true`. */
  enabled?: boolean
  /** Default notification channel for all stages. Default: `"email"`. */
  channel?: string
  /** Default provider template id for all stages. Default: `"abandoned-cart"`. */
  template?: string
  /** The recovery sequence. Default: a single stage sent 4 hours after abandonment. */
  stages?: AbandonedCartStageOptions[]
  /** How many carts to scan per page during detection. Default: `100`. */
  batchSize?: number
  /** How many notifications to send per sweep. Default: `100`. */
  notificationBatchSize?: number
  /** Carts inactive for longer than this are ignored (too cold to chase). Default: `"14d"`. */
  maxAge?: Duration
  /** Minimum number of line items for a cart to qualify. Default: `1`. */
  minItems?: number
  /** Minimum cart subtotal (in the cart's currency) to qualify. Default: `0`. */
  minSubtotal?: number
  /** Skip carts that have no email address. Default: `true`. */
  requireEmail?: boolean
  /** Only chase carts belonging to a registered customer. Default: `false`. */
  onlyRegisteredCustomers?: boolean
  /** Restrict detection to these sales channels. Default: all. */
  salesChannelIds?: string[]
  /** Storefront origin used to build the recovery link, e.g. `"https://shop.com"`. */
  storefrontUrl?: string
  /** Recovery path template. `{token}` and `{cart_id}` are replaced. Default: `"/cart/recover/{token}"`. */
  recoveryPath?: string
  /** Stop the sequence once the shopper comes back through a recovery link. Default: `true`. */
  stopAfterRecovery?: boolean
  /** Restart the sequence from stage 0 when a shopper edits an already-notified cart. Default: `false`. */
  resetOnActivity?: boolean
  /** Extra static data merged into every notification payload's `data`. */
  notificationData?: Record<string, unknown>

  // Localization

  /**
   * The locales this store sends in, e.g. `["en", "fr", "de-AT"]`. When set,
   * a resolved locale outside the list falls back to its base language and
   * then to `defaultLocale`, and every locale-keyed option is checked against
   * it at boot so a typo throws instead of silently disabling a translation.
   */
  locales?: string[]
  /** Locale used when nothing else resolves. Default: none — `locale` stays `null`. */
  defaultLocale?: string
  /** Metadata key read from the cart and the customer. Default: `"locale"`. */
  localeMetadataKey?: string
  /** Locale per region id, e.g. `{ reg_01J…: "fr" }`. */
  localeByRegion?: Record<string, string>
  /** Locale per sales channel id. */
  localeBySalesChannel?: Record<string, string>
  /** Locale per shipping-address country code (lower-case ISO 3166-1 alpha-2). */
  localeByCountry?: Record<string, string>
  /**
   * Last word on a cart's locale. Runs before every built-in source; return
   * `null` or `undefined` to fall through to them.
   */
  resolveLocale?: (
    context: AbandonedCartLocaleContext
  ) => string | null | undefined
  /** Per-locale template ids applied to every stage that doesn't set its own. */
  templates?: Record<string, string>
  /**
   * Derives a template id from the stage's template and the locale when no
   * explicit mapping matches, e.g. `"{template}-{lang}"`. Requires `locales`.
   */
  templatePattern?: string
  /** Per-locale additions to `notificationData`. */
  localeData?: Record<string, Record<string, unknown>>
  /** Per-locale storefront origins, for one-domain-per-language setups. */
  storefrontUrlByLocale?: Record<string, string>
  /** Per-locale recovery paths. `{locale}` and `{lang}` are substituted. */
  recoveryPathByLocale?: Record<string, string>
}

export type ResolvedStage = {
  id: string
  index: number
  delayMs: number
  template: string
  channel: string
  data: Record<string, unknown>
  /** Keys are lower-cased locale tags — look them up with `pickForLocale`. */
  templates: Record<string, string>
  /** Keys are lower-cased locale tags. */
  localeData: Record<string, Record<string, unknown>>
}

/** What a stage actually sends for one locale. */
export type StageDelivery = {
  template: string
  channel: string
  data: Record<string, unknown>
}

export type ResolvedAbandonedCartOptions = {
  enabled: boolean
  channel: string
  template: string
  stages: ResolvedStage[]
  batchSize: number
  notificationBatchSize: number
  maxAgeMs: number
  minItems: number
  minSubtotal: number
  requireEmail: boolean
  onlyRegisteredCustomers: boolean
  salesChannelIds: string[]
  storefrontUrl?: string
  recoveryPath: string
  stopAfterRecovery: boolean
  resetOnActivity: boolean
  notificationData: Record<string, unknown>
  locales: string[]
  defaultLocale: string | null
  localeMetadataKey: string
  localeByRegion: Record<string, string>
  localeBySalesChannel: Record<string, string>
  localeByCountry: Record<string, string>
  resolveLocale?: (
    context: AbandonedCartLocaleContext
  ) => string | null | undefined
  templates: Record<string, string>
  templatePattern?: string
  localeData: Record<string, Record<string, unknown>>
  storefrontUrlByLocale: Record<string, string>
  recoveryPathByLocale: Record<string, string>
}

/** A cart that passed detection, normalized into the shape the workflows use. */
export type AbandonedCartCandidate = {
  cart_id: string
  email: string | null
  customer_id: string | null
  sales_channel_id: string | null
  region_id: string | null
  currency_code: string | null
  locale: string | null
  item_count: number
  subtotal: number
  cart_updated_at: string
  metadata: Record<string, unknown> | null
}
