import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { ABANDONED_CART_MODULE } from "../modules/abandoned-cart"
import type AbandonedCartModuleService from "../modules/abandoned-cart/service"
import { runAbandonedCartSweep } from "../utils/run-sweep"

export default async function abandonedCartSweepJob(
  container: MedusaContainer
) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service = container.resolve<AbandonedCartModuleService>(
    ABANDONED_CART_MODULE
  )

  if (!service.getOptions().enabled) {
    return
  }

  try {
    const result = await runAbandonedCartSweep(container)

    if (result.created || result.sent || result.failed || result.closed) {
      logger.info(
        `[abandoned-cart] swept ${result.scanned} carts — ${result.created} new, ${result.updated} refreshed, ${result.sent} notified, ${result.failed} failed, ${result.closed} closed`
      )
    }
  } catch (error) {
    logger.error(
      `[abandoned-cart] sweep failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

export const config = {
  name: "abandoned-cart-sweep",
  // A scheduled job's config is read at boot, before plugin options are
  // available, so the cron expression comes from the environment instead.
  schedule: process.env.ABANDONED_CART_CRON || "*/15 * * * *",
}
