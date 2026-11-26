// ============================================================
// electron/licencia.config.ts — Configuración del servidor de licencias de ESTA compilación
//
// Se necesitan dos datos públicos (no son secretos): la URL del servidor de licencias y su clave pública Ed25519 (PEM), con la que la
// aplicación comprueba que una licencia es auténtica. Se toman de LICENSE_SERVER_URL y LICENSE_PUBLIC_KEY (o sus alias
// VENDEYA_LICENCIAS_URL y VENDEYA_LICENCIAS_CLAVE_PUBLICA) y se completan con el primer `licencia.config.json` disponible:
//   { "servidorUrl": "https://…", "clavePublica": "-----BEGIN PUBLIC KEY-----\n…" }
// Sin configuración el licenciamiento queda desactivado (la aplicación lo informa en Ajustes › Licencia) en lugar de bloquear las cajas.
// No importa `electron`: se prueba sin Electron.
// ============================================================
import { existsSync, readFileSync } from "fs";

export interface ConfigLicencia {
  servidorUrl: string;
  clavePublica: string;
}

export interface OpcionesConfigLicencia {
  /** Rutas candidatas de `licencia.config.json` (la primera que exista) */
  rutas: string[];
  env: NodeJS.ProcessEnv;
  registrar?: (mensaje: string) => void;
}

const ES_PEM = /^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\s*$/;

export function cargarDestinoTelemetria(o: OpcionesConfigLicencia): string | undefined {
  const env = o.env["TELEMETRY_URL"]?.trim() || o.env["VENDEYA_TELEMETRIA_URL"];
  if (env) return env;
  const archivo = o.rutas.find((r) => existsSync(r));
  if (archivo) {
    try {
      const j = JSON.parse(readFileSync(archivo, "utf8")) as { telemetriaUrl?: unknown };
      if (typeof j.telemetriaUrl === "string") return j.telemetriaUrl;
    } catch {
      o.registrar?.("No se pudo leer el destino de telemetría");
    }
  }
  return undefined;
}

/** https siempre; http solo contra el propio equipo (desarrollo del servidor de licencias). */
function urlValida(valor: string): string | null {
  try {
    const u = new URL(valor);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1" || u.hostname === "[::1]";
    return u.protocol === "https:" || (u.protocol === "http:" && local) ? u.origin + u.pathname.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

export function cargarConfigLicencia(o: OpcionesConfigLicencia): ConfigLicencia | null {
  const aviso = o.registrar ?? ((): void => undefined);
  let url = o.env["LICENSE_SERVER_URL"]?.trim() || o.env["VENDEYA_LICENCIAS_URL"];
  let clave = (o.env["LICENSE_PUBLIC_KEY"]?.trim() || o.env["VENDEYA_LICENCIAS_CLAVE_PUBLICA"])?.replace(/\\n/g, "\n");

  if (url === undefined || url === "" || clave === undefined || clave === "") {
    const archivo = o.rutas.find((r) => existsSync(r));
    if (archivo !== undefined) {
      try {
        const j = JSON.parse(readFileSync(archivo, "utf8")) as { servidorUrl?: unknown; clavePublica?: unknown };
        if (url === undefined || url === "") url = typeof j.servidorUrl === "string" ? j.servidorUrl : undefined;
        if (clave === undefined || clave === "") clave = typeof j.clavePublica === "string" ? j.clavePublica : undefined;
      } catch {
        aviso(`No se pudo leer ${archivo}: el JSON es inválido`);
        return null;
      }
    }
  }
  if (url === undefined || url === "" || clave === undefined || clave === "") return null;

  const servidorUrl = urlValida(url);
  if (servidorUrl === null) {
    aviso("La URL del servidor de licencias debe ser https (o http://localhost)");
    return null;
  }
  if (!ES_PEM.test(clave)) {
    aviso("La clave pública del servidor de licencias no es un PEM válido");
    return null;
  }
  return { servidorUrl, clavePublica: clave.trim() };
}
