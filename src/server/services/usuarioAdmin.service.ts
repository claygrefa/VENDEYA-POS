// ============================================================
// src/server/services/usuarioAdmin.service.ts — Gestión de usuarios por el administrador
//
// Reglas (todas verificadas en el servidor, no solo en la pantalla):
//   · Solo se ven y tocan los usuarios de la empresa del administrador.
//   · Nadie se desactiva ni se cambia el rol a sí mismo, y la empresa nunca se queda sin un administrador activo.
//   · No se desactiva a quien tiene un turno de caja abierto (el dinero de la caja está a su cargo).
//   · Al desactivar, cambiar el rol o la contraseña de alguien se cierran sus sesiones: la sesión guarda una copia de los permisos.
//   · El nombre de usuario no se cambia (figura en turnos, ventas y comprobantes). Las personas no se borran: se desactivan.
// ============================================================
import {
  ActualizarUsuarioSchema, CambiarPasswordSchema, EstadoUsuarioSchema, FiltroUsuariosSchema, NuevoUsuarioSchema, RestablecerPasswordSchema,
} from "../../shared/schemas/usuario.schema";
import type { UsuarioConRol, UsuarioRepository } from "../repositories/usuario.repository";
import { AppError } from "./appError.util";
import { hashPassword } from "./password.util";
import type { SessionService } from "./session.service";
import type { UsuarioService } from "./usuario.service";
import { parsear } from "./validation.util";

export interface ActorUsuarios {
  id: string;
  empresaId: string;
  username: string;
}

export interface UsuarioDetalle {
  id: string;
  username: string;
  nombre: string;
  apellido: string;
  rol: string;
  email: string | null;
  cedula: string | null;
  telefono: string | null;
  estado: string;
  ultimoAcceso: string | null;
  creado: string;
  /** Sesiones abiertas ahora mismo (en esta o en otras cajas) */
  sesionesActivas: number;
}

export interface RolDetalle {
  nombre: string;
  descripcion: string;
}

export class UsuarioAdminService {
  constructor(
    private readonly repo: UsuarioRepository,
    private readonly usuarios: UsuarioService,
    private readonly sesiones: SessionService
  ) {}

  private detalle(u: UsuarioConRol): UsuarioDetalle {
    return {
      id: u.id,
      username: u.username,
      nombre: u.nombre,
      apellido: u.apellido,
      rol: u.rol.nombre,
      email: u.email,
      cedula: u.cedula,
      telefono: u.telefono,
      estado: u.status,
      ultimoAcceso: u.ultimoAcceso?.toISOString() ?? null,
      creado: u.createdAt.toISOString(),
      sesionesActivas: this.sesiones.activasDe(u.id),
    };
  }

  private async obtenerDe(actor: ActorUsuarios, id: string): Promise<UsuarioConRol> {
    const u = await this.repo.findByIdEnEmpresa(id, actor.empresaId);
    if (u === null) throw new AppError("NO_ENCONTRADO", "Usuario no encontrado");
    return u;
  }

  /** La contraseña del administrador se pide de nuevo en lo delicado; un error aquí NO es una sesión inválida (por eso 400, no 401). */
  private async confirmar(actor: ActorUsuarios, password: string, origen: string): Promise<void> {
    try {
      await this.usuarios.autenticar({ username: actor.username, password }, origen);
    } catch (e) {
      if (e instanceof AppError && e.codigo === "CREDENCIALES_INVALIDAS") throw new AppError("VALIDACION", "La contraseña no es correcta");
      throw e;
    }
  }

  /** Impide quitarle el rol de administrador (o desactivar) al último administrador activo de la empresa. */
  private async exigirOtroAdministrador(u: UsuarioConRol, que: string): Promise<void> {
    if (u.rol.nombre !== "ADMIN" || u.status !== "ACTIVO") return;
    if ((await this.repo.contarAdministradoresActivos(u.empresaId, u.id)) === 0) {
      throw new AppError("ESTADO_INVALIDO", `No se puede ${que}: es el único administrador activo. Cree o active primero a otro administrador.`);
    }
  }

  async listar(actor: ActorUsuarios, filtro: unknown): Promise<{ items: UsuarioDetalle[] }> {
    const f = parsear(FiltroUsuariosSchema, filtro ?? {});
    const filas = await this.repo.listar(actor.empresaId, f);
    return { items: filas.map((u) => this.detalle(u)) };
  }

  async roles(): Promise<{ items: RolDetalle[] }> {
    const roles = await this.repo.listarRoles();
    return { items: roles.map((r) => ({ nombre: r.nombre, descripcion: r.descripcion })) };
  }

  async crear(actor: ActorUsuarios, entrada: unknown): Promise<UsuarioDetalle> {
    const datos = parsear(NuevoUsuarioSchema, entrada);
    // El inicio de sesión no distingue mayúsculas: «Maria» y «maria» serían la misma persona
    if ((await this.repo.findByUsername(datos.username)) !== null) throw new AppError("DUPLICADO", `El usuario '${datos.username}' ya existe`);
    const rol = await this.repo.findRolByNombre(datos.rol);
    if (rol === null) throw new AppError("NO_ENCONTRADO", `Rol '${datos.rol}' no existe`);
    const creado = await this.repo.create({
      empresaId: actor.empresaId,
      rolId: rol.id,
      username: datos.username,
      passwordHash: await hashPassword(datos.password),
      nombre: datos.nombre,
      apellido: datos.apellido,
      ...(datos.email != null && datos.email !== "" ? { email: datos.email } : {}),
      ...(datos.cedula != null && datos.cedula !== "" ? { cedula: datos.cedula } : {}),
      ...(datos.telefono != null && datos.telefono !== "" ? { telefono: datos.telefono } : {}),
    });
    return this.detalle(creado);
  }

  async actualizar(actor: ActorUsuarios, id: string, entrada: unknown): Promise<UsuarioDetalle> {
    const datos = parsear(ActualizarUsuarioSchema, entrada);
    const u = await this.obtenerDe(actor, id);

    let rolId: string | undefined;
    const cambiaRol = datos.rol !== undefined && datos.rol !== u.rol.nombre;
    if (cambiaRol) {
      if (u.id === actor.id) throw new AppError("ESTADO_INVALIDO", "No puede cambiar su propio rol");
      await this.exigirOtroAdministrador(u, "quitarle el rol de administrador");
      const rol = await this.repo.findRolByNombre(datos.rol as string);
      if (rol === null) throw new AppError("NO_ENCONTRADO", `Rol '${datos.rol}' no existe`);
      rolId = rol.id;
    }

    const vacioANulo = (v: string | null | undefined): string | null | undefined => (v === undefined ? undefined : v === null || v.trim() === "" ? null : v.trim());
    const email = vacioANulo(datos.email);
    const cedula = vacioANulo(datos.cedula);
    const telefono = vacioANulo(datos.telefono);
    const actualizado = await this.repo.update(u.id, {
      ...(rolId !== undefined ? { rolId } : {}),
      ...(datos.nombre !== undefined ? { nombre: datos.nombre } : {}),
      ...(datos.apellido !== undefined ? { apellido: datos.apellido } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(cedula !== undefined ? { cedula } : {}),
      ...(telefono !== undefined ? { telefono } : {}),
    });
    // Con otro rol tiene otros permisos: debe volver a entrar para que su sesión los refleje
    if (cambiaRol) this.sesiones.revocarDeUsuario(u.id);
    return this.detalle(actualizado);
  }

  async cambiarEstado(actor: ActorUsuarios, id: string, entrada: unknown): Promise<UsuarioDetalle> {
    const { estado } = parsear(EstadoUsuarioSchema, entrada);
    const u = await this.obtenerDe(actor, id);
    if (u.status === estado) return this.detalle(u);
    if (estado === "INACTIVO") {
      if (u.id === actor.id) throw new AppError("ESTADO_INVALIDO", "No puede desactivar su propio usuario");
      await this.exigirOtroAdministrador(u, "desactivarlo");
      if (await this.repo.tieneTurnoAbierto(u.id)) throw new AppError("ESTADO_INVALIDO", "Tiene un turno de caja abierto: ciérrelo antes de desactivar al usuario");
    }
    const actualizado = await this.repo.update(u.id, { status: estado });
    if (estado === "INACTIVO") this.sesiones.revocarDeUsuario(u.id);
    return this.detalle(actualizado);
  }

  /** El administrador define una contraseña nueva para otra persona (olvidó la suya). Pide la contraseña del administrador. */
  async restablecerPassword(actor: ActorUsuarios, id: string, entrada: unknown, origen = "local"): Promise<UsuarioDetalle> {
    const datos = parsear(RestablecerPasswordSchema, entrada);
    const u = await this.obtenerDe(actor, id);
    if (u.id === actor.id) throw new AppError("VALIDACION", "Para cambiar su propia contraseña use «Cambiar mi contraseña»");
    await this.confirmar(actor, datos.passwordAdmin, origen);
    const actualizado = await this.repo.update(u.id, { passwordHash: await hashPassword(datos.password) });
    this.sesiones.revocarDeUsuario(u.id);
    return this.detalle(actualizado);
  }

  /** Cada usuario cambia su propia contraseña; las demás sesiones suyas (otras cajas) se cierran y esta continúa. */
  async cambiarMiPassword(actor: ActorUsuarios, tokenActual: string | null, entrada: unknown, origen = "local"): Promise<{ sesionesCerradas: number }> {
    const datos = parsear(CambiarPasswordSchema, entrada);
    const u = await this.obtenerDe(actor, actor.id);
    // Mismo freno de intentos que el inicio de sesión: quien deja la caja abierta no puede probar claves sin límite
    await this.confirmar(actor, datos.actual, origen);
    await this.repo.update(u.id, { passwordHash: await hashPassword(datos.nueva) });
    return { sesionesCerradas: this.sesiones.revocarDeUsuario(u.id, tokenActual ?? undefined) };
  }
}
