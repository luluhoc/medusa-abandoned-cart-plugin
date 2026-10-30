const assert = require("node:assert/strict")
const { test } = require("node:test")
const { readFileSync } = require("node:fs")
const { resolve } = require("node:path")
const { createRequire } = require("node:module")
const vm = require("node:vm")

// Exercise the shipped JavaScript handlers without booting a store or sending mail.
function load(file) {
  const filename = resolve(".medusa/server/src", file)
  const localRequire = createRequire(filename)
  const module = { exports: {} }
  const utils = { ContainerRegistrationKeys: { QUERY: "query", LOGGER: "logger" }, Modules: { NOTIFICATION: "notification" },
    MedusaError: class extends Error { static Types = { INVALID_DATA: "invalid_data" } }, MedusaService: () => class {} }
  const requireDependency = id => {
    if (id === "@medusajs/framework/utils") return utils
    if (id === "@medusajs/framework/workflows-sdk") return {
      createStep: (_id, handler) => handler, StepResponse: class { constructor(output) { this.output = output } },
    }
    if (id === "../../modules/abandoned-cart") return { ABANDONED_CART_MODULE: "abandoned_cart" }
    if (file.endsWith("service.js") && id.startsWith("./models/")) return {}
    if (file.endsWith("service.js") && id === "./options") return {}
    return localRequire(id)
  }
  vm.runInNewContext(readFileSync(filename, "utf8"), { module, exports: module.exports, require: requireDependency, Date, Map, console }, { filename })
  return module.exports
}
const { selectDueAbandonedCartsStep: select } = load("workflows/steps/select-due-abandoned-carts.js")
const { sendAbandonedCartNotificationsStep: send } = load("workflows/steps/send-abandoned-cart-notifications.js")
const Service = load("modules/abandoned-cart/service.js").default
const hour = 3600000
const stages = [4, 24, 72].map((delay, index) => ({ id: `stage-${index}`, index, delayMs: delay * hour }))
function matches(record, filters) {
  return Object.entries(filters).every(([key, value]) => {
    if (key === "$or") return value.some(filter => matches(record, filter))
    if (value === null) return record[key] == null
    if (Array.isArray(value)) return value.includes(record[key])
    if (typeof value === "object") return Object.entries(value).every(([op, threshold]) =>
      op === "$gte" ? +new Date(record[key]) >= +threshold : op === "$lte" ? +new Date(record[key]) <= +threshold : false)
    return record[key] === value
  })
}
function fixture(records = [], stopAfterRecovery = false) {
  const service = Object.create(Service.prototype)
  service.options_ = { stages, maxAgeMs: 14 * 24 * hour, notificationBatchSize: 1, stopAfterRecovery }
  service.matchLocale = value => value
  service.resolveLocaleForCart = () => null
  service.listAbandonedCarts = async (filters, config) => records.filter(record => matches(record, filters))
    .sort((a, b) => +a.cart_updated_at - +b.cart_updated_at).slice(0, config.take)
  const query = { graph: async ({ filters }) => ({ data: filters.id.map(id => ({ id, email: "fixture@example.test", items: [{ id: "line" }] })) }) }
  const container = { resolve: key => key === "abandoned_cart" ? service : query }
  return { service, container }
}
const record = (id, extra = {}) => ({ id, cart_id: id, token: `token-${id}`, email: "fixture@example.test", status: "notified", stage_index: 1,
  cart_updated_at: new Date(Date.now() - 100 * hour), last_notified_at: new Date(Date.now() - 30 * hour), ...extra })
test("recovered carts continue only when stopAfterRecovery is false", async () => {
  for (const stop of [false, true]) {
    const { container } = fixture([record("cart", { status: "recovered" })], stop)
    assert.equal((await select({}, { container })).output.items.length, stop ? 0 : 1)
  }
})
test("due filtering happens before the batch limit", async () => {
  const { container } = fixture([record("waiting", { cart_updated_at: new Date(Date.now() - 200 * hour), last_notified_at: new Date() }),
    record("due", { stage_index: 0, cart_updated_at: new Date(Date.now() - 10 * hour), last_notified_at: null })])
  assert.equal((await select({ limit: 1 }, { container })).output.items[0].cart_id, "due")
})
test("automatic selection respects maxAge", async () => {
  const { container } = fixture([record("ancient", { cart_updated_at: new Date(Date.now() - 15 * 24 * hour) })])
  assert.equal((await select({}, { container })).output.items.length, 0)
})
test("late reminders preserve stage spacing", () => {
  const { service } = fixture(); const now = Date.now()
  const row = record("late", { last_notified_at: new Date(now - 19 * hour) })
  assert.equal(service.getDueStage(row, now), null)
  assert.equal(service.getDueStage(row, now + 2 * hour).id, "stage-1")
})
test("explicit force sends bypass timing and expose the trusted force marker", async () => {
  const { container } = fixture([record("cart", { cart_updated_at: new Date() })])
  const result = await select({ ids: ["cart"], force: true }, { container })
  assert.equal(result.output.items.length, 1); assert.equal(result.output.items[0].force, true)
})
function sender(enricher, status = "success") {
  const delivered = []
  const services = { abandoned_cart: { getStageDelivery: () => ({ channel: "email", template: "fixture", data: {} }), buildRecoveryUrl: () => "https://example.test/recover" },
    notification: { createNotifications: async payload => { delivered.push(payload); return [{ id: "notification", status }] } },
    logger: { error: () => {} }, abandonedCartNotificationEnricher: enricher }
  const container = { resolve: key => services[key] }
  const input = { items: [{ record_id: "record", cart_id: "cart", token: "test-token", to: "fixture@example.test", force: true,
    stage: stages[0], locale: null, cart: { currency_code: "eur", items: [] } }], stale: [] }
  return { delivered, container, input }
}
test("an optional host hook receives the record and its prepared payload is delivered", async () => {
  const f = sender(async payload => { assert.equal(payload.data.abandoned_cart_id, "record"); assert.equal(payload.data.forced_send, true); return { ...payload, idempotency_key: "stable-key" } })
  assert.equal((await send(f.input, { container: f.container })).output.sent, 1)
  assert.equal(f.delivered[0].idempotency_key, "stable-key")
})
test("a missing host hook preserves normal plugin sends", async () => {
  const f = sender(undefined); assert.equal((await send(f.input, { container: f.container })).output.sent, 1)
})
test("deferral keeps the stage pending without sending or recording a failure", async () => {
  const f = sender(async () => { throw Object.assign(new Error("Wait"), { code: "abandoned_cart_deferred" }) })
  const result = (await send(f.input, { container: f.container })).output
  assert.equal(f.delivered.length, 0); assert.equal(result.sent, 0); assert.equal(result.failed, 0); assert.equal(result.stale.length, 0)
})
test("a null hook result closes the record without sending", async () => {
  const f = sender(async () => null); const result = (await send(f.input, { container: f.container })).output
  assert.equal(f.delivered.length, 0); assert.equal(result.stale[0].status, "dismissed")
})
test("provider failure is recorded and never counted as sent", async () => {
  const f = sender(undefined, "failure"); const result = (await send(f.input, { container: f.container })).output
  assert.equal(result.sent, 0); assert.equal(result.failed, 1)
})
