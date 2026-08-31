import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabaseAdminClient } from '../../../lib/supabase/admin';
import { jsonResponse } from '../../../lib/api-helpers';
import { AREA_SLUGS } from '../../../lib/areas.config';

export const prerender = false;

const areaSlugSchema = z.string().refine((s) => AREA_SLUGS.includes(s), { message: 'area_slug inválido' });

const createSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, 'El usuario solo puede tener minúsculas, números y guiones'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
  nombreCompleto: z.string().trim().optional(),
  areas: z.array(areaSlugSchema),
});

const toggleSchema = z.object({
  userId: z.string().uuid(),
  areaSlug: areaSlugSchema,
  activo: z.boolean(),
});

function requireDev(context: { locals: App.Locals }): Response | null {
  if (context.locals.usuario?.rol !== 'dev') {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return null;
}

// POST /api/admin/usuarios — crea una cuenta de área: usuario en Supabase Auth + perfiles + permisos_modulo.
export const POST: APIRoute = async (context) => {
  const denied = requireDev(context);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') }, { status: 400 });
  }

  const { username, password, nombreCompleto, areas } = parsed.data;
  const email = `${username}@interno.com`;
  const admin = getSupabaseAdminClient();

  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError) {
    return jsonResponse({ ok: false, error: createError.message }, { status: 400 });
  }

  const { error: perfilError } = await admin
    .from('perfiles')
    .insert({ id: created.user.id, username, nombre_completo: nombreCompleto || null, rol: 'usuario' });
  if (perfilError) {
    // Sin perfil no hay cuenta usable — no dejar un usuario de Auth huérfano.
    await admin.auth.admin.deleteUser(created.user.id);
    return jsonResponse({ ok: false, error: perfilError.message }, { status: 400 });
  }

  if (areas.length > 0) {
    const rows = areas.map((area_slug) => ({ user_id: created.user.id, area_slug, activo: true }));
    const { error: permisosError } = await admin.from('permisos_modulo').insert(rows);
    if (permisosError) {
      return jsonResponse({ ok: false, error: permisosError.message }, { status: 400 });
    }
  }

  return jsonResponse({ ok: true, data: { id: created.user.id, username } });
};

// PATCH /api/admin/usuarios — togglea (upsert) el permiso de UN área para UN usuario existente.
export const PATCH: APIRoute = async (context) => {
  const denied = requireDev(context);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }

  const parsed = toggleSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') }, { status: 400 });
  }

  const admin = getSupabaseAdminClient();
  const { error } = await admin
    .from('permisos_modulo')
    .upsert(
      { user_id: parsed.data.userId, area_slug: parsed.data.areaSlug, activo: parsed.data.activo },
      { onConflict: 'user_id,area_slug' }
    );
  if (error) {
    return jsonResponse({ ok: false, error: error.message }, { status: 400 });
  }

  return jsonResponse({ ok: true });
};
