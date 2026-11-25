// ============================================================
// electron/updater/updater.service.ts — Auto-actualización con descarga silenciosa y respaldo previo de la base de datos
//
// Esta clase NO importa `electron` ni `electron-updater`: recibe el actualizador (AutoUpdaterLike) y las funciones del
// sistema que necesita, de modo que su comportamiento se prueba sin red ni ventanas. `main.ts` la conecta con los reales.
//
// Reglas:
//  - Se busca al iniciar (tras una pausa, para no competir con el arranque) y cada pocas horas; la descarga es silenciosa.
//  - Al terminar de descargar se respalda la base de datos; si el respaldo falla NO se instala sola (se prefiere seguir con la
//    versión actual a arriesgar los datos de la caja).
//  - Nunca se reinicia con una venta en curso: «Reiniciar e instalar» se rechaza mientras la interfaz informe que está ocupada.
//    Si no se pide el reinicio, se instala al cerrar la aplicación, que no interrumpe nada.
// ============================================================
import type { EstadoActualizacion, ResultadoInstalacion } from "../../src/shared/types/actualizacion.types";

/** Lo que usamos del `autoUpdater` de electron-updater. */
export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  /** Canal de publicación: «latest» (estable) o «beta» */
  channel?: string | null;
  allowPrerelease?: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(esSilencioso?: boolean, ejecutarDespues?: boolean): void;
  on(evento: string, escucha: (...args: unknown[]) => void): unknown;
}

export interface OpcionesActualizador {
  updater: AutoUpdaterLike;
  /** Avisa a la interfaz de cada cambio de estado */
  publicar: (estado: EstadoActualizacion) => void;
  /** Respalda la base de datos para instalar `version`; devuelve la ruta (null si este equipo no tiene base local). Debe lanzar si falla. */
  respaldar: (version: string) => Promise<string | null>;
  habilitado: boolean;
  motivoDeshabilitado?: string;
  /** «beta» recibe también las versiones de prueba (prerelease); cualquier otro valor o ninguno = estable */
  canal?: string | undefined;
  /** Cada cuánto se busca (default 4 h) */
  intervaloMs?: number;
  /** Espera antes de la primera búsqueda (default 60 s) */
  primeraRevisionMs?: number;
  ahora?: () => Date;
  registrar?: (mensaje: string, error?: unknown) => void;
}

const CUATRO_HORAS_MS = 4 * 60 * 60 * 1000;

const detalleDe = (e: unknown): string => {
  const texto = e instanceof Error ? e.message : String(e);
  return texto.length > 200 ? `${texto.slice(0, 197)}…` : texto;
};

export class ActualizadorApp {
  private actual: EstadoActualizacion;
  private ocupado = false;
  private instalando = false;
  private iniciado = false;
  private primera: ReturnType<typeof setTimeout> | null = null;
  private periodico: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly o: OpcionesActualizador) {
    this.actual = o.habilitado ? { tipo: "inactivo" } : { tipo: "desactivado", motivo: o.motivoDeshabilitado ?? "Las actualizaciones automáticas están desactivadas" };
  }

  estado(): EstadoActualizacion {
    return this.actual;
  }

  /** La interfaz informa si hay una venta/cobro en curso (impide el reinicio para instalar). */
  fijarOcupado(ocupado: boolean): void {
    this.ocupado = ocupado;
  }

  /** Configura el actualizador, escucha sus eventos y programa las búsquedas. Idempotente. */
  iniciar(): void {
    if (!this.o.habilitado || this.iniciado) return;
    this.iniciado = true;
    const u = this.o.updater;
    u.autoDownload = true; // descarga silenciosa en segundo plano
    u.autoInstallOnAppQuit = true; // si no se pide el reinicio, se instala al cerrar
    configurarCanal(u, this.o.canal);

    u.on("checking-for-update", () => {
      if (this.actual.tipo !== "descargando" && this.actual.tipo !== "lista") this.fijar({ tipo: "buscando" });
    });
    u.on("update-available", (info) => this.fijar({ tipo: "descargando", version: versionDe(info), porcentaje: 0 }));
    u.on("update-not-available", () => {
      if (this.actual.tipo !== "lista") this.fijar({ tipo: "al-dia", revisado: (this.o.ahora?.() ?? new Date()).toISOString() });
    });
    u.on("download-progress", (p) => {
      const version = this.actual.tipo === "descargando" ? this.actual.version : "";
      this.fijar({ tipo: "descargando", version, porcentaje: Math.max(0, Math.min(100, Math.round(porcentajeDe(p)))) });
    });
    u.on("update-downloaded", (info) => void this.alDescargar(versionDe(info)));
    u.on("error", (e) => this.alFallar(e));

    this.primera = setTimeout(() => void this.buscar(), this.o.primeraRevisionMs ?? 60_000);
    this.periodico = setInterval(() => void this.buscar(), this.o.intervaloMs ?? CUATRO_HORAS_MS);
    this.primera.unref?.();
    this.periodico.unref?.();
  }

  detener(): void {
    if (this.primera !== null) clearTimeout(this.primera);
    if (this.periodico !== null) clearInterval(this.periodico);
    this.primera = null;
    this.periodico = null;
  }

  /** Busca ahora (el botón «Buscar actualizaciones»). No hace nada si ya está buscando, descargando o lista. */
  async buscar(): Promise<EstadoActualizacion> {
    if (!this.o.habilitado) return this.actual;
    if (this.actual.tipo === "buscando" || this.actual.tipo === "descargando" || this.actual.tipo === "lista") return this.actual;
    this.fijar({ tipo: "buscando" });
    try {
      await this.o.updater.checkForUpdates();
    } catch (e) {
      this.alFallar(e);
    }
    return this.actual;
  }

  /** «Reiniciar e instalar»: respalda la base de datos y reinicia, salvo que haya una venta en curso o el respaldo falle. */
  async instalar(): Promise<ResultadoInstalacion> {
    if (this.actual.tipo !== "lista" || this.instalando) return { ok: false, motivo: "no-lista", mensaje: "No hay una actualización lista para instalar" };
    if (this.ocupado) return { ok: false, motivo: "ocupado", mensaje: "Hay una venta en curso: termínela antes de reiniciar" };
    const { version } = this.actual;
    let respaldo: string | null;
    try {
      respaldo = await this.o.respaldar(version);
    } catch (e) {
      this.o.registrar?.("No se pudo respaldar la base de datos antes de instalar", e);
      return { ok: false, motivo: "respaldo", mensaje: `No se instaló: falló el respaldo de la base de datos (${detalleDe(e)})` };
    }
    // Mientras se respaldaba pudo empezar una venta
    if (this.ocupado) return { ok: false, motivo: "ocupado", mensaje: "Hay una venta en curso: termínela antes de reiniciar" };
    this.fijar({ tipo: "lista", version, respaldo, aviso: null });
    this.o.updater.autoInstallOnAppQuit = true;
    this.instalando = true;
    this.o.updater.quitAndInstall(false, true);
    return { ok: true };
  }

  /**
   * Se llama al cerrar la aplicación, ANTES de cerrar la base de datos: si hay una actualización lista se vuelve a respaldar (los datos
   * cambiaron desde que se descargó) y, si no se pudo, se cancela la instalación automática de esta vez.
   */
  async antesDeCerrar(): Promise<void> {
    if (this.actual.tipo !== "lista" || this.instalando) return;
    const { version } = this.actual;
    try {
      const respaldo = await this.o.respaldar(version);
      this.fijar({ tipo: "lista", version, respaldo, aviso: null });
      this.o.updater.autoInstallOnAppQuit = true;
    } catch (e) {
      this.o.registrar?.("No se pudo respaldar la base de datos al cerrar: no se instalará la actualización", e);
      this.o.updater.autoInstallOnAppQuit = false;
    }
  }

  private async alDescargar(version: string): Promise<void> {
    let respaldo: string | null = null;
    let aviso: string | null = null;
    try {
      respaldo = await this.o.respaldar(version);
      this.o.updater.autoInstallOnAppQuit = true;
    } catch (e) {
      this.o.registrar?.("No se pudo respaldar la base de datos tras descargar la actualización", e);
      this.o.updater.autoInstallOnAppQuit = false;
      aviso = `No se pudo respaldar la base de datos (${detalleDe(e)}): la actualización no se instalará sola. Pruebe «Reiniciar e instalar» más tarde.`;
    }
    this.fijar({ tipo: "lista", version, respaldo, aviso });
  }

  private alFallar(e: unknown): void {
    this.o.registrar?.("Error de actualización", e);
    // Una actualización ya descargada y respaldada sigue siendo válida aunque falle una búsqueda posterior
    if (this.actual.tipo === "lista") return;
    this.fijar({ tipo: "error", mensaje: `No se pudo comprobar las actualizaciones (${detalleDe(e)}). Se reintentará más tarde.` });
  }

  private fijar(estado: EstadoActualizacion): void {
    this.actual = estado;
    this.o.publicar(estado);
  }
}

/** Estable por omisión; solo `beta` (sin importar mayúsculas) activa las versiones de prueba. Devuelve el canal aplicado. */
export function configurarCanal(u: AutoUpdaterLike, canal: string | undefined): "latest" | "beta" {
  const beta = canal?.trim().toLowerCase() === "beta";
  u.channel = beta ? "beta" : "latest";
  u.allowPrerelease = beta;
  return beta ? "beta" : "latest";
}

function versionDe(info: unknown): string {
  const v = (info as { version?: unknown } | null)?.version;
  return typeof v === "string" ? v : "";
}

function porcentajeDe(p: unknown): number {
  const v = (p as { percent?: unknown } | null)?.percent;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
