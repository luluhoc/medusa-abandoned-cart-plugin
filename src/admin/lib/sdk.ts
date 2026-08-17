import Medusa from "@medusajs/js-sdk"

/**
 * Mirrors how the Medusa dashboard builds its own client.
 *
 * `__BACKEND_URL__`, `__AUTH_TYPE__` and `__JWT_TOKEN_STORAGE_KEY__` are
 * build-time globals the admin bundler fills from the host application's
 * `admin.backendUrl` / `ADMIN_AUTH_TYPE` / `ADMIN_JWT_TOKEN_STORAGE_KEY`. They
 * are the only values that are correct when the admin is deployed on a
 * different origin than the backend — a relative base URL would send every
 * request to whatever is serving the dashboard instead of to Medusa.
 *
 * An empty `__BACKEND_URL__` means "same origin as the admin", which is the
 * default when Medusa serves the dashboard itself.
 */
const backendUrl = __BACKEND_URL__ ?? "/"
const authType = __AUTH_TYPE__ ?? "session"
const jwtTokenStorageKey = __JWT_TOKEN_STORAGE_KEY__ || undefined

export const sdk = new Medusa({
  baseUrl: backendUrl,
  debug: import.meta.env.DEV,
  auth: {
    type: authType,
    jwtTokenStorageKey,
  },
})
