// ============================================================
// src/server/repositories/compra.repository.ts
// ============================================================
import type { Prisma, Proveedor, Sucursal, TarifaImpuesto, Producto } from "@prisma/client";
import type { Db } from "./kardex.repository";

const incluirDetalle = {
  lineas: true,
  cuentaPorPagar: { select: { id: true, saldo: true, estado: true, fechaVencimiento: true } },
  proveedor: { select: { id: true, razonSocial: true, ruc: true } },
} satisfies Prisma.CompraInclude;

export type CompraCompleta = Prisma.CompraGetPayload<{ include: typeof incluirDetalle }>;
export type ProductoConTarifa = Producto & { tarifaImpuesto: TarifaImpuesto | null };

export interface NuevaCompra {
  proveedorId: string;
  sucursalId: string;
  usuarioId: string;
  numeroFactura: string;
  fecha: Date;
  formaPago: "CONTADO" | "CREDITO";
  subtotal: number;
  iva: number;
  total: number;
  observaciones: string | null;
  tipoDocumento: string;
  codSustento: string;
  autorizacion: string | null;
  lineas: Array<Omit<Prisma.LineaCompraUncheckedCreateWithoutCompraInput, "id">>;
}

export class CompraRepository {
  proveedor(db: Db, id: string): Promise<Proveedor | null> {
    return db.proveedor.findUnique({ where: { id } });
  }

  sucursal(db: Db, id: string): Promise<Sucursal | null> {
    return db.sucursal.findUnique({ where: { id } });
  }

  facturaExiste(db: Db, proveedorId: string, numeroFactura: string): Promise<{ id: string } | null> {
    return db.compra.findUnique({
      where: { proveedorId_numeroFactura: { proveedorId, numeroFactura } },
      select: { id: true },
    });
  }

  productosPorIds(db: Db, ids: string[]): Promise<ProductoConTarifa[]> {
    return db.producto.findMany({ where: { id: { in: ids } }, include: { tarifaImpuesto: true } });
  }

  async tarifasIva(db: Db, empresaId: string): Promise<Map<string, number>> {
    const tarifas = await db.tarifaImpuesto.findMany({ where: { empresaId, tipoImpuesto: "IVA", vigente: true } });
    return new Map(tarifas.map((t) => [t.codigo, t.porcentaje]));
  }

  crear(db: Db, c: NuevaCompra): Promise<CompraCompleta> {
    const { lineas, ...cabecera } = c;
    return db.compra.create({ data: { ...cabecera, lineas: { create: lineas } }, include: incluirDetalle });
  }

  buscarPorId(db: Db, id: string, empresaId: string): Promise<CompraCompleta | null> {
    return db.compra.findFirst({ where: { id, sucursal: { empresaId } }, include: incluirDetalle });
  }
}
