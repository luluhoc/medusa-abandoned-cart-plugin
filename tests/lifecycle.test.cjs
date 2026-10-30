const assert = require("node:assert/strict")
const { test } = require("node:test")
const { load, fixture, row, hour } = require("./helpers.cjs")
const select = load("workflows/steps/select-due-abandoned-carts.js").selectDueAbandonedCartsStep
const send = load("workflows/steps/send-abandoned-cart-notifications.js").sendAbandonedCartNotificationsStep
const record = load("workflows/steps/record-abandoned-cart-notifications.js").recordAbandonedCartNotificationsStep
const recover = load("workflows/steps/mark-abandoned-cart-recovered.js").markAbandonedCartRecoveredStep
const converted = load("workflows/steps/mark-abandoned-cart-converted.js").markAbandonedCartConvertedStep
const upsert = load("workflows/steps/upsert-abandoned-carts.js").upsertAbandonedCartsStep
const due = async (f, input = {}) => (await select(input, { container: f.container })).output
const deliver = async (f, input) => (await send(input ?? await due(f), { container: f.container })).output
const persist = async (f, result) => (await record(result, { container: f.container })).output

test("recovery clicks continue only when configured", async () => {
  for (const stop of [false, true]) {
    const f = fixture([row("cart", { status: "recovered" })], stop)
    assert.equal((await due(f)).items.length, stop ? 0 : 1)
  }
})
test("due filters run before the batch limit and retain spacing after late sends", async () => {
  const f = fixture([row("waiting", { stage_index: 1, cart_updated_at: new Date(Date.now() - 200 * hour), last_notified_at: new Date() }), row("due")])
  assert.equal((await due(f)).items[0].cart_id, "due")
  assert.equal(f.service.getDueStage(f.records[0]), null)
})
test("automatic age limits remain enforced", async () => {
  const f = fixture([row("old", { cart_updated_at: new Date(Date.now() - 15 * 24 * hour) })]); assert.equal((await due(f)).items.length, 0)
})
test("force sends bypass timing with and without explicit IDs", async () => {
  const f = fixture([row("cart", { cart_updated_at: new Date() })])
  for (const input of [{ force: true }, { force: true, ids: ["cart"] }]) {
    const result = await due(f, input); assert.equal(result.items.length, 1); assert.ok(result.items[0].request_id)
  }
})
test("the default sender blocks changed recipients and leaves the sequence retryable", async () => {
  const f = fixture(); const selected = await due(f); f.carts.get("cart").email = "another@example.test"
  const result = await deliver(f, selected)
  assert.equal(f.delivered.length, 0); assert.equal(result.deferred, 1); assert.equal(result.stale.length, 0)
})
test("fresh tracking-recipient changes and hook rerouting cannot leak cart contents", async () => {
  const f = fixture(); const selected = await due(f); f.records[0].email = "new@example.test"; f.carts.get("cart").email = "new@example.test"
  await deliver(f, selected); assert.equal(f.delivered.length, 0)
  f.records[0].email = "fixture@example.test"; f.carts.get("cart").email = "fixture@example.test"
  f.services.abandonedCartNotificationEnricher = async payload => ({ ...payload, to: "other@example.test" })
  await deliver(f, await due(f)); assert.equal(f.delivered.length, 0)
})
test("current contents replace the stale selection snapshot", async () => {
  const f = fixture(); const selected = await due(f); selected.items[0].cart = { items: [{ title: "stale" }] }
  await deliver(f, selected); assert.equal(f.delivered[0].data.items[0].title, "Live item")
})
test("host enrichment remains optional and keeps its stable native key", async () => {
  const f = fixture(); f.services.abandonedCartNotificationEnricher = async payload => ({ ...payload, idempotency_key: "host-key" })
  const result = await deliver(f); assert.equal(result.sent, 1); assert.equal(f.delivered[0].idempotency_key, "host-key")
  const plain = fixture(); await deliver(plain); assert.ok(plain.delivered[0].idempotency_key.startsWith("abandoned-cart:"))
})

test("required hooks fail closed for automatic and force sends, then allow retry after registration", async () => {
  for (const input of [{}, { ids: ["cart"], force: true, request_id: "required-hook" }]) {
    const f = fixture(); f.service.options_.requireDeliveryHook = true
    for (const hook of [undefined, { invalid: true }]) {
      f.services.abandonedCartNotificationEnricher = hook
      await persist(f, await deliver(f, await due(f, input)))
      assert.equal(f.delivered.length, 0); assert.equal(f.records[0].stage_index, 0)
      assert.equal(f.audit.at(-1).error, "Abandoned cart delivery unavailable")
    }
    let calls = 0
    f.services.abandonedCartNotificationEnricher = async payload => { calls++; return payload }
    const selected = await due(f, input)
    const accepted = await deliver(f, selected)
    await persist(f, accepted)
    assert.equal(calls, 1); assert.equal(f.delivered.length, 1); assert.equal(f.records[0].stage_index, 1)
    f.services.abandonedCartNotificationEnricher = undefined
    await deliver(f, selected)
    assert.equal(f.delivered.length, 1)
  }
})
test("a delivery receipt survives later bookkeeping failure", async () => {
  const f = fixture(); const selected = await due(f); const accepted = await deliver(f, selected)
  const create = f.service.createAbandonedCartNotifications
  f.service.createAbandonedCartNotifications = async () => { throw new Error("Audit unavailable") }
  await assert.rejects(persist(f, accepted)); f.service.createAbandonedCartNotifications = create
  await persist(f, await deliver(f, selected)); await persist(f, await deliver(f, selected))
  assert.equal(f.delivered.length, 1); assert.equal(f.audit.length, 1); assert.equal(f.records[0].stage_index, 1)
})
test("native success recovers a lost delivery-receipt write without another email", async () => {
  const f = fixture(); const selected = await due(f); const accept = f.service.acceptDelivery
  f.service.acceptDelivery = async () => { throw new Error("Receipt database outage") }
  await deliver(f, selected); f.service.acceptDelivery = accept
  await persist(f, await deliver(f, selected)); assert.equal(f.delivered.length, 1); assert.equal(f.audit.length, 1)
})
test("simultaneous sends compete for one claim", async () => {
  const f = fixture(); const selected = await due(f)
  await Promise.all([deliver(f, selected), deliver(f, selected)])
  assert.equal(f.delivered.length, 1)
})
test("unknown provider outcomes stay pending rather than being resent", async () => {
  const f = fixture(); const selected = await due(f)
  f.notifications.createNotifications = async payload => { f.delivered.push(payload); f.ledger.set(payload.idempotency_key, { ...payload, id: "native", status: "pending" }); throw new Error("Lost response") }
  await deliver(f, selected); const retry = await deliver(f, selected)
  assert.equal(f.delivered.length, 1); assert.equal(retry.deferred, 1)
})
test("known provider failures remain retryable and do not advance", async () => {
  const f = fixture(); const selected = await due(f); const create = f.notifications.createNotifications
  f.notifications.createNotifications = async payload => { const result = { ...payload, id: "failed", status: "failure" }; f.ledger.set(payload.idempotency_key, result); return [result] }
  await persist(f, await deliver(f, selected)); assert.equal(f.records[0].stage_index, 0)
  f.notifications.createNotifications = create; await persist(f, await deliver(f, selected)); assert.equal(f.records[0].stage_index, 1)
})

test("an old native failure cannot release another worker's active retry", async () => {
  const f = fixture(); const selected = await due(f)
  f.notifications.createNotifications = async payload => {
    const failure = { ...payload, id: "native", status: "failure", updated_at: "2026-01-01T00:00:00Z" }
    f.ledger.set(payload.idempotency_key, failure); return [failure]
  }
  await deliver(f, selected)
  let enter, release
  const entered = new Promise(resolve => { enter = resolve })
  const gate = new Promise(resolve => { release = resolve })
  f.notifications.createNotifications = async payload => {
    f.delivered.push(payload); enter(); await gate
    const success = { ...payload, id: "native", status: "success" }; f.ledger.set(payload.idempotency_key, success); return [success]
  }
  const running = deliver(f, selected); await entered
  try {
    assert.equal((await deliver(f, selected)).deferred, 1)
    assert.equal([...f.claims.values()][0].state, "invoking")
  } finally { release(); await running }
  assert.equal(f.delivered.length, 1)
})
test("explicit force operation IDs permit deliberate resend and dedupe its replay", async () => {
  const f = fixture(); const a = await due(f, { ids: ["cart"], force: true, request_id: "operation-a" })
  await persist(f, await deliver(f, a)); assert.equal(f.records[0].stage_index, 1)
  await persist(f, await deliver(f, await due(f, { ids: ["cart"], force: true, request_id: "operation-a" })))
  assert.equal(f.delivered.length, 1); assert.equal(f.records[0].stage_index, 1); assert.equal(f.audit.length, 1)
  f.records[0].delivery_cycle = "new-cycle"
  await deliver(f, await due(f, { ids: ["cart"], force: true, request_id: "operation-a" }))
  assert.equal(f.delivered.length, 1)
  await persist(f, await deliver(f, await due(f, { ids: ["cart"], force: true, request_id: "operation-b" })))
  assert.equal(f.delivered.length, 2)
})

test("native receipt recovery retains the original manual stage after concurrent progression", async () => {
  const f = fixture(); const accept = f.service.acceptDelivery
  f.service.acceptDelivery = async () => { throw new Error("Lost receipt write") }
  await deliver(f, await due(f, { ids: ["cart"], force: true, request_id: "operation" }))
  f.records[0].stage_index = 1; f.service.acceptDelivery = accept
  const retry = await deliver(f, await due(f, { ids: ["cart"], force: true, request_id: "operation" }))
  assert.equal(f.delivered.length, 1); assert.equal(retry.results[0].stage_index, 0)
  await persist(f, retry); assert.equal(f.records[0].stage_index, 1)
})
test("reset-on-activity creates a new delivery cycle", async () => {
  const f = fixture(); await persist(f, await deliver(f)); f.service.options_.resetOnActivity = true
  const current = f.records[0]
  await upsert({ carts: [{ ...current, cart_id: current.cart_id, cart_updated_at: new Date(Date.now() - 10 * hour).toISOString(), item_count: 1, subtotal: 10 }] }, { container: f.container })
  assert.notEqual(current.delivery_cycle, "initial"); assert.equal(current.stage_index, 0)
  await deliver(f); assert.equal(f.delivered.length, 2)
})
test("clicks do not revive dismissed, expired, or converted states", async () => {
  for (const status of ["dismissed", "expired", "converted"]) {
    const f = fixture([row("cart", { status })]); await recover({ token: "token-cart" }, { container: f.container }); assert.equal(f.records[0].status, status)
  }
})
test("delayed successful and stale bookkeeping preserve terminal states", async () => {
  for (const status of ["dismissed", "converted"]) {
    const f = fixture(); const result = await deliver(f); f.records[0].status = status
    await persist(f, result); await persist(f, { results: [], stale: [{ record_id: "cart", status: "expired" }] })
    assert.equal(f.records[0].status, status)
  }
})
test("explicit manual delivery leaves a dismissed sequence dismissed", async () => {
  const f = fixture([row("cart", { status: "dismissed" })])
  await persist(f, await deliver(f, await due(f, { ids: ["cart"], force: true, request_id: "manual" })))
  assert.equal(f.delivered.length, 1); assert.equal(f.records[0].status, "dismissed")
})
test("recovery compensation cannot undo a later conversion", async () => {
  const f = fixture(); const recovered = await recover({ token: "token-cart" }, { container: f.container })
  await converted({ order_id: "order_existing", cart_id: "cart" }, { container: f.container })
  await recover.compensate(recovered.compensation, { container: f.container }); assert.equal(f.records[0].status, "converted")
})

test("order attribution fills the link after a completed-cart fallback conversion", async () => {
  const f = fixture([row("cart", { status: "converted", order_id: null })])
  await converted({ order_id: "order_completed", cart_id: "cart" }, { container: f.container })
  assert.equal(f.records[0].status, "converted"); assert.equal(f.records[0].order_id, "order_completed")
})
test("host deferral and null results keep their documented semantics", async () => {
  const f = fixture(); f.services.abandonedCartNotificationEnricher = async () => { throw Object.assign(new Error("Wait"), { code: "abandoned_cart_deferred" }) }
  const result = await deliver(f); assert.equal(result.deferred, 1); assert.equal(result.failed, 0); assert.equal(result.stale.length, 0)
  f.services.abandonedCartNotificationEnricher = async () => null
  const stale = await deliver(f); assert.equal(stale.stale[0].status, "dismissed"); assert.equal(f.delivered.length, 0)
})
test("a deferred first batch does not block the next eligible cart", async () => {
  const f = fixture([row("deferred", { cart_updated_at: new Date(Date.now() - 110 * hour) }), row("ready")])
  f.services.abandonedCartNotificationEnricher = async payload => { if (payload.data.cart_id === "deferred") throw Object.assign(new Error("Wait"), { code: "abandoned_cart_deferred" }); return payload }
  const sweep = load("utils/run-sweep.js", {
    "../workflows/sync-abandoned-carts": { syncAbandonedCartsWorkflow: () => ({ run: async () => ({ result: { count: 0, scanned: 0, created: 0, updated: 0 } }) }) },
    "../workflows/send-abandoned-cart-notifications": { sendAbandonedCartNotificationsWorkflow: () => ({ run: async ({ input }) => ({ result: await persist(f, await deliver(f, await due(f, input))) }) }) },
  }).runAbandonedCartSweep
  const result = await sweep(f.container); assert.equal(result.sent, 1); assert.equal(result.deferred, 1); assert.equal(f.delivered[0].data.cart_id, "ready")
})
test("persistent attempt ordering is fair even when a sweep reaches its cap", async () => {
  const f = fixture(Array.from({ length: 11 }, (_, i) => row(`defer-${i}`)).concat(row("ready")))
  f.services.abandonedCartNotificationEnricher = async payload => { if (payload.data.cart_id !== "ready") throw Object.assign(new Error("Wait"), { code: "abandoned_cart_deferred" }); return payload }
  const sweep = load("utils/run-sweep.js", {
    "../workflows/sync-abandoned-carts": { syncAbandonedCartsWorkflow: () => ({ run: async () => ({ result: { count: 0, scanned: 0, created: 0, updated: 0 } }) }) },
    "../workflows/send-abandoned-cart-notifications": { sendAbandonedCartNotificationsWorkflow: () => ({ run: async ({ input }) => ({ result: await persist(f, await deliver(f, await due(f, input))) }) }) },
  }).runAbandonedCartSweep
  await sweep(f.container); await sweep(f.container); assert.equal(f.delivered.length, 1)
})
