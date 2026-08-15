# Storefront integration

A reminder is only useful if the button works. This page covers the one route your storefront needs.

## The flow

```text
email link                storefront route              Medusa
──────────                ────────────────              ──────
/cart/recover/{token} ──► GET /store/abandoned-carts/{token} ──► { cart_id, completed }
                          set cart cookie                        (records the click)
                          redirect to /cart
```

The token is opaque and random (24 bytes, base64url), stored on the tracked cart, and unique per
cart. It is **not** the cart id, and it doesn't expire on its own.

## The endpoint

```text
GET /store/abandoned-carts/:token
x-publishable-api-key: pk_…
```

```json
{
  "cart_id": "cart_01J…",
  "completed": false
}
```

- **404** if the token doesn't match a tracked cart, or the cart no longer exists.
- **`completed: true`** means the cart already became an order — usually the shopper checked out on
  another device after the email went out. Send them somewhere sensible rather than restoring a dead
  cart.

The call also marks the tracked cart `recovered` and stamps `recovered_at`. It's idempotent: opening
the link twice keeps the first timestamp, and the numbers in the admin don't inflate.

Like every `/store` route, it needs the `x-publishable-api-key` header.

## Next.js Starter Storefront

Copy [`examples/storefront-recover-route.ts`](../examples/storefront-recover-route.ts) to
`src/app/[countryCode]/(main)/cart/recover/[token]/route.ts`:

```ts
import { NextRequest } from "next/server"
import { notFound, redirect } from "next/navigation"
import { setCartId } from "../../../../../../lib/data/cookies"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; countryCode: string }> }
) {
  const { token, countryCode } = await params

  const response = await fetch(
    `${process.env.MEDUSA_BACKEND_URL}/store/abandoned-carts/${encodeURIComponent(token)}`,
    {
      headers: {
        "x-publishable-api-key": process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
      },
      cache: "no-store",
    }
  )

  if (!response.ok) {
    return notFound()
  }

  const { cart_id, completed } = await response.json()

  if (completed) {
    redirect(`/${countryCode}`)
  }

  setCartId(cart_id)
  redirect(`/${countryCode}/cart`)
}
```

`cache: "no-store"` matters — a cached response would stop recording clicks.

## Other storefronts

The shape is the same everywhere: exchange the token, persist the cart id however your storefront
does it, redirect.

### Remix / React Router

```ts
export async function loader({ params }: LoaderFunctionArgs) {
  const res = await fetch(`${BACKEND_URL}/store/abandoned-carts/${params.token}`, {
    headers: { "x-publishable-api-key": PUBLISHABLE_KEY },
  })

  if (!res.ok) throw new Response("Not found", { status: 404 })

  const { cart_id, completed } = await res.json()

  return redirect(completed ? "/" : "/cart", {
    headers: { "Set-Cookie": await cartCookie.serialize(cart_id) },
  })
}
```

### Client-side only (SPA)

```ts
const { cart_id, completed } = await sdk.client.fetch(`/store/abandoned-carts/${token}`)

if (completed) {
  navigate("/")
} else {
  localStorage.setItem("cart_id", cart_id)
  navigate("/cart")
}
```

Prefer a server-side redirect where you can — it keeps the token out of the browser history of the
cart page and works with email clients that prefetch links.

## Customising the link

`recoveryPath` is a template appended to `storefrontUrl`:

```ts
options: {
  storefrontUrl: "https://shop.example.com",
  recoveryPath: "/en/recover?token={token}",   // → https://shop.example.com/en/recover?token=9f3aK2…
}
```

`{token}` and `{cart_id}` are both substituted, and both are URL-encoded. Passing `{cart_id}` lets a
storefront restore the cart without calling the endpoint at all — but then the click isn't recorded
and your recovery rate stays at zero, so use it only alongside the token.

Without `storefrontUrl`, `recovery_url` is `null` and the template gets the raw `token` to build its
own link.

## Security notes

- **The token grants access to a cart, not an account.** Anyone with the link can view and modify
  that cart, exactly as if they had the cart id. That's the same exposure as any "return to cart"
  link, but it's worth knowing before you put one in an email.
- **Tokens don't expire.** They stop being useful once the cart is completed (`completed: true`) or
  deleted. If you need hard expiry, dismiss old records on a schedule — see
  [Recipes](./recipes.md#expire-old-records).
- **Don't log the full recovery URL** anywhere shoppers' support tickets end up.
- The endpoint returns only `cart_id` and `completed`. Fetch the cart itself through the normal
  `/store/carts/:id` route, which applies the usual publishable-key scoping.
