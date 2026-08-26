/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly ODOO_URL: string;
  readonly ODOO_DB: string;
  readonly ODOO_USER_EMAIL: string;
  readonly ODOO_API_KEY: string;
  readonly ODOO_UID?: string;
  readonly ODOO_CACHE_TTL_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
