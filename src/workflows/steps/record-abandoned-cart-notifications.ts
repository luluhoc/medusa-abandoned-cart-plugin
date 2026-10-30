import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ABANDONED_CART_MODULE } from "../../modules/abandoned-cart"
import type AbandonedCartModuleService from "../../modules/abandoned-cart/service"
import type { SendAbandonedCartNotificationsStepOutput } from "./send-abandoned-cart-notifications"

export type RecordAbandonedCartNotificationsStepInput = SendAbandonedCartNotificationsStepOutput
export type RecordAbandonedCartNotificationsStepOutput = {
  sent: number; failed: number; closed: number; notification_ids: string[]; processed_ids: string[]; deferred: number
}

/** Accepted-delivery audit is a durable fact: workflow compensation cannot unsend mail. */
export const recordAbandonedCartNotificationsStep = createStep("record-abandoned-cart-notifications", async (
  input: RecordAbandonedCartNotificationsStepInput, { container }
): Promise<StepResponse<RecordAbandonedCartNotificationsStepOutput>> => {
  const service = container.resolve<AbandonedCartModuleService>(ABANDONED_CART_MODULE)
  const results = input.results ?? []
  const stale = input.stale ?? []
  const ids: string[] = []
  for (const result of results) {
    const key = !result.error ? result.delivery_key : null
    let audit: any
    if (key) [audit] = await service.listAbandonedCartNotifications({ delivery_key: key }, { take: 1 })
    if (!audit) {
      try {
        audit = await service.createAbandonedCartNotifications({ abandoned_cart_id: result.record_id,
          stage_id: result.stage_id, stage_index: result.stage_index, channel: result.channel, template: result.template,
          locale: result.locale, to: result.to, notification_id: result.notification_id, delivery_key: key,
          error: result.error, sent_at: result.error ? null : new Date() })
      } catch (error) {
        if (key) [audit] = await service.listAbandonedCartNotifications({ delivery_key: key }, { take: 1 })
        if (!audit) throw error
      }
    }
    ids.push(audit.id)
    if (result.error) continue
    const current = await service.retrieveAbandonedCart(result.record_id)
    if (["converted", "dismissed", "expired"].includes(current.status) || current.order_id ||
      (current.delivery_cycle ?? "initial") !== (result.cycle ?? "initial") || (!result.force && current.stage_index > result.stage_index)) continue
    if (current.last_notified_at && new Date(current.last_notified_at).getTime() >= new Date(audit.sent_at).getTime()) continue
    await service.updateState(current, { stage_index: Math.max(current.stage_index, result.stage_index + 1),
      status: current.status === "recovered" ? "recovered" : "notified", last_notified_at: audit.sent_at, locale: result.locale })
  }
  let closed = 0
  for (const entry of stale) {
    const current = await service.retrieveAbandonedCart(entry.record_id)
    if (["converted", "dismissed"].includes(current.status) || current.order_id ||
      (current.delivery_cycle ?? "initial") !== (entry.cycle ?? "initial")) continue
    if (await service.updateState(current, { status: entry.status })) closed++
  }
  return new StepResponse({ sent: results.filter(row => !row.error).length, failed: results.filter(row => row.error).length,
    closed, notification_ids: ids, processed_ids: input.processed_ids ?? [...new Set([...results.map(row => row.record_id), ...stale.map(row => row.record_id)])],
    deferred: input.deferred ?? 0 })
})
