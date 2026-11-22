// ============================================================
// src/server/services/usuario.service.ts — Alta de usuarios y autenticación
// ============================================================
import { LoginSchema, UsuarioSchema } from "../../shared/schemas/usuario.schema";
import type { UsuarioConRol, UsuarioRepository } from "../repositories/usuario.repository";
import { AppError } from "./appError.util";
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

export class UsuarioService {
  constructor(private readonly repo: UsuarioRepository) {}

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

  async autenticar(entrada: unknown): Promise<UsuarioPublico> {
    const { username, password } = parsear(LoginSchema, entrada);
    const usuario = await this.repo.findByUsername(username);
    // Mismo error para usuario inexistente o clave errónea (no filtrar cuáles existen).
    if (usuario === null || !(await verifyPassword(password, usuario.passwordHash))) {
      throw new AppError("CREDENCIALES_INVALIDAS", "Usuario o contraseña incorrectos");
    }
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
