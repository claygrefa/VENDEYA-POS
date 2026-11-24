// ============================================================
// src/server/repositories/impresion.repository.ts — Datos para tickets e impresora
// ============================================================
import type { Prisma } from "@prisma/client";
import type { Db } from "./kardex.repository";

const incluirVentaTicket = {
  lineas: { select: { descripcion: true, cantidad: true, precioUnitario: true, total: true } },
  pagos: { select: { formaPago: true, monto: true, cambio: true } },
  cajero: { select: { nombre: true, apellido: true } },
  comprobante: { select: { claveAcceso: true, estado: true, numeroAutorizacion: true, ambiente: true } },
  sucursal: { include: { empresa: true } },
} satisfies Prisma.VentaInclude;

export type VentaParaTicket = Prisma.VentaGetPayload<{ include: typeof incluirVentaTicket }>;

export class ImpresionRepository {
  venta(db: Db, id: string, empresaId: string): Promise<VentaParaTicket | null> {
    return db.venta.findFirst({ where: { id, sucursal: { empresaId } }, include: incluirVentaTicket });
  }

  empresa(db: Db, empresaId: string) {
    return db.empresa.findUnique({ where: { id: empresaId } });
  }

  guardarImpresora(db: Db, empresaId: string, d: { conexion: string; direccion: string | null; puerto: number; ancho: number }) {
    return db.configuracionGiro.update({
      where: { empresaId },
      data: { impresoraConexion: d.conexion, impresoraDireccion: d.direccion, impresoraPuerto: d.puerto, impresoraAncho: d.ancho },
    });
  }
}
