const { readFileSync } = require("node:fs")
const { resolve } = require("node:path")
const { createRequire } = require("node:module")
const vm = require("node:vm")
function load(file, overrides = {}) {
  const filename = resolve(".medusa/server/src", file)
  const requireLocal = createRequire(filename)
  const module = { exports: {} }
  const noop = () => () => {}
  const utils = { ContainerRegistrationKeys: { QUERY: "query", LOGGER: "logger" }, Modules: { NOTIFICATION: "notification" },
    MedusaError: class extends Error { static Types = { INVALID_DATA: "invalid_data" }; constructor(type, message) { super(message); this.type = type } }, MedusaService: () => class {}, InjectManager: noop, MedusaContext: noop }
  const requireDependency = id => {
    if (Object.hasOwn(overrides, id)) return overrides[id]
    if (id === "@medusajs/framework/utils") return utils
    if (id === "@medusajs/framework/workflows-sdk") return {
      createStep: (_id, handler, compensate) => Object.assign(handler, { compensate }),
      StepResponse: class { constructor(output, compensation) { this.output = output; this.compensation = compensation } },
    }
    if (/modules\/abandoned-cart$/.test(id)) return { ABANDONED_CART_MODULE: "abandoned_cart" }
    if (file.endsWith("service.js") && id.startsWith("./models/")) return {}
    if (file.endsWith("service.js") && id === "./options") return {}
    return requireLocal(id)
  }
  vm.runInNewContext(readFileSync(filename, "utf8"), { module, exports: module.exports, require: requireDependency, Date, Map, Set, console }, { filename })
  return module.exports
}
const hour = 3600000
const stages = [4, 24, 72].map((delay, index) => ({ id: `stage-${index}`, index, delayMs: delay * hour, channel: "email", template: "fixture" }))
const Service = load("modules/abandoned-cart/service.js").default
const row = (id, extra = {}) => ({ id, cart_id: id, token: `token-${id}`, email: "fixture@example.test", status: "notified", stage_index: 0,
  revision: 0, delivery_cycle: "initial", attempt_order: 0, order_id: null,
  cart_updated_at: new Date(Date.now() - 100 * hour), last_notified_at: null, ...extra })
function matches(record, filters) {
  return Object.entries(filters).every(([key, value]) => {
    if (key === "$or") return value.some(filter => matches(record, filter))
    if (value === null) return record[key] == null
    if (Array.isArray(value)) return value.includes(record[key])
    if (typeof value === "object") return Object.entries(value).every(([op, threshold]) => {
      if (op === "$nin") return !threshold.includes(record[key])
      if (op === "$lt") return record[key] < threshold
      return op === "$gte" ? +new Date(record[key]) >= +threshold : op === "$lte" ? +new Date(record[key]) <= +threshold : false
    })
    return record[key] === value
  })
}
function fixture(records = [row("cart")], stopAfterRecovery = false) {
  const service = Object.create(Service.prototype)
  const claims = new Map(), audit = [], ledger = new Map(), delivered = []
  const carts = new Map(records.map(row => [row.cart_id, { id: row.cart_id, email: row.email, currency_code: "eur", items: [{ id: "line", title: "Live item", quantity: 1, unit_price: 10 }] }]))
  service.options_ = { stages, maxAgeMs: 14 * 24 * hour, batchSize: 100, notificationBatchSize: 1, stopAfterRecovery, locales: [] }
  service.matchLocale = value => value
  service.resolveLocaleForCart = () => null
  service.getStageDelivery = stage => ({ channel: "email", template: stage.template ?? "fixture", data: {} })
  service.buildRecoveryUrl = () => "https://example.test/recover"
  service.generateRecoveryToken = () => require("node:crypto").randomUUID()
  service.retrieveAbandonedCart = async id => ({ ...records.find(row => row.id === id) })
  service.listAbandonedCarts = async (filters, config = {}) => records.filter(row => matches(row, filters))
    .sort((a, b) => a.attempt_order - b.attempt_order || +a.cart_updated_at - +b.cart_updated_at).slice(0, config.take ?? records.length).map(row => ({ ...row }))
  service.updateState = async (before, data) => {
    const target = records.find(row => row.id === before.id)
    if (target.revision !== before.revision || target.status !== before.status || target.stage_index !== before.stage_index || target.delivery_cycle !== before.delivery_cycle) return null
    if (target.status === "converted" && data.status && data.status !== "converted") return null
    if (target.status === "dismissed" && data.status && !["dismissed", "converted"].includes(data.status)) return null
    Object.assign(target, data, { revision: target.revision + 1 }); return { ...target }
  }
  service.convertCart = async (id, orderId) => {
    const current = records.find(row => row.id === id)
    if (current.order_id && current.order_id !== orderId) return null
    Object.assign(current, { status: "converted", order_id: orderId, converted_at: new Date(), revision: current.revision + 1 }); return { ...current }
  }
  service.noteAttempt = async id => { records.find(row => row.id === id).attempt_order = Date.now() }
  service.claimDelivery = async (key, id, notificationKey) => {
    let claim = claims.get(key)
    if (claim && (claim.state !== "reserved" || claim.expires > Date.now())) return { owned: false, row: { ...claim } }
    claim = { id: key, delivery_key: key, state: "reserved", claim_token: require("node:crypto").randomUUID(), expires: Date.now() + 120000, idempotency_key: notificationKey }
    claims.set(key, claim); return { owned: true, row: { ...claim } }
  }
  service.beginDelivery = async (claim, key, intent = null) => {
    const current = claims.get(claim.id)
    if (current.claim_token !== claim.claim_token || current.state !== "reserved") return null
    Object.assign(current, { state: "invoking", idempotency_key: key, result: intent }); return { ...current }
  }
  service.acceptDelivery = async (claim, result) => { const current = claims.get(claim.id); if (current.claim_token === claim.claim_token) Object.assign(current, { state: "accepted", result }) }
  service.retryDelivery = async claim => { const current = claims.get(claim.id); if (current.claim_token === claim.claim_token && current.state !== "accepted") Object.assign(current, { state: "reserved", expires: 0 }) }
  service.listAbandonedCartNotifications = async filters => audit.filter(row => matches(row, filters))
  service.createAbandonedCartNotifications = async data => { if (data.delivery_key && audit.some(row => row.delivery_key === data.delivery_key)) throw new Error("Duplicate"); const created = { ...data, id: `audit_${audit.length}` }; audit.push(created); return created }
  const notifications = {
    listNotifications: async ({ idempotency_key }) => ledger.has(idempotency_key) ? [ledger.get(idempotency_key)] : [],
    createNotifications: async payload => { delivered.push(payload); const result = { ...payload, id: `noti_${delivered.length}`, status: "success" }; ledger.set(payload.idempotency_key, result); return [result] },
  }
  const services = { abandoned_cart: service, query: { graph: async ({ filters }) => ({ data: (Array.isArray(filters.id) ? filters.id : [filters.id]).map(id => carts.get(id)).filter(Boolean) }) },
    notification: notifications, logger: { error: () => {}, warn: () => {} } }
  return { service, records, claims, audit, ledger, delivered, notifications, carts, services, container: { resolve: key => services[key] } }
}
module.exports = { load, fixture, row, hour, stages, Service }
