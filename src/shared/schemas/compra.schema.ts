// ============================================================
// src/shared/schemas/compra.schema.ts
// ============================================================
import { z } from "zod";

export const LoteInputSchema = z.object({
  numeroLote:       z.string().trim().min(1).max(50),
  fechaVencimiento: z.coerce.date(),
  fechaFabricacion: z.coerce.date().optional(),
});

export const LineaCompraInputSchema = z.object({
  productoId:    z.string().uuid(),
  cantidad:      z.number().positive(),
  /** Costo unitario sin IVA */
  costoUnitario: z.number().positive(),
  /** Obligatorio si el producto requiere lote */
  lote:          LoteInputSchema.optional(),
});

export const CompraInputSchema = z.object({
  proveedorId:   z.string().uuid(),
  sucursalId:    z.string().uuid(),
  numeroFactura: z.string().trim().min(1).max(50),
  fecha:         z.coerce.date().optional(),
  formaPago:     z.enum(["CONTADO", "CREDITO"]).default("CONTADO"),
  /** Plazo de la compra a crédito; si se omite se usa `Proveedor.diasPago` */
  diasCredito:   z.number().int().nonnegative().max(365).optional(),
  lineas:        z.array(LineaCompraInputSchema).min(1, "La compra debe tener al menos una línea"),
  observaciones: z.string().trim().max(300).optional(),
  /**
   * Documento que sustenta la compra: FACTURA (01), NOTA_VENTA (02) o LIQUIDACION (03: la emite el comprador a un
   * proveedor que no emite comprobantes; `numeroFactura` es entonces solo una referencia interna).
   */
  tipoDocumento: z.enum(["FACTURA", "NOTA_VENTA", "LIQUIDACION"]).default("FACTURA"),
  /** Sustento tributario (Tabla de la ficha del ATS, 2 dígitos) */
  codSustento:   z.string().regex(/^\d{2}$/, "El sustento tributario son 2 dígitos").default("01"),
  /** Nº de autorización del documento del proveedor (10 a 49 dígitos) */
  autorizacion:  z.string().regex(/^\d{10,49}$/, "La autorización son 10 a 49 dígitos").optional(),
});

export type CompraInput = z.infer<typeof CompraInputSchema>;
