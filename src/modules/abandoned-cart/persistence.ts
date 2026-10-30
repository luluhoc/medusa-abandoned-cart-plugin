import { mergeMetadata } from "@medusajs/framework/utils"
import type { Context } from "@medusajs/framework/types"

export async function execute(context: Context, sql: string, params: unknown[] = []): Promise<any[]> {
  const manager = context.transactionManager ?? context.manager
  if (!manager) throw new Error("Abandoned cart database manager unavailable")
  return (manager as any).getConnection().execute(sql, params, "all", (manager as any).getTransactionContext())
}

const columns = new Set(["status", "stage_index", "locale", "last_notified_at", "recovered_at", "converted_at", "order_id",
  "email", "customer_id", "sales_channel_id", "region_id", "currency_code", "item_count", "subtotal", "raw_subtotal",
  "cart_updated_at", "metadata", "delivery_cycle"])
export async function updateState(context: Context, before: any, data: Record<string, unknown>) {
  if (before.status === "converted" && data.status && data.status !== "converted") return null
  if (before.status === "dismissed" && data.status && !["dismissed", "converted"].includes(String(data.status))) return null
  const values = { ...data }
  if (values.metadata) values.metadata = mergeMetadata(before.metadata ?? {}, values.metadata as Record<string, unknown>)
  if (values.subtotal != null) values.raw_subtotal = { value: String(values.subtotal), precision: 20 }
  const entries = Object.entries(values).filter(([key]) => columns.has(key))
  if (!entries.length) return before
  const params = entries.map(([key, value]) => ["metadata", "raw_subtotal"].includes(key) && value != null ? JSON.stringify(value) : value)
  const result = await execute(context, `UPDATE abandoned_cart SET ${entries.map(([key]) => `"${key}" = ?`).join(", ")},
    revision = revision + 1, updated_at = now() WHERE id = ? AND deleted_at IS NULL AND revision = ?
    AND status = ? AND stage_index = ? AND delivery_cycle = ? AND order_id IS NOT DISTINCT FROM ? RETURNING *`,
    [...params, before.id, before.revision ?? 0, before.status, before.stage_index, before.delivery_cycle ?? "initial", before.order_id ?? null])
  return result[0] ?? null
}
