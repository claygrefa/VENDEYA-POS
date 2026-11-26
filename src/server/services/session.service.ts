// ============================================================
// src/server/services/session.service.ts — Sesiones en memoria (token Bearer)
// El servidor es local; las sesiones se pierden al reiniciar la app (por diseño).
// ============================================================
import { randomBytes } from "crypto";
import type { UsuarioPublico } from "./usuario.service";

interface Sesion {
  usuario: UsuarioPublico;
  expiraEn: number;
}

export class SessionService {
  private readonly sesiones = new Map<string, Sesion>();

  constructor(
    private readonly ttlMs: number = 12 * 60 * 60 * 1000,
    private readonly ahora: () => number = Date.now
  ) {}

  crear(usuario: UsuarioPublico): string {
    this.purgarExpiradas();
    const token = randomBytes(32).toString("hex");
    this.sesiones.set(token, { usuario, expiraEn: this.ahora() + this.ttlMs });
    return token;
  }

  obtener(token: string): UsuarioPublico | null {
    const sesion = this.sesiones.get(token);
    if (sesion === undefined) return null;
    if (sesion.expiraEn <= this.ahora()) {
      this.sesiones.delete(token);
      return null;
    }
    return sesion.usuario;
  }

  revocar(token: string): void {
    this.sesiones.delete(token);
  }

  /**
   * Cierra todas las sesiones de un usuario (menos la indicada en `excepto`) y devuelve cuántas cerró. Se usa al desactivarlo, cambiarle el
   * rol o la contraseña: la sesión guarda una copia de sus permisos, así que no basta con cambiar la base. Las cajas conectadas por la red
   * local pierden su conexión en el siguiente latido de la sincronización.
   */
  revocarDeUsuario(usuarioId: string, excepto?: string): number {
    let cerradas = 0;
    for (const [token, s] of this.sesiones) {
      if (s.usuario.id === usuarioId && token !== excepto) {
        this.sesiones.delete(token);
        cerradas += 1;
      }
    }
    return cerradas;
  }

  /** Sesiones vigentes de un usuario (aparece «en línea» en la lista de usuarios). */
  activasDe(usuarioId: string): number {
    this.purgarExpiradas();
    let n = 0;
    for (const s of this.sesiones.values()) if (s.usuario.id === usuarioId) n += 1;
    return n;
  }

  get activas(): number {
    this.purgarExpiradas();
    return this.sesiones.size;
  }

  private purgarExpiradas(): void {
    const t = this.ahora();
    for (const [token, s] of this.sesiones) {
      if (s.expiraEn <= t) this.sesiones.delete(token);
    }
  }
}
