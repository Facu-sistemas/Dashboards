# Dashboards — Frontera Living

Sistema interno de dashboards de solo lectura para Frontera Living S.A. Consume datos en
vivo desde Odoo 17 vía JSON-RPC — nunca escribe ni modifica nada en Odoo.

Astro (SSR) + React + Tailwind + Recharts.

## Estructura

Home con una tarjeta por área de la empresa. Cada área tiene sus propios tabs internos,
con breadcrumb (Home > Área > Tab). Los tabs con filtros interactivos (período, categoría,
búsqueda) resuelven la consulta contra Odoo en el momento vía una API route — Dinamico 

### Áreas y estado actual

- **Finanzas** — Presupuesto de Compras (real vs. presupuestado por categoría y mes),
  Facturación (comparativo Banco vs. Efectivo por contacto).
- **Comercial** — Tendencia de Precios por producto (histórico mensual, con selección por
  búsqueda o lista), Top Clientes por monto facturado (con modo comparar entre dos
  clientes).
- **Manufactura** — Top 10 Productos más vendidos (Colchones / Living), Lead Time de
  Producción, Eficiencia (OEE), Consumo de Materia Prima vs. Stock.
- **Almacén** — Mapa visual del depósito (racks A-F, por nivel y columna), con detalle de
  productos y cantidades al hacer click en una ubicación. *En desarrollo.*
- **RRHH, Gerencia General, Gestión de Calidad, Mejora Continua** — Próximamente.

## Documentación

Las decisiones de diseño y los supuestos validados contra datos reales de Odoo (dominios
de filtros, categorías, campos técnicos, exclusiones) están documentados por feature en
`docs/` — son la fuente de verdad antes de tocar código en cada dashboard nuevo o
iteración.

La lógica de negocio de cada dashboard vive en `src/lib/odoo/<nombre>.ts`, con las
decisiones no obvias documentadas ahí mismo (monedas, matching de presupuesto,
exclusiones de categorías, etc.).

## Setup

```bash
npm install
cp .env.example .env   # completar ODOO_URL, ODOO_DB, ODOO_USER_EMAIL, ODOO_API_KEY
npm run dev
```