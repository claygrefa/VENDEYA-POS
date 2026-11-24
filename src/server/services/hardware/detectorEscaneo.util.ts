// ============================================================
// src/server/services/hardware/detectorEscaneo.util.ts — Escaneo vs. digitación
//
// Un lector de códigos tipo teclado (HID) «escribe» el código en una ráfaga muy rápida y termina con Enter. Una persona
// escribe con pausas de decenas o cientos de milisegundos y puede corregir con Retroceso. El detector recibe cada tecla con
// su marca de tiempo y, al llegar Enter, decide si fue un escaneo o una digitación manual. Es una función pura (sin DOM
// ni temporizadores): la pantalla del POS le pasa `event.key` y `performance.now()`.
// ============================================================

export interface OpcionesDetector {
  /** Pausa máxima entre dos teclas de una misma ráfaga (default 50 ms: los lectores envían una tecla cada 1–20 ms) */
  maxMsEntreTeclas?: number;
  /** Largo mínimo para considerarlo un código (default 4: evita confundir una tecla suelta con un escaneo) */
  minLongitud?: number;
  /** Largo máximo aceptado (default 64) */
  maxLongitud?: number;
}

export type ResultadoTecla =
  | { tipo: "CARACTER" }
  | { tipo: "IGNORADA" }
  /** Enter tras una ráfaga rápida: lectura del lector de códigos */
  | { tipo: "ESCANEO"; codigo: string }
  /** Enter tras escritura con pausas, correcciones o texto demasiado corto: digitación de la persona */
  | { tipo: "MANUAL"; texto: string }
  | { tipo: "REINICIO" };

export class DetectorEscaneo {
  private readonly maxMs: number;
  private readonly minLongitud: number;
  private readonly maxLongitud: number;
  private buffer = "";
  private ultima = 0;
  /** true si hubo una pausa larga o una corrección: la entrada ya no puede ser de un lector */
  private humano = false;

  constructor(opciones: OpcionesDetector = {}) {
    this.maxMs = opciones.maxMsEntreTeclas ?? 50;
    this.minLongitud = opciones.minLongitud ?? 4;
    this.maxLongitud = opciones.maxLongitud ?? 64;
  }

  /** Lo escrito hasta ahora (para mostrarlo en el campo de búsqueda). */
  get texto(): string {
    return this.buffer;
  }

  teclaPresionada(tecla: string, ahoraMs: number): ResultadoTecla {
    if (tecla === "Enter") {
      const texto = this.buffer;
      const rafaga = !this.humano && texto.length >= this.minLongitud && texto.length <= this.maxLongitud;
      this.reiniciar();
      if (texto === "") return { tipo: "IGNORADA" };
      return rafaga ? { tipo: "ESCANEO", codigo: texto } : { tipo: "MANUAL", texto };
    }
    if (tecla === "Escape") {
      this.reiniciar();
      return { tipo: "REINICIO" };
    }
    if (tecla === "Backspace") {
      this.buffer = this.buffer.slice(0, -1);
      this.humano = true; // los lectores nunca corrigen
      this.ultima = ahoraMs;
      return { tipo: "CARACTER" };
    }
    if (tecla.length !== 1) return { tipo: "IGNORADA" }; // Shift, Control, flechas…

    if (this.buffer !== "" && ahoraMs - this.ultima > this.maxMs) this.humano = true;
    this.buffer += tecla;
    this.ultima = ahoraMs;
    return { tipo: "CARACTER" };
  }

  reiniciar(): void {
    this.buffer = "";
    this.ultima = 0;
    this.humano = false;
  }
}
