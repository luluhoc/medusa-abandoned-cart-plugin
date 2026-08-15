/**
 * Admin extensions are bundled by Vite, which injects `import.meta.env`.
 * The plugin's own tsconfig targets the server (CommonJS), so these types are
 * declared here rather than pulled from `vite/client`.
 */
interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string
  readonly DEV: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
