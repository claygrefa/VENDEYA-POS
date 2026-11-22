// ============================================================
// src/server/repositories/venta.repository.ts
// Acceso a datos del motor de ventas. Los métodos reciben el cliente transaccional.
// ============================================================
import type { Cliente, Lote, Prisma, PresentacionProducto, Producto, PuntoEmision, Sucursal, TarifaImpuesto, TurnoCaja, UnidadMedida } from "@prisma/client";
import type { Db } from "./kardex.repository";

const incluirDetalle = {
  lineas: true,
  pagos: true,
  comprobante: { select: { id: true, estado: true, claveAcceso: true } },
} satisfies Prisma.VentaInclude;

export type VentaCompleta = Prisma.VentaGetPayload<{ include: typeof incluirDetalle }>;
export type ProductoConTarifa = Producto & { tarifaImpuesto: TarifaImpuesto | null; unidadMedida: UnidadMedida };
export type PuntoConSucursal = PuntoEmision & { sucursal: Sucursal };

export interface NuevaVenta {
  numero: string;
  sucursalId: string;
  puntoEmisionId: string;
  turnoId: string;
  cajeroId: string;
  clienteId: string | null;
  clienteRuc: string;
  clienteNombre: string;
  subtotal: number;
  descuento: number;
  iva: number;
  total: number;
  observaciones: string | null;
  lineas: Array<Omit<Prisma.LineaVentaUncheckedCreateWithoutVentaInput, "id">>;
  pagos: Array<Omit<Prisma.PagoVentaUncheckedCreateWithoutVentaInput, "id" | "createdAt">>;
}

export class VentaRepository {
  /**
   * Incrementa atómicamente el secuencial del punto de emisión y lo devuelve junto con su sucursal.
   * Al ser la primera escritura de la transacción, toma el bloqueo de escritura de SQLite
   * y serializa las ventas concurrentes. Si la transacción se revierte, el secuencial no se pierde.
   */
  async reservarSecuencial(db: Db, puntoEmisionId: string): Promise<PuntoConSucursal | null> {
    try {
      return await db.puntoEmision.update({
        where: { id: puntoEmisionId },
        data: { secuencialVenta: { increment: 1 } },
        include: { sucursal: true },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2025") return null; // registro inexistente
      throw e;
    }
  }

  turnoAbierto(db: Db, cajeroId: string, sucursalId: string): Promise<TurnoCaja | null> {
    return db.turnoCaja.findFirst({ where: { cajeroId, sucursalId, estado: "ABIERTO" }, orderBy: { fechaApertura: "desc" } });
  }

  productosPorIds(db: Db, ids: string[]): Promise<ProductoConTarifa[]> {
    return db.producto.findMany({ where: { id: { in: ids } }, include: { tarifaImpuesto: true, unidadMedida: true } });
  }

  /** Mapa código SRI → porcentaje, de las tarifas de IVA vigentes de la empresa. */
  async tarifasIva(db: Db, empresaId: string): Promise<Map<string, number>> {
    const tarifas = await db.tarifaImpuesto.findMany({ where: { empresaId, tipoImpuesto: "IVA", vigente: true } });
    return new Map(tarifas.map((t) => [t.codigo, t.porcentaje]));
  }

  presentacionesPorIds(db: Db, ids: string[]): Promise<PresentacionProducto[]> {
    return db.presentacionProducto.findMany({ where: { id: { in: ids } } });
  }

  /** Lotes vigentes con existencia (no bloqueados ni vencidos) de un producto. */
  lotesDisponibles(db: Db, productoId: string): Promise<Lote[]> {
    return db.lote.findMany({
      where: { productoId, status: "ACTIVO", cantidadActual: { gt: 0 }, fechaVencimiento: { gte: new Date() } },
      orderBy: [{ fechaVencimiento: "asc" }, { createdAt: "asc" }],
    });
  }

  /** Precios de una lista para los productos dados (base y por presentación). */
  preciosDeLista(db: Db, listaPrecioId: string, productoIds: string[]): Promise<Array<{ productoId: string; presentacionId: string | null; precio: number }>> {
    return db.precioProducto.findMany({
      where: { listaPrecioId, productoId: { in: productoIds }, lista: { status: "ACTIVO" } },
      select: { productoId: true, presentacionId: true, precio: true },
    });
  }

  async listasPreciosHabilitadas(db: Db, empresaId: string): Promise<boolean> {
    const cfg = await db.configuracionGiro.findUnique({ where: { empresaId }, select: { moduloListasPrecios: true } });
    return cfg?.moduloListasPrecios === true;
  }

  cliente(db: Db, id: string): Promise<Cliente | null> {
    return db.cliente.findUnique({ where: { id } });
  }

  lote(db: Db, id: string): Promise<Lote | null> {
    return db.lote.findUnique({ where: { id } });
  }

  async descontarLoteSiAlcanza(db: Db, loteId: string, productoId: string, cantidad: number): Promise<number> {
    const r = await db.lote.updateMany({
      where: { id: loteId, productoId, cantidadActual: { gte: cantidad } },
      data: { cantidadActual: { decrement: cantidad } },
    });
    return r.count;
  }

  async reponerLote(db: Db, loteId: string, cantidad: number): Promise<void> {
    await db.lote.update({ where: { id: loteId }, data: { cantidadActual: { increment: cantidad } } });
  }

  crear(db: Db, v: NuevaVenta): Promise<VentaCompleta> {
    const { lineas, pagos, ...cabecera } = v;
    return db.venta.create({
      data: { ...cabecera, estado: "COMPLETADA", lineas: { create: lineas }, pagos: { create: pagos } },
      include: incluirDetalle,
    });
  }

  /** Búsqueda acotada a la empresa del solicitante. */
  buscarPorId(db: Db, id: string, empresaId: string): Promise<VentaCompleta | null> {
    return db.venta.findFirst({ where: { id, sucursal: { empresaId } }, include: incluirDetalle });
  }

  /** Marca como ANULADA solo si sigue COMPLETADA (atómico). Devuelve filas afectadas. */
  async marcarAnulada(
    db: Db,
    id: string,
    empresaId: string,
    datos: { motivo: string; anuladaPorId: string; fecha: Date }
  ): Promise<number> {
    const r = await db.venta.updateMany({
      where: { id, estado: "COMPLETADA", sucursal: { empresaId } },
      data: { estado: "ANULADA", motivoAnulacion: datos.motivo, anuladaPorId: datos.anuladaPorId, fechaAnulacion: datos.fecha },
    });
    return r.count;
  }

  productosTipo(db: Db, ids: string[]): Promise<Array<Pick<Producto, "id" | "tipo">>> {
    return db.producto.findMany({ where: { id: { in: ids } }, select: { id: true, tipo: true } });
  }
}
