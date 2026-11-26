// ============================================================
// src/shared/schemas/sucursal.schema.ts — Sucursales (establecimientos) y puntos de emisión
// ============================================================
import { z } from "zod";

const TELEFONO = /^[0-9+()\-\s]{7,20}$/;

export const NuevaSucursalSchema = z.object({
  nombre:    z.string().trim().min(2).max(100),
  direccion: z.string().trim().min(5).max(300),
  telefono:  z.string().trim().regex(TELEFONO, "Teléfono inválido"),
});
export type NuevaSucursalInput = z.infer<typeof NuevaSucursalSchema>;

/** El código (001, 002…) no se cambia: forma parte de la serie de los comprobantes y de la clave de acceso. */
export const ActualizarSucursalSchema = NuevaSucursalSchema.partial();

export const EstadoSucursalSchema = z.object({ estado: z.enum(["ACTIVO", "INACTIVO"]) });

export const NuevoPuntoEmisionSchema = z.object({
  descripcion: z.string().trim().min(2).max(100),
});

export const ActualizarPuntoEmisionSchema = z.object({
  descripcion: z.string().trim().min(2).max(100).optional(),
  estado:      z.enum(["ACTIVO", "INACTIVO"]).optional(),
});
