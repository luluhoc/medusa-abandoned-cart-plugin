import type { MedusaContainer } from "@medusajs/framework/types"

/** Optional host hook, resolved in the commerce workflow scope before sending. */
export const ABANDONED_CART_NOTIFICATION_ENRICHER = "abandonedCartNotificationEnricher"
export const ABANDONED_CART_DEFERRED = "abandoned_cart_deferred"

export type AbandonedCartNotificationPayload = {
  to: string
  channel: string
  template: string
  data: Record<string, unknown>
  idempotency_key?: string
}

/** Return null to close the record; throw with the deferred code to retry later. */
export type AbandonedCartNotificationEnricher = (
  payload: AbandonedCartNotificationPayload,
  container: MedusaContainer
) => Promise<AbandonedCartNotificationPayload | null>
