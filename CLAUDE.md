# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **Medusa v2 plugin** (`@luluhoc/medusa-plugin-abandoned-cart`), not an application. Nothing here runs on its
own — it is compiled into `.medusa/server/` and installed into a Medusa application. Targets Medusa
**2.19.0+**, Node 20+.

## Commands

```bash
yarn typecheck          # tsc --noEmit -p tsconfig.check.json (server code only)
yarn generate           # medusa plugin:db:generate — needs Postgres via .env (DB_* vars)
yarn dev                # medusa plugin:develop — watch + publish to local yalc registry
yarn build              # medusa plugin:build — writes .medusa/server, also runs on prepublish
```

There is **no test suite and no test runner configured** (`@medusajs/test-utils` is a dev dependency
but nothing uses it) and no linter. `yarn typecheck` is the only automated check.

To exercise a change end-to-end you need a real Medusa application:

```bash
# here
yarn medusa plugin:publish && yarn medusa plugin:develop
# in the Medusa app
yarn medusa plugin:add @luluhoc/medusa-plugin-abandoned-cart && yarn medusa db:migrate && yarn dev
```

`POST /admin/abandoned-carts/sweep` runs a full pass immediately, which is the fastest way to test
without waiting on the cron.

### Two tsconfigs, on purpose

`tsconfig.json` (CommonJS/Node16) drives the server build. `tsconfig.check.json` extends it and
**excludes `src/admin`**, because the admin extensions are ESM bundled by Vite and `tsc` would flag
`import.meta` under the CommonJS module setting. Admin code is therefore only type-checked by the
Vite build — after editing `src/admin/**`, run `yarn build`, not just `typecheck`.

### Migrations

`yarn generate` writes to `src/modules/abandoned-cart/migrations/`. That directory does not exist
yet — it must be generated, committed, and shipped with the plugin. **Regenerate it after any change
to a model in `src/modules/abandoned-cart/models/`**, or installs will have no table.

## Architecture

Directory layout is dictated by Medusa's plugin conventions (`src/api`, `src/jobs`, `src/links`,
`src/subscribers`, `src/workflows`, `src/admin/routes`); file position is what registers a route,
job, or subscriber.

### The two-pass sweep

Everything centres on [run-sweep.ts](src/utils/run-sweep.ts), shared by the cron job and the admin
"run now" route so both take an identical path:

1. **Detection** — `syncAbandonedCartsWorkflow` pages through open carts (max 200 pages) and upserts
   a tracking row per cart. Cheap filters (`completed_at`, `updated_at` window, email, sales channel)
   go to Postgres; item-dependent thresholds (`minItems`, `minSubtotal`, `onlyRegisteredCustomers`)
   are applied in memory afterwards.
2. **Notification** — `sendAbandonedCartNotificationsWorkflow` selects due records, re-validates each
   against the *live* cart, sends through the Notification Module, records the outcome. Repeats while
   it keeps filling a page, max 10 rounds.

The plugin composes notification payloads; a **Notification Module Provider** registered in the host
app actually delivers them. `stage.template` is that provider's template id.

### Timing model (the thing most likely to be misunderstood)

Stage delays are **cumulative and measured from the cart's last activity**, not from the previous
send. `["1h", "24h"]` means one hour and 24 hours after the cart went quiet. `resolveOptions` enforces
strictly increasing delays and `maxAge > stages[0].delay`, throwing at boot rather than silently
sending nothing. A cart advances at most **one stage per sweep**.

### State invariants

- `stage_index` only ever moves forward — see the `Math.max` in
  [record-abandoned-cart-notifications.ts](src/workflows/steps/record-abandoned-cart-notifications.ts),
  which keeps a forced re-send of an earlier stage from rewinding the funnel.
- **Failed sends do not advance `stage_index`.** They are written as notification rows with an
  `error` and retried on the next sweep. Sends are isolated per cart; one bad address never cancels
  the batch.
- The send step has **no compensation** — an email that left can't be un-sent. The surrounding steps
  do compensate.
- `converted` and `dismissed` are terminal; detection never resurrects them.
- Recovery is idempotent: clicking the link twice keeps the first `recovered_at`.

### Attribution

`order.placed` → [order-placed.ts](src/subscribers/order-placed.ts) → resolve order's cart → mark the
tracking record converted with the order id. This is what makes the admin stats meaningful. The
subscriber swallows its own errors on purpose — bookkeeping must never break order placement.
`selectDueAbandonedCartsStep` also closes out completed carts as a fallback when no event fired.

### Options

All plugin options flow through [options.ts](src/modules/abandoned-cart/options.ts) into a fully
resolved shape (`ResolvedAbandonedCartOptions`); the rest of the codebase reads
`service.getOptions()` and never touches raw options. Durations accept `"30m"`, `"4h"`, `"2d"`,
`"1w"` — a bare number means **minutes** ([duration.ts](src/utils/duration.ts)).

The cron schedule is the exception: it comes from `process.env.ABANDONED_CART_CRON` (set in the
*host application*), because a scheduled job's `config` is read at boot before plugin options exist.

### Module links

`abandoned_cart` links to cart, customer and order as `readOnly` ([src/links/](src/links/)), which is
what lets admin routes fetch `cart.items.*`, `customer.*`, `order.*` through Query in one graph call.

## Conventions

- Comments explain *why*, not what; they are sparse and load-bearing. Match that density.
- Workflow steps live in `src/workflows/steps/`, are exported from `src/workflows/index.ts` (a public
  entry point via the `./workflows` export), and provide compensation wherever the action is
  reversible.
- Every public API route has a docblock naming its method and path.
- Admin API validation is centralised in [middlewares.ts](src/api/middlewares.ts) +
  [validators.ts](src/api/admin/abandoned-carts/validators.ts), never inline in route handlers.
- `docs/` is a complete, cross-linked user manual (9 files). Behaviour or option changes need matching
  edits there — especially `configuration.md`, `how-it-works.md`, and `api-reference.md`.
- A `medusa` MCP server is configured for this project. Prefer its doc/API-spec tools over recalling
  Medusa v2 APIs from memory.
