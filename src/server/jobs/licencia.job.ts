// ============================================================
// src/server/jobs/licencia.job.ts — Validación periódica de la licencia en línea
//
// Valida poco después de arrancar y luego cada 24 horas. Si no hay conexión no pasa nada: corre el período de gracia offline.
// Nunca lanza ni bloquea las ventas.
// ============================================================
import type { LicenciaService } from "../services/licencia/licencia.service";

export interface OpcionesLicenciaWorker {
  /** Espera antes de la primera validación (default 20 s: no compite con el arranque) */
  primeraMs?: number;
  /** Cada cuánto se valida (default 24 h) */
  intervaloMs?: number;
  alError?: (e: unknown) => void;
}

export class LicenciaWorker {
  private primera: NodeJS.Timeout | null = null;
  private periodico: NodeJS.Timeout | null = null;
  private ciclo: Promise<void> | null = null;

  constructor(private readonly licencias: LicenciaService, private readonly o: OpcionesLicenciaWorker = {}) {}

  get corriendo(): boolean {
    return this.periodico !== null;
  }

  iniciar(): void {
    if (this.periodico !== null || !this.licencias.habilitada) return;
    this.primera = setTimeout(() => void this.validar(), this.o.primeraMs ?? 20_000);
    this.periodico = setInterval(() => void this.validar(), this.o.intervaloMs ?? 24 * 60 * 60_000);
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

  /** Una validación ahora (también la usan las pruebas). */
  validar(): Promise<void> {
    this.ciclo = this.licencias.validarTodas().catch((e) => (this.o.alError ?? ((x) => console.error("[licencia]", x)))(e));
    return this.ciclo;
  }
}
