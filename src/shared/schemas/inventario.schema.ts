// ============================================================
// src/shared/schemas/inventario.schema.ts
// Presentaciones, listas de precios, lotes, ajustes de inventario y alertas
// ============================================================
import { z } from "zod";
import { LoteInputSchema } from "./compra.schema";
import { PaginacionSchema } from "./paginacion.schema";

// ── Presentaciones ───────────────────────────────────────────

export const PresentacionSchema = z.object({
  nombre:       z.string().trim().min(1).max(60),
  /** Unidades base que contiene la presentación (p. ej. caja x12 → 12) */
  factor:       z.number().positive().max(1_000_000),
  codigoBarras: z.string().trim().min(1).max(50).optional().nullable(),
  /** Si se omite: precio base del producto × factor */
  precioVenta:  z.number().positive().optional().nullable(),
});

export const PresentacionActualizarSchema = PresentacionSchema.partial().extend({
  status: z.enum(["ACTIVO", "INACTIVO"]).optional(),
});

// ── Listas de precios ────────────────────────────────────────

export const ListaPrecioSchema = z.object({
  nombre:      z.string().trim().min(2).max(100),
  descripcion: z.string().trim().max(300).optional(),
});

export const ListaPrecioActualizarSchema = ListaPrecioSchema.partial().extend({
  status: z.enum(["ACTIVO", "INACTIVO"]).optional(),
});

export const FijarPrecioSchema = z.object({
  productoId:     z.string().uuid(),
  presentacionId: z.string().uuid().optional().nullable(),
  precio:         z.number().positive(),
});

export const AsignarListaSchema = z.object({
  listaPrecioId: z.string().uuid().nullable(),
});

// ── Lotes ────────────────────────────────────────────────────

export const LoteCrearSchema = LoteInputSchema.extend({
  productoId:    z.string().uuid(),
  cantidad:      z.number().positive(),
  costoUnitario: z.number().nonnegative(),
  proveedorId:   z.string().uuid().optional(),
});

export const LoteActualizarSchema = z.object({
  fechaVencimiento: z.coerce.date().optional(),
  fechaFabricacion: z.coerce.date().optional(),
  status:           z.enum(["ACTIVO", "BLOQUEADO"]).optional(),
});

export const FiltroLotesSchema = PaginacionSchema.extend({
  productoId: z.string().uuid().optional(),
  status:     z.enum(["ACTIVO", "BLOQUEADO"]).optional(),
  /** true = solo lotes con existencia */
  conStock:   z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});

// ── Ajustes de inventario y consultas ────────────────────────

export const AjusteInventarioSchema = z.object({
  productoId:    z.string().uuid(),
  tipo:          z.enum(["ENTRADA", "SALIDA"]),
  cantidad:      z.number().positive(),
  /** Obligatorio en ENTRADA */
  costoUnitario: z.number().nonnegative().optional(),
  motivo:        z.string().trim().min(5, "El motivo debe tener al menos 5 caracteres").max(200),
  /** ENTRADA de un producto con lote: datos del lote a crear o reponer */
  lote:          LoteInputSchema.optional(),
  /** SALIDA de un producto con lote: lote del que se descuenta */
  loteId:        z.string().uuid().optional(),
});

export const AlertaVencimientoQuerySchema = z.object({
  dias: z.coerce.number().int().min(0).max(365).default(30),
});

export type PresentacionInput = z.infer<typeof PresentacionSchema>;
export type ListaPrecioInput = z.infer<typeof ListaPrecioSchema>;
export type FijarPrecioInput = z.infer<typeof FijarPrecioSchema>;
export type LoteCrearInput = z.infer<typeof LoteCrearSchema>;
export type AjusteInventarioInput = z.infer<typeof AjusteInventarioSchema>;
