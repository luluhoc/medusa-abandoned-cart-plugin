# Getting started

This guide takes you from an empty Medusa project to a reminder landing in your inbox.

## Prerequisites

- A Medusa v2 application (**v2.19.0 or later**).
- A Notification Module Provider for the channel you want to send on. The examples below use
  SendGrid; any provider works, including [your own](https://docs.medusajs.com/references/notification-provider-module).
- A storefront that can handle the recovery link. Optional to start — reminders send fine without
  one, they just won't have a working "return to cart" button.

## 1. Install

```bash
yarn add medusa-plugin-abandoned-cart
```

## 2. Register a notification provider

The plugin sends notifications; it does not deliver them. That's the Notification Module's job, and
it needs a provider registered for your channel (`email` by default).

```ts title="medusa-config.ts"
module.exports = defineConfig({
  // ...
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
})
```

If you skip this step, every send fails with `No provider found for channel: email` — recorded on the
cart, retried on the next sweep, and visible in the admin.

## 3. Create an email template

Create a template in your provider and note its id. There's a ready-to-paste HTML template in
[`examples/abandoned-cart-email.html`](../examples/abandoned-cart-email.html), and the full list of
variables it can use is in [Notifications](./notifications.md).

For SendGrid, that's a [dynamic template](https://mc.sendgrid.com/dynamic-templates) and the id looks
like `d-1a2b3c…`.

## 4. Register the plugin

```ts title="medusa-config.ts"
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "medusa-plugin-abandoned-cart",
      options: {
        storefrontUrl: process.env.STOREFRONT_URL,
        stages: [
          { id: "reminder-1", delay: "4h", template: "d-1a2b3c…" },
          { id: "last-call", delay: "2d", template: "d-4d5e6f…" },
        ],
      },
    },
  ],
})
```

Every option is documented in [Configuration](./configuration.md). The two that matter most on day
one are `stages` (when to send what) and `storefrontUrl` (so the recovery link resolves).

## 5. Run the migrations

```bash
yarn medusa db:migrate
```

This creates the `abandoned_cart` and `abandoned_cart_notification` tables.

## 6. Add the storefront route

The reminder links to `{storefrontUrl}/cart/recover/{token}`. Your storefront exchanges that token
for a cart id and sets its cart cookie. For the Next.js Starter Storefront, copy
[`examples/storefront-recover-route.ts`](../examples/storefront-recover-route.ts) to
`src/app/[countryCode]/(main)/cart/recover/[token]/route.ts`.

See [Storefront integration](./storefront.md) for other stacks.

## 7. Confirm it works

Start the application and open **Abandoned carts** in the admin sidebar (`/app/abandoned-carts`).

For a fast first test, shorten everything temporarily:

```ts title="medusa-config.ts"
options: {
  stages: [{ delay: "1m", template: "d-1a2b3c…" }],
  maxAge: "1d",
}
```

```bash title=".env"
ABANDONED_CART_CRON="* * * * *"
```

Then:

1. Add an item to a cart in your storefront.
2. Enter an email address at checkout — the plugin only chases carts it can reach.
3. Wait a minute or two, or hit **Run sweep** in the admin to skip the wait.

You should see a log line:

```text
info: [abandoned-cart] swept 1 carts — 1 new, 0 refreshed, 1 notified, 0 failed, 0 closed
```

…the cart in the admin table with status `notified`, and the email in your inbox.

**Revert the test settings when you're done.** A one-minute delay in production will email people
who stepped away to find their wallet.

## What next

- [Configuration](./configuration.md) — tune the sequence, thresholds and filters.
- [How it works](./how-it-works.md) — understand the timing model before you tune it.
- [Troubleshooting](./troubleshooting.md) — if nothing arrived.
