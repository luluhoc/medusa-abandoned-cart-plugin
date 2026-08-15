import { z } from "@medusajs/framework/zod"
import { createFindParams } from "@medusajs/medusa/api/utils/validators"

const StatusEnum = z.enum([
  "pending",
  "notified",
  "recovered",
  "converted",
  "dismissed",
  "expired",
])

export const GetAdminAbandonedCartsSchema = createFindParams({
  limit: 20,
  offset: 0,
}).extend({
  status: z.union([StatusEnum, z.array(StatusEnum)]).optional(),
  email: z.string().optional(),
  cart_id: z.string().optional(),
  customer_id: z.string().optional(),
})

export const PostAdminAbandonedCartSchema = z
  .object({
    status: StatusEnum.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export const PostAdminAbandonedCartSendSchema = z
  .object({
    /** Send a specific stage instead of the record's next one. */
    stage_id: z.string().optional(),
  })
  .strict()

export type GetAdminAbandonedCartsSchemaType = z.infer<
  typeof GetAdminAbandonedCartsSchema
>
export type PostAdminAbandonedCartSchemaType = z.infer<
  typeof PostAdminAbandonedCartSchema
>
export type PostAdminAbandonedCartSendSchemaType = z.infer<
  typeof PostAdminAbandonedCartSendSchema
>
