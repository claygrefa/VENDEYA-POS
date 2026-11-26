// ============================================================
// src/server/services/telemetria/telemetria.service.ts — Telemetría opcional de errores
//
//   · DESACTIVADA por defecto: sin consentimiento expreso del administrador no se guarda ni se envía nada (los reportes se descartan).
//   · Con consentimiento, cada error se limpia de datos personales (telemetria.util.ts) y queda en una cola local de 50 reportes que el
//     administrador puede revisar («vista previa»), descartar o enviar. Revocar el consentimiento borra la cola.
//   · El envío va detrás de `TransporteTelemetria` (sustituible). Sin destino configurado los reportes solo se acumulan.
//   · Archivos en la carpeta de secretos: `telemetria.json` (consentimiento, id aleatorio de la instalación) y `telemetria-cola.json`.
// ============================================================
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { z } from "zod";
import type { EstadoTelemetria, LoteTelemetria, ReporteError } from "../../../shared/types/telemetria.types";
import { AppError } from "../appError.util";
import { parsear } from "../validation.util";
import { construirReporte, EntradaErrorSchema } from "./telemetria.util";
import { renombrarConReintento } from "../archivo.util";

export const MAX_COLA = 50;
const ARCHIVO_CONFIG = "telemetria.json";
const ARCHIVO_COLA = "telemetria-cola.json";

export interface TransporteTelemetria {
  enviar(lote: LoteTelemetria): Promise<void>;
}

/** Envía el lote como JSON a un servidor: solo https, o http hacia este mismo equipo (desarrollo/pruebas). */
export class TransporteHttp implements TransporteTelemetria {
  constructor(
    private readonly url: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly esperaMs = 10_000
  ) {
    const u = new URL(url);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) throw new Error("El destino de la telemetría debe ser https");
  }

  async enviar(lote: LoteTelemetria): Promise<void> {
    const r = await this.fetchFn(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(lote),
      signal: AbortSignal.timeout(this.esperaMs),
    });
    if (!r.ok) throw new Error(`El servidor de telemetría respondió ${r.status}`);
  }
}

export interface OpcionesTelemetria {
  directorio: string;
  version: string;
  plataforma?: string;
  transporte?: TransporteTelemetria | null;
  /** Enviar solos los reportes al registrarlos (default: sí, si hay transporte) */
  autoEnviar?: boolean;
  ahora?: () => Date;
}

interface Config {
  consentimiento: boolean;
  desde: string | null;
  instalacion: string;
  ultimoEnvio: string | null;
}

const ConsentimientoSchema = z.object({ consentimiento: z.boolean() });

export class TelemetriaService {
  private enviando: Promise<number> | null = null;
  private ultimoAutoEnvio = 0;
  /** Id de instalación mientras no se haya guardado la configuración (estable durante la vida del proceso) */
  private readonly idProvisional = randomUUID();

  constructor(private readonly o: OpcionesTelemetria) {}

  private get ahora(): Date {
    return (this.o.ahora ?? (() => new Date()))();
  }
  private ruta(archivo: string): string {
    return path.join(this.o.directorio, archivo);
  }

  private leerConfig(): Config {
    try {
      const c = JSON.parse(readFileSync(this.ruta(ARCHIVO_CONFIG), "utf8")) as Partial<Config>;
      if (typeof c.instalacion === "string") {
        return { consentimiento: c.consentimiento === true, desde: c.desde ?? null, instalacion: c.instalacion, ultimoEnvio: c.ultimoEnvio ?? null };
      }
    } catch {
      /* primera vez o archivo ilegible: se parte de «sin consentimiento» */
    }
    return { consentimiento: false, desde: null, instalacion: this.idProvisional, ultimoEnvio: null };
  }

  private guardar(nombre: string, datos: unknown): void {
    mkdirSync(this.o.directorio, { recursive: true });
    const destino = this.ruta(nombre);
    const temporal = `${destino}.tmp`;
    writeFileSync(temporal, JSON.stringify(datos), { mode: 0o600 });
    renombrarConReintento(temporal, destino);
  }

  private leerCola(): ReporteError[] {
    try {
      const c = JSON.parse(readFileSync(this.ruta(ARCHIVO_COLA), "utf8")) as unknown;
      return Array.isArray(c) ? (c as ReporteError[]) : [];
    } catch {
      return [];
    }
  }

  estado(): EstadoTelemetria {
    const c = this.leerConfig();
    return {
      consentimiento: c.consentimiento,
      desde: c.desde,
      instalacion: c.instalacion,
      pendientes: this.leerCola().length,
      destinoConfigurado: (this.o.transporte ?? null) !== null,
      ultimoEnvio: c.ultimoEnvio,
    };
  }

  /** Activa o desactiva. Desactivar borra lo que estuviera en la cola: el negocio retira su consentimiento y nada queda guardado. */
  configurar(entrada: unknown): EstadoTelemetria {
    const { consentimiento } = parsear(ConsentimientoSchema, entrada);
    const c = this.leerConfig();
    if (consentimiento !== c.consentimiento || !existsSync(this.ruta(ARCHIVO_CONFIG))) {
      this.guardar(ARCHIVO_CONFIG, { ...c, consentimiento, desde: consentimiento ? this.ahora.toISOString() : null });
    }
    if (!consentimiento) rmSync(this.ruta(ARCHIVO_COLA), { force: true });
    return this.estado();
  }

  /** Registra un error (ya limpio). Devuelve false si no hay consentimiento: no se guarda nada. Nunca lanza por datos mal formados. */
  registrar(entrada: unknown, forzarOrigen?: "servidor"): boolean {
    if (!this.leerConfig().consentimiento) return false;
    const r = EntradaErrorSchema.safeParse(entrada);
    if (!r.success) return false;
    const reporte = construirReporte(
      { ...r.data, origen: forzarOrigen ?? r.data.origen },
      { id: randomUUID(), fecha: this.ahora.toISOString(), version: this.o.version, plataforma: this.o.plataforma ?? `${process.platform}-${process.arch}` }
    );
    const cola = this.leerCola();
    const previo = cola.at(-1);
    if (previo !== undefined && previo.mensaje === reporte.mensaje && previo.pila === reporte.pila && Date.parse(reporte.fecha) - Date.parse(previo.fecha) < 5_000) return true; // ráfaga del mismo error
    cola.push(reporte);
    this.guardar(ARCHIVO_COLA, cola.slice(-MAX_COLA));
    if ((this.o.transporte ?? null) !== null && this.o.autoEnviar !== false && Date.now() - this.ultimoAutoEnvio > 60_000) {
      this.ultimoAutoEnvio = Date.now();
      void this.enviar().catch(() => undefined); // el fallo queda en la cola para el siguiente intento
    }
    return true;
  }

  /** Error del servidor (500) capturado por el manejador global. Nunca lanza. */
  registrarError(error: unknown): void {
    try {
      const e = error instanceof Error ? error : new Error(String(error));
      this.registrar({ origen: "servidor", mensaje: e.message === "" ? e.name : `${e.name}: ${e.message}`, pila: e.stack ?? null }, "servidor");
    } catch {
      /* la telemetría jamás debe causar otro error */
    }
  }

  /** Lo que se enviaría ahora: la vista previa que ve el administrador. */
  pendientes(): ReporteError[] {
    return this.leerCola();
  }

  descartar(): number {
    const n = this.leerCola().length;
    rmSync(this.ruta(ARCHIVO_COLA), { force: true });
    return n;
  }

  /** Envía la cola; solo se borra lo que el servidor aceptó. */
  enviar(): Promise<number> {
    this.enviando ??= this.ejecutarEnvio().finally(() => {
      this.enviando = null;
    });
    return this.enviando;
  }

  private async ejecutarEnvio(): Promise<number> {
    const config = this.leerConfig();
    if (!config.consentimiento) throw new AppError("ESTADO_INVALIDO", "La telemetría está desactivada");
    const transporte = this.o.transporte ?? null;
    if (transporte === null) throw new AppError("ESTADO_INVALIDO", "No hay un servidor de telemetría configurado: los reportes se conservan para revisarlos");
    const lote = this.leerCola();
    if (lote.length === 0) return 0;
    try {
      await transporte.enviar({ instalacion: config.instalacion, reportes: lote });
    } catch (e) {
      throw new AppError("ESTADO_INVALIDO", `No se pudo enviar (se reintentará): ${e instanceof Error ? e.message : String(e)}`);
    }
    const enviados = new Set(lote.map((r) => r.id));
    this.guardar(ARCHIVO_COLA, this.leerCola().filter((r) => !enviados.has(r.id)));
    this.guardar(ARCHIVO_CONFIG, { ...this.leerConfig(), ultimoEnvio: this.ahora.toISOString() });
    return lote.length;
  }
}
