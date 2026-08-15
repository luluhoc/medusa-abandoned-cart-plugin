import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import {
  markAbandonedCartConvertedStep,
  type MarkAbandonedCartConvertedStepInput,
} from "./steps/mark-abandoned-cart-converted"

export type MarkAbandonedCartConvertedWorkflowInput =
  MarkAbandonedCartConvertedStepInput

export const MARK_ABANDONED_CART_CONVERTED_WORKFLOW_ID =
  "mark-abandoned-cart-converted"

/** Run when an order is placed, to attribute it back to the tracked cart. */
export const markAbandonedCartConvertedWorkflow = createWorkflow(
  MARK_ABANDONED_CART_CONVERTED_WORKFLOW_ID,
  (input: MarkAbandonedCartConvertedWorkflowInput) => {
    const result = markAbandonedCartConvertedStep(input)

    return new WorkflowResponse(result)
  }
)
