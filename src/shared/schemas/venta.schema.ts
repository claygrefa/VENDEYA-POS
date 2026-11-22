// ============================================================
// src/shared/schemas/venta.schema.ts
// ============================================================
import { z } from "zod";

export const LineaVentaInputSchema = z.object({
  productoId:     z.string().uuid(),
  loteId:         z.string().uuid().optional().nullable(),
  cantidad:       z.number().positive(),
  precioUnitario: z.number().positive(),
  // VALOR: monto total descontado de la línea; PORCENTAJE: 0–100
  descuento:      z.number().nonnegative().default(0),
  tipoDescuento:  z.enum(["PORCENTAJE", "VALOR"]).default("VALOR"),
});

export const PagoVentaInputSchema = z.object({
  formaPago:  z.enum(["EFECTIVO","TARJETA_CREDITO","TARJETA_DEBITO","TRANSFERENCIA","CHEQUE","CREDITO","OTRO"]),
  monto:      z.number().positive(),
  referencia: z.string().max(100).optional().nullable(),
});

export const VentaInputSchema = z.object({
  puntoEmisionId:   z.string().uuid(),
  clienteId:        z.string().uuid().optional().nullable(),
  clienteRuc:       z.string().max(13).optional().nullable(),
  clienteNombre:    z.string().max(300).optional().nullable(),
  lineas:           z.array(LineaVentaInputSchema).min(1, "La venta debe tener al menos una línea"),
  pagos:            z.array(PagoVentaInputSchema).min(1,  "La venta debe tener al menos un pago"),
  emitirFactura:    z.boolean().default(false),
  observaciones:    z.string().max(300).optional().nullable(),
});

export const AnularVentaSchema = z.object({
  motivo: z.string().trim().min(5, "El motivo debe tener al menos 5 caracteres").max(300),
});

export type AnularVentaInput = z.infer<typeof AnularVentaSchema>;
export type LineaVentaInput = z.infer<typeof LineaVentaInputSchema>;
export type PagoVentaInput  = z.infer<typeof PagoVentaInputSchema>;
export type VentaInput      = z.infer<typeof VentaInputSchema>;
