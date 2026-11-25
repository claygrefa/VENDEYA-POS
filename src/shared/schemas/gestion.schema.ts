// ============================================================
// src/shared/schemas/gestion.schema.ts — Proveedores, listados de ventas y compras, reportes
// ============================================================
import { z } from "zod";
import { PaginacionSchema } from "./paginacion.schema";

const texto = (max: number) => z.string().trim().max(max);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use el formato AAAA-MM-DD");

export const ProveedorSchema = z.object({
  /** RUC (13 dígitos) o cédula (10) del proveedor */
  ruc:             z.string().trim().regex(/^(\d{10}|\d{13})$/, "El RUC tiene 13 dígitos (o 10 si es una cédula)"),
  razonSocial:     z.string().trim().min(2).max(300),
  nombreComercial: texto(300).optional().nullable(),
  email:           z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Email inválido").optional().nullable(),
  telefono:        z.string().regex(/^[\d\s\-+()]{7,20}$/, "Teléfono inválido").optional().nullable(),
  direccion:       texto(300).optional().nullable(),
  contacto:        texto(200).optional().nullable(),
  diasPago:        z.number().int().min(0).max(365).default(30),
});

export const ProveedorActualizarSchema = ProveedorSchema.partial().extend({ status: z.enum(["ACTIVO", "INACTIVO"]).optional() });

export const FiltroVentasSchema = PaginacionSchema.extend({
  desde:   fecha.optional(),
  hasta:   fecha.optional(),
  turnoId: z.string().uuid().optional(),
  estado:  z.enum(["COMPLETADA", "ANULADA"]).optional(),
});

export const FiltroComprasSchema = PaginacionSchema.extend({
  desde: fecha.optional(),
  hasta: fecha.optional(),
});

export const TIPOS_REPORTE = ["ventas", "utilidad", "stock", "cartera"] as const;
export const AGRUPACIONES_VENTAS = ["dia", "producto", "formaPago", "cajero"] as const;

export const ReporteQuerySchema = z.object({
  desde:   fecha.optional(),
  hasta:   fecha.optional(),
  agrupar: z.enum(AGRUPACIONES_VENTAS).default("dia"),
  formato: z.enum(["json", "csv"]).default("json"),
});

export type TipoReporte = (typeof TIPOS_REPORTE)[number];
export type ProveedorInput = z.infer<typeof ProveedorSchema>;
