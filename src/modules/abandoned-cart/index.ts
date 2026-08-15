import { Module } from "@medusajs/framework/utils"

import AbandonedCartModuleService from "./service"

export const ABANDONED_CART_MODULE = "abandoned_cart"

export default Module(ABANDONED_CART_MODULE, {
  service: AbandonedCartModuleService,
})

export { AbandonedCartModuleService }
export * from "./types"
