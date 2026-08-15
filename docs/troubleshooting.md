# Troubleshooting

## Nothing is being sent

Work down the funnel — each step tells you where it stops.

### 1. Is the sweep running?

Look for this line after a sweep that did something:

```text
info: [abandoned-cart] swept 12 carts — 2 new, 3 refreshed, 1 notified, 0 failed, 0 closed
```

Quiet sweeps log nothing, which is intentional — otherwise a 15-minute cron floods your logs. To
force a sweep and see the numbers regardless, hit **Run sweep** in the admin or:

```bash
curl -X POST "$MEDUSA_URL/admin/abandoned-carts/sweep" -H "Authorization: Bearer $ADMIN_TOKEN"
```

If that returns all zeros, the problem is detection. If it returns `sent: 0, failed: n`, the problem
is your provider.

Also check `enabled` isn't `false`, and that `ABANDONED_CART_CRON` is a valid cron expression set in
the **application's** environment, not the plugin project's.

### 2. Are carts being detected?

```bash
curl "$MEDUSA_URL/admin/abandoned-carts?limit=5" -H "Authorization: Bearer $ADMIN_TOKEN"
```

Empty? A cart has to satisfy **all** of these:

| Requirement | Option |
| --- | --- |
| Not completed | – |
| Quiet for at least the first stage's delay | `stages[0].delay` |
| Quiet for less than `maxAge` | `maxAge` |
| Has an email address | `requireEmail` |
| Has at least `minItems` line items | `minItems` |
| Subtotal at least `minSubtotal` | `minSubtotal` |
| In an allowed sales channel | `salesChannelIds` |
| Belongs to a registered customer | `onlyRegisteredCustomers` |

The two that catch people out:

- **The email address.** A cart only gets one once the shopper reaches the email/address step of
  checkout. Carts abandoned before that are invisible to the plugin unless you set the email
  yourself. Set `requireEmail: false` only if you have another way to reach the shopper — sends will
  otherwise fail and the record ends up `expired`.
- **`updated_at`.** Anything that touches the cart — a poll from your storefront, a shipping-option
  refresh, a background job — bumps it and restarts the clock. If carts never seem to go quiet, check
  what's writing to them.

### 3. Are reminders due?

A detected cart sits at `pending` until its first stage's delay has elapsed *since the cart's last
activity*. Compare `cart_updated_at` on the record with your first delay. A cart detected 10 minutes
ago with a 4-hour first stage isn't due for another 3h50m — that's working as intended.

Carts at `status: "notified"` with `stage_index` equal to your stage count have finished the
sequence. Nothing more will be sent.

### 4. Is the provider accepting them?

```bash
curl "$MEDUSA_URL/admin/abandoned-carts/abcart_01J…" -H "Authorization: Bearer $ADMIN_TOKEN"
```

Look at `notifications[].error`. Common ones:

| Error | Cause |
| --- | --- |
| `No provider found for channel: email` | No Notification Module Provider registered for that channel. |
| `Template not found` / `does not exist` | The stage's `template` isn't a valid id for that provider. |
| `The from address does not match a verified Sender Identity` | Provider-side sender verification. |
| `Unauthorized` / `403` | Bad or missing API key in the provider options. |

Failed sends don't advance the sequence, so the same stage retries every sweep until it succeeds or
the cart ages out. Fix the cause and the backlog drains on its own.

## Emails arrive but the link doesn't work

- **`recovery_url` is `null` in the payload** — `storefrontUrl` isn't set. Set it, or build the link
  in the template from `token`.
- **The link 404s at your storefront** — the storefront route isn't deployed at the path
  `recoveryPath` points to. They have to match.
- **The endpoint 404s** — the token doesn't match a record, or the cart was deleted. Tokens are
  per-cart and don't expire; a 404 means the record or cart is gone.
- **Missing `x-publishable-api-key`** — every `/store` route needs it, including this one.

## The numbers look wrong

### Recovery rate is 0% but people are clearly coming back

The storefront isn't calling `GET /store/abandoned-carts/:token`. If your route restores the cart
from `{cart_id}` in the URL without exchanging the token, the click is never recorded. Use the token
form.

Also check the fetch isn't cached — `cache: "no-store"` in Next.js.

### Conversion rate is 0%

Attribution runs off the `order.placed` event. Check:

- the subscriber is loading (a plugin-provided subscriber appears in the boot logs' subscriber
  count);
- the order was created from a **tracked** cart — carts that converted before they were ever detected
  have no record to attribute to;
- the log for `[abandoned-cart] failed to attribute order …`.

### `recovered_value` looks too low

It sums at most 1000 converted carts. Past that, aggregate the list route yourself — see the
[API reference](./api-reference.md#get-adminabandoned-cartsstats).

Remember it's the **line-item subtotal** at detection time, not the order total: no shipping, tax or
discounts, and it doesn't follow the cart if the shopper added items before checking out.

## Shoppers got two emails

Each stage sends exactly once per cart, so duplicates mean one of:

- **Two Medusa instances both running the cron.** Scheduled jobs run per instance. Run the sweep on
  one worker (`workerMode: "worker"` on a single instance), or disable the job and drive it from one
  place — see [Recipes](./recipes.md#detect-on-your-own-cadence).
- **Someone pressed Send now.** Manual sends are forced and ignore the schedule. They're recorded in
  the notification list with the same `stage_id`.
- **`resetOnActivity: true`** and the shopper edited their cart between stages, which restarts the
  sequence by design.

## Stage delays don't behave as expected

Delays are **cumulative from the cart's last activity**, not gaps between emails. `["1h", "24h"]`
means the second email lands 24 hours after the cart went quiet — 23 hours after the first, not 25.
See [the timing model](./how-it-works.md#the-timing-model).

If the second email is consistently late, check your cron interval: the sweep advances a cart at most
one stage per run, so it can't be sparser than the gap between your closest two stages.

## Boot errors

| Message | Fix |
| --- | --- |
| `Invalid stages[0].delay: …` | Use a duration string with a unit (`"4h"`) or a number of minutes. |
| `stage "x" must have a longer delay than "y"` | Stage delays are cumulative and must strictly increase. |
| `duplicate stage id "x"` | Give each stage a unique `id`. |
| `"maxAge" must be longer than the first stage's delay` | Otherwise no cart can ever qualify. |

## Testing quickly

```ts title="medusa-config.ts"
options: {
  stages: [{ delay: "1m", template: "your-template-id" }],
  maxAge: "1d",
}
```

```bash title=".env"
ABANDONED_CART_CRON="* * * * *"
```

Add an item to a cart, enter an email at checkout, wait a minute. Or skip the wait entirely with
**Run sweep**, then **Send now** on the row — that path ignores delays and exercises your provider
and template immediately.

Revert both settings before deploying.

## Still stuck

Turn up the logging (`LOG_LEVEL=debug`) and run one sweep by hand. The detection query, the selection
query and each send are all visible there. If the behaviour still doesn't match this documentation,
that's a bug worth reporting — include the sweep response, one affected record from
`GET /admin/abandoned-carts/:id`, and your `stages` configuration.
