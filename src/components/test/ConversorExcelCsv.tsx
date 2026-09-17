import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';

type Mode = 'xlsx-a-csv' | 'csv-a-xlsx';

function nombreSinExtension(nombre: string) {
  const idx = nombre.lastIndexOf('.');
  return idx === -1 ? nombre : nombre.slice(0, idx);
}

function descargarBlob(blob: Blob, nombreArchivo: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Conversión 100% client-side (nada se sube a un servidor): se toma siempre
 * la primera hoja del libro. xlsx→csv agrega BOM UTF-8 para que Excel abra
 * bien los acentos; csv→xlsx detecta ; o , como separador antes de parsear.
 */
export default function ConversorExcelCsv() {
  const [mode, setMode] = useState<Mode>('xlsx-a-csv');
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = mode === 'xlsx-a-csv' ? '.xlsx,.xls' : '.csv';

  const handleFile = async (file: File) => {
    setError(null);
    setWorking(true);
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const base = nombreSinExtension(file.name);

      if (mode === 'xlsx-a-csv') {
        const workbook = XLSX.read(buffer, { type: 'array' });
        const hoja = workbook.Sheets[workbook.SheetNames[0]!]!;
        const csv = XLSX.utils.sheet_to_csv(hoja, { FS: ',' });
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        descargarBlob(blob, `${base}.csv`);
      } else {
        const text = new TextDecoder('utf-8').decode(buffer);
        const separador = text.slice(0, text.indexOf('\n')).includes(';') ? ';' : ',';
        const workbook = XLSX.read(text, { type: 'string', FS: separador });
        const outBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
        const blob = new Blob([outBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        descargarBlob(blob, `${base}.xlsx`);
      }
    } catch (err) {
      console.error('Error al convertir el archivo', err);
      setError('No se pudo convertir el archivo. Verificá que sea un archivo válido.');
    } finally {
      setWorking(false);
    }
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  return (
    <div className="max-w-xl">
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setMode('xlsx-a-csv')}
          className={`rounded px-3 py-1.5 text-sm ${
            mode === 'xlsx-a-csv' ? 'bg-brand-500/10 text-brand-400 ring-1 ring-brand-500/30' : 'text-slate-400 hover:bg-slate-800'
          }`}
        >
          Excel → CSV
        </button>
        <button
          type="button"
          onClick={() => setMode('csv-a-xlsx')}
          className={`rounded px-3 py-1.5 text-sm ${
            mode === 'csv-a-xlsx' ? 'bg-brand-500/10 text-brand-400 ring-1 ring-brand-500/30' : 'text-slate-400 hover:bg-slate-800'
          }`}
        >
          CSV → Excel
        </button>
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className="cursor-pointer rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-10 text-center transition hover:border-brand-500/50"
      >
        <p className="text-slate-300">
          {working ? 'Convirtiendo…' : 'Arrastrá un archivo aquí o hacé click para elegirlo'}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          {mode === 'xlsx-a-csv' ? 'Acepta .xlsx / .xls — se toma la primera hoja' : 'Acepta .csv'}
        </p>
        {fileName && !error && <p className="mt-3 text-xs text-slate-400">Último archivo: {fileName}</p>}
        <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={onInputChange} />
      </div>

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}
