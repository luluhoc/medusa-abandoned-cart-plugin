import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import {
  markAbandonedCartRecoveredStep,
  type MarkAbandonedCartRecoveredStepInput,
} from "./steps/mark-abandoned-cart-recovered"

export type MarkAbandonedCartRecoveredWorkflowInput =
  MarkAbandonedCartRecoveredStepInput

export const MARK_ABANDONED_CART_RECOVERED_WORKFLOW_ID =
  "mark-abandoned-cart-recovered"

/** Run when a shopper returns through a recovery link. */
export const markAbandonedCartRecoveredWorkflow = createWorkflow(
  MARK_ABANDONED_CART_RECOVERED_WORKFLOW_ID,
  (input: MarkAbandonedCartRecoveredWorkflowInput) => {
    const result = markAbandonedCartRecoveredStep(input)

    return new WorkflowResponse(result)
  }
)
