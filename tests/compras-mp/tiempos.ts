// Mide cuánto tarda cada tramo de una corrida (para decidir dónde partirla). No deja nada guardado.
import { tomarInstantanea, guardarRaw, abrirCorrida } from '../../src/lib/compras-mp/odoo/instantanea';
import { calcularDesdeInstantanea } from '../../src/lib/compras-mp/corrida';
import { getSupabaseAdminClient } from '../../src/lib/supabase/admin';
const t = (inicio: number) => `${((Date.now() - inicio) / 1000).toFixed(1)} s`;
let i = Date.now(); const snap = await tomarInstantanea(); console.log('leer Odoo           ', t(i));
i = Date.now(); const id = await abrirCorrida('manual', snap.fechaDatos, 'tiempos'); await guardarRaw(id, snap); console.log('guardar fotos crudas', t(i));
i = Date.now(); await calcularDesdeInstantanea(snap); console.log('calcular            ', t(i));
await getSupabaseAdminClient().from('compras_corridas').delete().eq('id', id);
