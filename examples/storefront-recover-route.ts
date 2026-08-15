/**
 * Next.js Starter Storefront — cart recovery route.
 *
 * Copy to `src/app/[countryCode]/(main)/cart/recover/[token]/route.ts`.
 *
 * It exchanges the token from the recovery email for a cart id, sets the
 * storefront's cart cookie, and drops the shopper back on the cart page. The
 * exchange also records the click on the backend, which is what makes the
 * "returned" number in the admin dashboard real.
 *
 * The matching plugin option is:
 *   recoveryPath: "/cart/recover/{token}"   // the default
 */
import { NextRequest } from "next/server"
import { notFound, redirect } from "next/navigation"

// Provided by the Next.js Starter Storefront.
import { setCartId } from "../../../../../../lib/data/cookies"

type Params = Promise<{ token: string; countryCode: string }>

type RecoverResponse = {
  cart_id: string
  completed: boolean
}

export async function GET(req: NextRequest, { params }: { params: Params }) {
  const { token, countryCode } = await params

  const backendUrl =
    process.env.MEDUSA_BACKEND_URL || "http://localhost:9000"
  const publishableKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY

  const response = await fetch(
    `${backendUrl}/store/abandoned-carts/${encodeURIComponent(token)}`,
    {
      headers: publishableKey
        ? { "x-publishable-api-key": publishableKey }
        : undefined,
      cache: "no-store",
    }
  )

  if (!response.ok) {
    return notFound()
  }

  const { cart_id, completed } = (await response.json()) as RecoverResponse

  // The shopper already checked out on another device — don't resurrect it.
  if (completed) {
    redirect(`/${countryCode}`)
  }

  setCartId(cart_id)

  redirect(`/${countryCode}/cart`)
}
