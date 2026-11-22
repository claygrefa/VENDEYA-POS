// ============================================================
// src/server/services/password.util.ts — Hash de contraseñas/PIN (scrypt nativo)
// Formato almacenado: scrypt$<salt hex>$<hash hex>
// ============================================================
import { randomBytes, scrypt, timingSafeEqual } from "crypto";

const KEY_LENGTH = 64;

function derivar(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derivar(password, salt);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, almacenado: string): Promise<boolean> {
  const partes = almacenado.split("$");
  if (partes.length !== 3 || partes[0] !== "scrypt") return false;
  const salt = Buffer.from(partes[1] as string, "hex");
  const esperado = Buffer.from(partes[2] as string, "hex");
  if (esperado.length !== KEY_LENGTH) return false;
  const obtenido = await derivar(password, salt);
  return timingSafeEqual(obtenido, esperado);
}
