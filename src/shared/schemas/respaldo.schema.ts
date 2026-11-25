// ============================================================
// src/shared/schemas/respaldo.schema.ts — Respaldos: configuración de la copia cifrada en la nube
// ============================================================
import { z } from "zod";

/** Frase mínima del respaldo cifrado (ver respaldoCifrado.util.ts) */
export const LONGITUD_MINIMA_FRASE_RESPALDO = 12;

export const ConfigurarNubeSchema = z.object({
  /** Carpeta que sincroniza el proveedor de nube (OneDrive, Google Drive, Dropbox…) o un disco externo/de red; ruta absoluta */
  carpeta: z.string().trim().min(1, "Indique la carpeta de destino").max(500),
  /** Frase con la que se cifra cada copia; sin ella no se puede restaurar. El negocio debe guardarla aparte. */
  frase: z.string().min(LONGITUD_MINIMA_FRASE_RESPALDO, `La frase debe tener al menos ${LONGITUD_MINIMA_FRASE_RESPALDO} caracteres`).max(200),
});
export type ConfigurarNubeInput = z.infer<typeof ConfigurarNubeSchema>;
