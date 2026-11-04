import { getSupabaseAdminClient } from './admin';

/**
 * Stock y movimientos de blocks por tipo y medida, cargados a mano (Odoo no sabe la medida). Una fila por día/tipo/medida,
 * como la planilla "stock de block". Tabla creada a mano en Supabase (no hay migraciones en el repo):
 *
 *   create table espumado_dia (
 *     fecha date not null,
 *     tipo text not null,
 *     medida text not null,
 *     stock_inicial integer check (stock_inicial >= 0),  -- null = arrastra el final del día anterior; con valor = conteo manual
 *     produccion integer not null default 0 check (produccion >= 0),
 *     colchones integer not null default 0 check (colchones >= 0),
 *     living integer not null default 0 check (living >= 0),
 *     venta integer not null default 0 check (venta >= 0),
 *     no_conforme integer not null default 0 check (no_conforme >= 0),
 *     actualizado_por text,
 *     updated_at timestamptz not null default now(),
 *     primary key (fecha, tipo, medida)
 *   );
 *   alter table espumado_dia enable row level security;  -- default-deny, acceso solo vía /api
 *   grant select, insert, update, delete on public.espumado_dia to service_role;  -- sin esto, "permission denied"
 *
 * Si la tabla no existe, las lecturas devuelven `disponible: false` y la pantalla avisa que no se puede guardar.
 */

export interface EspumadoDiaRow {
  fecha: string;
  tipo: string;
  medida: string;
  stockInicial: number | null;
  produccion: number;
  colchones: number;
  living: number;
  venta: number;
  noConforme: number;
}

export async function listarEspumadoDias(hasta: string): Promise<{ disponible: boolean; filas: EspumadoDiaRow[] }> {
  const { data, error } = await getSupabaseAdminClient()
    .from('espumado_dia')
    .select('fecha, tipo, medida, stock_inicial, produccion, colchones, living, venta, no_conforme')
    .lte('fecha', hasta)
    .order('fecha', { ascending: true })
    .limit(20000);
  if (error) {
    console.error('[espumado-dia]', error.message);
    return { disponible: false, filas: [] };
  }
  return {
    disponible: true,
    filas: (data ?? []).map((r) => ({
      fecha: String(r.fecha),
      tipo: r.tipo as string,
      medida: r.medida as string,
      stockInicial: r.stock_inicial === null ? null : Number(r.stock_inicial),
      produccion: Number(r.produccion),
      colchones: Number(r.colchones),
      living: Number(r.living),
      venta: Number(r.venta),
      noConforme: Number(r.no_conforme),
    })),
  };
}

/** Guarda el día: upsert de las filas con datos y borrado de las que quedaron vacías (sin conteo ni movimientos). */
export async function guardarEspumadoDia(fecha: string, filas: Omit<EspumadoDiaRow, 'fecha'>[], usuario: string): Promise<void> {
  const db = getSupabaseAdminClient();
  const vacia = (f: Omit<EspumadoDiaRow, 'fecha'>) =>
    f.stockInicial === null && !f.produccion && !f.colchones && !f.living && !f.venta && !f.noConforme;

  const conDatos = filas.filter((f) => !vacia(f));
  if (conDatos.length > 0) {
    const { error } = await db.from('espumado_dia').upsert(
      conDatos.map((f) => ({
        fecha,
        tipo: f.tipo,
        medida: f.medida,
        stock_inicial: f.stockInicial,
        produccion: f.produccion,
        colchones: f.colchones,
        living: f.living,
        venta: f.venta,
        no_conforme: f.noConforme,
        actualizado_por: usuario,
        updated_at: new Date().toISOString(),
      }))
    );
    if (error) throw new Error(error.message);
  }

  for (const f of filas.filter(vacia)) {
    const { error } = await db.from('espumado_dia').delete().eq('fecha', fecha).eq('tipo', f.tipo).eq('medida', f.medida);
    if (error) throw new Error(error.message);
  }
}
