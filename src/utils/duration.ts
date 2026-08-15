import { MedusaError } from "@medusajs/framework/utils"

import type { Duration } from "../modules/abandoned-cart/types"

const UNIT_TO_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
}

const DURATION_PATTERN = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/i

/**
 * Converts a duration option into milliseconds.
 *
 * Strings must carry a unit (`"90s"`, `"30m"`, `"4h"`, `"2d"`, `"1w"`); plain
 * numbers are interpreted as minutes.
 */
export function parseDuration(value: Duration, label = "duration"): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Invalid ${label}: expected a non-negative number of minutes, got ${value}`
      )
    }

    return value * UNIT_TO_MS.m
  }

  const match = DURATION_PATTERN.exec(String(value).trim())

  if (!match) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Invalid ${label}: "${value}". Expected a number of minutes or a string like "30m", "4h", "2d".`
    )
  }

  return parseFloat(match[1]) * UNIT_TO_MS[match[2].toLowerCase()]
}
