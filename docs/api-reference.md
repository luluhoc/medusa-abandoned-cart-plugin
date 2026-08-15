# API reference

## Authentication

- **Store routes** require the `x-publishable-api-key` header, like every other `/store` route.
- **Admin routes** use the dashboard's normal authentication — a session cookie, a JWT, or an API
  key. The plugin adds no authentication of its own.

---

## Store

### `GET /store/abandoned-carts/:token`

Exchanges a recovery token for a cart id and records the click. Idempotent — the first
`recovered_at` timestamp is kept.

**Response `200`**

```json
{
  "cart_id": "cart_01J…",
  "completed": false
}
```

| Field | Type | Description |
| --- | --- | --- |
| `cart_id` | `string` | The cart to restore. |
| `completed` | `boolean` | `true` when the cart already became an order — don't restore it. |

**Errors** — `404` when the token is unknown or the cart no longer exists.

```bash
curl "$MEDUSA_URL/store/abandoned-carts/9f3aK2…" \
  -H "x-publishable-api-key: $PUBLISHABLE_KEY"
```

---

## Admin

### `GET /admin/abandoned-carts`

Paginated list of tracked carts.

**Query parameters**

| Parameter | Type | Description |
| --- | --- | --- |
| `status` | `string \| string[]` | One or more of `pending`, `notified`, `recovered`, `converted`, `dismissed`, `expired`. |
| `email` | `string` | Exact match. |
| `cart_id` | `string` | Exact match. |
| `customer_id` | `string` | Exact match. |
| `fields` | `string` | Comma-separated field selection, including relations (`+notifications.*`). |
| `order` | `string` | Sort field; prefix with `-` for descending (`-cart_updated_at`). |
| `limit` | `number` | Default `20`. |
| `offset` | `number` | Default `0`. |

**Response `200`**

```json
{
  "abandoned_carts": [
    {
      "id": "abcart_01J…",
      "cart_id": "cart_01J…",
      "email": "shopper@example.com",
      "customer_id": "cus_01J…",
      "sales_channel_id": "sc_01J…",
      "currency_code": "usd",
      "item_count": 2,
      "subtotal": 129.5,
      "status": "notified",
      "stage_index": 1,
      "cart_updated_at": "2026-08-14T12:00:00.000Z",
      "last_notified_at": "2026-08-14T13:00:12.000Z",
      "recovered_at": null,
      "converted_at": null,
      "order_id": null,
      "created_at": "2026-08-14T13:00:12.000Z",
      "updated_at": "2026-08-14T13:00:12.000Z"
    }
  ],
  "count": 137,
  "limit": 20,
  "offset": 0
}
```

Those are the default fields. Use `fields` to ask for more — `?fields=*,notifications.*,cart.total`
— or fewer.

```bash
curl "$MEDUSA_URL/admin/abandoned-carts?status=notified&order=-cart_updated_at&limit=50" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### `GET /admin/abandoned-carts/stats`

Funnel counts, rates, recovered value, and the configured sequence.

**Query parameters**

| Parameter | Type | Description |
| --- | --- | --- |
| `days` | `number` | Only count carts detected in the last N days. Omit for all time. |

**Response `200`**

```json
{
  "stats": {
    "counts": {
      "pending": 12,
      "notified": 84,
      "recovered": 19,
      "converted": 11,
      "dismissed": 2,
      "expired": 9
    },
    "total": 137,
    "notified": 123,
    "recovery_rate": 0.2439,
    "conversion_rate": 0.0894,
    "recovered_value": [{ "currency_code": "usd", "amount": 2841.5 }]
  },
  "config": {
    "enabled": true,
    "stages": [
      { "id": "reminder-1", "delay_ms": 3600000, "template": "d-1a2b3c", "channel": "email" }
    ]
  }
}
```

| Field | Meaning |
| --- | --- |
| `counts` | Rows per status. |
| `total` | All tracked carts in the window. |
| `notified` | Carts that received at least one reminder — `notified + recovered + converted + expired`. |
| `recovery_rate` | `(recovered + converted) / notified`. Carts that came back. |
| `conversion_rate` | `converted / notified`. Carts that bought. |
| `recovered_value` | Summed subtotal of converted carts, per currency. |

> `recovered_value` sums at most **1000** converted carts per currency window. Past that, use the
> list route with `status=converted` and aggregate yourself, or query the table directly.

### `GET /admin/abandoned-carts/:id`

One record with its notifications, cart, customer and order.

**Response `200`**

```json
{
  "abandoned_cart": {
    "id": "abcart_01J…",
    "status": "notified",
    "stage_index": 1,
    "notifications": [
      {
        "id": "abcartnotif_01J…",
        "stage_id": "reminder-1",
        "stage_index": 0,
        "channel": "email",
        "template": "d-1a2b3c",
        "to": "shopper@example.com",
        "notification_id": "noti_01J…",
        "error": null,
        "sent_at": "2026-08-14T13:00:12.000Z"
      }
    ],
    "cart": { "id": "cart_01J…", "items": [] },
    "customer": { "id": "cus_01J…" },
    "order": null
  }
}
```

**Errors** — `404` when the id is unknown.

### `POST /admin/abandoned-carts/:id`

Update a record. Rejects unknown fields.

**Body**

| Field | Type | Description |
| --- | --- | --- |
| `status` | `string` | Any status. `dismissed` stops the sequence permanently. |
| `metadata` | `object` | Free-form. |

**Response `200`** — `{ "abandoned_cart": { … } }`

```bash
curl -X POST "$MEDUSA_URL/admin/abandoned-carts/abcart_01J…" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "dismissed"}'
```

### `POST /admin/abandoned-carts/:id/send`

Send this cart's next stage now, ignoring its delay.

**Body**

| Field | Type | Description |
| --- | --- | --- |
| `stage_id` | `string` | Send this stage instead of the next one. Useful for re-sending. |

**Response `200`**

```json
{
  "result": {
    "sent": 1,
    "failed": 0,
    "closed": 0,
    "notification_ids": ["abcartnotif_01J…"]
  }
}
```

`sent: 0` with `closed: 0` means there was nothing to send — the sequence is finished, or the cart is
`converted`. `closed: 1` means the cart was stale and got closed out instead.

**Errors** — `404` when the id is unknown; `400` when `stage_id` doesn't match a configured stage.

### `POST /admin/abandoned-carts/sweep`

Run detection and sending immediately instead of waiting for the cron. Runs even when
`enabled: false`.

**Query parameters**

| Parameter | Type | Description |
| --- | --- | --- |
| `notify` | `"false"` | Detect only — refresh tracked carts without sending anything. |

**Response `200`**

```json
{
  "sweep": {
    "scanned": 240,
    "created": 12,
    "updated": 31,
    "sent": 9,
    "failed": 1,
    "closed": 2
  }
}
```

| Field | Meaning |
| --- | --- |
| `scanned` | Carts returned by the detection query, before the in-memory thresholds. |
| `created` | New tracking records. |
| `updated` | Existing records whose snapshot changed. |
| `sent` | Reminders accepted by the provider. |
| `failed` | Reminders the provider rejected. These retry on the next sweep. |
| `closed` | Stale carts closed out as `expired` or `converted`. |

The request runs the full sweep synchronously, so on a large catalogue of carts it can take a while.
It's bounded at 200 detection pages and 10 notification rounds.

```bash
curl -X POST "$MEDUSA_URL/admin/abandoned-carts/sweep?notify=false" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## Admin UI

The dashboard page is at **`/app/abandoned-carts`** — funnel stats, a filterable table, and per-row
**Send now** / **Dismiss** actions. It's built on the routes above, so anything it can do, your own
tooling can do too.
