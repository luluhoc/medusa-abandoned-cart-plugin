import { createHash } from "crypto"

export function deliveryKey(recordId: string, stageId: string, cycle: string, requestId?: string): string {
  // A retried manual request may now select a later stage or a new activity
  // cycle. Its operation ID must still resolve to the original delivery.
  const identity = requestId ? [recordId, "manual", requestId] : [recordId, stageId, cycle, null]
  return "abandoned-cart:" + createHash("sha256").update(JSON.stringify(identity)).digest("hex")
}
export function sameEmail(a: unknown, b: unknown): boolean {
  return typeof a === "string" && typeof b === "string" && !!a.trim() && a.trim().toLowerCase() === b.trim().toLowerCase()
}
