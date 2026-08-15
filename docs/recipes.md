# Recipes

Everything the plugin does is exported, so you can drive it yourself when the built-in sweep isn't
the shape you need.

## Run the workflows yourself

```ts
import {
  syncAbandonedCartsWorkflow,
  sendAbandonedCartNotificationsWorkflow,
  markAbandonedCartRecoveredWorkflow,
  markAbandonedCartConvertedWorkflow,
} from "medusa-plugin-abandoned-cart/workflows"
```

| Workflow | Input | Returns |
| --- | --- | --- |
| `syncAbandonedCartsWorkflow` | `{ limit?, offset? }` | `{ created, updated, count, scanned, qualified }` |
| `sendAbandonedCartNotificationsWorkflow` | `{ ids?, limit?, force?, stage_id? }` | `{ sent, failed, closed, notification_ids }` |
| `markAbandonedCartRecoveredWorkflow` | `{ id? , token?, cart_id? }` | `{ record }` |
| `markAbandonedCartConvertedWorkflow` | `{ order_id, cart_id? }` | `{ record }` |

`count` on the sync result is the total number of carts matching the detection filters — use it to
drive your own pagination.

```ts
// Send a specific stage to specific carts, right now.
await sendAbandonedCartNotificationsWorkflow(container).run({
  input: {
    ids: ["abcart_01J…"],
    force: true,
    stage_id: "last-call",
  },
})
```

`force: true` ignores stage delays. Without it, `ids` still respects each record's schedule, which is
useful when you want to notify a subset on their normal cadence.

The individual steps are exported too, if you're composing your own workflow:

```ts
import {
  findAbandonedCartCandidatesStep,
  upsertAbandonedCartsStep,
  selectDueAbandonedCartsStep,
  sendAbandonedCartNotificationsStep,
  recordAbandonedCartNotificationsStep,
} from "medusa-plugin-abandoned-cart/workflows"
```

## Use the service directly

```ts
import { ABANDONED_CART_MODULE } from "medusa-plugin-abandoned-cart/modules/abandoned-cart"

const service = container.resolve(ABANDONED_CART_MODULE)
```

Beyond the generated CRUD methods (`listAbandonedCarts`, `createAbandonedCarts`,
`updateAbandonedCarts`, `deleteAbandonedCarts`, and the `…AbandonedCartNotifications` equivalents):

| Method | Description |
| --- | --- |
| `getOptions()` | The fully-resolved options, with delays in milliseconds. |
| `getStages()` | The resolved stage list. |
| `getStage(idOrIndex)` | One stage by id or position. |
| `getDueStage(record, now?)` | The stage that's due for a record, or `null`. |
| `buildRecoveryUrl(token, cartId)` | The link as it appears in the email, or `null` without `storefrontUrl`. |
| `generateRecoveryToken()` | A fresh token. |
| `getStats(filters?)` | The numbers behind the admin page. |

```ts
const stats = await service.getStats({
  created_at: { $gte: new Date("2026-08-01") },
})
```

## Detect on your own cadence

The scheduled job is a thin wrapper — you can call the same helper from anywhere:

```ts title="src/jobs/my-sweep.ts"
import { runAbandonedCartSweep } from "medusa-plugin-abandoned-cart/utils/run-sweep"

export default async function mySweep(container) {
  // Detect only; send nothing.
  const result = await runAbandonedCartSweep(container, { notify: false })
  container.resolve("logger").info(`tracked ${result.created} new carts`)
}

export const config = { name: "my-sweep", schedule: "0 * * * *" }
```

Set `enabled: false` in the plugin options so the built-in job doesn't run alongside yours.

## Skip stages for very old carts

The sweep advances a cart one stage per run, so a cart discovered long after it was abandoned works
through the sequence from the beginning. If you'd rather send such carts straight to your last-chance
message:

```ts title="src/jobs/catch-up.ts"
import { ABANDONED_CART_MODULE } from "medusa-plugin-abandoned-cart/modules/abandoned-cart"
import { sendAbandonedCartNotificationsWorkflow } from "medusa-plugin-abandoned-cart/workflows"

export default async function catchUp(container) {
  const service = container.resolve(ABANDONED_CART_MODULE)
  const stages = service.getStages()
  const lastStage = stages[stages.length - 1]

  const cutoff = new Date(Date.now() - lastStage.delayMs)

  const stale = await service.listAbandonedCarts(
    { status: "pending", cart_updated_at: { $lt: cutoff } },
    { take: 100 }
  )

  if (!stale.length) {
    return
  }

  await sendAbandonedCartNotificationsWorkflow(container).run({
    input: {
      ids: stale.map((record) => record.id),
      force: true,
      stage_id: lastStage.id,
    },
  })
}

export const config = { name: "abandoned-cart-catch-up", schedule: "30 * * * *" }
```

Because `stage_index` only ever moves forward, sending the last stage this way also ends the
sequence for those carts.

## Expire old records

Tokens don't expire on their own. To retire records past a certain age:

```ts title="src/jobs/expire-abandoned-carts.ts"
import { ABANDONED_CART_MODULE } from "medusa-plugin-abandoned-cart/modules/abandoned-cart"

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export default async function expireAbandonedCarts(container) {
  const service = container.resolve(ABANDONED_CART_MODULE)

  const old = await service.listAbandonedCarts(
    {
      status: ["pending", "notified", "recovered"],
      cart_updated_at: { $lt: new Date(Date.now() - MAX_AGE_MS) },
    },
    { take: 500 }
  )

  if (old.length) {
    await service.updateAbandonedCarts(
      old.map((record) => ({ id: record.id, status: "expired" }))
    )
  }
}

export const config = { name: "expire-abandoned-carts", schedule: "0 3 * * *" }
```

`expired` is terminal for the sweep, so those carts stop being selected and their tokens stop
resolving to anything useful.

## Exclude carts by your own rules

The built-in filters cover the common cases. For anything else, dismiss records after detection:

```ts
const BLOCKED_DOMAINS = ["example.test", "mailinator.com"]

const recent = await service.listAbandonedCarts({ status: "pending" }, { take: 200 })

const blocked = recent.filter((record) =>
  BLOCKED_DOMAINS.some((domain) => record.email?.endsWith(`@${domain}`))
)

if (blocked.length) {
  await service.updateAbandonedCarts(
    blocked.map((record) => ({ id: record.id, status: "dismissed" }))
  )
}
```

Run it on a schedule between detection and your first stage's delay, and `dismissed` keeps them out
of the sequence permanently.

## Add data to every email

For static values, use `notificationData` in the plugin options. For values that depend on the cart,
send the notification yourself instead of using the built-in sender — resolve the carts, build your
payload, and call the Notification Module directly, then record the send with
`service.createAbandonedCartNotifications(...)` and advance `stage_index` yourself.

## Export recovery data

```ts
const query = container.resolve(ContainerRegistrationKeys.QUERY)

const { data } = await query.graph({
  entity: "abandoned_cart",
  fields: [
    "email",
    "status",
    "subtotal",
    "currency_code",
    "cart_updated_at",
    "last_notified_at",
    "recovered_at",
    "converted_at",
    "order.id",
    "order.total",
    "notifications.stage_id",
    "notifications.sent_at",
  ],
  filters: { status: ["notified", "recovered", "converted"] },
  pagination: { skip: 0, take: 1000, order: { created_at: "DESC" } },
})
```

That's the raw material for a per-stage performance report: group by `notifications.stage_id` and
compare how many of each stage's recipients ended up `converted`.
