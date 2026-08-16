import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { ABANDONED_CART_MODULE } from "../../../../modules/abandoned-cart"
import type AbandonedCartModuleService from "../../../../modules/abandoned-cart/service"

/**
 * `GET /admin/abandoned-carts/stats?days=30`
 *
 * Omit `days` for all-time numbers.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve<AbandonedCartModuleService>(
    ABANDONED_CART_MODULE
  )

  const days = Number(req.query.days)
  const filters =
    Number.isFinite(days) && days > 0
      ? {
          created_at: {
            $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
          },
        }
      : {}

  const stats = await service.getStats(filters)
  const options = service.getOptions()

  res.json({
    stats,
    config: {
      enabled: options.enabled,
      locales: options.locales,
      default_locale: options.defaultLocale,
      stages: options.stages.map((stage) => ({
        id: stage.id,
        delay_ms: stage.delayMs,
        template: stage.template,
        channel: stage.channel,
        templates: stage.templates,
      })),
    },
  })
}
