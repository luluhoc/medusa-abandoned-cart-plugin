# Localization

A recovery email in the wrong language is worse than no email. This page covers how the plugin
decides which language a cart is chased in, and the four things that language then changes: the
template, the payload data, the recovery link, and the reporting.

Nothing here is on by default. A store that never sets a locale option keeps sending exactly what it
sent before, with `locale: null` in the payload.

## The short version

```ts title="medusa-config.ts"
options: {
  storefrontUrl: "https://shop.com",

  locales: ["en", "fr", "de"],
  defaultLocale: "en",

  // Where a French shopper's link should point.
  recoveryPath: "/{lang}/cart/recover/{token}",

  stages: [
    {
      id: "reminder",
      delay: "4h",
      template: "d-reminder-en",
      templates: { fr: "d-reminder-fr", de: "d-reminder-de" },
    },
  ],
}
```

A cart carrying `metadata.locale = "fr"` now gets `d-reminder-fr` and a link to
`https://shop.com/fr/cart/recover/…`. A cart with nothing set gets `d-reminder-en` and `/en/…`,
because `defaultLocale` is `"en"`.

## Locale tags

Tags are BCP 47-ish: a language, optionally a script or region — `"en"`, `"fr-CA"`, `"pt-BR"`,
`"zh-Hans"`. They are normalized before anything else happens, so `"FR_ca"`, `"fr-ca"` and `"fr-CA"`
are the same locale. The canonical spelling (`fr-CA`) is what gets stored and passed to templates.

Every lookup walks a **fallback chain**, most specific first: `zh-Hans-CN` → `zh-Hans` → `zh`. One
`fr` template therefore serves `fr`, `fr-CA` and `fr-BE` shoppers until you decide otherwise.

## `locales` — the supported set

```ts
locales: ["en", "fr", "de-AT"]
```

Setting it does three things:

1. **Constrains resolution.** A cart asking for `it` gets `defaultLocale` instead, so a stray
   metadata value can't route a shopper to a template that doesn't exist. A cart asking for `fr-CA`
   gets `fr` — the base language is close enough.
2. **Validates the rest of your config at boot.** Every locale-keyed option is checked against the
   list, so `templates: { fr: …, de: …, ge: … }` throws instead of quietly never firing.
3. **Unlocks `templatePattern` and the per-locale stats breakdown**, both of which need a bounded set
   of locales to work with.

Leave it unset and the plugin accepts any well-formed tag it finds. That's fine when a custom
notification provider does its own translation and just needs `locale` passed through.

## How a cart's locale is resolved

First match wins:

| # | Source | Notes |
| --- | --- | --- |
| 1 | `resolveLocale(context)` | Your own function. Return `null`/`undefined` to fall through. |
| 2 | `cart.metadata[localeMetadataKey]` | Default key: `"locale"`. The one to prefer — see below. |
| 3 | `customer.metadata[localeMetadataKey]` | An account-level language preference. |
| 4 | `localeByCountry[shipping_address.country_code]` | Most specific of the three maps. |
| 5 | `localeByRegion[region_id]` | |
| 6 | `localeBySalesChannel[sales_channel_id]` | For one-storefront-per-channel setups. |
| 7 | `defaultLocale` | |

If none of them produce a supported locale, the cart's locale is `null`: the stage's plain
`template` is used and `locale` is `null` in the payload.

### Writing the locale onto the cart

The metadata route is the accurate one, because the storefront knows which language the shopper was
actually reading. Set it when the cart is created or when the language switcher is used:

```ts title="storefront"
await sdk.store.cart.update(cartId, { metadata: { locale: "fr-CA" } })
```

Everything else — country, region, sales channel — is an inference. Useful as a backstop, wrong for
the Brussels shopper browsing in English.

### Mapping instead

```ts
options: {
  locales: ["en", "fr", "nl"],
  defaultLocale: "en",
  localeByCountry: { be: "nl", fr: "fr", ca: "fr" },
  localeByRegion: { reg_01JEUROPE: "fr" },
  localeBySalesChannel: { sc_01JFRSHOP: "fr" },
}
```

Keys are matched case-insensitively. Values must be in `locales`, so a typo throws at boot.

### Your own rule

```ts
options: {
  locales: ["en", "fr"],
  resolveLocale: (context) => {
    if (typeof context.cart_metadata?.language === "string") {
      return context.cart_metadata.language
    }

    return context.email?.endsWith(".fr") ? "fr" : null
  },
}
```

The function is synchronous and runs once per cart per sweep — keep it cheap, and don't reach for the
database in it. The context it receives:

```ts
type AbandonedCartLocaleContext = {
  cart_id: string | null
  email: string | null
  customer_id: string | null
  region_id: string | null
  sales_channel_id: string | null
  country_code: string | null       // from the shipping address
  currency_code: string | null
  cart_metadata: Record<string, unknown> | null
  customer_metadata: Record<string, unknown> | null
}
```

Returning an unsupported tag is not an error — it just falls through to the next source.

### When it is resolved

Twice. Detection stores a locale on the tracking record, and **the notification pass resolves it
again against the live cart** just before sending, so a shopper who switched language after
abandoning gets the language they last used. The stored value is the fallback if nothing resolves
the second time, and it is overwritten with whatever was actually sent.

## Picking the template

Most specific first:

1. the stage's own `templates[locale]`,
2. the top-level `templates[locale]`,
3. `templatePattern` applied to the stage's `template`,
4. the stage's `template`, untranslated.

Step 4 is the safety net: a locale you haven't translated yet still gets an email, in the default
language, rather than nothing.

### Per-stage maps

Best when template ids are opaque, which is the normal case for SendGrid:

```ts
stages: [
  { id: "reminder-1", delay: "1h",  template: "d-1en", templates: { fr: "d-1fr", de: "d-1de" } },
  { id: "last-call",  delay: "3d",  template: "d-2en", templates: { fr: "d-2fr", de: "d-2de" } },
]
```

### A top-level map

When the same template serves every stage and only the language differs:

```ts
options: {
  locales: ["en", "fr"],
  template: "abandoned-cart",
  templates: { fr: "abandoned-cart-fr" },
}
```

### A pattern

When template ids are names you control — a custom provider, or React Email components:

```ts
options: {
  locales: ["en", "fr", "de"],
  templatePattern: "{template}-{lang}",
  stages: [{ delay: "4h", template: "abandoned-cart" }],
}
// → abandoned-cart-en, abandoned-cart-fr, abandoned-cart-de
```

`{template}` is the stage's template, `{locale}` the full tag (`fr-CA`), `{lang}` just the language
(`fr`). The pattern requires `locales`, and must contain `{locale}` or `{lang}` — both throw at boot
otherwise. An explicit entry in either `templates` map always wins over the pattern, which is how you
handle the one language whose template id doesn't follow the convention.

## Per-locale data

`localeData` adds to the payload's `data` per locale, at the top level and per stage. The merge order
is:

1. `notificationData`
2. `localeData[locale]`
3. the stage's `data`
4. the stage's `localeData[locale]`
5. the built-in fields, which nothing can shadow

```ts
options: {
  locales: ["en", "fr"],
  notificationData: { support_email: "help@shop.com" },
  localeData: {
    fr: { support_email: "aide@shop.com", unsubscribe_label: "Se désabonner" },
  },
  stages: [
    {
      delay: "3d",
      template: "d-last-call",
      data: { discount_code: "COMEBACK10" },
      localeData: { fr: { discount_code: "REVIENS10" } },
    },
  ],
}
```

Use it for the handful of strings that live outside the template — a subject line the provider reads
from `data`, a legal footer, a locale-specific discount code. Don't use it to translate the email
body; that belongs in the template.

## Localized recovery links

Two options, both keyed by locale and both falling back to their unlocalized counterparts:

```ts
options: {
  // Path prefix — one domain, /fr/… and /de/… routes.
  storefrontUrl: "https://shop.com",
  recoveryPath: "/{lang}/cart/recover/{token}",
}
```

```ts
options: {
  // Domain per language.
  storefrontUrl: "https://shop.com",
  storefrontUrlByLocale: { fr: "https://shop.fr", de: "https://shop.de" },
  recoveryPath: "/cart/recover/{token}",
}
```

```ts
options: {
  // A path that isn't just a prefix swap.
  recoveryPath: "/cart/recover/{token}",
  recoveryPathByLocale: { fr: "/panier/recuperer/{token}" },
}
```

`{token}`, `{cart_id}`, `{locale}` and `{lang}` are all substituted. When a cart has no locale,
`{locale}` and `{lang}` collapse to nothing and the resulting `//` is squashed — so
`"/{lang}/cart/recover/{token}"` degrades to `"/cart/recover/…"` instead of emitting a literal
`{lang}`. If your storefront can't serve that unprefixed path, set `defaultLocale` so every cart has
one.

## In the payload

Two fields, on every send:

```jsonc
{
  "locale": "fr-CA",   // the resolved tag, or null
  "language": "fr"     // its base language, or null
}
```

A provider that renders in code can use them directly instead of keying off `template`:

```ts
async send({ template, to, data }: ProviderSendNotificationDTO) {
  const t = translations[data.language as string] ?? translations.en

  await this.mailer.send({ to, subject: t.subject, html: render(template, data, t) })
}
```

## In the data and the admin

`abandoned_cart.locale` holds the locale the cart is being chased in;
`abandoned_cart_notification.locale` holds the one each individual attempt actually went out in. They
differ when a shopper switched language mid-sequence, which is exactly the case you want visible in
the audit trail.

Filter the list route by it:

```bash
curl "$BACKEND/admin/abandoned-carts?locale=fr" -H "Authorization: Bearer $TOKEN"
```

`GET /admin/abandoned-carts/stats` returns a `by_locale` breakdown — total, notified and converted
per configured locale — so you can see which language is actually recovering carts. It's populated
only when `locales` is set; without that list there's no bounded set to count over.

The admin page grows a **Locale** column and a locale filter as soon as `locales` is configured, and
hides both when it isn't.

To re-send a reminder in a different language:

```bash
curl -X POST "$BACKEND/admin/abandoned-carts/$ID/send" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "locale": "de" }'
```

An unsupported locale is a `400` here, not a silent fallback — a manual send is a deliberate act.

## What locale does *not* change

- **Timing.** Stages, delays and `maxAge` are global. Sequences don't vary by language.
- **Channel.** A stage's `channel` is the same everywhere; only the template and the data change.
- **Detection.** Every filter — `minSubtotal`, `minItems`, `salesChannelIds` — applies to all
  locales equally. Restrict a campaign to one language with `salesChannelIds` if your channels split
  that way, or by dismissing records you don't want chased.
- **Prices.** `subtotal` and `unit_price` stay decimal numbers in the cart's currency. The plugin
  never formats them — pass `locale` and `currency_code` to `Intl.NumberFormat` in your template or
  provider.

## Validation

The plugin throws at boot if:

- a locale tag anywhere is malformed;
- `locales` contains a duplicate after normalization;
- `defaultLocale`, or a value in `localeByCountry` / `localeByRegion` / `localeBySalesChannel`, isn't
  in `locales`;
- a key in `templates`, `localeData`, `storefrontUrlByLocale`, `recoveryPathByLocale`, or a stage's
  `templates` / `localeData`, is one no configured locale would ever look up. Keys are checked
  against the fallback chain, not for equality: with `locales: ["de-AT"]` a `de` key is fine —
  `de-AT` falls back to it — but a `de-CH` key throws, because nothing reaches it;
- `templatePattern` is set without `locales`, or contains neither `{locale}` nor `{lang}`;
- `resolveLocale` isn't a function.

All of these are silent failures at runtime — a translation that never fires looks exactly like a
translation that isn't configured — so they're checked up front instead.

## See also

- [Configuration](./configuration.md#localization) — the option table.
- [Notifications](./notifications.md#localized-templates) — the payload and template side.
- [Data model](./data-model.md) — the `locale` columns.
- [Storefront integration](./storefront.md) — serving a localized recovery route.
