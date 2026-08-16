# AGENTS.md

Machine-oriented guide for coding agents. Two tasks are covered:

- **[Install this plugin into a Medusa application](#task-install-into-a-medusa-application)** — the common case.
- **[Work on this repository](#task-work-on-this-repository)** — contributing to the plugin itself.

Human-facing documentation lives in [`docs/`](./docs). Prefer this file for automation: it is
exhaustive about the option schema and states the constraints that cause silent failures.

Package name: `@luluhoc/medusa-plugin-abandoned-cart`. Requires **Medusa v2.19.0+**.

---

## Task: install into a Medusa application

### 0. Preconditions

Verify these before editing anything. If a check fails, resolve it or tell the user — do not work
around it.

| Check | Command / location | Required |
| --- | --- | --- |
| Medusa v2.19.0 or later | `node -p "require('@medusajs/medusa/package.json').version"` | yes |
| `medusa-config.ts` exists at the app root | – | yes |
| A Notification Module Provider is registered | `modules` array in `medusa-config.ts` | yes — nothing sends without one |
| Postgres reachable | app already runs `medusa db:migrate` | yes |
| A storefront exists | – | no — reminders send without it, but the recovery link won't work |

If no notification provider is registered, add one **before** installing this plugin. Step 2 shows
SendGrid; any [Notification Module Provider](https://docs.medusajs.com/resources/infrastructure-modules/notification)
works.

### 1. Install

```bash
yarn add @luluhoc/medusa-plugin-abandoned-cart
```

### 2. Edit `medusa-config.ts`

Two separate edits. The plugin goes in `plugins`; the notification provider goes in `modules`.
**Do not put this plugin in the `modules` array** — it is a plugin, not a module.

```ts title="medusa-config.ts"
module.exports = defineConfig({
  // ...

  // Edit A — only if no provider is registered for the channel you send on.
  modules: [
    {
      resolve: "@medusajs/medusa/notification",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/notification-sendgrid",
            id: "sendgrid",
            options: {
              channels: ["email"],
              api_key: process.env.SENDGRID_API_KEY,
              from: process.env.SENDGRID_FROM,
            },
          },
        ],
      },
    },
  ],

  // Edit B — the plugin.
  plugins: [
    {
      resolve: "@luluhoc/medusa-plugin-abandoned-cart",
      options: {
        storefrontUrl: process.env.STOREFRONT_URL,
        stages: [
          { id: "reminder-1", delay: "4h", template: process.env.ABANDONED_CART_TEMPLATE_1 },
          { id: "last-call", delay: "2d", template: process.env.ABANDONED_CART_TEMPLATE_2 },
        ],
      },
    },
  ],
})
```

`template` is the **provider's** template id (SendGrid: `d-…`). Ask the user for it. Do not invent
one — a wrong id fails at send time, not at boot, so it will look like it worked.

### 3. Environment

```bash title=".env"
STOREFRONT_URL=https://shop.example.com
ABANDONED_CART_TEMPLATE_1=d-...
ABANDONED_CART_TEMPLATE_2=d-...

# Optional. Cron for the sweep. Default: */15 * * * *
ABANDONED_CART_CRON=*/15 * * * *
```

`ABANDONED_CART_CRON` is read from the environment, **not** from the plugin options — a scheduled
job's config is evaluated at boot, before plugin options exist. Putting a `cron` or `schedule` key in
the plugin options does nothing.

### 4. Migrate

```bash
yarn medusa db:migrate
```

Creates `abandoned_cart` and `abandoned_cart_notification`.

### 5. Add the storefront route

Only if the app has a storefront. The route exchanges the email's token for a cart id and sets the
cart cookie.

For the Next.js Starter Storefront, create
`src/app/[countryCode]/(main)/cart/recover/[token]/route.ts` from
[`examples/storefront-recover-route.ts`](./examples/storefront-recover-route.ts). For other stacks,
see [docs/storefront.md](./docs/storefront.md).

The route's path must match the plugin's `recoveryPath` option (default `/cart/recover/{token}`).

### 6. Verify

Deterministic end-to-end check. Requires admin credentials.

```bash
# 1. Get an admin token.
TOKEN=$(curl -s -X POST "$MEDUSA_URL/auth/user/emailpass" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"..."}' | jq -r .token)

# 2. Force a sweep. Proves the plugin loaded, the module registered, and the tables exist.
curl -s -X POST "$MEDUSA_URL/admin/abandoned-carts/sweep" \
  -H "Authorization: Bearer $TOKEN" | jq

# 3. List tracked carts.
curl -s "$MEDUSA_URL/admin/abandoned-carts?limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Expected from step 2:

```json
{ "sweep": { "scanned": 0, "created": 0, "updated": 0, "sent": 0, "failed": 0, "closed": 0 } }
```

All zeros is a **pass** on a fresh install — it means the route, module and tables work and there is
simply nothing abandoned yet. A `404` means the plugin did not load; a `500` mentioning
`abandoned_cart` means migrations did not run.

To prove sending works, you need a real cart with an email address that has been idle longer than
the first stage's delay. Ask the user to create one, or temporarily set
`stages: [{ delay: "1m", template: "<real-id>" }]` and `ABANDONED_CART_CRON="* * * * *"`, then revert
both. Never leave a sub-hour delay in a production config.

### Option schema

Exhaustive. Unknown keys are ignored without an error, so a typo or an invented option fails silently
— use exactly these names. Source of truth:
[`src/modules/abandoned-cart/types.ts`](./src/modules/abandoned-cart/types.ts).

```ts
type Duration = string | number   // "90s" | "30m" | "4h" | "2d" | "1w" | 90 (minutes)

type Stage = {
  id?: string                     // default "stage-1", "stage-2", …
  delay: Duration                 // REQUIRED
  template?: string               // default: top-level `template`
  templates?: Record<string, string>                    // per-locale template ids
  channel?: string                // default: top-level `channel`
  data?: Record<string, unknown>  // merged into this stage's payload
  localeData?: Record<string, Record<string, unknown>>  // per-locale additions to `data`
}

type Options = {
  // sequence
  stages?: Stage[]                      // default [{ delay: "4h" }]
  template?: string                     // default "abandoned-cart"
  channel?: string                      // default "email"
  notificationData?: Record<string, unknown>  // default {}

  // detection
  enabled?: boolean                     // default true
  maxAge?: Duration                     // default "14d"
  minItems?: number                     // default 1
  minSubtotal?: number                  // default 0 — cart currency, decimals not minor units
  requireEmail?: boolean                // default true
  onlyRegisteredCustomers?: boolean     // default false
  salesChannelIds?: string[]            // default [] (all)
  resetOnActivity?: boolean             // default false

  // recovery
  storefrontUrl?: string                // no default — without it recovery_url is null
  recoveryPath?: string                 // default "/cart/recover/{token}"
  stopAfterRecovery?: boolean           // default true

  // throughput
  batchSize?: number                    // default 100
  notificationBatchSize?: number        // default 100

  // localization — all optional; omit them all and behaviour is unchanged
  locales?: string[]                    // default [] — the supported set
  defaultLocale?: string                // no default — otherwise locale stays null
  localeMetadataKey?: string            // default "locale"
  localeByCountry?: Record<string, string>       // shipping-address country code -> locale
  localeByRegion?: Record<string, string>        // region id -> locale
  localeBySalesChannel?: Record<string, string>  // sales channel id -> locale
  resolveLocale?: (context: AbandonedCartLocaleContext) => string | null | undefined
  templates?: Record<string, string>    // locale -> template id, for every stage
  templatePattern?: string              // e.g. "{template}-{lang}". REQUIRES `locales`
  localeData?: Record<string, Record<string, unknown>>  // locale -> payload data
  storefrontUrlByLocale?: Record<string, string>
  recoveryPathByLocale?: Record<string, string>
}
```

Locale resolution, first match wins: `resolveLocale` → `cart.metadata[localeMetadataKey]` →
`customer.metadata[localeMetadataKey]` → `localeByCountry` → `localeByRegion` →
`localeBySalesChannel` → `defaultLocale`, then `null`. Template resolution, first match wins:
`stage.templates[locale]` → `templates[locale]` → `templatePattern` → `stage.template`. Both walk the
locale fallback chain (`fr-CA` → `fr`). Full behaviour:
[docs/localization.md](./docs/localization.md).

### Constraints

Violating any of the first five throws at boot with a clear message:

1. Stage delays must **strictly increase**. Delays are cumulative from the cart's last activity, not
   gaps between emails.
2. `maxAge` must be **longer than the first stage's delay**.
3. Stage `id`s must be unique.
4. Durations need a unit (`"4h"`) or must be a number (minutes). `"4"` is invalid; `4` means four
   minutes.
5. Locale-keyed options are checked against `locales`. `templates: { ge: … }` with `locales: ["de"]`
   throws — it would otherwise be an invisible no-op. `templatePattern` without `locales`, or
   without `{locale}`/`{lang}` in it, also throws.
6. Prices are **decimals in the cart's currency**, not minor units. `minSubtotal: 25` is $25.00.
   Never multiply or divide by 100.
7. The sweep advances a cart **one stage per run**. Set `ABANDONED_CART_CRON` shorter than the gap
   between the two closest stages.
8. Scheduled jobs run **per instance**. If the app runs multiple server instances, run the sweep on a
   single worker or duplicate emails will go out.

### Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| `404` on `/admin/abandoned-carts/*` | Plugin not registered, or in `modules` instead of `plugins` | Edit B above |
| `500` mentioning `abandoned_cart` relation | Migrations not run | `yarn medusa db:migrate` |
| Boot error `stage "x" must have a longer delay than "y"` | Non-increasing delays | Constraint 1 |
| Boot error `"maxAge" must be longer than…` | `maxAge` too short | Constraint 2 |
| Sweep returns `failed > 0` | Provider rejected the send | Inspect `notifications[].error` via `GET /admin/abandoned-carts/:id` |
| `No provider found for channel: email` | No notification provider | Edit A above |
| Carts never detected | No email on cart, or thresholds too strict | [docs/troubleshooting.md](./docs/troubleshooting.md#2-are-carts-being-detected) |
| `recovery_url` is `null` in the email | `storefrontUrl` not set | Step 3 |
| Emails go out untranslated | Cart resolved to no locale, or the locale has no `templates` entry — the plugin falls back rather than skipping | [docs/localization.md](./docs/localization.md) |
| Boot error naming a locale | A locale-keyed option references a locale outside `locales` | Constraint 5 |

Failed sends do not advance the stage, so they retry on every sweep until fixed or the cart ages past
`maxAge`. A wrong template id therefore produces a growing pile of failures rather than an obvious
error — check `failed` in the sweep response after configuring.

### Public API surface

Import paths available to the host application:

```ts
import {
  syncAbandonedCartsWorkflow,              // { limit?, offset? }
  sendAbandonedCartNotificationsWorkflow,  // { ids?, limit?, force?, stage_id?, locale? }
  markAbandonedCartRecoveredWorkflow,      // { id? | token? | cart_id? }
  markAbandonedCartConvertedWorkflow,      // { order_id, cart_id? }
} from "@luluhoc/medusa-plugin-abandoned-cart/workflows"

import { ABANDONED_CART_MODULE } from "@luluhoc/medusa-plugin-abandoned-cart/modules/abandoned-cart"
import { runAbandonedCartSweep } from "@luluhoc/medusa-plugin-abandoned-cart/utils/run-sweep"
```

HTTP routes: `GET /store/abandoned-carts/:token`, and under `/admin/abandoned-carts` —
`GET /`, `GET /stats`, `GET /:id`, `POST /:id`, `POST /:id/send`, `POST /sweep`. Full shapes in
[docs/api-reference.md](./docs/api-reference.md).

Admin UI route: `/app/abandoned-carts`.

---

## Task: work on this repository

### Layout

```text
src/
  modules/abandoned-cart/   data models, service, option resolution  (types.ts is the option schema)
  workflows/                4 workflows; workflows/steps/ holds the 7 steps
  jobs/                     abandoned-cart-sweep (cron from ABANDONED_CART_CRON)
  subscribers/              order-placed → attribution
  links/                    3 read-only links: cart, customer, order
  api/                      admin/ + store/ routes, middlewares.ts holds all validators
  admin/                    dashboard page (Vite-bundled, ESM)
  utils/                    duration parsing, runAbandonedCartSweep
docs/                       human documentation
examples/                   email template + storefront route
```

### Commands

```bash
yarn typecheck   # tsc against tsconfig.check.json — MUST pass
yarn build       # medusa plugin:build — MUST pass
yarn generate    # medusa plugin:db:generate — needs Postgres and .env
yarn dev         # watch + publish to the local yalc registry
```

Run `yarn typecheck && yarn build` before considering any change complete. There is no test
suite yet; the build and typecheck are the gate.

`src/admin` is excluded from `tsconfig.check.json` because Vite compiles it as ESM and `tsc` would
flag `import.meta` under the CommonJS setting the server build needs. To check it, run tsc directly
with `--module ESNext --moduleResolution Bundler`.

### Invariants

Do not break these without deliberately changing the documented behaviour:

1. **A failed send must not advance `stage_index`.** That is what makes retries work.
   ([`record-abandoned-cart-notifications.ts`](./src/workflows/steps/record-abandoned-cart-notifications.ts))
2. **Sending and recording are separate steps, in that order.** The send step has no compensation
   because an email cannot be un-sent; every step that writes to the database has one.
3. **Stage delays are measured from `cart_updated_at`**, the cart's last activity — never from
   `last_notified_at`.
4. **`converted` and `dismissed` are terminal.** Detection must never resurrect them.
5. **Static API routes must not collide with `[id]`.** Medusa sorts static before dynamic
   (`global → wildcard → regex → static → params`), so `/sweep` and `/stats` win over `/:id`. The
   `/admin/abandoned-carts/:id` body validator also matches `POST /sweep`, so every field in
   `PostAdminAbandonedCartSchema` must stay optional.
6. **Money is decimal, in the cart's currency.** No minor-unit conversion anywhere.
7. **Attribution must never break order placement.** The `order.placed` subscriber catches and logs.
8. **Bounded loops.** `runAbandonedCartSweep` caps detection at 200 pages and notification at 10
   rounds; keep a cap if you change the loops.
9. **An unresolved or untranslated locale still sends.** Template resolution always falls back to the
   stage's plain `template`; locale is a routing hint, never a gate on delivery.

### If you change the option schema

1. Update [`src/modules/abandoned-cart/types.ts`](./src/modules/abandoned-cart/types.ts) and
   [`options.ts`](./src/modules/abandoned-cart/options.ts) (defaults + validation).
2. Update the schema block in this file and the tables in
   [docs/configuration.md](./docs/configuration.md#options).
3. Update the option list in [README.md](./README.md#at-a-glance).
4. If the option is locale-keyed, validate it against `locales` in `resolveOptions` and add it to
   [docs/localization.md](./docs/localization.md#validation).

### If you change a data model

1. Edit the model in `src/modules/abandoned-cart/models/`.
2. Run `yarn generate` and commit the generated migration.
3. Update [docs/data-model.md](./docs/data-model.md).

### Documentation map

| File | Purpose |
| --- | --- |
| [docs/getting-started.md](./docs/getting-started.md) | Install walkthrough |
| [docs/configuration.md](./docs/configuration.md) | Option reference + recipes |
| [docs/how-it-works.md](./docs/how-it-works.md) | Sweep, timing model, lifecycle, failure handling |
| [docs/notifications.md](./docs/notifications.md) | Payload reference + templates |
| [docs/localization.md](./docs/localization.md) | Locale resolution, per-locale templates/data/links |
| [docs/storefront.md](./docs/storefront.md) | Token exchange + route handlers |
| [docs/api-reference.md](./docs/api-reference.md) | All routes |
| [docs/data-model.md](./docs/data-model.md) | Tables, links, queries |
| [docs/recipes.md](./docs/recipes.md) | Programmatic use |
| [docs/troubleshooting.md](./docs/troubleshooting.md) | Diagnosis |

Keep documentation accurate rather than aspirational: if a field or behaviour does not exist in the
code, it does not belong in the docs.
