// ============================================================
// src/server/services/sync/sync.service.ts — Sincronización multi-caja en red local (LAN) por WebSocket
//
// MODELO: la base de datos (SQLite) vive SOLO en el equipo servidor; las demás cajas son clientes de su API y NO tienen una
// copia. Por eso no hay conflictos de escritura que resolver: cada cambio pasa por una transacción del servidor. Lo que se
// sincroniza es el AVISO: cuando una caja cambia algo (venta, stock, precios, turnos, estado de un comprobante…) el servidor
// difunde un evento numerado y las demás cajas refrescan lo afectado. Cada evento se guarda en la bitácora `EventoSync`,
// de modo que una caja que se desconecta pide `desde=<último seq>` al volver y recibe lo que se perdió (o `resync` si la
// bitácora ya no lo conserva: debe recargar todo).
// ============================================================
import type { PrismaClient } from "@prisma/client";
import type { WebSocket } from "ws";
import type { SessionService } from "../session.service";
import type { UsuarioPublico } from "../usuario.service";

export interface EventoDifundido {
  seq: number;
  modulo: string;
  accion: string;
  ruta: string;
  ids: Record<string, string>;
  usuarioId: string | null;
  cajaId: string | null;
  ts: string;
}

export interface NuevoEvento {
  empresaId: string;
  modulo: string;
  accion: string;
  ruta: string;
  ids?: Record<string, string>;
  usuarioId?: string | null;
  cajaId?: string | null;
}

export interface CajaConectada {
  cajaId: string;
  usuario: string;
  desde: string;
}

/** Códigos de cierre del WebSocket (rango 4000–4999 reservado para la aplicación). */
export const CIERRE_NO_AUTENTICADO = 4401;
export const CIERRE_MODULO_DESHABILITADO = 4403;
export const CIERRE_SESION_REVOCADA = 4408;
export const CIERRE_CAJA_DUPLICADA = 4409;

export interface OpcionesSync {
  /** Cada cuánto se comprueba que la caja siga viva y su sesión vigente (default 15 s) */
  latidoMs?: number;
  /** Eventos que conserva la bitácora por empresa (default 5000) */
  retencion?: number;
  /** Cada cuántos eventos publicados se poda la bitácora (default 200) */
  podarCada?: number;
}

interface Cliente {
  socket: WebSocket;
  token: string;
  empresaId: string;
  usuario: UsuarioPublico;
  cajaId: string;
  desde: Date;
  vivo: boolean;
}

const MAX_CAJA_ID = 64;

/** Id de caja seguro para mostrar y registrar. */
export function limpiarCajaId(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.replace(/[^\p{L}\p{N} ._\-]/gu, "").trim().slice(0, MAX_CAJA_ID);
  return limpio === "" ? null : limpio;
}

export class SyncService {
  private readonly clientes = new Set<Cliente>();
  private readonly latidoMs: number;
  private readonly retencion: number;
  private readonly podarCada: number;
  private temporizador: NodeJS.Timeout | null = null;
  private publicados = 0;
  private readonly cacheHabilitada = new Map<string, { valor: boolean; hasta: number }>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly sesiones: SessionService,
    opciones: OpcionesSync = {}
  ) {
    this.latidoMs = opciones.latidoMs ?? 15_000;
    this.retencion = opciones.retencion ?? 5_000;
    this.podarCada = opciones.podarCada ?? 200;
  }

  // ── Publicación ────────────────────────────────────────────

  /** ¿La empresa tiene activa la sincronización LAN (`ConfiguracionGiro.sincronizacionLAN`)? Se consulta como máximo cada 5 s. */
  async habilitada(empresaId: string): Promise<boolean> {
    const ahora = Date.now();
    const c = this.cacheHabilitada.get(empresaId);
    if (c !== undefined && c.hasta > ahora) return c.valor;
    const g = await this.prisma.configuracionGiro.findUnique({ where: { empresaId }, select: { sincronizacionLAN: true } });
    const valor = g?.sincronizacionLAN ?? false;
    this.cacheHabilitada.set(empresaId, { valor, hasta: ahora + 5_000 });
    return valor;
  }

  /** Olvida lo recordado sobre el interruptor (al cambiar la configuración). */
  olvidarConfiguracion(): void {
    this.cacheHabilitada.clear();
  }

  /** Guarda el evento y lo difunde a todas las cajas conectadas de la empresa. Nunca lanza (un fallo de red local no debe afectar a la operación). */
  async publicar(e: NuevoEvento): Promise<number | null> {
    try {
      if (!(await this.habilitada(e.empresaId))) return null; // sin sincronización LAN no se registra nada
      const fila = await this.prisma.eventoSync.create({
        data: {
          empresaId: e.empresaId,
          modulo: e.modulo,
          accion: e.accion,
          ruta: e.ruta,
          ids: JSON.stringify(e.ids ?? {}),
          usuarioId: e.usuarioId ?? null,
          cajaId: e.cajaId ?? null,
        },
      });
      this.publicados += 1;
      if (this.publicados % this.podarCada === 0) await this.podar(e.empresaId, fila.seq);
      const evento: EventoDifundido = { seq: fila.seq, modulo: e.modulo, accion: e.accion, ruta: e.ruta, ids: e.ids ?? {}, usuarioId: e.usuarioId ?? null, cajaId: e.cajaId ?? null, ts: fila.createdAt.toISOString() };
      for (const c of this.clientes) if (c.empresaId === e.empresaId) this.enviar(c, { tipo: "evento", ...evento });
      return fila.seq;
    } catch {
      return null;
    }
  }

  private async podar(empresaId: string, seqActual: number): Promise<void> {
    await this.prisma.eventoSync.deleteMany({ where: { empresaId, seq: { lt: seqActual - this.retencion } } }).catch(() => undefined);
  }

  // ── Conexiones ─────────────────────────────────────────────

  /**
   * Registra una caja. Valida la sesión y responde `hola` con el último `seq` y las cajas conectadas; si pide `desde`, le
   * reenvía lo que se perdió. Devuelve false (y cierra el socket) si no corresponde.
   */
  async conectar(socket: WebSocket, p: { token: string | null; cajaId: unknown; desde: unknown }): Promise<boolean> {
    const usuario = p.token === null ? null : this.sesiones.obtener(p.token);
    if (p.token === null || usuario === null) {
      socket.close(CIERRE_NO_AUTENTICADO, "Sesión requerida o expirada");
      return false;
    }
    if (!(await this.habilitada(usuario.empresaId))) {
      socket.close(CIERRE_MODULO_DESHABILITADO, "La sincronización LAN no está habilitada");
      return false;
    }
    const cajaId = limpiarCajaId(p.cajaId) ?? `caja-${usuario.username}`;
    // Una caja que se reconecta reemplaza a su conexión anterior (que suele estar muerta pero aún no detectada)
    for (const c of [...this.clientes]) {
      if (c.empresaId === usuario.empresaId && c.cajaId === cajaId) {
        this.clientes.delete(c);
        c.socket.close(CIERRE_CAJA_DUPLICADA, "La caja se conectó desde otra sesión");
      }
    }
    const cliente: Cliente = { socket, token: p.token, empresaId: usuario.empresaId, usuario, cajaId, desde: new Date(), vivo: true };
    this.clientes.add(cliente);

    socket.on("pong", () => {
      cliente.vivo = true;
    });
    socket.on("message", (datos) => {
      cliente.vivo = true;
      try {
        const m = JSON.parse(datos.toString()) as { tipo?: string };
        if (m.tipo === "ping") this.enviar(cliente, { tipo: "pong" });
      } catch {
        /* mensajes ilegibles de un cliente: se ignoran */
      }
    });
    socket.on("close", () => this.retirar(cliente));
    socket.on("error", () => this.retirar(cliente));

    const ultimo = (await this.prisma.eventoSync.aggregate({ where: { empresaId: cliente.empresaId }, _max: { seq: true } }))._max.seq ?? 0;
    this.enviar(cliente, { tipo: "hola", seq: ultimo, cajaId, cajas: this.cajasConectadas(cliente.empresaId) });
    await this.reenviar(cliente, p.desde, ultimo);
    for (const otro of this.clientes) {
      if (otro !== cliente && otro.empresaId === cliente.empresaId) this.enviar(otro, { tipo: "presencia", evento: "conectada", caja: this.descripcion(cliente) });
    }
    return true;
  }

  /** Reenvía lo ocurrido después de `desde`; si la bitácora ya no lo tiene completo, pide recargar todo. */
  private async reenviar(c: Cliente, desde: unknown, ultimo: number): Promise<void> {
    const n = typeof desde === "string" || typeof desde === "number" ? Number(desde) : NaN;
    if (!Number.isInteger(n) || n < 0 || n >= ultimo) return;
    const perdidos = await this.prisma.eventoSync.findMany({ where: { empresaId: c.empresaId, seq: { gt: n } }, orderBy: { seq: "asc" }, take: this.retencion + 1 });
    const primero = perdidos[0]?.seq;
    // Hueco: lo siguiente al último conocido ya fue podado → el cliente no puede reconstruir el estado con eventos
    if (primero === undefined || primero > n + 1 || perdidos.length > this.retencion) {
      this.enviar(c, { tipo: "resync", seq: ultimo });
      return;
    }
    for (const f of perdidos) {
      this.enviar(c, {
        tipo: "evento",
        seq: f.seq,
        modulo: f.modulo,
        accion: f.accion,
        ruta: f.ruta,
        ids: JSON.parse(f.ids) as Record<string, string>,
        usuarioId: f.usuarioId,
        cajaId: f.cajaId,
        ts: f.createdAt.toISOString(),
        reenviado: true,
      });
    }
  }

  private retirar(c: Cliente): void {
    if (!this.clientes.delete(c)) return;
    for (const otro of this.clientes) {
      if (otro.empresaId === c.empresaId) this.enviar(otro, { tipo: "presencia", evento: "desconectada", caja: this.descripcion(c) });
    }
  }

  private descripcion(c: Cliente): CajaConectada {
    return { cajaId: c.cajaId, usuario: `${c.usuario.nombre} ${c.usuario.apellido}`.trim(), desde: c.desde.toISOString() };
  }

  cajasConectadas(empresaId: string): CajaConectada[] {
    return [...this.clientes].filter((c) => c.empresaId === empresaId).map((c) => this.descripcion(c));
  }

  private enviar(c: Cliente, mensaje: Record<string, unknown>): void {
    if (c.socket.readyState !== 1) return; // 1 = OPEN
    try {
      c.socket.send(JSON.stringify(mensaje));
    } catch {
      this.retirar(c);
    }
  }

  // ── Latido: detecta cajas caídas y sesiones cerradas ───────

  iniciar(): void {
    if (this.temporizador !== null) return;
    this.temporizador = setInterval(() => this.latido(), this.latidoMs);
    this.temporizador.unref();
  }

  /** Un ciclo del latido (público para pruebas). */
  latido(): void {
    for (const c of [...this.clientes]) {
      if (this.sesiones.obtener(c.token) === null) {
        this.retirar(c);
        c.socket.close(CIERRE_SESION_REVOCADA, "La sesión terminó");
        continue;
      }
      if (!c.vivo) {
        this.retirar(c);
        c.socket.terminate();
        continue;
      }
      c.vivo = false;
      try {
        c.socket.ping();
      } catch {
        this.retirar(c);
      }
    }
  }

  detener(): void {
    if (this.temporizador !== null) clearInterval(this.temporizador);
    this.temporizador = null;
    for (const c of [...this.clientes]) {
      this.clientes.delete(c);
      c.socket.close(1001, "Servidor detenido");
    }
  }
}
