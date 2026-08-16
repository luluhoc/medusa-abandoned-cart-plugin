import { MedusaError } from "@medusajs/framework/utils"

import { parseDuration } from "../../utils/duration"
import {
  assertLocale,
  isReachableLocaleKey,
  matchSupportedLocale,
  normalizeLocaleKeyedMap,
} from "../../utils/locale"
import type {
  AbandonedCartModuleOptions,
  ResolvedAbandonedCartOptions,
  ResolvedStage,
} from "./types"

export const DEFAULT_CHANNEL = "email"
export const DEFAULT_TEMPLATE = "abandoned-cart"
export const DEFAULT_RECOVERY_PATH = "/cart/recover/{token}"
export const DEFAULT_LOCALE_METADATA_KEY = "locale"

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

  const locales = resolveLocales(options.locales)

  /**
   * Every locale-keyed option is checked against `locales`. A translation that
   * never fires because its key is misspelled is invisible in production —
   * much better to refuse to boot.
   */
  const localeKeyed = <T>(
    map: Record<string, T> | undefined,
    label: string
  ): Record<string, T> => {
    const normalized = normalizeLocaleKeyedMap(map, label)

    for (const key of Object.keys(normalized)) {
      if (!isReachableLocaleKey(key, locales)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Invalid abandoned cart options: ${label} has an entry for "${key}", which no locale in "locales" (${locales.join(
            ", "
          )}) would ever look up.`
        )
      }
    }

    return normalized
  }

  const localeValued = (
    map: Record<string, string> | undefined,
    label: string
  ): Record<string, string> => {
    const normalized: Record<string, string> = {}

    for (const [key, value] of Object.entries(map ?? {})) {
      normalized[key.toLowerCase()] = requireSupportedLocale(
        assertLocale(value, `${label}["${key}"]`),
        locales,
        `${label}["${key}"]`
      )
    }

    return normalized
  }

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
    templates: localeKeyed(stage.templates, `stages[${index}].templates`),
    localeData: localeKeyed(stage.localeData, `stages[${index}].localeData`),
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

  const defaultLocale = options.defaultLocale
    ? requireSupportedLocale(
        assertLocale(options.defaultLocale, `"defaultLocale"`),
        locales,
        `"defaultLocale"`
      )
    : null

  const templatePattern = options.templatePattern

  if (templatePattern) {
    if (!locales.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Invalid abandoned cart options: "templatePattern" requires "locales", so the plugin only ever derives template ids for locales you actually have templates for.`
      )
    }

    if (!/\{locale\}|\{lang\}/.test(templatePattern)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Invalid abandoned cart options: "templatePattern" must contain "{locale}" or "{lang}", otherwise every locale resolves to the same template.`
      )
    }
  }

  if (options.resolveLocale && typeof options.resolveLocale !== "function") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Invalid abandoned cart options: "resolveLocale" must be a function.`
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
    locales,
    defaultLocale,
    localeMetadataKey:
      options.localeMetadataKey ?? DEFAULT_LOCALE_METADATA_KEY,
    localeByRegion: localeValued(options.localeByRegion, `"localeByRegion"`),
    localeBySalesChannel: localeValued(
      options.localeBySalesChannel,
      `"localeBySalesChannel"`
    ),
    localeByCountry: localeValued(
      options.localeByCountry,
      `"localeByCountry"`
    ),
    resolveLocale: options.resolveLocale,
    templates: localeKeyed(options.templates, `"templates"`),
    templatePattern,
    localeData: localeKeyed(options.localeData, `"localeData"`),
    storefrontUrlByLocale: Object.fromEntries(
      Object.entries(
        localeKeyed(options.storefrontUrlByLocale, `"storefrontUrlByLocale"`)
      ).map(([locale, url]) => [locale, String(url).replace(/\/+$/, "")])
    ),
    recoveryPathByLocale: localeKeyed(
      options.recoveryPathByLocale,
      `"recoveryPathByLocale"`
    ),
  }
}

function resolveLocales(values: string[] | undefined): string[] {
  const locales: string[] = []
  const seen = new Set<string>()

  for (const [index, value] of (values ?? []).entries()) {
    const locale = assertLocale(value, `locales[${index}]`)

    if (seen.has(locale.toLowerCase())) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Invalid abandoned cart options: duplicate locale "${locale}" in "locales".`
      )
    }

    seen.add(locale.toLowerCase())
    locales.push(locale)
  }

  return locales
}

/** Constrains an option that names a locale, the same way resolution would. */
function requireSupportedLocale(
  locale: string,
  locales: string[],
  label: string
): string {
  const matched = matchSupportedLocale(locale, locales)

  if (!matched) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Invalid abandoned cart options: ${label} is "${locale}", which is not in "locales" (${locales.join(
        ", "
      )}).`
    )
  }

  return matched
}
