# @luluhoc/medusa-plugin-abandoned-cart

Abandoned cart detection, multi-stage recovery emails, and recovery analytics for **Medusa v2**.

The plugin watches for carts that go quiet, tracks each one in its own table, sends a configurable
sequence of reminders through Medusa's Notification Module, and attributes the resulting orders back
to the cart so you can see what the sequence actually earned.

- **Detection** — a scheduled sweep finds open carts that have been inactive longer than your first
  stage's delay, filtered by item count, subtotal, sales channel and customer type.
- **Sequences** — any number of stages (`1h`, `24h`, `3d`, …), each with its own provider template
  and channel.
- **Localization** — resolve each cart's locale from its metadata, country, region or your own rule,
  then send the matching template with a localized recovery link.
- **Recovery links** — every tracked cart gets an opaque token; the storefront exchanges it for the
  cart id and the click is recorded.
- **Attribution** — an `order.placed` subscriber marks the cart converted and stores the order id.
- **Admin page** — recovery stats, the full funnel, and manual "send now" / "dismiss" actions.

---

## Quick start

```bash
yarn add @luluhoc/medusa-plugin-abandoned-cart
```

```ts title="medusa-config.ts"
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@luluhoc/medusa-plugin-abandoned-cart",
      options: {
        storefrontUrl: process.env.STOREFRONT_URL,
        stages: [
          { id: "reminder-1", delay: "4h", template: "d-1a2b3c…" },
          { id: "reminder-2", delay: "24h", template: "d-4d5e6f…" },
          { id: "last-call", delay: "3d", template: "d-7g8h9i…" },
        ],
      },
    },
  ],
})
```

```bash
yarn medusa db:migrate
```

You also need a [Notification Module Provider](https://docs.medusajs.com/resources/infrastructure-modules/notification)
registered for the channel you send on (`email` by default) — the plugin composes notifications, the
provider delivers them. The `template` on each stage is that provider's template id.

Then add the recovery route to your storefront, and open **Abandoned carts** in the admin sidebar.

**[Full walkthrough →](./docs/getting-started.md)**

---

## Documentation

| Guide | What it covers |
| --- | --- |
| [Getting started](./docs/getting-started.md) | Install, wire up a provider, migrate, and confirm the first reminder. |
| [Configuration](./docs/configuration.md) | Every option, the duration format, the sweep schedule, and setup recipes. |
| [How it works](./docs/how-it-works.md) | The sweep, the timing model, the status lifecycle, failure handling. |
| [Notifications](./docs/notifications.md) | The payload each stage sends, template examples, provider notes. |
| [Localization](./docs/localization.md) | Locale resolution, per-locale templates and data, localized recovery links. |
| [Storefront integration](./docs/storefront.md) | Recovery links, the token exchange, drop-in route handlers. |
| [API reference](./docs/api-reference.md) | Every store and admin route. |
| [Data model](./docs/data-model.md) | Tables, columns, module links, and how to query them. |
| [Recipes](./docs/recipes.md) | Running the workflows yourself and extending the plugin. |
| [Troubleshooting](./docs/troubleshooting.md) | Why nothing sent, why the numbers look wrong, how to test fast. |

Working examples live in [`examples/`](./examples): a complete HTML email template and the storefront
recovery route.

Using a coding agent? [`AGENTS.md`](./AGENTS.md) is a machine-oriented install spec — exhaustive
option schema, boot constraints, a deterministic verification sequence, and the failure modes that
fail silently. It ships in the npm package, so an agent can read it from `node_modules`.

---

## At a glance

**Options** — `stages`, `template`, `channel`, `notificationData`, `enabled`, `maxAge`, `minItems`,
`minSubtotal`, `requireEmail`, `onlyRegisteredCustomers`, `salesChannelIds`, `resetOnActivity`,
`storefrontUrl`, `recoveryPath`, `stopAfterRecovery`, `batchSize`, `notificationBatchSize`, plus the
localization set — `locales`, `defaultLocale`, `localeMetadataKey`, `localeByCountry`,
`localeByRegion`, `localeBySalesChannel`, `resolveLocale`, `templates`, `templatePattern`,
`localeData`, `storefrontUrlByLocale`, `recoveryPathByLocale`.
[Reference →](./docs/configuration.md#options)

**Languages** — a cart's locale comes from its metadata, the customer, the country, the region, the
sales channel or your own `resolveLocale`, and picks the stage's template for that locale.
[Detail →](./docs/localization.md)

**Timing** — stage delays are cumulative and measured from the cart's last activity, so `["1h", "24h"]`
sends one hour and then 24 hours after the cart goes quiet.
[Detail →](./docs/how-it-works.md#the-timing-model)

**Schedule** — the sweep runs on `ABANDONED_CART_CRON` (default `*/15 * * * *`), set in the Medusa
application's environment. [Why →](./docs/configuration.md#the-sweep-schedule)

**API** — `GET /store/abandoned-carts/:token` plus six admin routes under `/admin/abandoned-carts`.
[Reference →](./docs/api-reference.md)

**Workflows** — `syncAbandonedCartsWorkflow`, `sendAbandonedCartNotificationsWorkflow`,
`markAbandonedCartRecoveredWorkflow`, `markAbandonedCartConvertedWorkflow`, all exported from
`@luluhoc/medusa-plugin-abandoned-cart/workflows`. [Usage →](./docs/recipes.md)

---

## Development

```bash
yarn install
yarn typecheck          # server-side type check
yarn generate           # generate migrations (needs the DB_* vars in .env)
yarn dev                # watch + publish to the local yalc registry
yarn build              # build for publishing
```

To test the plugin in a Medusa application:

```bash
# in the plugin project
yarn medusa plugin:publish
yarn medusa plugin:develop

# in the Medusa application
yarn medusa plugin:add @luluhoc/medusa-plugin-abandoned-cart
yarn medusa db:migrate
yarn dev
```

`yarn generate` needs a reachable Postgres — copy `.env.template` to `.env` and fill in the `DB_*`
variables. It writes to `src/modules/abandoned-cart/migrations/`, which must be committed and shipped
with the plugin. Run it once before publishing, and again whenever you change a data model.

## Compatibility

Medusa **v2.19.0** and later.

## License

MIT
