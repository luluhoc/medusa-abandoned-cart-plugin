# Configuration

All options go in the plugin entry in `medusa-config.ts`:

```ts title="medusa-config.ts"
plugins: [
  {
    resolve: "medusa-plugin-abandoned-cart",
    options: {
      // everything on this page
    },
  },
]
```

Options are validated at boot. Invalid configuration throws immediately rather than leaving you with
a plugin that silently sends nothing — see [Validation rules](#validation-rules).

## Options

### Sequence

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `stages` | `Stage[]` | one stage at `"4h"` | The reminder sequence. See [Stages](#stages). |
| `template` | `string` | `"abandoned-cart"` | Provider template id used by stages that don't set their own. |
| `channel` | `string` | `"email"` | Notification channel used by stages that don't set their own. |
| `notificationData` | `object` | `{}` | Static values merged into every notification payload's `data`. |

### Detection

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | Master switch for the scheduled sweep. Manual sends still work when off. |
| `maxAge` | `Duration` | `"14d"` | Carts quiet for longer than this are ignored — too cold to chase, and it keeps the scan bounded. |
| `minItems` | `number` | `1` | Minimum line items for a cart to qualify. |
| `minSubtotal` | `number` | `0` | Minimum subtotal, in the cart's own currency, computed from line items. |
| `requireEmail` | `boolean` | `true` | Skip carts with no email address. |
| `onlyRegisteredCustomers` | `boolean` | `false` | Skip guest carts (`customer.has_account === false`). |
| `salesChannelIds` | `string[]` | all | Restrict detection to these sales channels. |
| `resetOnActivity` | `boolean` | `false` | Restart the sequence at stage 1 when an already-notified shopper edits their cart. |

### Recovery

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `storefrontUrl` | `string` | – | Origin used to build `recovery_url`. Without it, `recovery_url` is `null` and templates get the raw `token`. |
| `recoveryPath` | `string` | `"/cart/recover/{token}"` | Path appended to `storefrontUrl`. `{token}` and `{cart_id}` are substituted. |
| `stopAfterRecovery` | `boolean` | `true` | Stop sending once the shopper follows a recovery link. |

### Throughput

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `batchSize` | `number` | `100` | Carts scanned per page during detection. |
| `notificationBatchSize` | `number` | `100` | Reminders sent per page. |

## Stages

A stage is one message in the sequence:

```ts
type Stage = {
  id?: string           // defaults to "stage-1", "stage-2", …
  delay: Duration       // required
  template?: string     // falls back to the top-level `template`
  channel?: string      // falls back to the top-level `channel`
  data?: object         // merged into this stage's notification payload
}
```

```ts
stages: [
  { id: "nudge",     delay: "1h",  template: "d-nudge" },
  { id: "reminder",  delay: "24h", template: "d-reminder" },
  { id: "last-call", delay: "3d",  template: "d-last-call", data: { discount_code: "COMEBACK10" } },
]
```

`id` is stored on every notification row, so keep it stable if you want to compare stage performance
over time. `data` is handy for stage-specific template variables — a discount code on the last email,
a different subject line, a campaign tag.

### Multi-channel sequences

`channel` is per-stage, so a sequence can escalate across channels as long as you have a provider
registered for each:

```ts
stages: [
  { id: "email-1", delay: "4h", channel: "email", template: "d-reminder" },
  { id: "sms",     delay: "2d", channel: "sms",   template: "abandoned-cart-sms" },
]
```

The plugin always addresses the notification to the cart's email, whatever the channel, so an SMS
provider has to resolve the phone number itself — usually by looking up the customer from the
payload's `customer` object. If yours can't, send that stage yourself:
see [Recipes](./recipes.md#add-data-to-every-email).

## Durations

Anywhere the docs say `Duration`, you can pass:

- a **string with a unit**: `"90s"`, `"30m"`, `"4h"`, `"2d"`, `"1w"`
- a **plain number**, interpreted as **minutes**: `90` is an hour and a half

Units are `ms`, `s`, `m`, `h`, `d`, `w`. Decimals are allowed (`"1.5h"`). Anything else throws at
boot with the offending value in the message.

## The sweep schedule

A scheduled job's configuration is read when Medusa boots, before plugin options exist, so the cron
expression comes from an environment variable rather than the options object:

```bash title=".env"
ABANDONED_CART_CRON="*/15 * * * *"   # the default: every 15 minutes
```

Set it in the **Medusa application**, not the plugin project. The job is named
`abandoned-cart-sweep`.

Pick an interval shorter than the gap between your closest two stages — the sweep can only advance a
cart one stage per run. With stages at `1h` and `2h`, a 15-minute sweep is plenty; a 90-minute sweep
would delay the second reminder.

To stop the sweep entirely, set `enabled: false`. The admin's **Run sweep** button and the manual
send routes still work, so you can keep operating the plugin by hand.

## Validation rules

The plugin throws at boot if:

- a stage's `delay` isn't a valid duration;
- stage delays don't strictly increase — delays are cumulative, so `["4h", "1h"]` would mean the
  second reminder was already overdue when the first one sent;
- two stages share an `id`;
- `maxAge` is not longer than the first stage's delay, which would make it impossible for any cart to
  qualify.

## Recipes

### Conservative — one polite reminder

```ts
options: {
  storefrontUrl: process.env.STOREFRONT_URL,
  stages: [{ id: "reminder", delay: "6h", template: "d-reminder" }],
  minSubtotal: 25,
}
```

### Standard — the usual three-touch sequence

```ts
options: {
  storefrontUrl: process.env.STOREFRONT_URL,
  stages: [
    { id: "reminder-1", delay: "1h",  template: "d-reminder-1" },
    { id: "reminder-2", delay: "24h", template: "d-reminder-2" },
    { id: "last-call",  delay: "3d",  template: "d-last-call", data: { discount_code: "COMEBACK10" } },
  ],
  maxAge: "7d",
}
```

### High-value carts only, registered customers only

```ts
options: {
  storefrontUrl: process.env.STOREFRONT_URL,
  stages: [{ delay: "2h", template: "d-vip" }],
  minSubtotal: 250,
  minItems: 1,
  onlyRegisteredCustomers: true,
}
```

### One sales channel, with a campaign tag on every send

```ts
options: {
  storefrontUrl: "https://outlet.example.com",
  recoveryPath: "/recover?token={token}",
  salesChannelIds: ["sc_01J…"],
  stages: [{ delay: "3h", template: "d-outlet" }],
  notificationData: { campaign: "outlet-recovery-q3" },
}
```

### Staging — track everything, send nothing

```ts
options: {
  enabled: process.env.NODE_ENV === "production",
  stages: [{ delay: "1h", template: "d-reminder" }],
}
```

With `enabled: false` the sweep never runs on its own, so nothing is detected either. To *detect*
without *sending*, leave it enabled and call
`POST /admin/abandoned-carts/sweep?notify=false` on your own schedule instead.
