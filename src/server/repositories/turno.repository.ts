// ============================================================
// src/server/repositories/turno.repository.ts — Turnos y movimientos de caja
// ============================================================
import type { MovimientoCaja, Prisma, Sucursal, TurnoCaja } from "@prisma/client";
import { calcularEfectivoEsperado } from "../services/cuadreCaja.util";
import { round2 } from "../services/ventaCalculo.util";
import type { Db } from "./kardex.repository";

const incluirCajero = {
  cajero: { select: { id: true, nombre: true, apellido: true, username: true } },
} satisfies Prisma.TurnoCajaInclude;

export type TurnoConCajero = Prisma.TurnoCajaGetPayload<{ include: typeof incluirCajero }> & { sucursal: Sucursal };

export interface ResumenVentasTurno {
  completadas: { cantidad: number; subtotal: number; descuento: number; iva: number; total: number };
  anuladas: { cantidad: number; total: number };
}

export interface PagoPorForma {
  formaPago: string;
  monto: number;
  cambio: number;
}

export interface DetalleEfectivo {
  ventasEfectivoRecibido: number;
  cambioEntregado: number;
  ingresos: number;
  egresos: number;
  esperado: number;
}

export class TurnoRepository {
  sucursal(db: Db, id: string): Promise<Sucursal | null> {
    return db.sucursal.findUnique({ where: { id } });
  }

  turnoAbierto(db: Db, cajeroId: string, sucursalId: string): Promise<TurnoCaja | null> {
    return db.turnoCaja.findFirst({ where: { cajeroId, sucursalId, estado: "ABIERTO" }, orderBy: { fechaApertura: "desc" } });
  }

  /** Turnos abiertos de un cajero (todas las sucursales de la empresa). */
  turnosAbiertosDe(db: Db, cajeroId: string, empresaId: string): Promise<TurnoConCajero[]> {
    return db.turnoCaja.findMany({
      where: { cajeroId, estado: "ABIERTO", sucursal: { empresaId } },
      include: { ...incluirCajero, sucursal: true },
      orderBy: { fechaApertura: "desc" },
    });
  }

  crear(db: Db, data: { sucursalId: string; cajeroId: string; montoApertura: number }): Promise<TurnoCaja> {
    return db.turnoCaja.create({ data });
  }

  /** Búsqueda acotada a la empresa del solicitante. */
  buscarPorId(db: Db, id: string, empresaId: string): Promise<TurnoConCajero | null> {
    return db.turnoCaja.findFirst({
      where: { id, sucursal: { empresaId } },
      include: { ...incluirCajero, sucursal: true },
    });
  }

  /** Cierra solo si sigue ABIERTO (atómico). Devuelve filas afectadas. */
  async cerrarSiAbierto(
    db: Db,
    id: string,
    datos: { contado: number; esperado: number; diferencia: number; observaciones: string | null; fecha: Date }
  ): Promise<number> {
    const r = await db.turnoCaja.updateMany({
      where: { id, estado: "ABIERTO" },
      data: {
        estado: "CERRADO",
        fechaCierre: datos.fecha,
        montoCierreCiego: datos.contado,
        montoCierreReal: datos.esperado,
        diferencia: datos.diferencia,
        observaciones: datos.observaciones,
      },
    });
    return r.count;
  }

  movimientos(db: Db, turnoId: string): Promise<MovimientoCaja[]> {
    return db.movimientoCaja.findMany({ where: { turnoId }, orderBy: { createdAt: "asc" } });
  }

  crearMovimiento(
    db: Db,
    datos: { turnoId: string; tipo: "INGRESO" | "EGRESO"; concepto: string; monto: number; referencia: string | null; categoria: string; usuarioId: string }
  ): Promise<MovimientoCaja> {
    return db.movimientoCaja.create({ data: datos });
  }

  async resumenVentas(db: Db, turnoId: string): Promise<ResumenVentasTurno> {
    const [ok, anuladas] = await Promise.all([
      db.venta.aggregate({
        where: { turnoId, estado: "COMPLETADA" },
        _count: { _all: true },
        _sum: { subtotal: true, descuento: true, iva: true, total: true },
      }),
      db.venta.aggregate({ where: { turnoId, estado: "ANULADA" }, _count: { _all: true }, _sum: { total: true } }),
    ]);
    return {
      completadas: {
        cantidad: ok._count._all,
        subtotal: round2(ok._sum.subtotal ?? 0),
        descuento: round2(ok._sum.descuento ?? 0),
        iva: round2(ok._sum.iva ?? 0),
        total: round2(ok._sum.total ?? 0),
      },
      anuladas: { cantidad: anuladas._count._all, total: round2(anuladas._sum.total ?? 0) },
    };
  }

  /** Pagos de ventas COMPLETADAS del turno agrupados por forma de pago. */
  async pagosPorForma(db: Db, turnoId: string): Promise<PagoPorForma[]> {
    const filas = await db.pagoVenta.groupBy({
      by: ["formaPago"],
      where: { venta: { turnoId, estado: "COMPLETADA" } },
      _sum: { monto: true, cambio: true },
      orderBy: { formaPago: "asc" },
    });
    return filas.map((f) => ({ formaPago: f.formaPago, monto: round2(f._sum.monto ?? 0), cambio: round2(f._sum.cambio ?? 0) }));
  }

  /** Efectivo esperado en caja y sus componentes (excluye ventas anuladas). */
  async detalleEfectivo(db: Db, turno: Pick<TurnoCaja, "id" | "montoApertura">): Promise<DetalleEfectivo> {
    const [efectivo, movimientos] = await Promise.all([
      db.pagoVenta.aggregate({
        where: { formaPago: "EFECTIVO", venta: { turnoId: turno.id, estado: "COMPLETADA" } },
        _sum: { monto: true, cambio: true },
      }),
      db.movimientoCaja.groupBy({ by: ["tipo"], where: { turnoId: turno.id }, _sum: { monto: true }, orderBy: { tipo: "asc" } }),
    ]);
    const suma = (tipo: string): number => round2(movimientos.find((m) => m.tipo === tipo)?._sum.monto ?? 0);
    const base = {
      ventasEfectivoRecibido: round2(efectivo._sum.monto ?? 0),
      cambioEntregado: round2(efectivo._sum.cambio ?? 0),
      ingresos: suma("INGRESO"),
      egresos: suma("EGRESO"),
    };
    return { ...base, esperado: calcularEfectivoEsperado({ montoApertura: turno.montoApertura, ...base }) };
  }
}
