// ============================================================
// src/server/repositories/usuario.repository.ts
// ============================================================
import type { Prisma, PrismaClient } from "@prisma/client";

const incluirRolYPermisos = {
  rol: { include: { permisos: { include: { permiso: true } } } },
} satisfies Prisma.UsuarioInclude;

export type UsuarioConRol = Prisma.UsuarioGetPayload<{ include: typeof incluirRolYPermisos }>;

export class UsuarioRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<UsuarioConRol | null> {
    return this.prisma.usuario.findUnique({ where: { id }, include: incluirRolYPermisos });
  }

  findByUsername(username: string): Promise<UsuarioConRol | null> {
    return this.prisma.usuario.findUnique({ where: { username }, include: incluirRolYPermisos });
  }

  findRolByNombre(nombre: string): Promise<{ id: string; nombre: string } | null> {
    return this.prisma.rol.findUnique({ where: { nombre }, select: { id: true, nombre: true } });
  }

  create(data: Prisma.UsuarioUncheckedCreateInput): Promise<UsuarioConRol> {
    return this.prisma.usuario.create({ data, include: incluirRolYPermisos });
  }

  async registrarAcceso(id: string): Promise<void> {
    await this.prisma.usuario.update({ where: { id }, data: { ultimoAcceso: new Date() } });
  }

  /** Usuario de la empresa indicada (nunca devuelve el de otra empresa). */
  findByIdEnEmpresa(id: string, empresaId: string): Promise<UsuarioConRol | null> {
    return this.prisma.usuario.findFirst({ where: { id, empresaId }, include: incluirRolYPermisos });
  }

  listar(empresaId: string, f: { q?: string | undefined; estado?: string | undefined }): Promise<UsuarioConRol[]> {
    const q = f.q?.trim();
    return this.prisma.usuario.findMany({
      where: {
        empresaId,
        ...(f.estado !== undefined ? { status: f.estado } : {}),
        ...(q !== undefined && q !== ""
          ? { OR: [{ username: { contains: q } }, { nombre: { contains: q } }, { apellido: { contains: q } }, { cedula: { contains: q } }] }
          : {}),
      },
      include: incluirRolYPermisos,
      orderBy: [{ status: "asc" }, { nombre: "asc" }, { apellido: "asc" }],
    });
  }

  listarRoles(): Promise<Array<{ id: string; nombre: string; descripcion: string }>> {
    return this.prisma.rol.findMany({ select: { id: true, nombre: true, descripcion: true }, orderBy: { nombre: "asc" } });
  }

  update(id: string, data: Prisma.UsuarioUncheckedUpdateInput): Promise<UsuarioConRol> {
    return this.prisma.usuario.update({ where: { id }, data, include: incluirRolYPermisos });
  }

  /** Administradores activos de la empresa (se excluye `excepto`): la empresa nunca puede quedarse sin uno. */
  contarAdministradoresActivos(empresaId: string, excepto: string): Promise<number> {
    return this.prisma.usuario.count({ where: { empresaId, status: "ACTIVO", rol: { nombre: "ADMIN" }, id: { not: excepto } } });
  }

  /** ¿Tiene un turno de caja abierto? (no se puede desactivar a quien tiene dinero a su cargo) */
  async tieneTurnoAbierto(usuarioId: string): Promise<boolean> {
    return (await this.prisma.turnoCaja.count({ where: { cajeroId: usuarioId, estado: "ABIERTO" } })) > 0;
  }
}
