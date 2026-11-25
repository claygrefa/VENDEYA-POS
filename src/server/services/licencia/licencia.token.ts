// ============================================================
// src/server/services/licencia/licencia.token.ts — Licencia firmada por el servidor de licencias (Ed25519)
//
// Formato: base64url(JSON del payload) + "." + base64url(firma). La aplicación solo trae la clave PÚBLICA: puede comprobar que la
// licencia es auténtica pero no fabricar una. `firmarLicencia` existe para el servidor de licencias y para las pruebas.
// ============================================================
import { createPrivateKey, createPublicKey, sign, verify } from "crypto";
import { z } from "zod";

export const LicenciaPayloadSchema = z.object({
  v: z.literal(1),
  licenciaId: z.string().min(1),
  /** RUC de la empresa licenciada */
  ruc: z.string().regex(/^\d{13}$/),
  plan: z.string().min(1),
  maxDispositivos: z.number().int().min(1).max(1000),
  /** Equipo en el que se activó: la licencia no sirve copiada a otro */
  dispositivoId: z.string().min(1),
  emitida: z.string().datetime(),
  /** Fin de la suscripción */
  vence: z.string().datetime(),
});

export type LicenciaPayload = z.infer<typeof LicenciaPayloadSchema>;

const b64 = (b: Buffer): string => b.toString("base64url");

export function firmarLicencia(payload: LicenciaPayload, clavePrivadaPem: string): string {
  const cuerpo = Buffer.from(JSON.stringify(payload), "utf8");
  const firma = sign(null, cuerpo, createPrivateKey(clavePrivadaPem));
  return `${b64(cuerpo)}.${b64(firma)}`;
}

export type ResultadoVerificacion = { valida: true; payload: LicenciaPayload } | { valida: false; motivo: string };

/** Comprueba la firma y la forma del contenido. Nunca lanza. */
export function verificarLicencia(token: string, clavePublicaPem: string): ResultadoVerificacion {
  try {
    const partes = token.split(".");
    if (partes.length !== 2 || partes[0] === "" || partes[1] === "") return { valida: false, motivo: "La licencia tiene un formato inválido" };
    const cuerpo = Buffer.from(partes[0] as string, "base64url");
    const firma = Buffer.from(partes[1] as string, "base64url");
    if (!verify(null, cuerpo, createPublicKey(clavePublicaPem), firma)) return { valida: false, motivo: "La licencia no es auténtica (firma inválida)" };
    const payload = LicenciaPayloadSchema.safeParse(JSON.parse(cuerpo.toString("utf8")));
    return payload.success ? { valida: true, payload: payload.data } : { valida: false, motivo: "La licencia tiene un contenido inválido" };
  } catch {
    return { valida: false, motivo: "La licencia no se pudo leer" };
  }
}
