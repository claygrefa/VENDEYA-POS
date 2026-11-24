// ============================================================
// src/shared/schemas/balanza.schema.ts — Balanza serial y escaneo de códigos
// ============================================================
import { z } from "zod";

export const BAUDIOS_VALIDOS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200] as const;

export const ConfigurarBalanzaSchema = z.object({
  /** COM3, /dev/ttyUSB0… (vacío o ausente = sin balanza) */
  puerto: z
    .string()
    .trim()
    .regex(/^(COM\d{1,3}|\/dev\/[A-Za-z0-9._\-/]{1,60})$/, "Puerto inválido (ej. COM3 o /dev/ttyUSB0)")
    .optional(),
  baudios: z.union(BAUDIOS_VALIDOS.map((b) => z.literal(b)) as unknown as [z.ZodLiteral<number>, z.ZodLiteral<number>, ...Array<z.ZodLiteral<number>>]).default(9600),
  protocolo: z.enum(["GENERICO", "CAS"]).default("GENERICO"),
  /** Qué lleva el EAN-13 que imprime la balanza: el peso (gramos) o el precio (centavos) */
  etiqueta: z.enum(["PESO", "PRECIO"]).default("PESO"),
});

export const LeerPesoSchema = z.object({
  /** Producto que se pesa: convierte el peso a su unidad de medida */
  productoId: z.string().uuid().optional(),
  /** Tara (peso del recipiente) en kilogramos */
  tara: z.coerce.number().min(0).max(1000).default(0),
});

export type ConfigurarBalanzaInput = z.infer<typeof ConfigurarBalanzaSchema>;
