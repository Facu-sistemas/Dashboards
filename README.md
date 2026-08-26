# Dashboards

Dashboard de solo lectura para Frontera Living S.A. Muestra el KPI **% Cumplimiento del
Presupuesto de Compras** (real vs. presupuestado por categoría y mes), consumiendo datos
en vivo desde Odoo 17 vía JSON-RPC.

Astro (SSR) + React + Tailwind + Recharts. Ver `src/lib/odoo/purchase-budget.ts` para la
lógica de negocio y las decisiones no obvias documentadas ahí (monedas, matching de
presupuesto, etc.).

## Setup

```bash
npm install
cp .env.example .env   # completar ODOO_URL, ODOO_DB, ODOO_USER_EMAIL, ODOO_API_KEY
npm run dev
```
