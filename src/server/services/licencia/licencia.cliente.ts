// ============================================================
// src/server/services/licencia/licencia.cliente.ts — Cliente del servidor de licencias
//
// CONTRATO (todas las llamadas son POST con JSON a `<servidor>/v1/licencias/...`; las respuestas de error traen `{error, mensaje?}`):
//   /activar      {clave, ruc, dispositivo:{id,nombre,plataforma,version}}      → 200 {token}
//   /validar      {token, dispositivo:{...}}                                    → 200 {token}  (el servidor renueva la licencia firmada)
//   /desactivar   {token, dispositivoId}                                        → 204          (libera la plaza de ese equipo)
//   /dispositivos {token}                                                       → 200 {maximo, dispositivos:[{id,nombre,plataforma,ultimoUso}]}
//   /liberar      {token, dispositivoId}                                        → 204          (libera la plaza de otro equipo)
//   Errores: CLAVE_INVALIDA (404) · RUC_NO_COINCIDE (403) · REVOCADA (403) · SUSCRIPCION_VENCIDA (402) ·
//            LIMITE_DISPOSITIVOS (409, con `maximo` y `dispositivos`) · DISPOSITIVO_NO_REGISTRADO (409)
// El token es la licencia firmada (ver licencia.token.ts). El servidor real aún no existe: las pruebas usan uno simulado.
// ============================================================
import { z } from "zod";

export interface DatosDispositivo {
  id: string;
  nombre: string;
  plataforma: string;
  version: string;
}

export interface DispositivoRemoto {
  id: string;
  nombre: string;
  plataforma: string;
  ultimoUso: string | null;
}

export interface ListaDispositivos {
  maximo: number;
  dispositivos: DispositivoRemoto[];
}

export interface ClienteLicencias {
  activar(p: { clave: string; ruc: string; dispositivo: DatosDispositivo }): Promise<{ token: string }>;
  validar(p: { token: string; dispositivo: DatosDispositivo }): Promise<{ token: string }>;
  desactivar(p: { token: string; dispositivoId: string }): Promise<void>;
  dispositivos(p: { token: string }): Promise<ListaDispositivos>;
  liberar(p: { token: string; dispositivoId: string }): Promise<void>;
}

export type CodigoErrorLicencias =
  | "SIN_CONEXION"
  | "ERROR_SERVIDOR"
  | "RESPUESTA_INVALIDA"
  | "CLAVE_INVALIDA"
  | "RUC_NO_COINCIDE"
  | "REVOCADA"
  | "SUSCRIPCION_VENCIDA"
  | "LIMITE_DISPOSITIVOS"
  | "DISPOSITIVO_NO_REGISTRADO";

const CODIGOS_DEL_SERVIDOR: ReadonlySet<string> = new Set(["CLAVE_INVALIDA", "RUC_NO_COINCIDE", "REVOCADA", "SUSCRIPCION_VENCIDA", "LIMITE_DISPOSITIVOS", "DISPOSITIVO_NO_REGISTRADO"]);

const MENSAJE_POR_DEFECTO: Record<CodigoErrorLicencias, string> = {
  SIN_CONEXION: "No se pudo comunicar con el servidor de licencias. Revise la conexión a internet.",
  ERROR_SERVIDOR: "El servidor de licencias no está disponible en este momento. Intente más tarde.",
  RESPUESTA_INVALIDA: "El servidor de licencias respondió algo inesperado.",
  CLAVE_INVALIDA: "La clave de activación no existe. Revise que esté bien escrita.",
  RUC_NO_COINCIDE: "Esta clave pertenece a otra empresa (el RUC no coincide).",
  REVOCADA: "La licencia fue revocada. Contacte a su proveedor.",
  SUSCRIPCION_VENCIDA: "La suscripción de esta licencia está vencida. Renuévela para activarla.",
  LIMITE_DISPOSITIVOS: "Se alcanzó el número de equipos que permite el plan. Libere uno para activar este.",
  DISPOSITIVO_NO_REGISTRADO: "Este equipo ya no está registrado en la licencia.",
};

export class ErrorLicencias extends Error {
  constructor(readonly codigo: CodigoErrorLicencias, mensaje?: string, readonly detalle?: unknown) {
    super(mensaje ?? MENSAJE_POR_DEFECTO[codigo]);
    this.name = "ErrorLicencias";
  }
  /** Fallos pasajeros (sin red, servidor caído): no cambian el estado de la licencia, solo cuentan como «no se pudo validar» */
  get transitorio(): boolean {
    return this.codigo === "SIN_CONEXION" || this.codigo === "ERROR_SERVIDOR" || this.codigo === "RESPUESTA_INVALIDA";
  }
}

const RespuestaToken = z.object({ token: z.string().min(1) });
const RespuestaDispositivos = z.object({
  maximo: z.number().int().min(1),
  dispositivos: z.array(z.object({ id: z.string(), nombre: z.string(), plataforma: z.string(), ultimoUso: z.string().nullable().optional().transform((v) => v ?? null) })),
});

export interface OpcionesClienteHttp {
  fetchFn?: typeof fetch;
  /** Tiempo máximo de cada llamada (default 15 s) */
  timeoutMs?: number;
}

export class ClienteLicenciasHttp implements ClienteLicencias {
  private readonly base: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(servidorUrl: string, opciones: OpcionesClienteHttp = {}) {
    this.base = servidorUrl.replace(/\/+$/, "");
    this.fetchFn = opciones.fetchFn ?? fetch;
    this.timeoutMs = opciones.timeoutMs ?? 15_000;
  }

  async activar(p: { clave: string; ruc: string; dispositivo: DatosDispositivo }): Promise<{ token: string }> {
    return this.pedir("activar", p, RespuestaToken);
  }
  async validar(p: { token: string; dispositivo: DatosDispositivo }): Promise<{ token: string }> {
    return this.pedir("validar", p, RespuestaToken);
  }
  async desactivar(p: { token: string; dispositivoId: string }): Promise<void> {
    await this.pedir("desactivar", p, null);
  }
  async dispositivos(p: { token: string }): Promise<ListaDispositivos> {
    return this.pedir("dispositivos", p, RespuestaDispositivos);
  }
  async liberar(p: { token: string; dispositivoId: string }): Promise<void> {
    await this.pedir("liberar", p, null);
  }

  private async pedir<T>(ruta: string, cuerpo: unknown, esquema: z.ZodSchema<T> | null): Promise<T> {
    let respuesta: Response;
    try {
      respuesta = await this.fetchFn(`${this.base}/v1/licencias/${ruta}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(cuerpo),
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ErrorLicencias("SIN_CONEXION");
    }
    if (respuesta.status === 204 || (respuesta.ok && esquema === null)) return undefined as T;
    let datos: unknown = null;
    try {
      datos = await respuesta.json();
    } catch {
      /* sin cuerpo JSON */
    }
    if (!respuesta.ok) {
      const d = (datos ?? {}) as { error?: unknown; mensaje?: unknown };
      const codigo = typeof d.error === "string" && CODIGOS_DEL_SERVIDOR.has(d.error) ? (d.error as CodigoErrorLicencias) : "ERROR_SERVIDOR";
      throw new ErrorLicencias(codigo, typeof d.mensaje === "string" && d.mensaje !== "" ? d.mensaje : undefined, datos);
    }
    const r = esquema?.safeParse(datos);
    if (r === undefined || !r.success) throw new ErrorLicencias("RESPUESTA_INVALIDA");
    return r.data;
  }
}
