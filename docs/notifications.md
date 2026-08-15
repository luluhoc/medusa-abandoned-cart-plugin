# Notifications

The plugin builds a payload and hands it to Medusa's Notification Module. The module routes it to
whichever provider is registered for the stage's `channel`, and the provider renders your template.

```ts
{
  to:       "shopper@example.com",  // record.email, falling back to cart.email
  channel:  "email",                // stage.channel
  template: "d-1a2b3c…",            // stage.template — the provider's template id
  data:     { /* below */ },
}
```

## Payload reference

```jsonc
{
  "stage": { "id": "reminder-1", "index": 0 },

  "cart_id": "cart_01J…",
  "token": "9f3aK2…",
  "recovery_url": "https://shop.com/cart/recover/9f3aK2…",  // null without `storefrontUrl`
  "email": "shopper@example.com",
  "currency_code": "usd",

  "customer": {
    "first_name": "Ada",          // cart.customer, falling back to the shipping address
    "last_name": "Lovelace",
    "email": "shopper@example.com"
  },

  "item_count": 2,
  "subtotal": 129.5,              // sum of unit_price × quantity, cart currency

  "items": [
    {
      "id": "li_01J…",
      "product_title": "Medusa T-Shirt",
      "title": "Medusa T-Shirt",
      "subtitle": "Shirts",
      "variant_title": "L / Black",
      "quantity": 1,
      "unit_price": 29.5,
      "total": 29.5,
      "thumbnail": "https://…"
    }
  ]
}
```

Plus, merged in at the top level and in this order:

1. `notificationData` from the plugin options,
2. the stage's own `data`,
3. everything above.

So a stage's `data` overrides `notificationData`, and neither can shadow the built-in fields.

### Field notes

- **`subtotal` and `unit_price` are decimals in the cart's currency**, not minor units. Medusa v2
  stores `29.5`, not `2950`. Don't divide by 100.
- **`subtotal` excludes shipping, taxes and promotions.** It's the sum of the line items, which is
  what you want in a "here's what's in your cart" email. If you need the full total, fetch the cart
  yourself — see [Recipes](./recipes.md#add-data-to-every-email).
- **`recovery_url` is `null` when `storefrontUrl` isn't set.** Templates should either guard on it or
  build their own link from `token`.
- **`customer.first_name` falls back to the shipping address**, so guest carts that got as far as
  the address step still personalise correctly. It can still be undefined — always guard.

## Templates

A complete, provider-agnostic HTML email lives in
[`examples/abandoned-cart-email.html`](../examples/abandoned-cart-email.html). It's written for
Handlebars-style syntax (SendGrid dynamic templates, Postmark, Mailgun).

The essential parts:

```handlebars
<h1>{{#if customer.first_name}}{{customer.first_name}}, your{{else}}Your{{/if}} cart is still here</h1>

{{#each items}}
  <img src="{{thumbnail}}" alt="{{product_title}}" />
  <strong>{{product_title}}</strong>
  {{#if variant_title}}<span>{{variant_title}}</span>{{/if}}
  <span>Qty {{quantity}} · {{unit_price}}</span>
{{/each}}

<a href="{{recovery_url}}">Return to my cart</a>
```

### Per-stage content

Give each stage its own template id when the emails differ structurally, and use `data` when only
the details change:

```ts
stages: [
  { id: "reminder-1", delay: "1h",  template: "d-reminder" },
  { id: "reminder-2", delay: "24h", template: "d-reminder" },
  { id: "last-call",  delay: "3d",  template: "d-reminder",
    data: { urgency: "high", discount_code: "COMEBACK10" } },
]
```

```handlebars
{{#if discount_code}}
  <p>Use <strong>{{discount_code}}</strong> for 10% off — today only.</p>
{{/if}}
```

You can also branch on `stage.id` inside a single template, which keeps the sequence in one place at
the cost of a busier template.

## Providers

Any [Notification Module Provider](https://docs.medusajs.com/resources/infrastructure-modules/notification)
works. `template` means whatever that provider says it means.

| Provider | What `template` is |
| --- | --- |
| SendGrid | The dynamic template id, `d-…`. |
| Resend (community) | Usually the name of a React Email component. |
| Custom provider | Whatever you switch on in `send()`. |

### Writing a custom provider

If you render emails in code rather than in a SaaS dashboard, a
[custom provider](https://docs.medusajs.com/references/notification-provider-module) receives the
whole payload:

```ts
async send(notification: ProviderSendNotificationDTO) {
  const { template, to, data } = notification

  if (template === "abandoned-cart") {
    const html = renderAbandonedCartEmail(data)   // your renderer
    await this.mailer.send({ to, subject: "Your cart is waiting", html })
  }

  return {}
}
```

## Subject lines and sender

The plugin doesn't set a subject or a from-address — those belong to the provider or the template.
For SendGrid, the subject lives in the dynamic template (and can reference `data`). For a custom
provider, derive it from `template` and `data` as above.

## Delivery records

Every attempt is written to `abandoned_cart_notification`:

| Column | Meaning |
| --- | --- |
| `stage_id`, `stage_index` | Which stage this was. |
| `channel`, `template`, `to` | What was sent, where. |
| `notification_id` | The Notification Module's record id, when the send succeeded. |
| `error` | The provider's error message, when it didn't. |
| `sent_at` | Timestamp on success; `null` on failure. |

Failures don't advance the sequence, so the same stage is retried on the next sweep. See
[How it works](./how-it-works.md#a-send-fails).
