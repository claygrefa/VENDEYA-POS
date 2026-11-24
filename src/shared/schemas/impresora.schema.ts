// ============================================================
// src/shared/schemas/impresora.schema.ts — Configuración de la impresora térmica
// ============================================================
import { z } from "zod";

export const ConfigurarImpresoraSchema = z
  .object({
    conexion: z.enum(["NINGUNA", "RED", "SISTEMA"]),
    /** RED: dirección IP o nombre de host · SISTEMA: nombre de la impresora instalada */
    direccion: z.string().trim().min(1).max(100).optional(),
    puerto: z.number().int().min(1).max(65535).default(9100),
    /** Ancho del papel en mm */
    ancho: z.union([z.literal(58), z.literal(80)]).default(80),
  })
  .superRefine((v, ctx) => {
    if (v.conexion !== "NINGUNA" && v.direccion === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["direccion"], message: v.conexion === "RED" ? "Indique la dirección de la impresora" : "Indique el nombre de la impresora" });
    }
  });

export type ConfigurarImpresoraInput = z.infer<typeof ConfigurarImpresoraSchema>;
