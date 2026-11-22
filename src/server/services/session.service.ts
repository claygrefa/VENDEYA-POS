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
