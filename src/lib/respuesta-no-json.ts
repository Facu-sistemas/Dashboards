/**
 * El servidor contestó con una página (HTML) en vez de datos: pasa durante un deploy, con la sesión vencida (el middleware
 * redirige a /login) o con una ruta caída. Se distingue de un error "normal" de la API (que sí viene en JSON) para poder
 * recuperarse recargando la página.
 */
export class RespuestaNoJsonError extends Error {
  constructor(
    readonly status: number,
    readonly sesionVencida: boolean
  ) {
    super(
      sesionVencida
        ? 'La sesión venció — recargá la página e iniciá sesión de nuevo.'
        : `El servidor no devolvió datos (${status}). Recargá la página; si sigue, avisá a sistemas.`
    );
    this.name = 'RespuestaNoJsonError';
  }
}

/** Tira RespuestaNoJsonError si la respuesta no es JSON. */
export function exigirJson(res: Response): void {
  if (!(res.headers.get('content-type') ?? '').includes('json')) {
    throw new RespuestaNoJsonError(res.status, res.redirected && res.url.includes('/login'));
  }
}
