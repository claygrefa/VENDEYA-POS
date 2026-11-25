// ============================================================
// src/server/services/limitadorIntentos.util.ts — Freno a la fuerza bruta del inicio de sesión
//
// Cuenta los intentos FALLIDOS por clave (usuario + dirección). Al llegar al máximo dentro de la ventana, esa clave queda bloqueada un
// tiempo: ni siquiera una contraseña correcta entra mientras dure (si no, el bloqueo no frena nada). Un acierto borra el contador.
// El bloqueo es por usuario+dirección, así quien adivina contraseñas no deja fuera al titular que entra desde otra caja, y la tabla
// tiene un tope de claves para que inventar usuarios no agote la memoria.
// ============================================================

export interface OpcionesLimitador {
  /** Fallos seguidos permitidos antes de bloquear (default 5) */
  maxIntentos?: number;
  /** Ventana en la que cuentan los fallos (default 15 min) */
  ventanaMs?: number;
  /** Duración del bloqueo (default 15 min) */
  bloqueoMs?: number;
  /** Tope de claves recordadas a la vez (default 10 000) */
  maxClaves?: number;
  ahora?: () => number;
}

interface Registro {
  fallos: number;
  desde: number;
  bloqueadoHasta: number;
}

export class LimitadorIntentos {
  private readonly registros = new Map<string, Registro>();
  private readonly maxIntentos: number;
  private readonly ventanaMs: number;
  private readonly bloqueoMs: number;
  private readonly maxClaves: number;
  private readonly ahora: () => number;

  constructor(o: OpcionesLimitador = {}) {
    this.maxIntentos = o.maxIntentos ?? 5;
    this.ventanaMs = o.ventanaMs ?? 15 * 60_000;
    this.bloqueoMs = o.bloqueoMs ?? 15 * 60_000;
    this.maxClaves = o.maxClaves ?? 10_000;
    this.ahora = o.ahora ?? Date.now;
  }

  /** Segundos que faltan para poder reintentar; 0 si la clave no está bloqueada. */
  segundosDeBloqueo(clave: string): number {
    const r = this.registros.get(clave);
    if (r === undefined) return 0;
    const restante = r.bloqueadoHasta - this.ahora();
    return restante > 0 ? Math.ceil(restante / 1000) : 0;
  }

  /** Anota un intento fallido; devuelve true si con él la clave quedó bloqueada. */
  registrarFallo(clave: string): boolean {
    const t = this.ahora();
    this.purgar(t);
    let r = this.registros.get(clave);
    if (r === undefined || t - r.desde > this.ventanaMs) {
      r = { fallos: 0, desde: t, bloqueadoHasta: 0 };
      this.registros.set(clave, r);
    }
    r.fallos += 1;
    if (r.fallos >= this.maxIntentos) {
      r.bloqueadoHasta = t + this.bloqueoMs;
      r.fallos = 0;
      r.desde = t;
      return true;
    }
    return false;
  }

  registrarAcierto(clave: string): void {
    this.registros.delete(clave);
  }

  get claves(): number {
    return this.registros.size;
  }

  private purgar(t: number): void {
    for (const [clave, r] of this.registros) {
      if (r.bloqueadoHasta <= t && t - r.desde > this.ventanaMs) this.registros.delete(clave);
    }
    // Con la tabla llena (ataque con usuarios inventados) se descartan primero las más antiguas sin bloqueo activo
    if (this.registros.size >= this.maxClaves) {
      for (const [clave, r] of this.registros) {
        if (r.bloqueadoHasta <= t) this.registros.delete(clave);
        if (this.registros.size < this.maxClaves) break;
      }
    }
  }
}
