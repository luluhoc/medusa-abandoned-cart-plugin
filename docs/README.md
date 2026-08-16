# Documentation

Everything you need to run, configure and extend `@luluhoc/medusa-plugin-abandoned-cart`.

## Start here

| Guide | What it covers |
| --- | --- |
| [Getting started](./getting-started.md) | Install the plugin, wire up a notification provider, run migrations, and confirm the first reminder goes out. |
| [Configuration](./configuration.md) | Every option, the duration format, stage sequences, the sweep schedule, and recipes for common setups. |
| [How it works](./how-it-works.md) | The sweep, the timing model, the status lifecycle, and what happens when things go wrong. |

## Reference

| Guide | What it covers |
| --- | --- |
| [Notifications](./notifications.md) | The exact payload each stage sends, template examples, and per-provider notes. |
| [Storefront integration](./storefront.md) | Recovery links, the token exchange, and drop-in route handlers. |
| [API reference](./api-reference.md) | Every store and admin route, with request and response shapes. |
| [Data model](./data-model.md) | Tables, columns, module links, and how to query them. |
| [Recipes](./recipes.md) | Running the workflows yourself, using the service directly, and extending the plugin. |
| [Troubleshooting](./troubleshooting.md) | Why nothing sent, why the numbers look wrong, and how to test quickly. |

## For coding agents

[`AGENTS.md`](../AGENTS.md) at the repo root is the machine-oriented version of these pages: the
exhaustive option schema, the constraints that throw at boot, a deterministic verification sequence,
and the failure modes that are silent. It also documents the repository's invariants for anyone
changing the plugin itself.

## Quick orientation

The plugin is four moving parts:

1. A **scheduled sweep** finds carts that have gone quiet and records each one in the
   `abandoned_cart` table.
2. The same sweep sends whichever **stage** of your reminder sequence is now due, through Medusa's
   Notification Module.
3. Each reminder carries a **recovery link**. When a shopper follows it, the storefront exchanges the
   token for a cart id and the click is recorded.
4. An **`order.placed` subscriber** attributes the resulting order back to the cart, which is what
   turns the table into a recovery report.

Read [How it works](./how-it-works.md) for the detail behind each of those.
