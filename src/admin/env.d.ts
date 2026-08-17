/**
 * Admin extensions are bundled by Vite, which injects `import.meta.env`.
 * The plugin's own tsconfig targets the server (CommonJS), so these types are
 * declared here rather than pulled from `vite/client`.
 */
interface ImportMetaEnv {
  readonly DEV: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/**
 * Globals the admin bundler defines at build time from the host application's
 * configuration. A plugin cannot read the host's `.env` directly, so these are
 * the supported way to learn where the backend is and how it authenticates.
 */
declare const __BACKEND_URL__: string
declare const __BASE__: string
declare const __AUTH_TYPE__: "session" | "jwt"
declare const __JWT_TOKEN_STORAGE_KEY__: string
