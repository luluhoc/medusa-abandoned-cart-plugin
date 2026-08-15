import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { markAbandonedCartConvertedWorkflow } from "../workflows/mark-abandoned-cart-converted"

/**
 * Attributes a placed order back to its tracked cart, which is what turns the
 * abandoned-cart table into a recovery report rather than a list of guesses.
 */
export default async function abandonedCartOrderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    await markAbandonedCartConvertedWorkflow(container).run({
      input: { order_id: data.id },
    })
  } catch (error) {
    // Attribution is bookkeeping — never let it break order placement.
    logger.error(
      `[abandoned-cart] failed to attribute order ${data.id}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
