// ============================================================
// src/server/jobs/sriWorker.job.ts — Worker en segundo plano de la cola del SRI
//
// Revisa la cola cada `intervaloMs` y envía de uno en uno (orden cronológico). Corre aparte de las ventas: ninguna
// operación de caja lo espera. Al arrancar libera lo que quedó EN_PROCESO por un cierre a mitad de un envío.
// ============================================================
import type { EnvioSriService } from "../services/sri/envioSri.service";

export interface OpcionesSriWorker {
  /** Espera entre revisiones cuando no hay trabajo (default 15 s) */
  intervaloMs?: number;
  /** Máximo de comprobantes por ciclo (default 20) */
  lote?: number;
  /** Un envío EN_PROCESO más viejo que esto se considera abandonado (default 10 min) */
  huerfanoMs?: number;
  /** Recibe los errores inesperados del ciclo (default: consola) */
  alError?: (e: unknown) => void;
}

export class SriWorker {
  private readonly intervaloMs: number;
  private readonly lote: number;
  private readonly huerfanoMs: number;
  private readonly alError: (e: unknown) => void;
  private temporizador: NodeJS.Timeout | null = null;
  private ciclo: Promise<void> | null = null;
  private activo = false;

  constructor(private readonly envio: EnvioSriService, opciones: OpcionesSriWorker = {}) {
    this.intervaloMs = opciones.intervaloMs ?? 15_000;
    this.lote = opciones.lote ?? 20;
    this.huerfanoMs = opciones.huerfanoMs ?? 10 * 60_000;
    this.alError = opciones.alError ?? ((e) => console.error("[sri-worker]", e));
    this.envio.alHaberTrabajo(() => this.despertar());
  }

  get corriendo(): boolean {
    return this.activo;
  }

  /** Arranca el worker (recupera lo interrumpido y programa el primer ciclo). */
  async iniciar(): Promise<void> {
    if (this.activo) return;
    this.activo = true;
    try {
      await this.envio.recuperarEnProceso(null);
    } catch (e) {
      this.alError(e);
    }
    this.programar(0);
  }

  /** Detiene el worker esperando a que termine el envío en curso. */
  async detener(): Promise<void> {
    this.activo = false;
    if (this.temporizador !== null) clearTimeout(this.temporizador);
    this.temporizador = null;
    if (this.ciclo !== null) await this.ciclo;
  }

  /** Adelanta la próxima revisión (hay trabajo nuevo). */
  despertar(): void {
    if (this.activo && this.ciclo === null) this.programar(0);
  }

  /** Un ciclo completo; devuelve cuántos comprobantes trató. Se expone para pruebas y uso manual. */
  async ejecutarCiclo(): Promise<number> {
    await this.envio.recuperarEnProceso(this.huerfanoMs);
    return this.envio.procesarCola(this.lote);
  }

  private programar(esperaMs: number): void {
    if (!this.activo) return;
    if (this.temporizador !== null) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      this.temporizador = null;
      this.ciclo = this.ejecutarCiclo()
        .then((tratados) => tratados)
        .catch((e: unknown) => {
          this.alError(e);
          return 0;
        })
        .then((tratados) => {
          this.ciclo = null;
          // Si hubo trabajo, se vuelve a revisar enseguida; si no, se espera el intervalo
          this.programar(tratados > 0 ? 0 : this.intervaloMs);
        });
    }, esperaMs);
    this.temporizador.unref();
  }
}
