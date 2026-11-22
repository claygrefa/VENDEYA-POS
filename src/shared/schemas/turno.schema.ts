// ============================================================
// src/shared/schemas/turno.schema.ts — Turnos y movimientos de caja
// ============================================================
import { z } from "zod";

export const AbrirTurnoSchema = z.object({
  sucursalId:    z.string().uuid(),
  montoApertura: z.number().nonnegative().default(0),
});

export const MovimientoCajaSchema = z.object({
  tipo:       z.enum(["INGRESO", "EGRESO"]),
  concepto:   z.string().trim().min(3, "El concepto es obligatorio (mínimo 3 caracteres)").max(200),
  monto:      z.number().positive(),
  referencia: z.string().trim().max(100).optional(),
});

/** Cierre ciego: el cajero declara lo contado sin conocer el valor esperado. */
export const CerrarTurnoSchema = z.object({
  efectivoContado: z.number().nonnegative(),
  observaciones:   z.string().trim().max(300).optional(),
});

export const TurnoActualQuerySchema = z.object({
  sucursalId: z.string().uuid().optional(),
});

export type AbrirTurnoInput = z.infer<typeof AbrirTurnoSchema>;
export type MovimientoCajaInput = z.infer<typeof MovimientoCajaSchema>;
export type CerrarTurnoInput = z.infer<typeof CerrarTurnoSchema>;
