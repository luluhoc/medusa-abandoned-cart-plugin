import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { ABANDONED_CART_MODULE } from "../../modules/abandoned-cart"
import type AbandonedCartModuleService from "../../modules/abandoned-cart/service"
import type { SendAbandonedCartNotificationsStepOutput } from "./send-abandoned-cart-notifications"

export type RecordAbandonedCartNotificationsStepInput =
  SendAbandonedCartNotificationsStepOutput

export type RecordAbandonedCartNotificationsStepOutput = {
  sent: number
  failed: number
  closed: number
  notification_ids: string[]
}

type RecordCompensation = {
  notification_ids: string[]
  previous: Record<string, unknown>[]
}

/**
 * Writes the audit trail and advances the funnel.
 *
 * Successful sends move the record to the next stage; failed sends are logged
 * as notification rows with an `error` but leave `stage_index` alone, so the
 * next sweep retries them.
 */
export const recordAbandonedCartNotificationsStep = createStep(
  "record-abandoned-cart-notifications",
  async (
    input: RecordAbandonedCartNotificationsStepInput,
    { container }
  ): Promise<
    StepResponse<RecordAbandonedCartNotificationsStepOutput, RecordCompensation>
  > => {
    const service = container.resolve<AbandonedCartModuleService>(
      ABANDONED_CART_MODULE
    )

    const results = input.results ?? []
    const stale = input.stale ?? []

    if (!results.length && !stale.length) {
      return new StepResponse(
        { sent: 0, failed: 0, closed: 0, notification_ids: [] },
        { notification_ids: [], previous: [] }
      )
    }

    const affectedIds = [
      ...new Set([
        ...results.map((result) => result.record_id),
        ...stale.map((entry) => entry.record_id),
      ]),
    ]

    const records = await service.listAbandonedCarts(
      { id: affectedIds },
      { take: affectedIds.length }
    )
    const recordsById = new Map(records.map((record) => [record.id, record]))

    const previous = records.map((record) => ({
      id: record.id,
      status: record.status,
      stage_index: record.stage_index,
      last_notified_at: record.last_notified_at,
      locale: record.locale,
    }))

    const sentAt = new Date()

    const notificationRows = results.map((result) => ({
      abandoned_cart_id: result.record_id,
      stage_id: result.stage_id,
      stage_index: result.stage_index,
      channel: result.channel,
      template: result.template,
      locale: result.locale,
      to: result.to,
      notification_id: result.notification_id,
      error: result.error,
      sent_at: result.error ? null : sentAt,
    }))

    const createdNotifications = notificationRows.length
      ? await service.createAbandonedCartNotifications(notificationRows)
      : []

    const updates: Record<string, unknown>[] = []

    for (const result of results) {
      if (result.error) {
        continue
      }

      const record = recordsById.get(result.record_id)

      if (!record) {
        continue
      }

      updates.push({
        id: result.record_id,
        // A forced re-send of an earlier stage must not rewind the funnel.
        stage_index: Math.max(record.stage_index, result.stage_index + 1),
        status: record.status === "recovered" ? "recovered" : "notified",
        last_notified_at: sentAt,
        // Keep the record showing the locale we actually sent in.
        locale: result.locale,
      })
    }

    for (const entry of stale) {
      updates.push({ id: entry.record_id, status: entry.status })
    }

    if (updates.length) {
      await service.updateAbandonedCarts(updates)
    }

    return new StepResponse(
      {
        sent: results.filter((result) => !result.error).length,
        failed: results.filter((result) => result.error).length,
        closed: stale.length,
        notification_ids: createdNotifications.map(
          (notification) => notification.id
        ),
      },
      {
        notification_ids: createdNotifications.map(
          (notification) => notification.id
        ),
        previous,
      }
    )
  },
  async (compensation, { container }) => {
    if (!compensation) {
      return
    }

    const service = container.resolve<AbandonedCartModuleService>(
      ABANDONED_CART_MODULE
    )

    if (compensation.notification_ids.length) {
      await service.deleteAbandonedCartNotifications(
        compensation.notification_ids
      )
    }

    if (compensation.previous.length) {
      await service.updateAbandonedCarts(compensation.previous)
    }
  }
)
