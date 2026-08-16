import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { ABANDONED_CART_MODULE } from "../../modules/abandoned-cart"
import type AbandonedCartModuleService from "../../modules/abandoned-cart/service"
import { baseLanguage } from "../../utils/locale"
import type { SelectDueAbandonedCartsStepOutput } from "./select-due-abandoned-carts"

export type SendAbandonedCartNotificationsStepInput =
  SelectDueAbandonedCartsStepOutput

export type AbandonedCartSendResult = {
  record_id: string
  cart_id: string
  stage_id: string
  stage_index: number
  channel: string
  template: string
  locale: string | null
  to: string
  notification_id: string | null
  error: string | null
}

export type SendAbandonedCartNotificationsStepOutput = {
  results: AbandonedCartSendResult[]
  stale: { record_id: string; status: string }[]
  sent: number
  failed: number
}

/**
 * Hands each due cart to the Notification Module.
 *
 * Sends are isolated per cart so that one bad address or one provider error
 * doesn't cancel the whole batch — failures come back as results with an
 * `error`, and the next step records them without advancing the stage, so the
 * cart is retried on the following sweep.
 *
 * This step has no compensation: an email that left the building can't be
 * un-sent.
 */
export const sendAbandonedCartNotificationsStep = createStep(
  "send-abandoned-cart-notifications",
  async (
    input: SendAbandonedCartNotificationsStepInput,
    { container }
  ): Promise<StepResponse<SendAbandonedCartNotificationsStepOutput>> => {
    const service = container.resolve<AbandonedCartModuleService>(
      ABANDONED_CART_MODULE
    )
    const notificationModuleService = container.resolve(Modules.NOTIFICATION)
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

    const results: AbandonedCartSendResult[] = []

    for (const item of input.items ?? []) {
      const { cart, stage, locale } = item
      const delivery = service.getStageDelivery(stage, locale)

      const payload = {
        to: item.to,
        channel: delivery.channel,
        template: delivery.template,
        data: {
          ...delivery.data,
          stage: { id: stage.id, index: stage.index },
          cart_id: item.cart_id,
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

      try {
        const notification = await notificationModuleService.createNotifications(
          payload
        )
        const created = Array.isArray(notification)
          ? notification[0]
          : notification

        results.push({
          record_id: item.record_id,
          cart_id: item.cart_id,
          stage_id: stage.id,
          stage_index: stage.index,
          channel: delivery.channel,
          template: delivery.template,
          locale,
          to: item.to,
          notification_id: created?.id ?? null,
          error: null,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        logger.error(
          `[abandoned-cart] failed to notify cart ${item.cart_id} (stage "${stage.id}"): ${message}`
        )

        results.push({
          record_id: item.record_id,
          cart_id: item.cart_id,
          stage_id: stage.id,
          stage_index: stage.index,
          channel: delivery.channel,
          template: delivery.template,
          locale,
          to: item.to,
          notification_id: null,
          error: message,
        })
      }
    }

    return new StepResponse({
      results,
      stale: input.stale ?? [],
      sent: results.filter((result) => !result.error).length,
      failed: results.filter((result) => result.error).length,
    })
  }
)
