const assert = require("node:assert/strict")
const { test } = require("node:test")
const { Service, load } = require("./helpers.cjs")
test("recovered value includes every converted record in one aggregate query", async () => {
  const service = Object.create(Service.prototype); service.options_ = { locales: ["en-US", "fr-FR"] }
  let reads = 0
  const manager = { getTransactionContext: () => undefined, getConnection: () => ({ execute: async () => {
    reads++; return [
      { kind: "status", status: "converted", count: "1500" },
      { kind: "locale", locale: "en-US", status: "converted", count: "1499" },
      { kind: "locale", locale: "fr-FR", status: "converted", count: "1" },
      { kind: "value", currency_code: "eur", amount: "1845.00" },
    ]
  } }) }
  const stats = await service.getStats({}, { manager })
  assert.equal(reads, 1); assert.equal(stats.counts.converted, 1500); assert.equal(stats.recovered_value[0].amount, 1845)
  assert.equal(stats.by_locale[0].converted, 1499); assert.equal(stats.by_locale[1].converted, 1)
})
test("empty statistics preserve configured locale rows and zero rates", async () => {
  const service = Object.create(Service.prototype); service.options_ = { locales: ["en-US"] }
  const manager = { getTransactionContext: () => undefined, getConnection: () => ({ execute: async () => [] }) }
  const stats = await service.getStats({}, { manager })
  assert.equal(stats.total, 0); assert.equal(stats.conversion_rate, 0); assert.equal(stats.by_locale[0].total, 0)
})
test("invalid batch sizes fail at boot instead of burning sweep rounds", () => {
  const { resolveOptions } = load("modules/abandoned-cart/options.js")
  for (const field of ["batchSize", "notificationBatchSize"]) {
    for (const value of [0, -1, 1.5, Infinity, NaN, 1001]) assert.throws(() => resolveOptions({ [field]: value }), /integer between 1 and 1000/)
    assert.equal(resolveOptions({ [field]: 1000 })[field], 1000)
  }
})

test("required delivery hook policy defaults off and accepts only boolean configuration", () => {
  const { resolveOptions } = load("modules/abandoned-cart/options.js")
  assert.equal(resolveOptions().requireDeliveryHook, false)
  assert.equal(resolveOptions({ requireDeliveryHook: true }).requireDeliveryHook, true)
  assert.equal(resolveOptions({ requireDeliveryHook: false }).requireDeliveryHook, false)
  for (const value of ["true", "false", 0, 1, {}]) assert.throws(() => resolveOptions({ requireDeliveryHook: value }), /must be a boolean/)
})
