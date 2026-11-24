// ============================================================
// src/server/services/sync/syncCliente.ts — Cliente de la sincronización LAN (lo usa cada caja)
//
// Se conecta al servidor, recuerda el último evento recibido y, si la conexión se cae, reintenta con espera creciente y
// pide `desde=<último seq>` para recibir lo que se perdió. No depende de `ws` ni del navegador: se le entrega una función
// que crea el WebSocket (en el navegador `(url) => new WebSocket(url)`, en Node `(url) => new (require("ws"))(url)`).
// ============================================================
import type { CajaConectada, EventoDifundido } from "./sync.service";

/** Lo mínimo de la interfaz WebSocket que usa el cliente (la cumplen el del navegador y el de `ws`). */
export interface WebSocketLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(code?: number, reason?: string): void;
}

export type EstadoCliente = "DESCONECTADO" | "CONECTANDO" | "CONECTADO";

export interface OpcionesClienteSync {
  /** URL base del servidor, p. ej. `ws://192.168.1.10:3001` */
  url: string;
  token: string;
  cajaId: string;
  crearSocket: (url: string) => WebSocketLike;
  /** Esperas entre reintentos (ms); la última se repite (default 0.5, 1, 2, 5 y 10 s) */
  esperasMs?: number[];
  /** Último evento ya procesado (si la caja lo guardó antes de cerrarse) */
  desdeSeq?: number;
  /** Códigos de cierre con los que NO se reintenta (sesión/permiso: reconectar no lo arregla) */
  sinReintento?: number[];
}

export interface ReceptoresSync {
  evento?: (e: EventoDifundido & { reenviado?: boolean }) => void;
  /** La bitácora no alcanza para reconstruir lo perdido: hay que recargar todo desde la API */
  resync?: () => void;
  presencia?: (evento: "conectada" | "desconectada", caja: CajaConectada) => void;
  estado?: (estado: EstadoCliente) => void;
  /** Cierre definitivo (sin reintento) con su código */
  cerrado?: (codigo: number, motivo: string) => void;
}

export class ClienteSync {
  private socket: WebSocketLike | null = null;
  private seq: number;
  private intentos = 0;
  private temporizador: NodeJS.Timeout | null = null;
  private activo = false;
  private _estado: EstadoCliente = "DESCONECTADO";
  private readonly esperas: number[];
  private readonly sinReintento: Set<number>;

  constructor(private readonly o: OpcionesClienteSync, private readonly receptores: ReceptoresSync = {}) {
    this.seq = o.desdeSeq ?? 0;
    this.esperas = o.esperasMs ?? [500, 1_000, 2_000, 5_000, 10_000];
    // 4401 sin sesión · 4403 módulo apagado · 4408 sesión terminada · 4409 otra conexión ocupó la caja: reconectar no sirve
    this.sinReintento = new Set(o.sinReintento ?? [4401, 4403, 4408, 4409]);
  }

  get estado(): EstadoCliente {
    return this._estado;
  }

  /** Último evento recibido (se envía como `desde` al reconectar). */
  get ultimoSeq(): number {
    return this.seq;
  }

  conectar(): void {
    this.activo = true;
    this.abrir();
  }

  desconectar(): void {
    this.activo = false;
    if (this.temporizador !== null) clearTimeout(this.temporizador);
    this.temporizador = null;
    const s = this.socket;
    this.socket = null;
    s?.close(1000, "Cliente cerrado");
    this.cambiar("DESCONECTADO");
  }

  private cambiar(e: EstadoCliente): void {
    if (this._estado === e) return;
    this._estado = e;
    this.receptores.estado?.(e);
  }

  private urlConexion(): string {
    const q = new URLSearchParams({ token: this.o.token, cajaId: this.o.cajaId });
    if (this.seq > 0) q.set("desde", String(this.seq));
    return `${this.o.url.replace(/\/+$/, "")}/api/sync?${q.toString()}`;
  }

  private abrir(): void {
    if (!this.activo) return;
    this.cambiar("CONECTANDO");
    const socket = this.o.crearSocket(this.urlConexion());
    this.socket = socket;

    socket.onopen = () => {
      this.intentos = 0;
      this.cambiar("CONECTADO");
    };
    socket.onmessage = (ev) => {
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(String(ev.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      switch (m["tipo"]) {
        case "hola": {
          // Una caja nueva parte del evento actual. Una que vuelve conserva su cursor: el servidor le reenvía lo que se perdió
          // y cada evento lo irá adelantando (adelantarlo aquí haría descartar justo esos eventos).
          if (this.seq === 0 && typeof m["seq"] === "number") this.seq = m["seq"];
          break;
        }
        case "resync": {
          // Lo perdido no se puede reconstruir: el receptor recarga todo desde la API y el cursor salta al evento actual
          this.receptores.resync?.();
          if (typeof m["seq"] === "number") this.seq = m["seq"];
          break;
        }
        case "evento": {
          const e = m as unknown as EventoDifundido & { reenviado?: boolean };
          if (typeof e.seq === "number" && e.seq > this.seq) {
            this.seq = e.seq;
            this.receptores.evento?.(e);
          }
          break;
        }
        case "presencia":
          this.receptores.presencia?.(m["evento"] as "conectada" | "desconectada", m["caja"] as CajaConectada);
          break;
        default:
          break;
      }
    };
    socket.onerror = () => undefined; // el cierre que sigue decide qué hacer
    socket.onclose = (ev) => {
      if (this.socket !== socket) return; // un socket anterior ya reemplazado
      this.socket = null;
      this.cambiar("DESCONECTADO");
      if (!this.activo) return;
      if (this.sinReintento.has(ev.code)) {
        this.activo = false;
        this.receptores.cerrado?.(ev.code, ev.reason ?? "");
        return;
      }
      const espera = this.esperas[Math.min(this.intentos, this.esperas.length - 1)] ?? 1_000;
      this.intentos += 1;
      this.temporizador = setTimeout(() => this.abrir(), espera);
    };
  }
}
