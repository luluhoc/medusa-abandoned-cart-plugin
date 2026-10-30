import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ABANDONED_CART_MODULE } from "../../modules/abandoned-cart"
import type AbandonedCartModuleService from "../../modules/abandoned-cart/service"
import { ABANDONED_CART_NOTIFICATION_ENRICHER, ABANDONED_CART_DEFERRED, type AbandonedCartNotificationEnricher, type AbandonedCartNotificationPayload } from "../../utils/notification-enrichment"
import { baseLanguage } from "../../utils/locale"
import { deliveryKey, sameEmail } from "../../utils/delivery-key"
import type { DueAbandonedCart, SelectDueAbandonedCartsStepOutput } from "./select-due-abandoned-carts"

export type SendAbandonedCartNotificationsStepInput = SelectDueAbandonedCartsStepOutput
export type AbandonedCartSendResult = {
  record_id: string; cart_id: string; stage_id: string; stage_index: number; channel: string; template: string;
  locale: string | null; to: string; notification_id: string | null; error: string | null; delivery_key?: string; cycle?: string; force?: boolean
}
export type SendAbandonedCartNotificationsStepOutput = {
  results: AbandonedCartSendResult[]; stale: { record_id: string; status: string; cycle?: string }[];
  sent: number; failed: number; processed_ids: string[]; deferred: number
}
function deferred(): Error { return Object.assign(new Error("Cart delivery deferred"), { code: ABANDONED_CART_DEFERRED }) }
function failureVersion(notification: any): string {
  const updated = notification.updated_at ? new Date(notification.updated_at).toISOString() : null
  return JSON.stringify([notification.id, updated])
}

function buildPayload(item: DueAbandonedCart, cart: any, service: AbandonedCartModuleService): AbandonedCartNotificationPayload {
  const { stage, locale } = item
  const delivery = service.getStageDelivery(stage, locale)
  return {
    to: item.to,
    channel: delivery.channel,
    template: delivery.template,
    data: {
      ...delivery.data,
      stage: { id: stage.id, index: stage.index },
      cart_id: item.cart_id,
      abandoned_cart_id: item.record_id,
      forced_send: item.force === true,
      token: item.token,
      recovery_url: service.buildRecoveryUrl(
        item.token,
        item.cart_id,
        locale
      ),
      email: item.to,
      locale,
      language: locale ? baseLanguage(locale) : null,
      currency_code: cart.currency_code,
      customer: {
        first_name:
          cart.customer?.first_name ?? cart.shipping_address?.first_name,
        last_name:
          cart.customer?.last_name ?? cart.shipping_address?.last_name,
        email: cart.customer?.email ?? item.to,
      },
      item_count: cart.items?.length ?? 0,
      subtotal: (cart.items ?? []).reduce(
        (sum: number, line: any) =>
          sum + Number(line.unit_price ?? 0) * Number(line.quantity ?? 0),
        0
      ),
      items: (cart.items ?? []).map((line: any) => ({
        id: line.id,
        product_title: line.product_title ?? line.title,
        title: line.title,
        subtitle: line.subtitle,
        variant_title: line.variant_title,
        quantity: line.quantity,
        unit_price: Number(line.unit_price ?? 0),
        total: Number(line.unit_price ?? 0) * Number(line.quantity ?? 0),
        thumbnail: line.thumbnail,
      })),
    },
  }
}

export const sendAbandonedCartNotificationsStep = createStep("send-abandoned-cart-notifications", async (
  input: SendAbandonedCartNotificationsStepInput, { container }
): Promise<StepResponse<SendAbandonedCartNotificationsStepOutput>> => {
  const service = container.resolve<AbandonedCartModuleService>(ABANDONED_CART_MODULE)
  const notifications = container.resolve(Modules.NOTIFICATION)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const results: AbandonedCartSendResult[] = []
  const stale = input.stale ?? []
  const processed = new Set(stale.map(row => row.record_id))
  let deferredCount = 0
  for (const item of input.items ?? []) {
    processed.add(item.record_id)
    let claim: any
    let owned = false
    let invoking = false
    const delivery = service.getStageDelivery(item.stage, item.locale)
    const result: AbandonedCartSendResult = { record_id: item.record_id, cart_id: item.cart_id,
      stage_id: item.stage.id, stage_index: item.stage.index, channel: delivery.channel, template: delivery.template,
      locale: item.locale, to: item.to, notification_id: null, error: null, cycle: item.cycle ?? "initial", force: item.force === true }
    try {
      if (item.force && !item.request_id) throw new Error("Forced delivery requires an operation ID")
      await service.noteAttempt(item.record_id)
      const key = deliveryKey(item.record_id, item.stage.id, result.cycle!, item.force ? item.request_id : undefined)
      result.delivery_key = key
      const acquired = await service.claimDelivery(key, item.record_id, key)
      claim = acquired.row; owned = acquired.owned
      if (claim.state === "accepted") { results.push(claim.result); continue }
      if (!owned) {
        if (claim.state === "invoking") {
          const [previous] = await notifications.listNotifications({ idempotency_key: claim.idempotency_key } as any, { take: 1 })
          if (previous?.status === "success") {
            const { _failure_version, ...intent } = claim.result ?? result
            const receipt = { ...intent, notification_id: previous.id, to: previous.to, template: previous.template, channel: previous.channel, locale: typeof previous.data?.locale === "string" ? previous.data.locale : intent.locale }
            await service.acceptDelivery(claim, receipt); results.push(receipt); continue
          }
          // Native retries leave the previous failure row untouched while the
          // provider is running. Only a NEW ledger failure proves this attempt
          // failed; otherwise another worker could release an active invocation.
          if (previous?.status === "failure" && failureVersion(previous) !== claim.result?._failure_version) await service.retryDelivery(claim)
        }
        throw deferred()
      }
      const current = await service.retrieveAbandonedCart(item.record_id)
      if (current.status === "converted" || current.order_id || (!item.force && ["dismissed", "expired"].includes(current.status)) ||
        (current.delivery_cycle ?? "initial") !== result.cycle || (!item.force && current.stage_index > item.stage.index)) throw deferred()
      const { data: carts } = await query.graph({ entity: "cart", filters: { id: item.cart_id },
        fields: ["id", "email", "completed_at", "currency_code", "items.*", "customer.*", "shipping_address.*"] }, { cache: { enable: false } })
      const cart = carts[0]
      if (!cart || cart.completed_at || !cart.items?.length) {
        stale.push({ record_id: item.record_id, status: cart?.completed_at ? "converted" : "expired", cycle: result.cycle })
        await service.retryDelivery(claim); continue
      }
      // Core privacy invariant, independent of the optional application hook.
      if (!sameEmail(item.to, current.email) || !sameEmail(current.email, cart.email)) throw deferred()
      const payload = buildPayload(item, cart, service)
      const prepare = container.resolve<AbandonedCartNotificationEnricher>(ABANDONED_CART_NOTIFICATION_ENRICHER, { allowUnregistered: true })
      const prepared = prepare ? await prepare(payload, container) : payload
      if (!prepared) {
        stale.push({ record_id: item.record_id, status: "dismissed", cycle: result.cycle })
        await service.retryDelivery(claim); continue
      }
      if (!sameEmail(prepared.to, cart.email)) throw deferred()
      prepared.idempotency_key ||= key
      Object.assign(result, { to: prepared.to, template: prepared.template, channel: prepared.channel,
        locale: typeof prepared.data?.locale === "string" ? prepared.data.locale : result.locale })
      const [prior] = await notifications.listNotifications({ idempotency_key: prepared.idempotency_key } as any, { take: 1 })
      const started = await service.beginDelivery(claim, prepared.idempotency_key, { ...result,
        _failure_version: prior?.status === "failure" ? failureVersion(prior) : null })
      if (!started) throw deferred()
      claim = started; invoking = true
      const response = await notifications.createNotifications(prepared)
      let created = Array.isArray(response) ? response[0] : response
      if (!created) [created] = await notifications.listNotifications({ idempotency_key: prepared.idempotency_key } as any, { take: 1 })
      if (created?.status !== "success") {
        if (created?.status === "failure") { await service.retryDelivery(claim); invoking = false; throw new Error("Abandoned cart notification delivery failed") }
        throw deferred()
      }
      result.notification_id = created.id
      await service.acceptDelivery(claim, result)
      results.push(result)
    } catch (error) {
      if (owned && claim && !invoking) await service.retryDelivery(claim)
      if (error?.code === ABANDONED_CART_DEFERRED) { deferredCount++; continue }
      // Unknown invocation outcomes retain their claim; a later read of the native
      // notification ledger can recover success/failure without guessing or re-sending.
      logger.error(`[abandoned-cart] delivery failed for record ${item.record_id}`)
      results.push({ ...result, error: "Abandoned cart delivery unavailable" })
    }
  }
  return new StepResponse({ results, stale, sent: results.filter(row => !row.error).length,
    failed: results.filter(row => row.error).length, processed_ids: [...processed], deferred: deferredCount })
})
