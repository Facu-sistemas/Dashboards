import { useMemo, useState } from 'react';

/**
 * Diagrama entidad-relación de las tablas propias de la web (Supabase). No hay migraciones en el repo: las tablas
 * se leen de los bloques `create table` documentados en src/lib/supabase/*.ts y de las consultas del código.
 * Las tablas de Odoo no se dibujan (el sistema las lee por API, solo lectura): las columnas que guardan un id de
 * Odoo llevan la marca ODOO.
 */

type Flag = 'PK' | 'FK' | 'ODOO';
type Col = [name: string, type: string, flag?: Flag];

interface Tabla {
  id: string;
  x: number;
  y: number;
  grupo: string;
  /** Las columnas de estas tablas están inferidas del código (no hay `create table` documentado). */
  inferida?: boolean;
  cols: Col[];
}

interface Relacion {
  de: string; // lado "1"
  a: string; // lado "N"
  texto: string;
  /** Sin foreign key declarada: la relación existe en el código pero no en la base. */
  logica?: boolean;
  card?: [string, string];
}

const W = 270;
const H_HEAD = 28;
const H_ROW = 18;
const altura = (t: Tabla) => H_HEAD + t.cols.length * H_ROW + 6;

const GRUPOS: Record<string, { nombre: string; color: string }> = {
  acceso: { nombre: 'Acceso y permisos', color: '#38bdf8' },
  compras: { nombre: 'Compras MP — corridas y resultados', color: '#a78bfa' },
  versiones: { nombre: 'Compras MP — versiones y cierres', color: '#c084fc' },
  config: { nombre: 'Compras MP — configuración', color: '#f472b6' },
  sillon: { nombre: 'Líneas de sillones', color: '#34d399' },
  planificado: { nombre: 'Planificado línea', color: '#2dd4bf' },
  fichaje: { nombre: 'Fichaje y RRHH', color: '#fbbf24' },
  logistica: { nombre: 'Logística', color: '#fb923c' },
  vertical: { nombre: 'Optimizador vertical', color: '#60a5fa' },
  produccion: { nombre: 'Producción y calidad', color: '#f87171' },
  rentabilidad: { nombre: 'Rentabilidad (propuesta, aún no creada)', color: '#a3e635' },
};

const C1 = 20;
const C2 = 330;
const C3 = 640;
const C4 = 950;

const TABLAS: Tabla[] = [
  // --- Acceso
  { id: 'auth.users', x: C1, y: 80, grupo: 'acceso', inferida: true, cols: [['id', 'uuid', 'PK'], ['email', 'text'], ['(Supabase Auth)', '']] },
  {
    id: 'perfiles', x: C2, y: 80, grupo: 'acceso', inferida: true,
    cols: [['id', 'uuid', 'PK'], ['username', 'text'], ['nombre_completo', 'text'], ['rol', 'text'], ['sesion_max_minutos', 'int']],
  },
  { id: 'permisos_modulo', x: C3, y: 80, grupo: 'acceso', inferida: true, cols: [['user_id', 'uuid', 'PK'], ['area_slug', 'text', 'PK'], ['activo', 'boolean']] },

  // --- Compras: corridas
  {
    id: 'raw_compras', x: C1, y: 320, grupo: 'compras', inferida: true,
    cols: [['id', 'uuid', 'PK'], ['corrida_id', 'uuid', 'FK'], ['fuente', 'text'], ['fecha_datos', 'date'], ['hash', 'text'], ['filas', 'int'], ['datos', 'jsonb']],
  },
  {
    id: 'calc_sku', x: C1, y: 490, grupo: 'compras', inferida: true,
    cols: [['corrida_id', 'uuid', 'FK'], ['product_id', 'int', 'ODOO'], ['sku', 'text'], ['categoria', 'text'], ['linea', 'text'], ['origen', 'text'], ['abc', 'text'], ['datos', 'jsonb']],
  },
  {
    id: 'calc_sku_mes', x: C1, y: 700, grupo: 'compras', inferida: true,
    cols: [['corrida_id', 'uuid', 'FK'], ['product_id', 'int', 'ODOO'], ['mes', 'text'], ['llegada_u / llegada_ars', 'numeric'], ['emitir_u / emitir_ars', 'numeric'], ['consumo_proy_u', 'numeric'], ['deficit_u / entrante_u', 'numeric']],
  },
  {
    id: 'compras_corridas', x: C2, y: 560, grupo: 'compras', inferida: true,
    cols: [['id', 'uuid', 'PK'], ['creada_en', 'timestamptz'], ['origen', 'text'], ['disparada_por', 'text'], ['fecha_datos', 'date'], ['estado', 'text'], ['error', 'text'], ['params', 'jsonb'], ['resumen', 'jsonb'], ['controles', 'jsonb']],
  },
  {
    id: 'calc_desembolsos', x: C3, y: 320, grupo: 'compras', inferida: true,
    cols: [['corrida_id', 'uuid', 'FK'], ['mes', 'text'], ['tipo', 'text'], ['concepto', 'text'], ['valor', 'numeric']],
  },
  {
    id: 'calc_control_oc', x: C3, y: 470, grupo: 'compras', inferida: true,
    cols: [['corrida_id', 'uuid', 'FK'], ['linea_id', 'int', 'ODOO'], ['oc_id', 'int', 'ODOO'], ['product_id', 'int', 'ODOO'], ['datos', 'jsonb']],
  },
  {
    id: 'oc_decisiones', x: C3, y: 620, grupo: 'compras', inferida: true,
    cols: [['id', 'uuid', 'PK'], ['oc_id', 'int', 'ODOO'], ['product_id', 'int', 'ODOO'], ['decision', 'text'], ['nueva_fecha', 'date'], ['comentario', 'text'], ['usuario', 'text'], ['creado_en', 'timestamptz']],
  },

  // --- Compras: versiones y cierres
  {
    id: 'version_presupuesto', x: C2, y: 920, grupo: 'versiones', inferida: true,
    cols: [['id', 'uuid', 'PK'], ['nombre', 'text'], ['horizonte', 'text[]'], ['corrida_id', 'uuid', 'FK'], ['aprobada_por', 'text'], ['aprobada_en', 'timestamptz'], ['total_compra', 'numeric'], ['vigente', 'boolean'], ['params', 'jsonb']],
  },
  {
    id: 'version_sku_mes', x: C1, y: 960, grupo: 'versiones', inferida: true,
    cols: [['version_id', 'uuid', 'FK'], ['product_id', 'int', 'ODOO'], ['mes', 'text'], ['datos', 'jsonb']],
  },
  {
    id: 'version_desembolso', x: C1, y: 1090, grupo: 'versiones', inferida: true,
    cols: [['version_id', 'uuid', 'FK'], ['mes', 'text'], ['tipo', 'text'], ['concepto', 'text'], ['valor', 'numeric']],
  },
  {
    id: 'cierre_mensual', x: C3, y: 920, grupo: 'versiones', inferida: true,
    cols: [['id', 'uuid', 'PK'], ['mes', 'text'], ['revision', 'int'], ['indicadores', 'jsonb'], ['fecha_datos', 'date'], ['corrida_id', 'uuid', 'FK'], ['usuario', 'text'], ['creado_en', 'timestamptz']],
  },

  // --- Compras: configuración
  { id: 'cfg_parametros', x: C4, y: 320, grupo: 'config', inferida: true, cols: [['clave', 'text', 'PK'], ['valor', 'jsonb'], ['actualizado_en', 'timestamptz'], ['actualizado_por', 'text']] },
  { id: 'cfg_reglas', x: C4, y: 450, grupo: 'config', inferida: true, cols: [['tipo', 'text', 'PK'], ['clave', 'text', 'PK'], ['valor', 'jsonb'], ['actualizado_en', 'timestamptz'], ['actualizado_por', 'text']] },
  {
    id: 'cfg_excepciones', x: C4, y: 600, grupo: 'config', inferida: true,
    cols: [['product_id', 'int', 'PK'], ['sku_nombre', 'text'], ['metodo', 'text'], ['critico', 'boolean'], ['costo', 'numeric'], ['consumo_mensual', 'numeric'], ['origen / respaldo', 'text'], ['comentario', 'text']],
  },
  { id: 'cfg_plan', x: C4, y: 800, grupo: 'config', inferida: true, cols: [['anio', 'int', 'PK'], ['mes', 'int', 'PK'], ['concepto', 'text', 'PK'], ['valor', 'numeric'], ['actualizado_por', 'text']] },
  { id: 'cfg_auditoria', x: C4, y: 950, grupo: 'config', inferida: true, cols: [['id', 'bigint', 'PK'], ['usuario', 'text'], ['tabla', 'text'], ['clave', 'text'], ['anterior', 'jsonb'], ['nuevo', 'jsonb']] },

  // --- Líneas de sillones
  {
    id: 'lineas_sillon_lineas', x: C1, y: 1210, grupo: 'sillon',
    cols: [['linea', 'integer', 'PK'], ['activa', 'boolean'], ['asignados', 'jsonb'], ['adelanto', 'jsonb'], ['actualizado_por', 'text'], ['updated_at', 'timestamptz']],
  },
  {
    id: 'lineas_sillon_personas', x: C2, y: 1210, grupo: 'sillon',
    cols: [['id', 'uuid', 'PK'], ['nombre', 'text'], ['puesto', 'text'], ['activa', 'boolean'], ['productos', 'text[]'], ['niveles', 'jsonb'], ['empleado_id', 'integer', 'ODOO'], ['updated_at', 'timestamptz']],
  },
  { id: 'lineas_sillon_alias', x: C3, y: 1210, grupo: 'sillon', cols: [['odoo_base', 'text', 'PK'], ['producto', 'text'], ['actualizado_por', 'text'], ['updated_at', 'timestamptz']] },
  { id: 'lineas_sillon_tiempos', x: C3, y: 1340, grupo: 'sillon', cols: [['producto', 'text', 'PK'], ['minutos', 'numeric'], ['actualizado_por', 'text'], ['updated_at', 'timestamptz']] },
  {
    id: 'lineas_sillon_manuales', x: C1, y: 1410, grupo: 'sillon',
    cols: [['id', 'uuid', 'PK'], ['linea', 'integer', 'FK'], ['producto', 'text'], ['cantidad', 'integer'], ['nota', 'text'], ['updated_at', 'timestamptz']],
  },
  { id: 'lineas_sillon_planes', x: C2, y: 1440, grupo: 'sillon', cols: [['fecha', 'date', 'PK'], ['plan', 'jsonb'], ['creado_por', 'text'], ['creado_en', 'timestamptz']] },
  { id: 'lineas_sillon_ignoradas', x: C3, y: 1490, grupo: 'sillon', cols: [['orden', 'text', 'ODOO'], ['unidades', 'integer'], ['actualizado_por', 'text'], ['updated_at', 'timestamptz']] },

  // --- Planificado línea
  { id: 'linea_mesas', x: C4, y: 1210, grupo: 'planificado', cols: [['codigo', 'text', 'PK'], ['activa', 'boolean'], ['actualizado_por', 'text'], ['updated_at', 'timestamptz']] },
  { id: 'linea_tap_reglas', x: C4, y: 1350, grupo: 'planificado', cols: [['familia', 'text', 'PK'], ['modo', 'text'], ['mesas', 'text[]'], ['prioridad', 'integer'], ['updated_at', 'timestamptz']] },

  // --- Fichaje y RRHH
  { id: 'fichaje_caras', x: C1, y: 1700, grupo: 'fichaje', inferida: true, cols: [['id', 'uuid', 'PK'], ['empleado_id', 'int', 'ODOO'], ['empleado_nombre', 'text'], ['descriptor', 'jsonb'], ['creado_en', 'timestamptz']] },
  { id: 'fichaje_marcas', x: C2, y: 1700, grupo: 'fichaje', cols: [['id', 'uuid', 'PK'], ['empleado_id', 'int', 'ODOO'], ['empleado_nombre', 'text'], ['accion', 'text'], ['kiosco', 'text'], ['marcado_en', 'timestamptz']] },
  { id: 'rrhh_resumen_estado', x: C3, y: 1700, grupo: 'fichaje', cols: [['empleado_id', 'integer', 'PK'], ['estado', 'text'], ['empleado_nombre', 'text'], ['actualizado_por', 'text'], ['actualizado_en', 'timestamptz']] },

  // --- Logística
  { id: 'embalaje_escaneos', x: C4, y: 1700, grupo: 'logistica', cols: [['id', 'bigint', 'PK'], ['barcode', 'text', 'ODOO'], ['producto', 'text'], ['usuario', 'text'], ['anulado', 'boolean'], ['created_at', 'timestamptz']] },

  // --- Optimizador vertical
  {
    id: 'vertical_sobrantes', x: C1, y: 1920, grupo: 'vertical', inferida: true,
    cols: [['id', 'uuid', 'PK'], ['color_block', 'text'], ['ancho_block_cm', 'numeric'], ['largo_block_cm', 'numeric'], ['alto_disponible_cm', 'numeric'], ['origen_fecha', 'date'], ['origen_producto', 'text'], ['consumido', 'boolean'], ['consumido_fecha', 'date']],
  },
  {
    id: 'vertical_cortes_sesiones', x: C2, y: 1920, grupo: 'vertical', inferida: true,
    cols: [['fecha', 'date', 'PK'], ['color_block', 'text', 'PK'], ['bloques_cargados', 'jsonb'], ['sobrante_resultante_cm', 'numeric'], ['updated_by', 'uuid', 'FK'], ['updated_at', 'timestamptz']],
  },

  // --- Producción y calidad
  {
    id: 'espumado_dia', x: C3, y: 1920, grupo: 'produccion',
    cols: [['fecha', 'date', 'PK'], ['tipo', 'text', 'PK'], ['medida', 'text', 'PK'], ['stock_inicial', 'integer'], ['produccion', 'integer'], ['colchones', 'integer'], ['living', 'integer'], ['venta', 'integer'], ['no_conforme', 'integer'], ['updated_at', 'timestamptz']],
  },
  { id: 'seguimiento_mo_umbrales', x: C4, y: 1920, grupo: 'produccion', cols: [['grupo', 'text', 'PK'], ['amarillo_desde', 'integer'], ['rojo_desde', 'integer'], ['updated_at', 'timestamptz']] },
  { id: 'cnc_parametros', x: C1, y: 2190, grupo: 'produccion', cols: [['nota', 'text', 'PK'], ['cuenta', 'boolean'], ['flete', 'boolean'], ['horas', 'numeric'], ['pct', 'numeric'], ['updated_at', 'timestamptz']] },
  { id: 'costo_devoluciones_tarifas', x: C2, y: 2190, grupo: 'produccion', cols: [['mes', 'text', 'PK'], ['costo_hora', 'numeric'], ['viajes', 'numeric'], ['fletes', 'jsonb'], ['updated_at', 'timestamptz']] },
  { id: 'presupuesto_mp_linea', x: C3, y: 2190, grupo: 'produccion', cols: [['product_id', 'integer', 'ODOO'], ['linea', 'text'], ['actualizado_por', 'text'], ['updated_at', 'timestamptz']] },

  // --- Rentabilidad (propuesta)
  { id: 'rentabilidad_configuracion', x: C1, y: 2400, grupo: 'rentabilidad', cols: [['id', 'integer', 'PK'], ['contribucion_objetivo', 'numeric'], ['umbral_verde', 'numeric'], ['umbral_amarillo', 'numeric']] },
  { id: 'rentabilidad_contribucion_objetivos', x: C2, y: 2400, grupo: 'rentabilidad', cols: [['categoria', 'text', 'PK'], ['contribucion_objetivo', 'numeric'], ['umbral_verde', 'numeric'], ['umbral_amarillo', 'numeric']] },
  { id: 'rentabilidad_parametros_costeo', x: C3, y: 2400, grupo: 'rentabilidad', cols: [['clave', 'text', 'PK'], ['valor', 'numeric'], ['descripcion', 'text'], ['actualizado_por', 'text']] },
];

const RELACIONES: Relacion[] = [
  { de: 'auth.users', a: 'perfiles', texto: 'id', card: ['1', '1'] },
  { de: 'perfiles', a: 'permisos_modulo', texto: 'user_id' },
  { de: 'compras_corridas', a: 'raw_compras', texto: 'corrida_id' },
  { de: 'compras_corridas', a: 'calc_sku', texto: 'corrida_id' },
  { de: 'compras_corridas', a: 'calc_sku_mes', texto: 'corrida_id' },
  { de: 'compras_corridas', a: 'calc_desembolsos', texto: 'corrida_id' },
  { de: 'compras_corridas', a: 'calc_control_oc', texto: 'corrida_id' },
  { de: 'compras_corridas', a: 'version_presupuesto', texto: 'corrida_id' },
  { de: 'compras_corridas', a: 'cierre_mensual', texto: 'corrida_id' },
  { de: 'calc_sku', a: 'calc_sku_mes', texto: 'product_id', logica: true },
  { de: 'calc_control_oc', a: 'oc_decisiones', texto: 'oc_id + product_id', logica: true },
  { de: 'version_presupuesto', a: 'version_sku_mes', texto: 'version_id' },
  { de: 'version_presupuesto', a: 'version_desembolso', texto: 'version_id' },
  { de: 'lineas_sillon_lineas', a: 'lineas_sillon_manuales', texto: 'linea', logica: true },
  { de: 'lineas_sillon_personas', a: 'lineas_sillon_lineas', texto: 'asignados (jsonb)', logica: true, card: ['N', 'N'] },
  { de: 'lineas_sillon_tiempos', a: 'lineas_sillon_alias', texto: 'producto', logica: true },
  { de: 'linea_mesas', a: 'linea_tap_reglas', texto: 'mesas[] → codigo', logica: true, card: ['N', 'N'] },
  { de: 'vertical_sobrantes', a: 'vertical_cortes_sesiones', texto: 'color_block', logica: true, card: ['N', 'N'] },
];

// Los grupos de abajo arrancan después de que termina "versiones" (que se corrió hacia abajo).
const DESPLAZAR = new Set(['sillon', 'planificado', 'fichaje', 'logistica', 'vertical', 'produccion', 'rentabilidad']);
for (const t of TABLAS) if (DESPLAZAR.has(t.grupo)) t.y += 120;

const porId = new Map(TABLAS.map((t) => [t.id, t]));

/** Punto donde la línea que sale del centro de `t` hacia (px, py) cruza el borde del rectángulo. */
function borde(t: Tabla, px: number, py: number): { x: number; y: number } {
  const w = W;
  const h = altura(t);
  const cx = t.x + w / 2;
  const cy = t.y + h / 2;
  const dx = px - cx;
  const dy = py - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const k = Math.min(dx === 0 ? Infinity : w / 2 / Math.abs(dx), dy === 0 ? Infinity : h / 2 / Math.abs(dy));
  return { x: cx + dx * k, y: cy + dy * k };
}

const CANVAS_W = C4 + W + 20;
const CANVAS_H = 2400 + 120 + 130;

/** Cuadro de fondo de cada grupo, calculado a partir de las tablas que contiene. */
function cuadroGrupo(grupo: string) {
  const ts = TABLAS.filter((t) => t.grupo === grupo);
  const x1 = Math.min(...ts.map((t) => t.x)) - 12;
  const y1 = Math.min(...ts.map((t) => t.y)) - 36;
  const x2 = Math.max(...ts.map((t) => t.x + W)) + 12;
  const y2 = Math.max(...ts.map((t) => t.y + altura(t))) + 12;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export default function ErDiagramApp() {
  const [zoom, setZoom] = useState(1);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [verGrupo, setVerGrupo] = useState<string>('todos');

  const grupos = useMemo(() => Object.keys(GRUPOS), []);
  const visibles = (g: string) => verGrupo === 'todos' || verGrupo === g;

  const vecinas = useMemo(() => {
    const s = new Set<string>();
    if (!seleccion) return s;
    s.add(seleccion);
    for (const r of RELACIONES) {
      if (r.de === seleccion) s.add(r.a);
      if (r.a === seleccion) s.add(r.de);
    }
    return s;
  }, [seleccion]);

  const grupoDe = (id: string) => porId.get(id)!.grupo;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setVerGrupo('todos')}
            className={`rounded-md px-2.5 py-1 text-xs ring-1 ring-slate-700 ${verGrupo === 'todos' ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Todo ({TABLAS.length} tablas)
          </button>
          {grupos.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setVerGrupo(verGrupo === g ? 'todos' : g)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs ring-1 ring-slate-700 ${verGrupo === g ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: GRUPOS[g]!.color }} />
              {GRUPOS[g]!.nombre}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(1)))} className="h-7 w-7 rounded-md text-slate-300 ring-1 ring-slate-700 hover:bg-slate-800" aria-label="Alejar">−</button>
          <span className="w-12 text-center text-xs text-slate-400">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(1)))} className="h-7 w-7 rounded-md text-slate-300 ring-1 ring-slate-700 hover:bg-slate-800" aria-label="Acercar">+</button>
          <button type="button" onClick={() => setZoom(1)} className="ml-1 rounded-md px-2 py-1 text-xs text-slate-300 ring-1 ring-slate-700 hover:bg-slate-800">100%</button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <svg width="28" height="8"><line x1="0" y1="4" x2="28" y2="4" className="stroke-slate-400" strokeWidth="1.5" /></svg>
          Relación con clave foránea
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="28" height="8"><line x1="0" y1="4" x2="28" y2="4" className="stroke-slate-400" strokeWidth="1.5" strokeDasharray="4 3" /></svg>
          Relación lógica (la usa el código, sin FK declarada)
        </span>
        <span><b className="text-amber-400">PK</b> clave primaria</span>
        <span><b className="text-sky-400">FK</b> clave foránea</span>
        <span><b className="text-emerald-400">ODOO</b> guarda un id de Odoo (sistema externo, solo lectura)</span>
        <span>Tocá una tabla para resaltar sus relaciones</span>
      </div>

      <div className="overflow-auto rounded-lg bg-slate-950/60 ring-1 ring-slate-800" style={{ maxHeight: '75vh' }}>
        <svg
          width={CANVAS_W * zoom}
          height={CANVAS_H * zoom}
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          className="block font-sans"
          onClick={() => setSeleccion(null)}
        >
          {grupos.filter(visibles).map((g) => {
            const c = cuadroGrupo(g);
            return (
              <g key={g}>
                <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={10} fill={GRUPOS[g]!.color} fillOpacity={0.06} stroke={GRUPOS[g]!.color} strokeOpacity={0.35} strokeDasharray="6 4" />
                <text x={c.x + 12} y={c.y + 22} fill={GRUPOS[g]!.color} className="text-[14px] font-semibold">{GRUPOS[g]!.nombre}</text>
              </g>
            );
          })}

          {RELACIONES.filter((r) => visibles(grupoDe(r.de)) && visibles(grupoDe(r.a))).map((r) => {
            const A = porId.get(r.de)!;
            const B = porId.get(r.a)!;
            const ca = { x: A.x + W / 2, y: A.y + altura(A) / 2 };
            const cb = { x: B.x + W / 2, y: B.y + altura(B) / 2 };
            const p1 = borde(A, cb.x, cb.y);
            const p2 = borde(B, ca.x, ca.y);
            const activa = !seleccion || (vecinas.has(r.de) && vecinas.has(r.a) && (r.de === seleccion || r.a === seleccion));
            const mx = (p1.x + p2.x) / 2;
            const my = (p1.y + p2.y) / 2;
            const [c1, c2] = r.card ?? ['1', 'N'];
            // Etiquetas de cardinalidad un poco separadas del borde, hacia el otro extremo.
            const t = (p: { x: number; y: number }, q: { x: number; y: number }, d: number) => {
              const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
              return { x: p.x + ((q.x - p.x) / len) * d, y: p.y + ((q.y - p.y) / len) * d };
            };
            const l1 = t(p1, p2, 14);
            const l2 = t(p2, p1, 14);
            return (
              <g key={`${r.de}-${r.a}`} opacity={activa ? 1 : 0.12}>
                <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="stroke-slate-400" strokeWidth={1.5} strokeDasharray={r.logica ? '5 4' : undefined} />
                <text x={l1.x} y={l1.y + 4} textAnchor="middle" className="fill-slate-200 text-[12px] font-bold">{c1}</text>
                <text x={l2.x} y={l2.y + 4} textAnchor="middle" className="fill-slate-200 text-[12px] font-bold">{c2}</text>
                <text x={mx} y={my - 4} textAnchor="middle" className="fill-slate-400 text-[10px]" paintOrder="stroke" stroke="rgb(var(--slate-950))" strokeWidth={3}>{r.texto}</text>
              </g>
            );
          })}

          {TABLAS.filter((t) => visibles(t.grupo)).map((t) => {
            const h = altura(t);
            const color = GRUPOS[t.grupo]!.color;
            const atenuada = seleccion !== null && !vecinas.has(t.id);
            return (
              <g
                key={t.id}
                opacity={atenuada ? 0.25 : 1}
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  setSeleccion(seleccion === t.id ? null : t.id);
                }}
              >
                <rect x={t.x} y={t.y} width={W} height={h} rx={6} className="fill-slate-900" stroke={color} strokeWidth={seleccion === t.id ? 2.5 : 1.2} />
                <path d={`M${t.x},${t.y + H_HEAD} V${t.y + 6} a6,6 0 0 1 6,-6 H${t.x + W - 6} a6,6 0 0 1 6,6 V${t.y + H_HEAD} Z`} fill={color} fillOpacity={0.28} />
                <text x={t.x + 10} y={t.y + 19} className="fill-slate-100 text-[13px] font-semibold">{t.id}</text>
                {t.cols.map(([nombre, tipo, flag], i) => {
                  const y = t.y + H_HEAD + 14 + i * H_ROW;
                  return (
                    <g key={nombre}>
                      {flag && (
                        <text x={t.x + 10} y={y} className={`text-[9px] font-bold ${flag === 'PK' ? 'fill-amber-400' : flag === 'FK' ? 'fill-sky-400' : 'fill-emerald-400'}`}>{flag}</text>
                      )}
                      <text x={t.x + 42} y={y} className="fill-slate-200 text-[11px]">{nombre}</text>
                      <text x={t.x + W - 10} y={y} textAnchor="end" className="fill-slate-500 text-[10px]">{tipo}</text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-4 space-y-1 text-xs text-slate-500">
        <p>
          La base es Supabase (PostgreSQL). Odoo es el sistema de origen de productos, empleados, órdenes y facturas: se consulta por API en solo lectura, por eso sus tablas no aparecen y
          se referencian por id (marca ODOO).
        </p>
        <p>
          Todas las tablas tienen RLS activado sin políticas: solo se accede desde el servidor con la clave de servicio. Las columnas de las tablas de acceso, compras y vertical están
          inferidas del código; el resto sale de los <code>create table</code> documentados en <code>src/lib/supabase</code>. Las tablas de Rentabilidad son una propuesta todavía no ejecutada.
        </p>
      </div>
    </div>
  );
}
