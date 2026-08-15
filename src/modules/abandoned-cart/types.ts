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
  /** Notification channel. Falls back to the top-level `channel` option (`"email"`). */
  channel?: string
  /** Extra static data merged into the notification payload's `data`. */
  data?: Record<string, unknown>
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
}

export type ResolvedStage = {
  id: string
  index: number
  delayMs: number
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
}

/** A cart that passed detection, normalized into the shape the workflows use. */
export type AbandonedCartCandidate = {
  cart_id: string
  email: string | null
  customer_id: string | null
  sales_channel_id: string | null
  region_id: string | null
  currency_code: string | null
  item_count: number
  subtotal: number
  cart_updated_at: string
  metadata: Record<string, unknown> | null
}
