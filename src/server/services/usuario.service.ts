// ============================================================
// src/server/services/usuario.service.ts — Alta de usuarios y autenticación
// ============================================================
import { LoginSchema, UsuarioSchema } from "../../shared/schemas/usuario.schema";
import type { UsuarioConRol, UsuarioRepository } from "../repositories/usuario.repository";
import { AppError } from "./appError.util";
import { LimitadorIntentos } from "./limitadorIntentos.util";
import { hashPassword, verifyPassword } from "./password.util";
import { parsear } from "./validation.util";

export interface UsuarioPublico {
  id: string;
  empresaId: string;
  username: string;
  nombre: string;
  apellido: string;
  rol: string;
  permisos: string[]; // "modulo:accion"
}

function aPublico(u: UsuarioConRol): UsuarioPublico {
  return {
    id: u.id,
    empresaId: u.empresaId,
    username: u.username,
    nombre: u.nombre,
    apellido: u.apellido,
    rol: u.rol.nombre,
    permisos: u.rol.permisos.map((rp) => `${rp.permiso.modulo}:${rp.permiso.accion}`),
  };
}

/** Hash de un usuario que no existe: verificar contra él gasta el mismo tiempo que con uno real y no delata qué usuarios existen. */
let hashSenuelo: Promise<string> | null = null;
const obtenerHashSenuelo = (): Promise<string> => (hashSenuelo ??= hashPassword("senuelo-sin-usuario"));

export class UsuarioService {
  constructor(
    private readonly repo: UsuarioRepository,
    private readonly limitador: LimitadorIntentos = new LimitadorIntentos()
  ) {}

  async crear(entrada: unknown): Promise<UsuarioPublico> {
    const datos = parsear(UsuarioSchema, entrada);
    if ((await this.repo.findByUsername(datos.username)) !== null) {
      throw new AppError("DUPLICADO", `El usuario '${datos.username}' ya existe`);
    }
    const rol = await this.repo.findRolByNombre(datos.rol);
    if (rol === null) throw new AppError("NO_ENCONTRADO", `Rol '${datos.rol}' no existe`);

    const creado = await this.repo.create({
      empresaId: datos.empresaId,
      rolId: rol.id,
      username: datos.username,
      passwordHash: await hashPassword(datos.password),
      nombre: datos.nombre,
      apellido: datos.apellido,
      ...(datos.email != null ? { email: datos.email } : {}),
      ...(datos.cedula != null ? { cedula: datos.cedula } : {}),
      ...(datos.telefono != null ? { telefono: datos.telefono } : {}),
    });
    return aPublico(creado);
  }

  /**
   * `origen` es la dirección de quien intenta entrar: los fallos se cuentan por usuario + origen y, al llegar al máximo, ese par queda
   * bloqueado (DEMASIADOS_INTENTOS, HTTP 429) aunque la contraseña sea correcta.
   */
  async autenticar(entrada: unknown, origen = "local"): Promise<UsuarioPublico> {
    const { username, password } = parsear(LoginSchema, entrada);
    const clave = `${username.toLowerCase()}|${origen}`;
    const espera = this.limitador.segundosDeBloqueo(clave);
    if (espera > 0) {
      throw new AppError("DEMASIADOS_INTENTOS", `Demasiados intentos fallidos. Espere ${Math.ceil(espera / 60)} min antes de volver a intentar`);
    }
    // Los usuarios nuevos se guardan en minúsculas: «Maria» entra como «maria» (los antiguos con mayúsculas siguen entrando tal cual)
    const usuario = (await this.repo.findByUsername(username)) ?? (username === username.toLowerCase() ? null : await this.repo.findByUsername(username.toLowerCase()));
    // Mismo error (y mismo tiempo) para usuario inexistente o clave errónea: no filtrar cuáles existen.
    const correcta = await verifyPassword(password, usuario?.passwordHash ?? (await obtenerHashSenuelo()));
    if (usuario === null || !correcta) {
      this.limitador.registrarFallo(clave);
      throw new AppError("CREDENCIALES_INVALIDAS", "Usuario o contraseña incorrectos");
    }
    this.limitador.registrarAcierto(clave);
    if (usuario.status !== "ACTIVO") {
      throw new AppError("USUARIO_INACTIVO", "El usuario está inactivo");
    }
    await this.repo.registrarAcceso(usuario.id);
    return aPublico(usuario);
  }

  tienePermiso(usuario: UsuarioPublico, modulo: string, accion: string): boolean {
    return usuario.permisos.includes(`${modulo}:${accion}`);
  }
}
