import type { APIRoute } from 'astro';
import { z } from 'zod';
import { generateEtiquetaPdf, buildEtiquetaFilename } from '../../lib/etiqueta-pdf';

export const prerender = false;

const listonRowSchema = z.object({
  medida: z.string(),
  largoCm: z.number(),
  piezas: z.number(),
});

const bodySchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha must be YYYY-MM-DD'),
  linea: z.string().trim().min(1).max(50),
  modelos: z.array(z.string()),
  filas1x2: z.array(listonRowSchema),
  filasOtras: z.array(listonRowSchema),
});

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// POST /api/carpinteria-etiqueta — no Odoo access here, just formats data the client already has into a PDF.
export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('JSON inválido', 400);
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues.map((i) => i.message).join('; '), 400);
  }

  try {
    const pdfBytes = await generateEtiquetaPdf(parsed.data);
    const filename = buildEtiquetaFilename(parsed.data.modelos, parsed.data.linea);
    return new Response(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="etiqueta.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'X-Etiqueta-Filename': encodeURIComponent(filename),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[api] etiqueta pdf generation failed', err);
    return jsonError('No se pudo generar el PDF', 500);
  }
};
