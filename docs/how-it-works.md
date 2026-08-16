# How it works

## The sweep

Every run of the `abandoned-cart-sweep` job does two passes.

```text
                 ┌──────────────── detection ────────────────┐
  open carts ──► filter ──► qualify ──► upsert abandoned_cart │
                 (SQL)      (memory)                          │
                 └──────────────────────────────────────────┬─┘
                                                            │
                 ┌─────────────── notification ─────────────▼─┐
                 │ select due ──► send ──► record + advance   │
                 └───────────────────────────────────────────┘
```

### Pass 1 — detection

`syncAbandonedCartsWorkflow` pages through carts using Query. The database filters are the ones
Postgres can answer cheaply:

- `completed_at` is `null` — the cart never became an order;
- `updated_at` is older than the **first stage's delay** — the cart has actually gone quiet;
- `updated_at` is newer than `maxAge` — the cart isn't ancient;
- `email` is not `null`, when `requireEmail` is on;
- `sales_channel_id` is in `salesChannelIds`, when set.

Each page is then filtered in memory for the thresholds that depend on line items: `minItems`,
`minSubtotal` (summed from `unit_price × quantity`), and `onlyRegisteredCustomers`.

Whatever survives is upserted into `abandoned_cart`. New carts get a row with a freshly generated
recovery token and `status: "pending"`. Carts already tracked get their snapshot refreshed — email,
item count, subtotal, locale, and `cart_updated_at`.

Detection stops after 200 pages as a safety bound. If it hits that with carts left over, it logs a
warning telling you to raise `batchSize` or shorten `maxAge`.

### Pass 2 — notification

`sendAbandonedCartNotificationsWorkflow` selects tracked carts whose next stage is due, oldest
activity first, then:

1. **Re-validates against the live cart.** A cart that was completed, emptied or deleted since
   detection is closed out instead of emailed — see [Stale carts](#stale-carts).
2. **Re-resolves the locale** from that same live cart, so a shopper who switched language after
   abandoning is emailed in the language they last used. The value stored at detection is the
   fallback. See [Localization](./localization.md#when-it-is-resolved).
3. **Sends one notification per cart**, isolated in its own try/catch, so a single bad address or
   provider hiccup can't cancel the batch.
4. **Records the outcome** in `abandoned_cart_notification` and advances `stage_index`.

The pass repeats while it keeps filling a whole page, up to 10 rounds per sweep.

## The timing model

**Delays are cumulative and measured from the cart's last activity** — not from the previous email.

With `stages: [{ delay: "1h" }, { delay: "24h" }, { delay: "3d" }]` and a cart that goes quiet at
noon on Monday:

| Stage | Due at |
| --- | --- |
| 1 | Monday 13:00 |
| 2 | Tuesday 12:00 |
| 3 | Thursday 12:00 |

Stage 2 fires 23 hours after stage 1, not 24 — the delay is measured from the cart, not from the
last send.

Two consequences worth internalising:

- **A stage can never fire twice.** `stage_index` only moves forward, and each stage has exactly one
  due time.
- **A long-idle cart doesn't get its whole sequence at once.** The sweep advances a cart by one stage
  per run, so a cart that's been quiet for a week receives stage 1 on the next sweep, stage 2 on the
  one after, and so on. If that matters to you, add a
  [catch-up job](./recipes.md#skip-stages-for-very-old-carts) or shorten `maxAge`.

### When a shopper comes back and edits the cart

Editing a cart bumps its `updated_at`, so the next sweep refreshes `cart_updated_at` and every
remaining stage shifts later by the same amount. Stages already sent stay sent.

Set `resetOnActivity: true` if you'd rather restart the sequence from stage 1 — appropriate when your
emails are written as "you left something behind" rather than "here's a nudge".

## The status lifecycle

```text
   detected
      │
      ▼
  ┌────────┐  stage sent   ┌──────────┐  link clicked   ┌───────────┐
  │pending ├──────────────►│ notified ├────────────────►│ recovered │
  └───┬────┘               └────┬─────┘                 └─────┬─────┘
      │                         │                             │
      │  order.placed           │  order.placed               │  order.placed
      └─────────────────────────┴──────────────┬──────────────┘
                                               ▼
                                        ┌───────────┐
                                        │ converted │  terminal
                                        └───────────┘

  any state ──► dismissed (manual, terminal)
  any state ──► expired   (cart gone, emptied, or unreachable)
```

| Status | Meaning | Still chased? |
| --- | --- | --- |
| `pending` | Detected, nothing sent yet. | Yes |
| `notified` | At least one stage sent. | Yes, until the sequence runs out |
| `recovered` | The shopper followed a recovery link. | Only if `stopAfterRecovery: false` |
| `converted` | The cart became an order. | No — terminal |
| `dismissed` | Manually excluded from the admin or API. | No — terminal |
| `expired` | Cart deleted, emptied, or has no reachable address. | No |

Detection never resurrects a `converted` or `dismissed` cart, even if the underlying cart is somehow
updated again.

## Attribution

When an order is placed, the `order.placed` subscriber resolves the order's cart through Medusa's
built-in Order↔Cart link, finds the matching tracked cart, and sets `status: "converted"`,
`converted_at` and `order_id`.

This is what makes the numbers on the admin page mean something: `conversion_rate` is the share of
*notified* carts that ended in an order, not a guess based on timing.

Attribution failures are caught and logged. Bookkeeping never breaks order placement.

> **Note on honesty of the numbers.** A cart marked `converted` isn't proof the email caused the
> purchase — the shopper might have come back on their own. `recovered` (they clicked the link) is
> the stronger signal, and both are shown separately in the admin for that reason.

## Failure handling

### A send fails

The error is written to `abandoned_cart_notification` with `error` set and `sent_at` null, and
`stage_index` is **not** advanced. The next sweep picks the same cart up and retries the same stage.

That means a permanently bad address retries every sweep until the cart ages past `maxAge`
— or you dismiss it. The notification rows make this visible: several failures for the same
`stage_id` on one cart is a bad address, the same failure across many carts is a provider problem.

### Stale carts

During the notification pass, a tracked cart is closed instead of emailed when:

| Situation | New status |
| --- | --- |
| The cart no longer exists | `expired` |
| The cart has `completed_at` set | `converted` |
| The cart has no line items left | `expired` |
| Neither the record nor the cart has an email address | `expired` |

The `converted` case is a fallback for orders completed without an `order.placed` event reaching the
subscriber; normally attribution has already happened.

### A workflow step throws

Each step that writes to the database has a compensation function, so a failure mid-workflow rolls
back the rows it created or changed. The send step deliberately has none — an email that left the
building can't be un-sent — which is why sending and recording are separate steps in that order.
