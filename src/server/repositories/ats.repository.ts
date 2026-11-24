// ============================================================
// src/server/repositories/ats.repository.ts — Datos del periodo para el Anexo Transaccional Simplificado
// ============================================================
import type { Prisma } from "@prisma/client";
import type { Db } from "./kardex.repository";

const incluirComprobanteVenta = {
  venta: { include: { lineas: { select: { codigoIvaSRI: true, porcentajeIva: true, subtotal: true, iva: true } }, pagos: { select: { formaPago: true } } } },
  origen: { include: { venta: { include: { lineas: { select: { codigoIvaSRI: true, porcentajeIva: true, subtotal: true, iva: true } }, pagos: { select: { formaPago: true } } } } } },
} satisfies Prisma.ComprobanteElectronicoInclude;

export type ComprobanteVentaAts = Prisma.ComprobanteElectronicoGetPayload<{ include: typeof incluirComprobanteVenta }>;

const incluirCompra = {
  proveedor: { select: { ruc: true, razonSocial: true } },
  lineas: { select: { subtotal: true, iva: true, porcentajeIva: true } },
} satisfies Prisma.CompraInclude;

export type CompraAts = Prisma.CompraGetPayload<{ include: typeof incluirCompra }>;

const incluirDocumentoCompra = { retenciones: true } satisfies Prisma.ComprobanteElectronicoInclude;
export type DocumentoCompraAts = Prisma.ComprobanteElectronicoGetPayload<{ include: typeof incluirDocumentoCompra }>;

export class AtsRepository {
  empresa(db: Db, empresaId: string) {
    return db.empresa.findUnique({ where: { id: empresaId }, select: { ruc: true, razonSocial: true } });
  }

  async codigosEstablecimientos(db: Db, empresaId: string): Promise<string[]> {
    const filas = await db.sucursal.findMany({ where: { empresaId, status: "ACTIVO" }, select: { codigo: true }, orderBy: { codigo: "asc" } });
    return filas.map((f) => f.codigo);
  }

  /** Facturas (01) y notas de crédito (04) del periodo, con los datos de la venta que las originó. */
  ventasDelPeriodo(db: Db, empresaId: string, desde: Date, hasta: Date, estados: string[]): Promise<ComprobanteVentaAts[]> {
    return db.comprobanteElectronico.findMany({
      where: { empresaId, tipoComprobante: { in: ["01", "04"] }, estado: { in: estados }, fechaEmision: { gte: desde, lt: hasta } },
      include: incluirComprobanteVenta,
      orderBy: { fechaEmision: "asc" },
    });
  }

  /** Cantidad de comprobantes de venta del periodo que aún no están autorizados ni anulados ni rechazados. */
  pendientesDelPeriodo(db: Db, empresaId: string, desde: Date, hasta: Date): Promise<number> {
    return db.comprobanteElectronico.count({
      where: { empresaId, tipoComprobante: { in: ["01", "04"] }, estado: { in: ["PENDIENTE", "EN_PROCESO"] }, fechaEmision: { gte: desde, lt: hasta } },
    });
  }

  comprasDelPeriodo(db: Db, empresaId: string, desde: Date, hasta: Date): Promise<CompraAts[]> {
    return db.compra.findMany({
      where: { sucursal: { empresaId }, estado: "REGISTRADA", fecha: { gte: desde, lt: hasta } },
      include: incluirCompra,
      orderBy: { fecha: "asc" },
    });
  }

  /** Retenciones (07) y liquidaciones (03) emitidas sobre las compras indicadas. */
  documentosDeCompras(db: Db, compraIds: string[]): Promise<DocumentoCompraAts[]> {
    return db.comprobanteElectronico.findMany({
      where: { compraId: { in: compraIds }, tipoComprobante: { in: ["07", "03"] }, estado: { notIn: ["ANULADO", "RECHAZADO", "DEVUELTO"] } },
      include: incluirDocumentoCompra,
    });
  }

  /** Comprobantes anulados ante el SRI (con autorización previa) emitidos en el periodo. */
  anuladosDelPeriodo(db: Db, empresaId: string, desde: Date, hasta: Date) {
    return db.comprobanteElectronico.findMany({
      where: { empresaId, estado: "ANULADO", numeroAutorizacion: { not: null }, fechaEmision: { gte: desde, lt: hasta } },
      select: { tipoComprobante: true, serie: true, secuencial: true, numeroAutorizacion: true },
      orderBy: { secuencial: "asc" },
    });
  }
}
