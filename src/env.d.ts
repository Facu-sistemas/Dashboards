/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly ODOO_URL: string;
  readonly ODOO_DB: string;
  readonly ODOO_USER_EMAIL: string;
  readonly ODOO_API_KEY: string;
  readonly ODOO_UID?: string;
  readonly ODOO_CACHE_TTL_MS?: string;
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_ANON_KEY: string;
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Usuario {
  id: string;
  username: string;
  rol: 'dev' | 'usuario';
  /** area_slug values from areas.config.ts this user can see — every slug when rol is 'dev'. */
  areasPermitidas: string[];
}

declare namespace App {
  interface Locals {
    /** Set by src/middleware.ts for every request that reaches a page — absent only on /login, /404, and the auth API routes. */
    usuario?: Usuario;
  }
}
