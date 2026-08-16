import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { ABANDONED_CART_MODULE } from "../../../../modules/abandoned-cart"
import type AbandonedCartModuleService from "../../../../modules/abandoned-cart/service"
import type { PostAdminAbandonedCartSchemaType } from "../validators"

const DETAIL_FIELDS = [
  "*",
  "notifications.*",
  "cart.*",
  "cart.items.*",
  "customer.*",
  "order.*",
]

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "abandoned_cart",
    fields: DETAIL_FIELDS,
    filters: { id: req.params.id },
  })

  if (!data.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Abandoned cart ${req.params.id} was not found`
    )
  }

  res.json({ abandoned_cart: data[0] })
}

export const POST = async (
  req: MedusaRequest<PostAdminAbandonedCartSchemaType>,
  res: MedusaResponse
) => {
  const service = req.scope.resolve<AbandonedCartModuleService>(
    ABANDONED_CART_MODULE
  )

  const [record] = await service.listAbandonedCarts(
    { id: req.params.id },
    { take: 1 }
  )

  if (!record) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Abandoned cart ${req.params.id} was not found`
    )
  }

  const body = { ...req.validatedBody }

  if (body.locale) {
    const locale = service.matchLocale(body.locale)

    if (!locale) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Unsupported abandoned cart locale "${body.locale}".`
      )
    }

    body.locale = locale
  }

  const [updated] = await service.updateAbandonedCarts([
    {
      id: req.params.id,
      ...body,
    },
  ])

  res.json({ abandoned_cart: updated })
}
