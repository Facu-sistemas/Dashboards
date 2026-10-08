// Parámetros de Compras MP (solo Compras): parámetros, plan mensual, reglas, excepciones y auditoría.
// Cada cambio se valida en el servidor, queda auditado y recalcula con las fotos de la última actualización.
import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '../../dashboard/useApiQuery';
import type { CambioConfig, ConfigEditable } from '../../../lib/compras-mp/edicion';
import type { VistaSku } from '../../../lib/compras-mp/vistas';
import { postJson } from './acciones';
import { Cabeza, Cargando, Cuerpo, ErrorCaja, Seccion, Segmentos, Selector, Tabla, Vacio, fechaHora, td, th } from './ui';

type Pestania = 'parametros' | 'plan' | 'reglas' | 'excepciones' | 'auditoria';

const ANIO = new Date().getFullYear();
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const entrada = 'w-28 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm tabular-nums text-slate-100';
const boton = 'rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-brand-400 disabled:opacity-50';
const botonSec = 'rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50';

const INFO: Record<string, { titulo: string; ayuda: string; pct?: boolean }> = {
  sommier_pct_ventas: { titulo: 'Bases de sommier sobre ventas de colchones', ayuda: 'Porcentaje de las ventas de colchones que se proyecta en bases de sommier.', pct: true },
  pocket_x18_mes: { titulo: 'Pocket x18: unidades por mes', ayuda: 'Plan de la línea Pocket de altura 18.' },
  eps_semana: { titulo: 'EPS: unidades por semana', ayuda: 'Plan del cliente único de EPS.' },
  semanas_mes: { titulo: 'Semanas por mes', ayuda: '52 / 12 = 4,33.' },
  umbral_A: { titulo: 'Clase A: hasta qué % acumulado del consumo valorizado', ayuda: 'Los insumos que juntan este porcentaje del consumo proyectado son clase A.', pct: true },
  umbral_B: { titulo: 'Clase B: hasta qué % acumulado', ayuda: 'El resto hasta este porcentaje es clase B; lo que queda es C. Tiene que ser mayor que el de A.', pct: true },
  dias_por_semana: { titulo: 'Días por semana de la política', ayuda: '7 = días corridos; 5 = días hábiles.' },
  umbral_tendencia: { titulo: 'Umbral de tendencia', ayuda: 'Si el último mes supera al promedio en más de este porcentaje (con consumo en 2 meses o más), se proyecta con el ritmo del último mes.', pct: true },
  ss_critico: { titulo: 'Stock de seguridad de los insumos críticos (semanas)', ayuda: 'Mínimo para los insumos marcados como críticos en las excepciones.' },
  ss_abc: { titulo: 'Stock de seguridad por clase (semanas)', ayuda: 'Cuántas semanas de consumo se mantienen como seguridad, según la clase ABC.' },
  ciclo_abc: { titulo: 'Margen hasta el máximo por clase (semanas)', ayuda: 'Semanas que se suman al objetivo para obtener el stock máximo (solo compra mensual).' },
  origenes: { titulo: 'Política por origen', ayuda: 'Lead time en días corridos, stock de seguridad mínimo en semanas y ciclo de compra en meses (China compra un contenedor por ciclo).' },
  plan_mes_siguiente: { titulo: 'Plan del mes siguiente al horizonte', ayuda: 'Se usa para la cobertura al cierre del último mes. Vacío = se aproxima con el último mes del horizonte.' },
  plan_enero_siguiente: { titulo: 'Plan de enero del año siguiente', ayuda: 'Producción y ventas de enero cuando el horizonte lo incluye. Vacío = se usa diciembre.' },
  cond_pago_default: { titulo: 'Condición de pago por defecto', ayuda: 'Se usa cuando el proveedor no tiene condición cargada en Odoo: días de pago, si paga al emitir la orden, IVA y percepciones.' },
  tipo_cambio_manual: { titulo: 'Tipo de cambio USD manual', ayuda: 'Vacío = se usa la cotización del día de Odoo. Compras puede fijar uno para valorizar los desembolsos.' },
  ubicacion_reposicion: { titulo: 'Ubicación de las reglas de reabastecimiento', ayuda: 'Ubicación completa como aparece en Odoo, por ejemplo WH/Existencias.' },
};
const ETIQUETA_CAMPO: Record<string, string> = {
  A: 'Clase A', B: 'Clase B', C: 'Clase C', Local: 'Local', Brasil: 'Brasil', China: 'China', lead_dias: 'Lead time (días)', ss_min: 'Seguridad mín. (sem)', ciclo: 'Ciclo (meses)',
  prod_colchones: 'Producción colchones', prod_sillones: 'Producción sillones', ventas_colchones: 'Ventas colchones', dias: 'Días de pago', anticipado: 'Paga al emitir la orden', iva: 'IVA', perc: 'Percepciones',
};
const PORCENTAJES = new Set(['iva', 'perc']);

/** Editor genérico de un valor: número (vacío = null), booleano, texto u objeto con esos mismos campos. */
function Campo({ valor, onChange, nombre, porcentaje }: { valor: unknown; onChange: (v: unknown) => void; nombre?: string; porcentaje?: boolean }): ReactNode {
  if (typeof valor === 'boolean') return <input type="checkbox" checked={valor} onChange={(e) => onChange(e.target.checked)} />;
  if (typeof valor === 'string') return <input className={`${entrada} w-56`} value={valor} onChange={(e) => onChange(e.target.value)} />;
  if (valor === null || typeof valor === 'number') {
    const mostrado = valor === null ? '' : porcentaje ? String(Math.round((valor as number) * 10000) / 100) : String(valor);
    return (
      <span className="inline-flex items-center gap-1">
        <input
          className={entrada}
          inputMode="decimal"
          value={mostrado}
          onChange={(e) => {
            const t = e.target.value.trim().replace(',', '.');
            if (t === '') return onChange(null);
            const n = Number(t);
            if (!Number.isNaN(n)) onChange(porcentaje ? n / 100 : n);
          }}
        />
        {porcentaje && <span className="text-xs text-slate-500">%</span>}
      </span>
    );
  }
  if (valor && typeof valor === 'object') {
    return (
      <div className="flex flex-col gap-2">
        {Object.entries(valor as Record<string, unknown>).map(([k, v]) => (
          <div key={k} className="flex flex-wrap items-center gap-3">
            <span className="w-44 text-sm text-slate-400">{ETIQUETA_CAMPO[k] ?? k}</span>
            <Campo valor={v} nombre={k} porcentaje={PORCENTAJES.has(k)} onChange={(nv) => onChange({ ...(valor as Record<string, unknown>), [k]: nv })} />
          </div>
        ))}
      </div>
    );
  }
  return <span className="text-slate-500">{nombre}</span>;
}

export default function Parametros() {
  const [pestania, setPestania] = useState<Pestania>('parametros');
  const [anio, setAnio] = useState(ANIO);
  const q = useApiQuery<ConfigEditable>(['cmp', 'config', String(anio)], `/api/compras-mp/config?anio=${anio}`);
  const cliente = useQueryClient();
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  const guardar = useMutation({
    mutationFn: (cambios: CambioConfig[]) => postJson<{ aplicados: number }>('/api/compras-mp/config', { cambios, recalcular: true }),
    onSuccess: (r) => {
      setMensaje({ tipo: 'ok', texto: `Listo: ${r.aplicados} cambio/s guardado/s y presupuesto recalculado.` });
      return cliente.invalidateQueries({ queryKey: ['cmp'] });
    },
    onError: (e: Error) => setMensaje({ tipo: 'error', texto: e.message }),
  });
  const enviar = (cambios: CambioConfig[]) => { setMensaje(null); guardar.mutate(cambios); };

  if (q.isLoading) return <Cargando />;
  if (q.error) return <ErrorCaja mensaje={(q.error as Error).message} />;
  const c = q.data;
  if (!c) return <Vacio>No se pudo leer la configuración.</Vacio>;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-400">
        Los cambios se validan, quedan auditados (quién, cuándo, valor anterior y nuevo) y recalculan el presupuesto con los datos de Odoo de la última actualización. No se pisa nada: la
        versión aprobada no cambia.
      </div>
      {guardar.isPending && <div className="rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm text-slate-300">Guardando y recalculando… (unos segundos)</div>}
      {mensaje && (mensaje.tipo === 'error' ? <ErrorCaja mensaje={mensaje.texto} /> : <div className="rounded-lg border border-status-green/40 bg-status-green/10 p-3 text-sm text-status-green">{mensaje.texto}</div>)}

      <Segmentos
        valor={pestania}
        onChange={setPestania}
        opciones={[
          { valor: 'parametros', texto: 'Parámetros' },
          { valor: 'plan', texto: 'Plan mensual' },
          { valor: 'reglas', texto: 'Reglas' },
          { valor: 'excepciones', texto: 'Excepciones' },
          { valor: 'auditoria', texto: 'Historial de cambios' },
        ]}
      />

      {pestania === 'parametros' && <PestaniaParametros c={c} ocupado={guardar.isPending} onGuardar={enviar} />}
      {pestania === 'plan' && <PestaniaPlan c={c} anio={anio} setAnio={setAnio} ocupado={guardar.isPending} onGuardar={enviar} />}
      {pestania === 'reglas' && <PestaniaReglas c={c} ocupado={guardar.isPending} onGuardar={enviar} />}
      {pestania === 'excepciones' && <PestaniaExcepciones c={c} ocupado={guardar.isPending} onGuardar={enviar} />}
      {pestania === 'auditoria' && <PestaniaAuditoria c={c} />}
    </div>
  );
}

// ----------------------------------------------------------------------------- Parámetros
function PestaniaParametros({ c, ocupado, onGuardar }: { c: ConfigEditable; ocupado: boolean; onGuardar: (x: CambioConfig[]) => void }) {
  const [edit, setEdit] = useState<Record<string, unknown>>({});
  const orden = Object.keys(INFO).filter((k) => k in c.parametros);
  return (
    <div className="flex flex-col gap-4">
      {orden.map((clave) => {
        const info = INFO[clave]!;
        const original = c.parametros[clave];
        const actual = clave in edit ? edit[clave] : original;
        const cambiado = JSON.stringify(actual) !== JSON.stringify(original);
        const esPorcentaje = !!info.pct;
        return (
          <div key={clave} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-xl">
                <h4 className="text-sm font-medium text-slate-100">{info.titulo}</h4>
                <p className="mt-0.5 text-xs text-slate-400">{info.ayuda}</p>
              </div>
              <div className="flex items-center gap-3">
                {clave === 'dias_por_semana' ? (
                  <Selector valor={String(actual)} onChange={(x) => setEdit({ ...edit, [clave]: Number(x) })} opciones={[{ valor: '7', texto: '7 (corridos)' }, { valor: '5', texto: '5 (hábiles)' }]} />
                ) : (
                  <Campo valor={actual} porcentaje={esPorcentaje} onChange={(v) => setEdit({ ...edit, [clave]: v })} />
                )}
                <button type="button" disabled={!cambiado || ocupado} className={boton} onClick={() => { onGuardar([{ tipo: 'parametro', clave, valor: actual }]); setEdit((e) => { const { [clave]: _omitido, ...resto } = e; void _omitido; return resto; }); }}>
                  Guardar
                </button>
                {cambiado && <button type="button" className={botonSec} onClick={() => setEdit((e) => { const { [clave]: _omitido, ...resto } = e; void _omitido; return resto; })}>Descartar</button>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------------------- Plan mensual
function PestaniaPlan({ c, anio, setAnio, ocupado, onGuardar }: { c: ConfigEditable; anio: number; setAnio: (a: number) => void; ocupado: boolean; onGuardar: (x: CambioConfig[]) => void }) {
  const [edit, setEdit] = useState<Record<string, number | null>>({});
  const filas: [string, string, string][] = [
    ['dias_habiles', 'Días hábiles del mes', 'Vacío = se usa el calendario laboral de Odoo'],
    ['prod_real_colchones', 'Producción real de colchones', 'Se carga al cerrar cada mes; calibra el consumo por unidad'],
    ['prod_real_sillones', 'Producción real de sillones equivalentes', 'Se carga al cerrar cada mes'],
    ['prod_consensuada_colchones', 'Producción consensuada de colchones', 'Plan que acuerdan Comercial y Producción'],
    ['prod_consensuada_sillones', 'Producción consensuada de sillones equivalentes', 'Plan que acuerdan Comercial y Producción'],
    ['ventas_consensuadas', 'Ventas consensuadas de colchones', 'Define las bases de sommier'],
  ];
  const celda = (concepto: string, mes: number) => {
    const k = `${concepto}|${mes}`;
    return k in edit ? edit[k] : (c.plan.valores[concepto]?.[mes - 1] ?? null);
  };
  const cambios = useMemo(
    () => Object.entries(edit).map(([k, valor]) => { const [concepto, mes] = k.split('|') as [string, string]; return { tipo: 'plan' as const, anio, mes: Number(mes), concepto, valor }; }),
    [edit, anio],
  );
  return (
    <Seccion
      titulo={`Plan ${anio}`}
      nota="Producción y ventas por mes. Lo real se carga al cerrar cada mes."
      acciones={
        <div className="flex items-center gap-3">
          <Selector valor={String(anio)} onChange={(x) => { setEdit({}); setAnio(Number(x)); }} opciones={[ANIO - 1, ANIO, ANIO + 1].map((a) => ({ valor: String(a), texto: String(a) }))} />
          <button type="button" className={boton} disabled={!cambios.length || ocupado} onClick={() => { onGuardar(cambios); setEdit({}); }}>Guardar {cambios.length ? `(${cambios.length})` : ''}</button>
          {cambios.length > 0 && <button type="button" className={botonSec} onClick={() => setEdit({})}>Descartar</button>}
        </div>
      }
    >
      <Tabla>
        <Cabeza>
          <tr>
            <th className={th}>Concepto</th>
            {MESES.map((m) => <th key={m} className={`${th} text-right`}>{m}</th>)}
          </tr>
        </Cabeza>
        <Cuerpo>
          {filas.map(([concepto, titulo, ayuda]) => (
            <tr key={concepto}>
              <td className={td}>
                <div>{titulo}</div>
                <div className="text-xs text-slate-500">{ayuda}</div>
              </td>
              {MESES.map((_, i) => {
                const v = celda(concepto, i + 1);
                const k = `${concepto}|${i + 1}`;
                return (
                  <td key={i} className="px-1 py-1.5 text-right">
                    <input
                      className={`${entrada} w-20 text-right ${k in edit ? 'border-brand-500' : ''}`}
                      inputMode="decimal"
                      value={v === null ? '' : String(v)}
                      onChange={(e) => {
                        const t = e.target.value.trim().replace(',', '.');
                        const n = t === '' ? null : Number(t);
                        if (n === null || !Number.isNaN(n)) setEdit({ ...edit, [k]: n });
                      }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </Cuerpo>
      </Tabla>
    </Seccion>
  );
}

// ----------------------------------------------------------------------------- Reglas
const REGLAS: { tipo: keyof ConfigEditable['reglas']; titulo: string; ayuda: string; valor?: 'linea' | 'origen' | 'texto' }[] = [
  { tipo: 'linea_categoria', titulo: 'Línea por categoría', ayuda: 'A qué línea de producto pertenece cada categoría de materia prima (Colchones, Living o Ambos). Las no listadas van a Living.', valor: 'linea' },
  { tipo: 'origen_proveedor', titulo: 'Origen de cada proveedor', ayuda: 'Local, Brasil o China. El origen de un insumo es el de mayor prioridad entre sus proveedores (China > Brasil > Local); los proveedores sin origen se toman como Local.', valor: 'origen' },
  { tipo: 'quimico_principal', titulo: 'Químicos principales', ayuda: 'Insumos cuyo consumo sigue la producción total.' },
  { tipo: 'coleccion', titulo: 'Colecciones de Tela Living', ayuda: 'Inicio del nombre → colección.', valor: 'texto' },
  { tipo: 'prefijo_tela_living', titulo: 'Prefijos de Tela Living', ayuda: 'Detectan telas archivadas que todavía cuentan para calibrar los metros por sillón.' },
  { tipo: 'coleccion_discontinuada', titulo: 'Colecciones discontinuadas', ayuda: 'Telas que se agotan y no se recompran.' },
];

function PestaniaReglas({ c, ocupado, onGuardar }: { c: ConfigEditable; ocupado: boolean; onGuardar: (x: CambioConfig[]) => void }) {
  const [tipoAbierto, setTipoAbierto] = useState<string>('origen_proveedor');
  const [busca, setBusca] = useState('');
  const [nuevaClave, setNuevaClave] = useState('');
  const [nuevoValor, setNuevoValor] = useState('');
  const regla = REGLAS.find((r) => r.tipo === tipoAbierto)!;
  const lista = (c.reglas[tipoAbierto] ?? []).filter((x) => !busca.trim() || x.clave.toLowerCase().includes(busca.trim().toLowerCase()));
  const valorPorDefecto = regla.valor === 'linea' ? 'Living' : regla.valor === 'origen' ? 'Local' : regla.valor === 'texto' ? '' : true;

  return (
    <div className="flex flex-col gap-4">
      <Segmentos valor={tipoAbierto} onChange={(t) => { setTipoAbierto(t); setBusca(''); setNuevaClave(''); setNuevoValor(''); }} opciones={REGLAS.map((r) => ({ valor: r.tipo as string, texto: r.titulo }))} />
      <p className="text-sm text-slate-400">{regla.ayuda}</p>
      <div className="flex flex-wrap items-center gap-3">
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar" className="w-56 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500" />
        <span className="text-sm text-slate-500">{lista.length} de {(c.reglas[tipoAbierto] ?? []).length}</span>
      </div>
      <Tabla maxAlto="max-h-[28rem]">
        <Cabeza>
          <tr><th className={th}>Nombre</th>{regla.valor && <th className={th}>{regla.valor === 'texto' ? 'Valor' : regla.valor === 'linea' ? 'Línea' : 'Origen'}</th>}<th className={th} /></tr>
        </Cabeza>
        <Cuerpo>
          {lista.map((x) => (
            <tr key={x.clave}>
              <td className={td}>{x.clave}</td>
              {regla.valor === 'linea' && (
                <td className={td}>
                  <Selector valor={String(x.valor)} onChange={(v) => onGuardar([{ tipo: 'regla', regla: tipoAbierto as never, clave: x.clave, valor: v }])} opciones={['Colchones', 'Living', 'Ambos'].map((o) => ({ valor: o, texto: o }))} />
                </td>
              )}
              {regla.valor === 'origen' && (
                <td className={td}>
                  <Selector valor={String(x.valor)} onChange={(v) => onGuardar([{ tipo: 'regla', regla: tipoAbierto as never, clave: x.clave, valor: v }])} opciones={['Local', 'Brasil', 'China'].map((o) => ({ valor: o, texto: o }))} />
                </td>
              )}
              {regla.valor === 'texto' && <td className={td}>{String(x.valor)}</td>}
              <td className={td}>
                <button type="button" disabled={ocupado} className="text-xs text-status-red hover:underline disabled:opacity-50" onClick={() => { if (window.confirm(`¿Quitar "${x.clave}" de esta lista?`)) onGuardar([{ tipo: 'regla', regla: tipoAbierto as never, clave: x.clave, valor: null }]); }}>
                  Quitar
                </button>
              </td>
            </tr>
          ))}
        </Cuerpo>
      </Tabla>
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Agregar
          <input value={nuevaClave} onChange={(e) => setNuevaClave(e.target.value)} placeholder="Nombre" className="w-72 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100" />
        </label>
        {regla.valor === 'linea' && <Selector valor={nuevoValor || 'Living'} onChange={setNuevoValor} opciones={['Colchones', 'Living', 'Ambos'].map((o) => ({ valor: o, texto: o }))} />}
        {regla.valor === 'origen' && <Selector valor={nuevoValor || 'Local'} onChange={setNuevoValor} opciones={['Local', 'Brasil', 'China'].map((o) => ({ valor: o, texto: o }))} />}
        {regla.valor === 'texto' && <input value={nuevoValor} onChange={(e) => setNuevoValor(e.target.value)} placeholder="Colección" className="w-56 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100" />}
        <button
          type="button"
          className={boton}
          disabled={ocupado || !nuevaClave.trim() || (regla.valor === 'texto' && !nuevoValor.trim())}
          onClick={() => { onGuardar([{ tipo: 'regla', regla: tipoAbierto as never, clave: nuevaClave.trim(), valor: regla.valor === 'texto' ? nuevoValor.trim() : (nuevoValor || valorPorDefecto) }]); setNuevaClave(''); setNuevoValor(''); }}
        >
          Agregar
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- Excepciones
type Exc = ConfigEditable['excepciones'][number];
const METODOS = ['', 'Coeficiente', 'Promedio', 'Agotar stock', 'Discontinuado', 'Consignado', 'Sin proyeccion'];

function PestaniaExcepciones({ c, ocupado, onGuardar }: { c: ConfigEditable; ocupado: boolean; onGuardar: (x: CambioConfig[]) => void }) {
  const [busca, setBusca] = useState('');
  const [editando, setEditando] = useState<Partial<Exc> | null>(null);
  const productos = useApiQuery<VistaSku | { vacio: true }>(['cmp', 'sku', ''], '/api/compras-mp/datos?vista=sku');
  const lista = productos.data && !('vacio' in productos.data) ? productos.data.lista : [];
  const filas = c.excepciones.filter((e) => !busca.trim() || e.skuNombre.toLowerCase().includes(busca.trim().toLowerCase()));

  const guardarEdicion = () => {
    if (!editando?.productId || !editando.skuNombre) return;
    onGuardar([{
      tipo: 'excepcion',
      excepcion: {
        productId: editando.productId, skuNombre: editando.skuNombre, metodo: (editando.metodo || null) as never, critico: !!editando.critico, costo: editando.costo ?? null,
        consumoMensual: editando.consumoMensual ?? null, origen: (editando.origen || null) as never, respaldo: (editando.respaldo || null) as never, comentario: editando.comentario || null,
      },
    }]);
    setEditando(null);
  };
  const num = (s: string) => { const t = s.trim().replace(',', '.'); if (!t) return null; const n = Number(t); return Number.isNaN(n) ? null : n; };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-400">
        Excepciones por insumo: método forzado, crítico, costo corregido, consumo mensual forzado, origen y respaldo. Se identifican por el ID del producto, así que sobreviven a un cambio de nombre en Odoo.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar insumo" className="w-56 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500" />
        <span className="text-sm text-slate-500">{filas.length} excepciones</span>
        <button type="button" className={boton} onClick={() => setEditando({ critico: false })}>Agregar excepción</button>
      </div>

      {editando && (
        <div className="rounded-lg border border-brand-500/50 bg-slate-900 p-4">
          <h4 className="mb-3 text-sm font-medium text-slate-100">{editando.productId && c.excepciones.some((e) => e.productId === editando.productId) ? 'Editar excepción' : 'Nueva excepción'}</h4>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs text-slate-400 lg:col-span-2">
              Insumo
              <input
                list="cmp-excepciones-skus"
                value={editando.skuNombre ?? ''}
                disabled={!!editando.productId && c.excepciones.some((e) => e.productId === editando.productId)}
                onChange={(e) => {
                  const m = lista.find((x) => x.sku === e.target.value);
                  setEditando({ ...editando, skuNombre: e.target.value, productId: m ? Number(m.clave.slice(1)) : undefined });
                }}
                placeholder="Escribí para buscar el insumo"
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100"
              />
              <datalist id="cmp-excepciones-skus">{lista.map((x) => <option key={x.clave} value={x.sku} />)}</datalist>
              {editando.skuNombre && !editando.productId && <span className="text-status-yellow">Elegí un insumo de la lista.</span>}
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Método forzado
              <select value={editando.metodo ?? ''} onChange={(e) => setEditando({ ...editando, metodo: e.target.value || null })} className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100">
                {METODOS.map((m) => <option key={m} value={m}>{m || '(el que corresponda)'}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Costo corregido ($)
              <input className={entrada} value={editando.costo ?? ''} onChange={(e) => setEditando({ ...editando, costo: num(e.target.value) })} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Consumo mensual forzado (u)
              <input className={entrada} value={editando.consumoMensual ?? ''} onChange={(e) => setEditando({ ...editando, consumoMensual: num(e.target.value) })} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Origen forzado
              <select value={editando.origen ?? ''} onChange={(e) => setEditando({ ...editando, origen: e.target.value || null })} className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100">
                {['', 'Local', 'Brasil', 'China'].map((m) => <option key={m} value={m}>{m || '(el del proveedor)'}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Respaldo forzado
              <select value={editando.respaldo ?? ''} onChange={(e) => setEditando({ ...editando, respaldo: e.target.value || null })} className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100">
                {['', 'Local', 'Brasil', 'China', 'Ninguno'].map((m) => <option key={m} value={m}>{m || '(el que corresponda)'}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={!!editando.critico} onChange={(e) => setEditando({ ...editando, critico: e.target.checked })} /> Insumo crítico (seguridad mínima de 4 semanas)
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400 md:col-span-2 lg:col-span-3">
              Comentario
              <input value={editando.comentario ?? ''} maxLength={300} onChange={(e) => setEditando({ ...editando, comentario: e.target.value })} className="rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100" />
            </label>
          </div>
          <div className="mt-4 flex gap-3">
            <button type="button" className={boton} disabled={ocupado || !editando.productId} onClick={guardarEdicion}>Guardar</button>
            <button type="button" className={botonSec} onClick={() => setEditando(null)}>Cancelar</button>
          </div>
        </div>
      )}

      <Tabla maxAlto="max-h-[34rem]">
        <Cabeza>
          <tr>
            <th className={th}>Insumo</th><th className={th}>Método</th><th className={th}>Crítico</th><th className={th}>Costo</th><th className={th}>Consumo forzado</th>
            <th className={th}>Origen</th><th className={th}>Respaldo</th><th className={th}>Comentario</th><th className={th}>Actualizado</th><th className={th} />
          </tr>
        </Cabeza>
        <Cuerpo>
          {filas.map((e) => (
            <tr key={e.productId}>
              <td className={td}>{e.skuNombre}</td>
              <td className={td}>{e.metodo === 'Sin proyeccion' ? 'Sin proyección' : (e.metodo ?? '—')}</td>
              <td className={td}>{e.critico ? 'Sí' : '—'}</td>
              <td className={td}>{e.costo ?? '—'}</td>
              <td className={td}>{e.consumoMensual ?? '—'}</td>
              <td className={td}>{e.origen ?? '—'}</td>
              <td className={td}>{e.respaldo ?? '—'}</td>
              <td className={`${td} max-w-xs truncate text-xs text-slate-400`} title={e.comentario ?? ''}>{e.comentario ?? ''}</td>
              <td className={`${td} whitespace-nowrap text-xs text-slate-400`}>{fechaHora(e.actualizadoEn)}{e.actualizadoPor ? ` · ${e.actualizadoPor}` : ''}</td>
              <td className={`${td} whitespace-nowrap`}>
                <button type="button" className="mr-3 text-xs text-brand-400 hover:underline" onClick={() => setEditando(e)}>Editar</button>
                <button type="button" disabled={ocupado} className="text-xs text-status-red hover:underline disabled:opacity-50" onClick={() => { if (window.confirm(`¿Borrar la excepción de "${e.skuNombre}"?`)) onGuardar([{ tipo: 'excepcion', excepcion: { productId: e.productId, borrar: true } }]); }}>
                  Borrar
                </button>
              </td>
            </tr>
          ))}
        </Cuerpo>
      </Tabla>
    </div>
  );
}

// ----------------------------------------------------------------------------- Auditoría
function PestaniaAuditoria({ c }: { c: ConfigEditable }) {
  const corto = (v: unknown) => (v === null || v === undefined ? '—' : (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 90));
  if (!c.auditoria.length) return <Vacio>Todavía no hay cambios registrados.</Vacio>;
  return (
    <Tabla maxAlto="max-h-[34rem]">
      <Cabeza>
        <tr><th className={th}>Cuándo</th><th className={th}>Quién</th><th className={th}>Qué</th><th className={th}>Antes</th><th className={th}>Después</th></tr>
      </Cabeza>
      <Cuerpo>
        {c.auditoria.map((a) => (
          <tr key={a.id}>
            <td className={`${td} whitespace-nowrap`}>{fechaHora(a.creadoEn)}</td>
            <td className={td}>{a.usuario}</td>
            <td className={td}>{a.tabla.replace('cfg_', '')} · {a.clave}</td>
            <td className={`${td} max-w-xs truncate text-xs text-slate-400`} title={corto(a.anterior)}>{corto(a.anterior)}</td>
            <td className={`${td} max-w-xs truncate text-xs text-slate-300`} title={corto(a.nuevo)}>{corto(a.nuevo)}</td>
          </tr>
        ))}
      </Cuerpo>
    </Tabla>
  );
}
