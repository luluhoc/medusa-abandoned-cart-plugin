import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { runAbandonedCartSweep } from "../../../../utils/run-sweep"

/**
 * `POST /admin/abandoned-carts/sweep`
 *
 * Runs detection + notification immediately instead of waiting for the cron.
 * Pass `?notify=false` to only refresh the tracked carts without sending.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const notify = req.query.notify !== "false"

  const result = await runAbandonedCartSweep(req.scope, { notify })

  res.json({ sweep: result })
}
