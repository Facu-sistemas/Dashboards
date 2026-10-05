/**
 * Búsqueda + orden por columna para tablas renderizadas en el servidor.
 *
 * Cada <tr> del tbody lleva `data-<key>` por columna ordenable; los <button
 * data-sort="<key>"> del thead disparan el orden. Los ids se derivan del
 * `prefix`: `<prefix>-table`, `<prefix>-search`, `<prefix>-count`, `<prefix>-empty`.
 */
export interface SortableTableOptions {
  prefix: string;
  /** Claves `data-*` donde busca el input de texto. */
  searchKeys: string[];
  /** Claves que se comparan como número (el resto, como texto). */
  numericKeys: string[];
  defaultSort: string;
  /** Claves que al primer clic arrancan descendentes. */
  descFirst?: string[];
  /** Clave de desempate (siempre descendente). */
  tieBreaker?: string;
}

export function initSortableTable(opts: SortableTableOptions): void {
  const table = document.getElementById(`${opts.prefix}-table`);
  const search = document.getElementById(`${opts.prefix}-search`) as HTMLInputElement | null;
  const count = document.getElementById(`${opts.prefix}-count`);
  const empty = document.getElementById(`${opts.prefix}-empty`);
  const tbody = table?.querySelector('tbody');
  if (!table || !tbody || !search) return;

  const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr'));
  const numeric = new Set(opts.numericKeys);
  const descFirst = new Set(opts.descFirst ?? []);
  let sortKey = opts.defaultSort;
  let sortDir = descFirst.has(sortKey) ? -1 : 1;

  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const fmt = (n: number) => n.toLocaleString('es-AR');

  function render() {
    const q = norm(search!.value.trim());
    const sorted = rows.slice().sort((a, b) => {
      const av = a.dataset[sortKey] ?? '';
      const bv = b.dataset[sortKey] ?? '';
      const cmp = numeric.has(sortKey) ? Number(av) - Number(bv) : av.localeCompare(bv, 'es');
      if (cmp * sortDir !== 0) return cmp * sortDir;
      return opts.tieBreaker ? Number(b.dataset[opts.tieBreaker]) - Number(a.dataset[opts.tieBreaker]) : 0;
    });
    let visible = 0;
    for (const row of sorted) {
      const show = !q || norm(opts.searchKeys.map((k) => row.dataset[k] ?? '').join(' ')).includes(q);
      row.hidden = !show;
      if (show) visible++;
      tbody!.appendChild(row);
    }
    if (count) count.textContent = `(${fmt(visible)}${visible === rows.length ? '' : ` de ${fmt(rows.length)}`})`;
    empty?.classList.toggle('hidden', visible > 0);
    table!.querySelectorAll<HTMLButtonElement>('button[data-sort]').forEach((btn) => {
      const active = btn.dataset.sort === sortKey;
      btn.classList.toggle('text-slate-100', active);
      btn.dataset.arrow = active ? (sortDir === 1 ? ' ▲' : ' ▼') : '';
    });
  }

  table.querySelectorAll<HTMLButtonElement>('button[data-sort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.sort!;
      if (key === sortKey) sortDir = -sortDir;
      else {
        sortKey = key;
        sortDir = descFirst.has(key) ? -1 : 1;
      }
      render();
    });
  });
  search.addEventListener('input', render);
  render();
}
