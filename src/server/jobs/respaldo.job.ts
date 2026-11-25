// ============================================================
// src/server/jobs/respaldo.job.ts — Respaldo automático diario (local y, si está configurada, copia cifrada en la nube)
//
// Poco después de arrancar y luego cada 6 horas revisa: si el último respaldo automático tiene más de 24 horas (o no existe) toma uno, y
// si hay carpeta de nube configurada y su última copia es igual de vieja la exporta. Así un equipo que se apaga por la noche igual se
// respalda al abrirse. Nunca lanza ni bloquea las ventas; un fallo se informa y se reintenta en el siguiente ciclo.
// ============================================================
import type { RespaldoService } from "../services/respaldo.service";
import type { RespaldoNubeService } from "../services/respaldoNube.service";

export interface OpcionesRespaldoJob {
  /** Espera antes de la primera revisión (default 2 min: no compite con el arranque) */
  primeraMs?: number;
  /** Cada cuánto se revisa (default 6 h) */
  intervaloMs?: number;
  /** Antigüedad a partir de la cual se toma otro respaldo (default 24 h) */
  maxEdadMs?: number;
  alError?: (e: unknown) => void;
  ahora?: () => number;
}

export class RespaldoWorker {
  private primera: NodeJS.Timeout | null = null;
  private periodico: NodeJS.Timeout | null = null;
  private ciclo: Promise<void> | null = null;

  constructor(
    private readonly respaldos: RespaldoService,
    private readonly nube: RespaldoNubeService,
    private readonly o: OpcionesRespaldoJob = {}
  ) {}

  get corriendo(): boolean {
    return this.periodico !== null;
  }

  iniciar(): void {
    if (this.periodico !== null) return;
    this.primera = setTimeout(() => void this.revisar(), this.o.primeraMs ?? 2 * 60_000);
    this.periodico = setInterval(() => void this.revisar(), this.o.intervaloMs ?? 6 * 60 * 60_000);
    this.primera.unref();
    this.periodico.unref();
  }

  async detener(): Promise<void> {
    if (this.primera !== null) clearTimeout(this.primera);
    if (this.periodico !== null) clearInterval(this.periodico);
    this.primera = null;
    this.periodico = null;
    if (this.ciclo !== null) await this.ciclo;
  }

  /** Una revisión ahora (también la usan las pruebas). */
  revisar(): Promise<void> {
    this.ciclo = this.ejecutar().catch((e) => (this.o.alError ?? ((x) => console.error("[respaldo]", x)))(e));
    return this.ciclo;
  }

  private async ejecutar(): Promise<void> {
    const ahora = (this.o.ahora ?? Date.now)();
    const maxEdad = this.o.maxEdadMs ?? 24 * 60 * 60_000;
    const estado = this.nube.estado();
    const fallos: unknown[] = [];
    try {
      const ultimo = this.respaldos.ultimo("automatico");
      if (ultimo === null || ahora - ultimo.creado.getTime() > maxEdad) await this.respaldos.crear("automatico");
    } catch (e) {
      fallos.push(e);
    }
    try {
      if (estado.configurada && !estado.requiereReconfigurar) {
        const ultima = estado.ultima === null ? null : Date.parse(estado.ultima.creado);
        if (ultima === null || ahora - ultima > maxEdad) await this.nube.exportar();
      }
    } catch (e) {
      fallos.push(e);
    }
    if (fallos.length > 0) throw fallos[0];
  }
}
