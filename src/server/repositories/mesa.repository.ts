// ============================================================
// src/server/repositories/mesa.repository.ts
// ============================================================
import type { Mesa, Prisma, Sucursal } from "@prisma/client";
import type { Db } from "./kardex.repository";

const incluirCuentaAbierta = {
  comandas: {
    where: { estado: "ABIERTA" },
    select: {
      id: true,
      numero: true,
      meseroId: true,
      comensales: true,
      createdAt: true,
      items: { where: { estado: { not: "CANCELADO" }, cobrado: false }, select: { total: true } },
    },
  },
} satisfies Prisma.MesaInclude;

export type MesaConCuenta = Prisma.MesaGetPayload<{ include: typeof incluirCuentaAbierta }>;

export class MesaRepository {
  sucursal(db: Db, id: string): Promise<Sucursal | null> {
    return db.sucursal.findUnique({ where: { id } });
  }

  buscarPorId(db: Db, id: string, empresaId: string): Promise<Mesa | null> {
    return db.mesa.findFirst({ where: { id, sucursal: { empresaId } } });
  }

  numeroExiste(db: Db, sucursalId: string, numero: number, ignorarId?: string): Promise<{ id: string } | null> {
    return db.mesa.findFirst({
      where: { sucursalId, numero, ...(ignorarId !== undefined ? { id: { not: ignorarId } } : {}) },
      select: { id: true },
    });
  }

  crear(db: Db, data: Prisma.MesaUncheckedCreateInput): Promise<Mesa> {
    return db.mesa.create({ data });
  }

  actualizar(db: Db, id: string, data: Prisma.MesaUncheckedUpdateInput): Promise<Mesa> {
    return db.mesa.update({ where: { id }, data });
  }

  async tieneCuentaAbierta(db: Db, mesaId: string): Promise<boolean> {
    return (await db.comanda.count({ where: { mesaId, estado: "ABIERTA" } })) > 0;
  }

  /** Plano de mesas con su cuenta abierta (si la hay). */
  listar(db: Db, f: { empresaId: string; sucursalId?: string; zona?: string }): Promise<MesaConCuenta[]> {
    return db.mesa.findMany({
      where: {
        sucursal: { empresaId: f.empresaId },
        status: "ACTIVO",
        ...(f.sucursalId !== undefined ? { sucursalId: f.sucursalId } : {}),
        ...(f.zona !== undefined ? { zona: f.zona } : {}),
      },
      include: incluirCuentaAbierta,
      orderBy: [{ zona: "asc" }, { numero: "asc" }],
    });
  }
}
