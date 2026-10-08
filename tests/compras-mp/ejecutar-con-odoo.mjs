// Corre un script .ts que usa los conectores de Odoo del proyecto (src/lib/...), fuera de Astro.
// Los conectores leen `import.meta.env` (Vite); acá se empaquetan con esbuild reemplazándolo por process.env.
// SOLO LECTURA: los conectores no tienen ninguna operación de escritura.
//
// Uso: node --env-file=.env tests/compras-mp/ejecutar-con-odoo.mjs <script.ts> [argumentos...]
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [entrada, ...args] = process.argv.slice(2);
if (!entrada) throw new Error('Uso: ejecutar-con-odoo.mjs <script.ts> [argumentos]');
const tmp = mkdtempSync(join(tmpdir(), 'compras-mp-'));
const salida = join(tmp, 'script.mjs');
try {
  await build({
    entryPoints: [resolve(entrada)],
    outfile: salida,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    jsx: 'automatic',
    define: { 'import.meta.env': '__env' },
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url); const __env = process.env;" },
    logLevel: 'error',
  });
  process.argv = [process.argv[0], salida, ...args];
  await import(pathToFileURL(salida).href);
} finally {
  // se limpia al terminar el proceso (los imports dinámicos pueden seguir corriendo)
  process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
}
