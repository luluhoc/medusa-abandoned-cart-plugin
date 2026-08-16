import { MedusaError } from "@medusajs/framework/utils"

/**
 * Locale tags are BCP 47-ish: a language, optionally followed by a script or
 * region — `"fr"`, `"fr-CA"`, `"pt-BR"`, `"zh-Hans"`. Underscores are accepted
 * because that is how most i18n libraries and cookies spell them.
 */
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i

/**
 * Canonicalizes a locale tag: `"FR_ca"` → `"fr-CA"`. Returns `null` for
 * anything that isn't a usable tag, so callers can treat "no locale" and
 * "unusable locale" the same way.
 */
export function normalizeLocale(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const raw = value.trim().replace(/_/g, "-")

  if (!raw || !LOCALE_PATTERN.test(raw)) {
    return null
  }

  const [language, ...rest] = raw.split("-")

  return [
    language.toLowerCase(),
    ...rest.map((part) =>
      // Region subtags are conventionally upper case, script subtags title
      // case. Neither affects matching, which is case-insensitive throughout.
      part.length === 4
        ? part[0].toUpperCase() + part.slice(1).toLowerCase()
        : part.toUpperCase()
    ),
  ].join("-")
}

/** Like {@link normalizeLocale}, but throws instead of returning `null`. */
export function assertLocale(value: unknown, label: string): string {
  const locale = normalizeLocale(value)

  if (!locale) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Invalid ${label}: ${JSON.stringify(
        value
      )}. Expected a locale tag like "en", "fr-CA" or "pt-BR".`
    )
  }

  return locale
}

/** The language part of a tag: `"pt-BR"` → `"pt"`. */
export function baseLanguage(locale: string): string {
  return locale.split("-")[0].toLowerCase()
}

/**
 * The lookup chain for a locale, most specific first:
 * `"zh-Hans-CN"` → `["zh-hans-cn", "zh-hans", "zh"]`.
 *
 * This is what makes a single `fr` template serve `fr-CA` shoppers.
 */
export function localeLookupKeys(locale: string): string[] {
  const parts = locale.toLowerCase().split("-")

  return parts.map((_, index) => parts.slice(0, parts.length - index).join("-"))
}

/**
 * Looks a locale up in a map keyed by lower-cased tags, walking the fallback
 * chain. Maps must be built with {@link normalizeLocaleKeyedMap}.
 */
export function pickForLocale<T>(
  map: Record<string, T>,
  locale: string | null | undefined
): T | undefined {
  if (!locale) {
    return undefined
  }

  for (const key of localeLookupKeys(locale)) {
    if (key in map) {
      return map[key]
    }
  }

  return undefined
}

/**
 * Constrains a locale to a supported set: an exact match if there is one,
 * otherwise one that shares its base language, otherwise `null`. This is the
 * single rule for "which of my locales is this?" — resolution uses it at
 * runtime, option validation uses it at boot.
 */
export function matchSupportedLocale(
  locale: string,
  locales: string[]
): string | null {
  if (!locales.length) {
    return locale
  }

  const lower = locale.toLowerCase()

  return (
    locales.find((candidate) => candidate.toLowerCase() === lower) ??
    locales.find(
      (candidate) => baseLanguage(candidate) === baseLanguage(lower)
    ) ??
    null
  )
}

/**
 * Whether a locale-keyed map entry can ever be read, i.e. whether the key is
 * on the lookup chain of some supported locale. With `locales: ["de-AT"]` a
 * `de` key is reachable (`de-AT` falls back to it) but a `de-CH` key is not.
 */
export function isReachableLocaleKey(key: string, locales: string[]): boolean {
  if (!locales.length) {
    return true
  }

  const lower = key.toLowerCase()

  return locales.some((locale) => localeLookupKeys(locale).includes(lower))
}

/**
 * Validates and lower-cases the keys of a locale-keyed option map so that
 * lookups can be case-insensitive without normalizing on every send.
 */
export function normalizeLocaleKeyedMap<T>(
  map: Record<string, T> | undefined,
  label: string
): Record<string, T> {
  if (!map) {
    return {}
  }

  const normalized: Record<string, T> = {}

  for (const [key, value] of Object.entries(map)) {
    normalized[assertLocale(key, `${label} key`).toLowerCase()] = value
  }

  return normalized
}

/**
 * Fills a `{template}` / `{locale}` / `{lang}` pattern, e.g.
 * `"{template}-{lang}"` with `("d-reminder", "fr-CA")` → `"d-reminder-fr"`.
 */
export function applyTemplatePattern(
  pattern: string,
  template: string,
  locale: string
): string {
  return pattern
    .replace(/\{template\}/g, template)
    .replace(/\{locale\}/g, locale)
    .replace(/\{lang\}/g, baseLanguage(locale))
}
