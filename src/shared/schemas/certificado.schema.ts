// ============================================================
// src/shared/schemas/certificado.schema.ts — Certificado digital (.p12) para la firma electrónica
// ============================================================
import { z } from "zod";

/** Tamaño máximo del .p12 (los emitidos por las entidades ecuatorianas pesan unos pocos KB). */
export const MAX_BYTES_P12 = 256 * 1024;

export const CargarCertificadoSchema = z.object({
  /** Contenido del archivo .p12 en base64 */
  archivoBase64: z
    .string()
    .min(1, "El archivo del certificado es obligatorio")
    .max(Math.ceil((MAX_BYTES_P12 * 4) / 3) + 8, "El archivo del certificado es demasiado grande")
    .regex(/^[A-Za-z0-9+/\r\n]+={0,2}$/, "El archivo del certificado debe venir en base64"),
  /** Contraseña del .p12 (solo se usa para abrirlo y se guarda cifrada) */
  password: z.string().min(1, "La contraseña del certificado es obligatoria").max(256),
  /** Confirma que el titular es correcto aunque su RUC/cédula no aparezca en el certificado */
  confirmarTitular: z.boolean().optional(),
});

export type CargarCertificadoInput = z.infer<typeof CargarCertificadoSchema>;
