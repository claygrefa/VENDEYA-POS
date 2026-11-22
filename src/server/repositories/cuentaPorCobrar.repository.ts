// ============================================================
// src/server/repositories/cuentaPorCobrar.repository.ts
// ============================================================
import type { Prisma, PagoCuentaPorCobrar } from "@prisma/client";
import { round2 } from "../services/ventaCalculo.util";
import type { Db } from "./kardex.repository";
import type { ResultadoPaginado } from "./producto.repository";

const incluirDetalle = {
  pagos: { orderBy: { fecha: "asc" } },
  cliente: { select: { id: true, razonSocial: true, identificacion: true } },
  venta: { select: { id: true, numero: true, sucursalId: true } },
} satisfies Prisma.CuentaPorCobrarInclude;

export type CuentaPorCobrarDetalle = Prisma.CuentaPorCobrarGetPayload<{ include: typeof incluirDetalle }>;

export interface FiltroCxC {
  empresaId: string;
  page: number;
  pageSize: number;
  estado?: string;
  clienteId?: string;
  vencidas?: boolean;
}

export class CuentaPorCobrarRepository {
  crear(
    db: Db,
    datos: { ventaId: string; clienteId: string; montoTotal: number; fechaEmision: Date; fechaVencimiento: Date }
  ): Promise<CuentaPorCobrarDetalle> {
    return db.cuentaPorCobrar.create({ data: { ...datos, saldo: datos.montoTotal }, include: incluirDetalle });
  }

  /** Saldo pendiente total del cliente (cuentas PENDIENTE o PARCIAL). */
  async saldoPendienteCliente(db: Db, clienteId: string): Promise<number> {
    const r = await db.cuentaPorCobrar.aggregate({
      where: { clienteId, estado: { in: ["PENDIENTE", "PARCIAL"] } },
      _sum: { saldo: true },
    });
    return round2(r._sum.saldo ?? 0);
  }

  buscarPorId(db: Db, id: string, empresaId: string): Promise<CuentaPorCobrarDetalle | null> {
    return db.cuentaPorCobrar.findFirst({ where: { id, venta: { sucursal: { empresaId } } }, include: incluirDetalle });
  }

  /** Sin filtro de empresa: uso interno al anular una venta ya validada. */
  porVenta(db: Db, ventaId: string): Promise<(CuentaPorCobrarDetalle) | null> {
    return db.cuentaPorCobrar.findUnique({ where: { ventaId }, include: incluirDetalle });
  }

  async listar(db: Db, f: FiltroCxC): Promise<ResultadoPaginado<CuentaPorCobrarDetalle>> {
    const where: Prisma.CuentaPorCobrarWhereInput = {
      venta: { sucursal: { empresaId: f.empresaId } },
      ...(f.estado !== undefined ? { estado: f.estado } : {}),
      ...(f.clienteId !== undefined ? { clienteId: f.clienteId } : {}),
      ...(f.vencidas === true ? { estado: { in: ["PENDIENTE", "PARCIAL"] }, fechaVencimiento: { lt: new Date() } } : {}),
    };
    const [items, total] = await Promise.all([
      db.cuentaPorCobrar.findMany({
        where,
        include: incluirDetalle,
        orderBy: { fechaVencimiento: "asc" },
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      db.cuentaPorCobrar.count({ where }),
    ]);
    return { items, total, page: f.page, pageSize: f.pageSize };
  }

  /** Compare-and-swap del saldo: solo aplica si no cambió desde la lectura. */
  async actualizarSaldoSiNoCambio(db: Db, id: string, saldoLeido: number, nuevo: { saldo: number; estado: string }): Promise<number> {
    const r = await db.cuentaPorCobrar.updateMany({
      where: { id, saldo: saldoLeido, estado: { in: ["PENDIENTE", "PARCIAL"] } },
      data: nuevo,
    });
    return r.count;
  }

  async anular(db: Db, id: string): Promise<void> {
    await db.cuentaPorCobrar.update({ where: { id }, data: { estado: "ANULADA", saldo: 0 } });
  }

  crearPago(
    db: Db,
    datos: { cuentaId: string; monto: number; formaPago: string; referencia: string | null; usuarioId: string; turnoId: string | null }
  ): Promise<PagoCuentaPorCobrar> {
    return db.pagoCuentaPorCobrar.create({ data: datos });
  }
}
