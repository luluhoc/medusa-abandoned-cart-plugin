import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { recordAbandonedCartNotificationsStep } from "./steps/record-abandoned-cart-notifications"
import { selectDueAbandonedCartsStep } from "./steps/select-due-abandoned-carts"
import { sendAbandonedCartNotificationsStep } from "./steps/send-abandoned-cart-notifications"

export type SendAbandonedCartNotificationsWorkflowInput = {
  /** Restrict the run to these tracking record ids. */
  ids?: string[]
  /** Maximum number of carts to notify. Defaults to `notificationBatchSize`. */
  limit?: number
  /** Ignore stage delays and send immediately. */
  force?: boolean
  /** Send a specific stage instead of the record's next one. Requires `force`. */
  stage_id?: string
  /** Send in this locale instead of the one resolved from the cart. */
  locale?: string
}

export const SEND_ABANDONED_CART_NOTIFICATIONS_WORKFLOW_ID =
  "send-abandoned-cart-notifications"

/**
 * Notification pass: picks the carts whose next stage is due, sends it through
 * the Notification Module, and records the outcome.
 */
export const sendAbandonedCartNotificationsWorkflow = createWorkflow(
  SEND_ABANDONED_CART_NOTIFICATIONS_WORKFLOW_ID,
  (input: SendAbandonedCartNotificationsWorkflowInput) => {
    const due = selectDueAbandonedCartsStep(input)
    const sent = sendAbandonedCartNotificationsStep(due)
    const recorded = recordAbandonedCartNotificationsStep(sent)

    return new WorkflowResponse(recorded)
  }
)
