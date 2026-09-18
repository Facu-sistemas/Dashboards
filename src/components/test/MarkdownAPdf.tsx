import { useState } from 'react';
import { marked, type Token, type Tokens } from 'marked';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const EJEMPLO = `# Título del documento

Escribí o pegá tu texto en **Markdown** acá.

- Punto uno
- Punto dos con \`código\`

> También podés usar citas y tablas.

| Campo | Valor |
| --- | --- |
| Ejemplo | 123 |
`;

const MARGEN = 40;

type Estilo = { bold?: boolean; italic?: boolean; code?: boolean };
type Fragmento = Estilo & { texto: string };

function aplicarFuente(doc: jsPDF, estilo: Estilo, tamano: number) {
  if (estilo.code) {
    doc.setFont('courier', estilo.bold ? 'bold' : 'normal');
  } else {
    const variante = estilo.bold && estilo.italic ? 'bolditalic' : estilo.bold ? 'bold' : estilo.italic ? 'italic' : 'normal';
    doc.setFont('helvetica', variante);
  }
  doc.setFontSize(tamano);
}

/** Convierte los tokens inline de marked (bold, italic, code, links, etc.) en una lista plana de fragmentos con estilo. */
function aplanarInline(tokens: Token[], estiloBase: Estilo = {}): Fragmento[] {
  const fragmentos: Fragmento[] = [];
  for (const t of tokens) {
    const tok = t as Tokens.Generic;
    switch (tok.type) {
      case 'strong':
        fragmentos.push(...aplanarInline(tok.tokens as Token[], { ...estiloBase, bold: true }));
        break;
      case 'em':
        fragmentos.push(...aplanarInline(tok.tokens as Token[], { ...estiloBase, italic: true }));
        break;
      case 'codespan':
        fragmentos.push({ texto: (tok as Tokens.Codespan).text, ...estiloBase, code: true });
        break;
      case 'del':
      case 'link':
        if (tok.tokens) fragmentos.push(...aplanarInline(tok.tokens as Token[], estiloBase));
        break;
      case 'br':
        fragmentos.push({ texto: '\n', ...estiloBase });
        break;
      case 'text':
      case 'escape':
        if (tok.tokens) fragmentos.push(...aplanarInline(tok.tokens as Token[], estiloBase));
        else fragmentos.push({ texto: (tok as Tokens.Text).text, ...estiloBase });
        break;
      default:
        if (tok.tokens) fragmentos.push(...aplanarInline(tok.tokens as Token[], estiloBase));
        else if ('text' in tok && typeof tok.text === 'string') fragmentos.push({ texto: tok.text, ...estiloBase });
    }
  }
  return fragmentos;
}

function textoPlanoInline(tokens: Token[]): string {
  return aplanarInline(tokens)
    .map((f) => f.texto)
    .join('');
}

/** Renderiza un párrafo (lista de fragmentos con estilo) con salto de línea automático dentro del ancho disponible. */
function dibujarParrafo(
  doc: jsPDF,
  fragmentos: Fragmento[],
  x: number,
  y: number,
  anchoMax: number,
  tamano: number,
  interlineado: number,
  agregarPagina: (alturaNecesaria: number) => number,
): number {
  type Palabra = Fragmento;
  const palabras: Palabra[] = [];
  for (const frag of fragmentos) {
    const partes = frag.texto.split(/(\s+)/).filter((p) => p !== '');
    for (const parte of partes) {
      palabras.push({ ...frag, texto: parte });
    }
  }

  let cursorY = y;
  let linea: Palabra[] = [];
  let anchoLinea = 0;

  const medir = (palabra: Palabra) => {
    aplicarFuente(doc, palabra, tamano);
    return doc.getTextWidth(palabra.texto);
  };

  const dibujarLinea = () => {
    if (linea.length === 0) return;
    cursorY = agregarPagina(interlineado);
    let cursorX = x;
    for (const palabra of linea) {
      if (palabra.texto === ' ') {
        aplicarFuente(doc, palabra, tamano);
        cursorX += doc.getTextWidth(' ');
        continue;
      }
      aplicarFuente(doc, palabra, tamano);
      const ancho = doc.getTextWidth(palabra.texto);
      if (palabra.code) {
        doc.setFillColor(241, 245, 249);
        doc.rect(cursorX - 1, cursorY - tamano * 0.78, ancho + 2, tamano * 1.05, 'F');
      }
      doc.setTextColor(palabra.code ? 190 : 15, palabra.code ? 30 : 23, palabra.code ? 60 : 42);
      doc.text(palabra.texto, cursorX, cursorY);
      doc.setTextColor(15, 23, 42);
      cursorX += ancho;
    }
    cursorY += interlineado;
    linea = [];
    anchoLinea = 0;
  };

  for (const palabra of palabras) {
    if (palabra.texto === '\n') {
      dibujarLinea();
      continue;
    }
    if (palabra.texto.trim() === '' && linea.length === 0) continue; // no arrancar línea con espacio
    const ancho = medir(palabra);
    if (anchoLinea + ancho > anchoMax && linea.length > 0) {
      dibujarLinea();
    }
    linea.push(palabra);
    anchoLinea += ancho;
  }
  dibujarLinea();

  return cursorY;
}

function generarPdf(markdown: string): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const anchoPagina = doc.internal.pageSize.getWidth();
  const altoPagina = doc.internal.pageSize.getHeight();
  const anchoMax = anchoPagina - MARGEN * 2;

  let y = MARGEN;

  const agregarPagina = (alturaNecesaria: number) => {
    if (y + alturaNecesaria > altoPagina - MARGEN) {
      doc.addPage();
      y = MARGEN;
    }
    y += alturaNecesaria;
    return y;
  };

  const tokens = marked.lexer(markdown);

  const renderTokens = (lista: Token[], indent = 0) => {
    for (const t of lista) {
      const tok = t as Tokens.Generic;
      switch (tok.type) {
        case 'heading': {
          const heading = tok as Tokens.Heading;
          const tamanos: Record<number, number> = { 1: 20, 2: 17, 3: 14, 4: 12, 5: 11, 6: 11 };
          const tamano = tamanos[heading.depth] ?? 12;
          y += heading.depth === 1 ? 10 : 6;
          y = dibujarParrafo(
            doc,
            aplanarInline(heading.tokens as Token[], { bold: true }),
            MARGEN + indent,
            y,
            anchoMax - indent,
            tamano,
            tamano * 1.25,
            agregarPagina,
          );
          y += 4;
          break;
        }
        case 'paragraph': {
          const parrafo = tok as Tokens.Paragraph;
          y = dibujarParrafo(
            doc,
            aplanarInline(parrafo.tokens as Token[]),
            MARGEN + indent,
            y,
            anchoMax - indent,
            11,
            15,
            agregarPagina,
          );
          y += 8;
          break;
        }
        case 'list': {
          const list = tok as Tokens.List;
          list.items.forEach((item, i) => {
            const prefijo = list.ordered ? `${(list.start === '' ? 1 : Number(list.start)) + i}. ` : '• ';
            const itemTokens =
              item.tokens.length && item.tokens[0]!.type === 'text'
                ? (item.tokens[0] as Tokens.Text).tokens ?? marked.Lexer.lexInline(item.text)
                : marked.Lexer.lexInline(item.text);
            const fragmentos: Fragmento[] = [{ texto: prefijo }, ...aplanarInline(itemTokens as Token[])];
            y = dibujarParrafo(doc, fragmentos, MARGEN + indent + 14, y, anchoMax - indent - 14, 11, 15, agregarPagina);
            const sublistas = item.tokens.filter((tk) => tk.type === 'list') as Tokens.List[];
            sublistas.forEach((sub) => renderTokens([sub], indent + 20));
          });
          y += 6;
          break;
        }
        case 'blockquote': {
          const cita = tok as Tokens.Blockquote;
          const yInicio = y;
          y = dibujarParrafo(
            doc,
            aplanarInline((cita.tokens[0] as Tokens.Paragraph)?.tokens ?? [], { italic: true }),
            MARGEN + indent + 12,
            y,
            anchoMax - indent - 12,
            11,
            15,
            agregarPagina,
          );
          doc.setDrawColor(148, 163, 184);
          doc.setLineWidth(2);
          doc.line(MARGEN + indent + 2, yInicio - 10, MARGEN + indent + 2, y - 10);
          y += 8;
          break;
        }
        case 'code': {
          const bloque = tok as Tokens.Code;
          const lineas = bloque.text.split('\n');
          doc.setFont('courier', 'normal');
          doc.setFontSize(9);
          const altoBloque = lineas.length * 12 + 12;
          if (y + altoBloque > altoPagina - MARGEN) {
            doc.addPage();
            y = MARGEN;
          }
          doc.setFillColor(241, 245, 249);
          doc.rect(MARGEN + indent, y - 2, anchoMax - indent, altoBloque, 'F');
          y += 10;
          for (const linea of lineas) {
            doc.text(linea, MARGEN + indent + 6, y);
            y += 12;
          }
          y += 8;
          break;
        }
        case 'table': {
          const tabla = tok as Tokens.Table;
          autoTable(doc, {
            startY: y,
            margin: { left: MARGEN + indent, right: MARGEN },
            head: [tabla.header.map((celda) => textoPlanoInline(celda.tokens as Token[]))],
            body: tabla.rows.map((fila) => fila.map((celda) => textoPlanoInline(celda.tokens as Token[]))),
            styles: { font: 'helvetica', fontSize: 10, cellPadding: 5, textColor: [15, 23, 42] },
            headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
            alternateRowStyles: { fillColor: [248, 250, 252] },
          });
          y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
          break;
        }
        case 'hr': {
          agregarPagina(10);
          doc.setDrawColor(203, 213, 225);
          doc.line(MARGEN, y - 4, anchoPagina - MARGEN, y - 4);
          y += 6;
          break;
        }
        case 'space':
          break;
        default:
          if (tok.tokens) renderTokens(tok.tokens as Token[], indent);
      }
    }
  };

  renderTokens(tokens);
  return doc;
}

export default function MarkdownAPdf() {
  const [markdown, setMarkdown] = useState(EJEMPLO);
  const [nombre, setNombre] = useState('documento');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerar = () => {
    if (!markdown.trim()) return;
    setError(null);
    setWorking(true);
    try {
      const archivo = (nombre.trim() || 'documento').replace(/\.pdf$/i, '');
      const doc = generarPdf(markdown);
      doc.save(`${archivo}.pdf`);
    } catch (err) {
      console.error('Error al generar el PDF', err);
      setError('No se pudo generar el PDF. Probá de nuevo.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <label className="mb-1 block text-sm text-slate-400">Texto en Markdown</label>
      <textarea
        value={markdown}
        onChange={(e) => setMarkdown(e.target.value)}
        rows={14}
        spellCheck={false}
        className="w-full rounded-xl border border-slate-700 bg-slate-900/40 p-3 font-mono text-sm text-slate-200 focus:border-brand-500/50 focus:outline-none"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-400">Nombre del archivo</label>
        <input
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-1.5 text-sm text-slate-200 focus:border-brand-500/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={handleGenerar}
          disabled={working}
          className="rounded-lg bg-brand-500/10 px-4 py-1.5 text-sm text-brand-400 ring-1 ring-brand-500/30 transition hover:bg-brand-500/20 disabled:opacity-50"
        >
          {working ? 'Generando…' : 'Descargar PDF'}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}
