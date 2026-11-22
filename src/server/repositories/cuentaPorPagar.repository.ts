// ============================================================
// src/server/repositories/cuentaPorPagar.repository.ts
// ============================================================
import type { PagoCuentaPorPagar, Prisma } from "@prisma/client";
import type { Db } from "./kardex.repository";
import type { ResultadoPaginado } from "./producto.repository";

const incluirDetalle = {
  pagos: { orderBy: { fecha: "asc" } },
  proveedor: { select: { id: true, razonSocial: true, ruc: true } },
  compra: { select: { id: true, numeroFactura: true, sucursalId: true } },
} satisfies Prisma.CuentaPorPagarInclude;

export type CuentaPorPagarDetalle = Prisma.CuentaPorPagarGetPayload<{ include: typeof incluirDetalle }>;

export interface FiltroCxP {
  empresaId: string;
  page: number;
  pageSize: number;
  estado?: string;
  proveedorId?: string;
  vencidas?: boolean;
}

export class CuentaPorPagarRepository {
  crear(
    db: Db,
    datos: { compraId: string; proveedorId: string; montoTotal: number; fechaEmision: Date; fechaVencimiento: Date }
  ): Promise<CuentaPorPagarDetalle> {
    return db.cuentaPorPagar.create({ data: { ...datos, saldo: datos.montoTotal }, include: incluirDetalle });
  }

  buscarPorId(db: Db, id: string, empresaId: string): Promise<CuentaPorPagarDetalle | null> {
    return db.cuentaPorPagar.findFirst({ where: { id, compra: { sucursal: { empresaId } } }, include: incluirDetalle });
  }

  async listar(db: Db, f: FiltroCxP): Promise<ResultadoPaginado<CuentaPorPagarDetalle>> {
    const where: Prisma.CuentaPorPagarWhereInput = {
      compra: { sucursal: { empresaId: f.empresaId } },
      ...(f.estado !== undefined ? { estado: f.estado } : {}),
      ...(f.proveedorId !== undefined ? { proveedorId: f.proveedorId } : {}),
      ...(f.vencidas === true ? { estado: { in: ["PENDIENTE", "PARCIAL"] }, fechaVencimiento: { lt: new Date() } } : {}),
    };
    const [items, total] = await Promise.all([
      db.cuentaPorPagar.findMany({
        where,
        include: incluirDetalle,
        orderBy: { fechaVencimiento: "asc" },
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      db.cuentaPorPagar.count({ where }),
    ]);
    return { items, total, page: f.page, pageSize: f.pageSize };
  }

  async actualizarSaldoSiNoCambio(db: Db, id: string, saldoLeido: number, nuevo: { saldo: number; estado: string }): Promise<number> {
    const r = await db.cuentaPorPagar.updateMany({
      where: { id, saldo: saldoLeido, estado: { in: ["PENDIENTE", "PARCIAL"] } },
      data: nuevo,
    });
    return r.count;
  }

  crearPago(
    db: Db,
    datos: { cuentaId: string; monto: number; formaPago: string; referencia: string | null; usuarioId: string; turnoId: string | null }
  ): Promise<PagoCuentaPorPagar> {
    return db.pagoCuentaPorPagar.create({ data: datos });
  }
}
