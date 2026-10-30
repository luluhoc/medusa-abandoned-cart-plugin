# Data model

The plugin owns three tables and three read-only links into Medusa's core modules.

Module name: **`abandoned_cart`**, exported as `ABANDONED_CART_MODULE`.

## `abandoned_cart`

One row per tracked cart. Created the first time the sweep sees a cart go quiet, then refreshed on
every sweep.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `text` | Primary key, prefixed `abcart_`. |
| `cart_id` | `text` | **Unique.** The cart being chased. |
| `token` | `text` | **Unique.** Opaque recovery token (24 random bytes, base64url). |
| `email` | `text?` | Snapshot of the cart's email at detection time. |
| `customer_id` | `text?` | Includes guest customers. |
| `sales_channel_id` | `text?` | |
| `region_id` | `text?` | |
| `currency_code` | `text?` | |
| `locale` | `text?` | The locale this cart is chased in. `null` when none resolved. See [Localization](./localization.md). |
| `item_count` | `integer` | Line items at the last sweep. Default `0`. |
| `subtotal` | `numeric` | Sum of `unit_price × quantity`, in the cart's currency. Stored as a Medusa big number, so there's a companion `raw_subtotal` column. |
| `status` | `enum` | See [the lifecycle](./how-it-works.md#the-status-lifecycle). Default `pending`. |
| `stage_index` | `integer` | Stages already sent — i.e. the index of the next one. Default `0`. |
| `revision` | `integer` | Incremented by conditional lifecycle updates to fence stale workers and compensation. Default `0`. |
| `attempt_order` | `numeric` | Last notification attempt, as epoch milliseconds; default `0`. A companion `raw_attempt_order` stores Medusa's big-number representation. |
| `delivery_cycle` | `text` | Default `initial`; regenerated when `resetOnActivity` restarts the sequence. |
| `cart_updated_at` | `timestamptz` | The cart's `updated_at` at the last sweep. **All stage delays are measured from this.** |
| `last_notified_at` | `timestamptz?` | |
| `recovered_at` | `timestamptz?` | Set when a recovery link is followed. |
| `converted_at` | `timestamptz?` | Set when the cart becomes an order. |
| `order_id` | `text?` | The attributed order. |
| `metadata` | `jsonb?` | Yours to use. |
| `created_at`, `updated_at`, `deleted_at` | `timestamptz` | Added by Medusa. |

**Indexes** — unique on `cart_id`, unique on `token`, composite on `(status, stage_index)` for the
due-selection query, and one each on `email` and `locale`.

## `abandoned_cart_notification`

One row per send *attempt*, successful or not.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `text` | Primary key, prefixed `abcartnotif_`. |
| `abandoned_cart_id` | `text` | Foreign key. |
| `stage_id` | `text` | The stage's configured id. |
| `stage_index` | `integer` | Its position in the sequence. |
| `channel` | `text` | `email`, `sms`, … |
| `template` | `text` | The provider template id used, after locale resolution. |
| `locale` | `text?` | The locale this attempt went out in. Can differ from the parent's when the shopper switched language mid-sequence. |
| `to` | `text` | Recipient. |
| `notification_id` | `text?` | The Notification Module's record id, on success. |
| `delivery_key` | `text?` | Unique for a successful stage/cycle or manual operation. Replaying an accepted receipt reuses its audit row. |
| `error` | `text?` | Generic delivery failure message; provider details are not copied into this audit. |
| `sent_at` | `timestamptz?` | `null` when the attempt failed. |

**Index** — `(abandoned_cart_id, stage_id)`.

A failed attempt leaves `stage_index` on the parent untouched, so you'll see several rows with the
same `stage_id` when a send has been retried.

## `abandoned_cart_delivery`

Durable delivery coordination, independent of the audit step. `delivery_key` is a unique hash of
tracking ID, stage ID and cycle for automatic sends, or tracking ID and operation ID for forced
sends. Manual retries keep the original identity after progression or an activity reset. Fields are `id`,
`delivery_key`, `abandoned_cart_id`, `state`, `claim_token`, `claim_expires_at`, `idempotency_key`,
`result` and Medusa timestamps. `abandoned_cart_id` is indexed; this table has no foreign key.

A `reserved` claim can be renewed after its two-minute lease expires. Only its current token can
begin invocation. An `invoking` claim is never reclaimed on a timer: an uncertain provider response
may already have delivered mail. Native notification ledger success records an `accepted` receipt;
proven failure permits retry. `result` stores the invocation's audit fields and then its notification ID, not the recovery
token or full message payload. Accepted receipts survive audit failures and workflow compensation.

## Module links

Three **read-only** links let Query resolve an abandoned cart's related records without a pivot
table:

| From | To | Via |
| --- | --- | --- |
| `abandoned_cart` | `cart` | `cart_id` |
| `abandoned_cart` | `customer` | `customer_id` |
| `abandoned_cart` | `order` | `order_id` |

Read-only means the traversal works **from the abandoned cart outward only**. You can ask for
`abandoned_cart.cart`, but not `cart.abandoned_cart`.

## Querying

```ts
const query = container.resolve(ContainerRegistrationKeys.QUERY)

const { data: records, metadata } = await query.graph({
  entity: "abandoned_cart",
  fields: [
    "*",
    "notifications.*",
    "cart.*",
    "cart.items.*",
    "customer.email",
    "order.id",
    "order.total",
  ],
  filters: {
    status: ["notified", "recovered"],
    cart_updated_at: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  },
  pagination: { skip: 0, take: 50, order: { cart_updated_at: "DESC" } },
})
```

Or through the module service, which gives you the generated CRUD methods:

```ts
const service = container.resolve(ABANDONED_CART_MODULE)

const [records, count] = await service.listAndCountAbandonedCarts(
  { status: "notified" },
  { take: 50, order: { cart_updated_at: "DESC" } }
)
```

See [Recipes](./recipes.md) for what else the service exposes.

## Migrations

Migrations live in `src/modules/abandoned-cart/migrations/` in the plugin package and run as part of
your application's:

```bash
yarn medusa db:migrate
```

`Migration20261030002808` adds delivery claims, unique successful audit keys and conditional-update
fields. Run it before starting the updated plugin on every worker. Its rollback removes these new
fields and the delivery table while preserving existing tracking and notification rows. Stop workers
before rollback; removing claims also removes duplicate-send protection for their historical keys.

If you fork the plugin and change a model, regenerate them in the plugin project:

```bash
yarn generate    # yarn medusa plugin:db:generate
```

That needs a reachable Postgres — copy `.env.template` to `.env` and fill in the `DB_*` variables.
