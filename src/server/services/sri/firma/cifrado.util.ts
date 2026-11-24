// ============================================================
// src/server/services/sri/firma/cifrado.util.ts — AES-256-GCM para secretos locales
//
// - Clave de cifrado: HKDF-SHA256 de la clave maestra de la instalación (nunca la maestra directamente).
// - IV de 12 bytes aleatorio por cifrado; etiqueta de autenticación de 16 bytes.
// - AAD (datos asociados): enlaza el texto cifrado con su dueño (p. ej. la empresa), de modo que un secreto
//   copiado a otra fila no se descifra aunque la clave sea la misma.
// ============================================================
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";
import { AppError } from "../../appError.util";

const ALGORITMO = "aes-256-gcm";
const LONGITUD_IV = 12;
const LONGITUD_TAG = 16;
const CONTEXTO_HKDF = "vendeya/certificado-p12/v1";

/** Texto cifrado y sus parámetros, en base64 (se guardan en columnas separadas). */
export interface SecretoCifrado {
  cifrado: string;
  iv: string;
  tag: string;
}

export function derivarClaveCifrado(claveMaestra: Buffer): Buffer {
  if (claveMaestra.length !== 32) throw new AppError("VALIDACION", "La clave maestra debe tener 32 bytes");
  return Buffer.from(hkdfSync("sha256", claveMaestra, Buffer.alloc(0), CONTEXTO_HKDF, 32));
}

export function cifrarSecreto(texto: string, claveMaestra: Buffer, aad: string): SecretoCifrado {
  const iv = randomBytes(LONGITUD_IV);
  const cifrador = createCipheriv(ALGORITMO, derivarClaveCifrado(claveMaestra), iv, { authTagLength: LONGITUD_TAG });
  cifrador.setAAD(Buffer.from(aad, "utf8"));
  const cifrado = Buffer.concat([cifrador.update(texto, "utf8"), cifrador.final()]);
  return { cifrado: cifrado.toString("base64"), iv: iv.toString("base64"), tag: cifrador.getAuthTag().toString("base64") };
}

/**
 * Descifra y autentica. Cualquier alteración del texto, del IV, de la etiqueta, del AAD o una clave distinta
 * produce el mismo error genérico (no se revela cuál de ellas falló).
 */
export function descifrarSecreto(secreto: SecretoCifrado, claveMaestra: Buffer, aad: string): string {
  try {
    const iv = Buffer.from(secreto.iv, "base64");
    const tag = Buffer.from(secreto.tag, "base64");
    if (iv.length !== LONGITUD_IV || tag.length !== LONGITUD_TAG) throw new Error("parámetros inválidos");
    const descifrador = createDecipheriv(ALGORITMO, derivarClaveCifrado(claveMaestra), iv, { authTagLength: LONGITUD_TAG });
    descifrador.setAAD(Buffer.from(aad, "utf8"));
    descifrador.setAuthTag(tag);
    return Buffer.concat([descifrador.update(Buffer.from(secreto.cifrado, "base64")), descifrador.final()]).toString("utf8");
  } catch {
    throw new AppError("ESTADO_INVALIDO", "No se pudo descifrar la contraseña del certificado (datos alterados o clave distinta): vuelva a cargar el certificado");
  }
}
