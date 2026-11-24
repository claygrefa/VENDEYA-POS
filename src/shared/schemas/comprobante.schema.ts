// ============================================================
// src/shared/schemas/comprobante.schema.ts — Comprobantes electrónicos SRI
// ============================================================
import { z } from "zod";
import { PaginacionSchema } from "./paginacion.schema";

export const ESTADOS_COMPROBANTE = ["PENDIENTE", "EN_PROCESO", "AUTORIZADO", "RECHAZADO", "DEVUELTO", "ANULADO"] as const;

/** Emitir (o reintentar) la factura de una venta ya registrada. */
export const EmitirFacturaSchema = z.object({
  /** Comprador a asignar a la venta antes de facturar (p. ej. si superaba el límite de Consumidor Final) */
  clienteId: z.string().uuid().optional(),
});

export const FiltroComprobantesSchema = PaginacionSchema.extend({
  estado:          z.enum(ESTADOS_COMPROBANTE).optional(),
  /** 01 factura, 04 nota de crédito */
  tipoComprobante: z.enum(["01", "04"]).optional(),
});

export type EmitirFacturaInput = z.infer<typeof EmitirFacturaSchema>;
