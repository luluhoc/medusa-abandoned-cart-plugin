import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { ABANDONED_CART_MODULE } from "../modules/abandoned-cart"
import type AbandonedCartModuleService from "../modules/abandoned-cart/service"
import { sendAbandonedCartNotificationsWorkflow } from "../workflows/send-abandoned-cart-notifications"
import { syncAbandonedCartsWorkflow } from "../workflows/sync-abandoned-carts"

export type SweepResult = {
  scanned: number
  created: number
  updated: number
  sent: number
  failed: number
  closed: number
}

/** Hard bounds so a bad page/filter combination can never spin forever. */
const MAX_DETECTION_PAGES = 200
const MAX_NOTIFICATION_PAGES = 10

/**
 * One full pass: detect newly abandoned carts, then send whatever is due.
 *
 * Shared by the scheduled job and the admin "run now" route so that both take
 * exactly the same path.
 */
export async function runAbandonedCartSweep(
  container: MedusaContainer,
  { notify = true }: { notify?: boolean } = {}
): Promise<SweepResult> {
  const service = container.resolve<AbandonedCartModuleService>(
    ABANDONED_CART_MODULE
  )
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const options = service.getOptions()

  const result: SweepResult = {
    scanned: 0,
    created: 0,
    updated: 0,
    sent: 0,
    failed: 0,
    closed: 0,
  }

  // Detection
  let offset = 0
  let total = 0
  let page = 0

  do {
    const { result: syncResult } = await syncAbandonedCartsWorkflow(
      container
    ).run({
      input: { limit: options.batchSize, offset },
    })

    total = syncResult.count
    result.scanned += syncResult.scanned
    result.created += syncResult.created
    result.updated += syncResult.updated

    offset += options.batchSize
    page += 1
  } while (offset < total && page < MAX_DETECTION_PAGES)

  if (page >= MAX_DETECTION_PAGES && offset < total) {
    logger.warn(
      `[abandoned-cart] detection stopped after ${MAX_DETECTION_PAGES} pages with ${
        total - offset
      } carts left; consider raising "batchSize" or shortening "maxAge".`
    )
  }

  if (!notify) {
    return result
  }

  // Notification
  const limit = options.notificationBatchSize

  for (let round = 0; round < MAX_NOTIFICATION_PAGES; round++) {
    const { result: sendResult } = await sendAbandonedCartNotificationsWorkflow(
      container
    ).run({
      input: { limit },
    })

    result.sent += sendResult.sent
    result.failed += sendResult.failed
    result.closed += sendResult.closed

    // Only keep going while a full page was actually processed; a short page
    // (or a page of pure failures, which stay selectable) ends the sweep.
    if (sendResult.sent + sendResult.closed < limit) {
      break
    }
  }

  return result
}
