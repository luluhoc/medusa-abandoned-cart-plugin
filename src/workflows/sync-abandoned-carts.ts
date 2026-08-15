import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { findAbandonedCartCandidatesStep } from "./steps/find-abandoned-cart-candidates"
import { upsertAbandonedCartsStep } from "./steps/upsert-abandoned-carts"

export type SyncAbandonedCartsWorkflowInput = {
  /** Page size. Defaults to the plugin's `batchSize` option. */
  limit?: number
  /** Page offset, used by the scheduled job to walk through all matching carts. */
  offset?: number
}

export const SYNC_ABANDONED_CARTS_WORKFLOW_ID = "sync-abandoned-carts"

/**
 * Detection pass: finds carts that went quiet and makes sure each one has an
 * up-to-date tracking record. Sends nothing.
 */
export const syncAbandonedCartsWorkflow = createWorkflow(
  SYNC_ABANDONED_CARTS_WORKFLOW_ID,
  (input: SyncAbandonedCartsWorkflowInput) => {
    const candidates = findAbandonedCartCandidatesStep(input)
    const result = upsertAbandonedCartsStep(candidates)

    return new WorkflowResponse(
      transform({ candidates, result }, (data) => ({
        created: data.result.created,
        updated: data.result.updated,
        /** Total carts matching the detection filters — the pagination bound. */
        count: data.candidates.count,
        /** Carts returned by this page before the in-memory thresholds. */
        scanned: data.candidates.scanned,
        /** Carts on this page that qualified. */
        qualified: data.candidates.carts.length,
      }))
    )
  }
)
