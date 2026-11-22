// ============================================================
// src/server/services/validation.util.ts — Validación Zod → AppError
// ============================================================
import type { ZodTypeAny, z } from "zod";
import { AppError } from "./appError.util";

/** Valida `datos` con el esquema o lanza AppError("VALIDACION") con todos los mensajes. */
export function parsear<S extends ZodTypeAny>(schema: S, datos: unknown): z.output<S> {
  const resultado = schema.safeParse(datos);
  if (!resultado.success) {
    const detalle = resultado.error.issues
      .map((i) => (i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
    throw new AppError("VALIDACION", detalle);
  }
  return resultado.data;
}
