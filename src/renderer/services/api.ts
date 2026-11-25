// ============================================================
// src/renderer/services/api.ts — Cliente HTTP del backend local (token de sesión, errores del dominio)
// ============================================================

/** Error de la API: `codigo` es el del dominio (TURNO_REQUERIDO, STOCK_INSUFICIENTE…) o SIN_CONEXION / ERROR_INTERNO. */
export class ApiError extends Error {
  constructor(readonly codigo: string, mensaje: string, readonly status: number) {
    super(mensaje);
    this.name = "ApiError";
  }
}

export interface ConfigApi {
  baseUrl: string;
  obtenerToken: () => string | null;
  /** Identifica esta caja ante el servidor (cabecera `x-caja-id`) */
  cajaId: string;
  /** Se invoca cuando el servidor responde 401 con una sesión que ya no vale */
  alNoAutenticado?: () => void;
  fetchFn?: typeof fetch;
}

export type Metodo = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export class ApiCliente {
  constructor(private readonly cfg: ConfigApi) {}

  get baseUrl(): string {
    return this.cfg.baseUrl;
  }

  get cajaId(): string {
    return this.cfg.cajaId;
  }

  token(): string | null {
    return this.cfg.obtenerToken();
  }

  async solicitar<T>(metodo: Metodo, ruta: string, cuerpo?: unknown): Promise<T> {
    const token = this.cfg.obtenerToken();
    const cabeceras: Record<string, string> = { "x-caja-id": this.cfg.cajaId };
    if (token !== null) cabeceras["authorization"] = `Bearer ${token}`;
    if (cuerpo !== undefined) cabeceras["content-type"] = "application/json";

    let respuesta: Response;
    try {
      respuesta = await (this.cfg.fetchFn ?? fetch)(`${this.cfg.baseUrl}${ruta}`, {
        method: metodo,
        headers: cabeceras,
        ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
      });
    } catch {
      throw new ApiError("SIN_CONEXION", "No se pudo comunicar con el servidor. Revise la conexión de la caja.", 0);
    }

    if (respuesta.status === 204) return undefined as T;
    let datos: unknown = null;
    try {
      datos = await respuesta.json();
    } catch {
      /* cuerpo vacío o no JSON */
    }
    if (!respuesta.ok) {
      const d = (datos ?? {}) as { error?: string; mensaje?: string };
      if (respuesta.status === 401 && token !== null) this.cfg.alNoAutenticado?.();
      throw new ApiError(d.error ?? "ERROR_INTERNO", d.mensaje ?? `El servidor respondió ${respuesta.status}`, respuesta.status);
    }
    return datos as T;
  }

  /** Descarga un archivo (CSV, PDF, XML) con la sesión del cajero; el nombre sale de `Content-Disposition`. */
  async archivo(ruta: string): Promise<{ blob: Blob; nombre: string }> {
    const token = this.cfg.obtenerToken();
    const cabeceras: Record<string, string> = { "x-caja-id": this.cfg.cajaId };
    if (token !== null) cabeceras["authorization"] = `Bearer ${token}`;
    let respuesta: Response;
    try {
      respuesta = await (this.cfg.fetchFn ?? fetch)(`${this.cfg.baseUrl}${ruta}`, { method: "GET", headers: cabeceras });
    } catch {
      throw new ApiError("SIN_CONEXION", "No se pudo comunicar con el servidor. Revise la conexión de la caja.", 0);
    }
    if (!respuesta.ok) {
      let d: { error?: string; mensaje?: string } = {};
      try {
        d = (await respuesta.json()) as typeof d;
      } catch {
        /* sin cuerpo */
      }
      if (respuesta.status === 401 && token !== null) this.cfg.alNoAutenticado?.();
      throw new ApiError(d.error ?? "ERROR_INTERNO", d.mensaje ?? `El servidor respondió ${respuesta.status}`, respuesta.status);
    }
    const nombre = /filename="([^"]+)"/.exec(respuesta.headers.get("content-disposition") ?? "")?.[1] ?? "archivo";
    return { blob: await respuesta.blob(), nombre };
  }

  get<T>(ruta: string): Promise<T> {
    return this.solicitar<T>("GET", ruta);
  }

  post<T>(ruta: string, cuerpo?: unknown): Promise<T> {
    return this.solicitar<T>("POST", ruta, cuerpo ?? {});
  }

  patch<T>(ruta: string, cuerpo: unknown): Promise<T> {
    return this.solicitar<T>("PATCH", ruta, cuerpo);
  }
}

/** Query string con solo los valores presentes. */
export function consulta(parametros: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(parametros)) if (v !== undefined && v !== "") q.set(k, String(v));
  const texto = q.toString();
  return texto === "" ? "" : `?${texto}`;
}
