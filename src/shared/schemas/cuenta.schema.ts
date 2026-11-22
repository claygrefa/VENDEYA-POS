// ============================================================
// src/shared/schemas/cuenta.schema.ts — Abonos y filtros de cuentas por cobrar/pagar
// ============================================================
import { z } from "zod";
import { PaginacionSchema } from "./paginacion.schema";

export const AbonoSchema = z.object({
  monto:      z.number().positive(),
  formaPago:  z.enum(["EFECTIVO", "TARJETA_CREDITO", "TARJETA_DEBITO", "TRANSFERENCIA", "CHEQUE", "OTRO"]),
  referencia: z.string().trim().max(100).optional(),
});

const booleanoQuery = z.enum(["true", "false"]).transform((v) => v === "true");

const ESTADOS_CUENTA = ["PENDIENTE", "PARCIAL", "PAGADA", "ANULADA"] as const;

export const FiltroCuentasPorCobrarSchema = PaginacionSchema.extend({
  estado:    z.enum(ESTADOS_CUENTA).optional(),
  clienteId: z.string().uuid().optional(),
  /** true = solo cuentas con saldo cuya fecha de vencimiento ya pasó */
  vencidas:  booleanoQuery.optional(),
});

export const FiltroCuentasPorPagarSchema = PaginacionSchema.extend({
  estado:      z.enum(ESTADOS_CUENTA).optional(),
  proveedorId: z.string().uuid().optional(),
  vencidas:    booleanoQuery.optional(),
});

export type AbonoInput = z.infer<typeof AbonoSchema>;
export type FiltroCuentasPorCobrar = z.infer<typeof FiltroCuentasPorCobrarSchema>;
export type FiltroCuentasPorPagar = z.infer<typeof FiltroCuentasPorPagarSchema>;
