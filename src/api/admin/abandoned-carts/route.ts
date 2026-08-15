import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const {
    data: abandoned_carts,
    metadata: { count, take, skip } = { count: 0, take: 20, skip: 0 },
  } = await query.graph({
    entity: "abandoned_cart",
    ...req.queryConfig,
    filters: req.filterableFields,
  })

  res.json({
    abandoned_carts,
    count,
    limit: take,
    offset: skip,
  })
}
