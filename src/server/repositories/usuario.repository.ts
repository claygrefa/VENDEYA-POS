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
}
