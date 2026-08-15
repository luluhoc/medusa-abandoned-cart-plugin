import { MedusaError } from "@medusajs/framework/utils"

import { parseDuration } from "../../utils/duration"
import type {
  AbandonedCartModuleOptions,
  ResolvedAbandonedCartOptions,
  ResolvedStage,
} from "./types"

export const DEFAULT_CHANNEL = "email"
export const DEFAULT_TEMPLATE = "abandoned-cart"
export const DEFAULT_RECOVERY_PATH = "/cart/recover/{token}"

/**
 * Normalizes the raw plugin options into a fully-resolved shape that the rest
 * of the plugin can rely on. Throws on invalid configuration so that a
 * misconfigured plugin fails at boot rather than silently sending nothing.
 */
export function resolveOptions(
  options: AbandonedCartModuleOptions = {}
): ResolvedAbandonedCartOptions {
  const channel = options.channel ?? DEFAULT_CHANNEL
  const template = options.template ?? DEFAULT_TEMPLATE

  const stageOptions = options.stages?.length
    ? options.stages
    : [{ delay: "4h" }]

  const stages: ResolvedStage[] = stageOptions.map((stage, index) => ({
    id: stage.id ?? `stage-${index + 1}`,
    index,
    delayMs: parseDuration(stage.delay, `stages[${index}].delay`),
    template: stage.template ?? template,
    channel: stage.channel ?? channel,
    data: stage.data ?? {},
  }))

  stages.forEach((stage, index) => {
    if (index > 0 && stage.delayMs <= stages[index - 1].delayMs) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Invalid abandoned cart stages: stage "${stage.id}" must have a longer delay than "${
          stages[index - 1].id
        }". Delays are cumulative and measured from the cart's last activity.`
      )
    }
  })

  const ids = new Set<string>()
  for (const stage of stages) {
    if (ids.has(stage.id)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Invalid abandoned cart stages: duplicate stage id "${stage.id}".`
      )
    }
    ids.add(stage.id)
  }

  const maxAgeMs = parseDuration(options.maxAge ?? "14d", "maxAge")

  if (maxAgeMs <= stages[0].delayMs) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Invalid abandoned cart options: "maxAge" must be longer than the first stage's delay, otherwise no cart can ever qualify.`
    )
  }

  return {
    enabled: options.enabled ?? true,
    channel,
    template,
    stages,
    batchSize: options.batchSize ?? 100,
    notificationBatchSize: options.notificationBatchSize ?? 100,
    maxAgeMs,
    minItems: options.minItems ?? 1,
    minSubtotal: options.minSubtotal ?? 0,
    requireEmail: options.requireEmail ?? true,
    onlyRegisteredCustomers: options.onlyRegisteredCustomers ?? false,
    salesChannelIds: options.salesChannelIds ?? [],
    storefrontUrl: options.storefrontUrl?.replace(/\/+$/, ""),
    recoveryPath: options.recoveryPath ?? DEFAULT_RECOVERY_PATH,
    stopAfterRecovery: options.stopAfterRecovery ?? true,
    resetOnActivity: options.resetOnActivity ?? false,
    notificationData: options.notificationData ?? {},
  }
}
