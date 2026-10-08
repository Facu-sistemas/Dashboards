// Corre UNA corrida completa y la conserva (para tener datos en las pantallas). Solo lectura sobre Odoo.
// Uso: node --env-file=.env tests/compras-mp/ejecutar-con-odoo.mjs tests/compras-mp/ejecutar.ts
import { ejecutarCorrida } from '../../src/lib/compras-mp/corrida';
const r = await ejecutarCorrida({ origen: 'manual', disparadaPor: 'fase-4' });
console.log('Corrida', r.corridaId, '·', r.skus, 'SKUs · compra total', Math.round(r.totalCompra).toLocaleString('es-AR'), '· controles', r.estadoControles, '·', (r.duracionMs / 1000).toFixed(1), 's');
console.log('Inventario:', JSON.stringify(r.kpis.inventario));
