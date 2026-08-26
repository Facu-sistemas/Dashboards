/**
 * Server-only environment accessor. Importing this from a client component
 * would throw at build time because `import.meta.env.ODOO_API_KEY` is never
 * inlined into client bundles (it's not prefixed PUBLIC_), so any accidental
 * client import fails loudly instead of leaking the key silently.
 */
export interface OdooServerConfig {
  url: string;
  db: string;
  userEmail: string;
  apiKey: string;
  uid?: number;
  cacheTtlMs: number;
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required env var "${name}". Copy .env.example to .env and fill it in.`
    );
  }
  return value;
}

let cached: OdooServerConfig | undefined;

export function getOdooConfig(): OdooServerConfig {
  if (cached) return cached;

  const env = import.meta.env;
  cached = {
    url: required('ODOO_URL', env.ODOO_URL).replace(/\/+$/, ''),
    db: required('ODOO_DB', env.ODOO_DB),
    userEmail: required('ODOO_USER_EMAIL', env.ODOO_USER_EMAIL),
    apiKey: required('ODOO_API_KEY', env.ODOO_API_KEY),
    uid: env.ODOO_UID ? Number(env.ODOO_UID) : undefined,
    cacheTtlMs: env.ODOO_CACHE_TTL_MS ? Number(env.ODOO_CACHE_TTL_MS) : 15_000,
  };
  return cached;
}
