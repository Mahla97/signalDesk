/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute origin of the backend API, baked in at build time.
   * Empty (unset) for the web build, which shares an origin with the API.
   */
  readonly VITE_API_BASE_URL?: string;
  /**
   * Secret path of the admin panel (e.g. `/ops-…`). When unset the admin panel
   * is not routed at all — leave it unset for the Android build.
   */
  readonly VITE_ADMIN_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
