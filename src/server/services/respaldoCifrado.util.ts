// ============================================================
// src/server/services/respaldoCifrado.util.ts — Cifrado de respaldos con frase de paso (AES-256-GCM)
//
// Un respaldo que sale del equipo (carpeta de OneDrive/Drive/Dropbox, disco externo) lleva toda la base: ventas, clientes, comprobantes.
// Se cifra ANTES de salir, con una frase que el negocio guarda y que el proveedor de la nube nunca ve.
//
// Formato del archivo `.vdbk`:   "VDYBK1" | sal (16) | IV (12) | texto cifrado (streaming) | etiqueta GCM (16)
//   · clave = scrypt(frase, sal, N=2^15, r=8, p=1) → 32 bytes; la cabecera completa viaja como AAD, así que alterar la sal o el IV
//     (no solo el contenido) hace fallar la autenticación.
//   · se procesa por bloques: una base de cientos de MB no se carga entera en memoria.
//   · al descifrar, el resultado se escribe en `destino` y se BORRA si la autenticación falla: nunca queda una base a medias.
// ============================================================
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "crypto";
import { createReadStream, createWriteStream, rmSync, statSync } from "fs";
import { open } from "fs/promises";
import { once } from "events";
import { AppError } from "./appError.util";

export const EXTENSION_RESPALDO_CIFRADO = ".vdbk";
const MAGIA = Buffer.from("VDYBK1", "ascii");
const LONGITUD_SAL = 16;
const LONGITUD_IV = 12;
const LONGITUD_TAG = 16;
const LONGITUD_CABECERA = MAGIA.length + LONGITUD_SAL + LONGITUD_IV;
/** Frase mínima: más corta se adivina fuera de línea aunque scrypt la encarezca */
export const LONGITUD_MINIMA_FRASE = 12;

function derivarClave(frase: string, sal: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(frase.normalize("NFC"), sal, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }, (err, clave) => (err ? reject(err) : resolve(clave)));
  });
}

/** Cifra `origen` en `destino`. Si algo falla no deja un destino parcial. */
export async function cifrarArchivo(origen: string, destino: string, frase: string): Promise<void> {
  if (frase.length < LONGITUD_MINIMA_FRASE) throw new AppError("VALIDACION", `La frase del respaldo debe tener al menos ${LONGITUD_MINIMA_FRASE} caracteres`);
  const sal = randomBytes(LONGITUD_SAL);
  const iv = randomBytes(LONGITUD_IV);
  const cabecera = Buffer.concat([MAGIA, sal, iv]);
  const cifrador = createCipheriv("aes-256-gcm", await derivarClave(frase, sal), iv, { authTagLength: LONGITUD_TAG });
  cifrador.setAAD(cabecera);
  const salida = createWriteStream(destino, { mode: 0o600 });
  try {
    salida.write(cabecera);
    for await (const bloque of createReadStream(origen)) {
      if (!salida.write(cifrador.update(bloque as Buffer))) await once(salida, "drain");
    }
    salida.write(cifrador.final());
    salida.end(cifrador.getAuthTag());
    await once(salida, "finish");
  } catch (e) {
    await descartar(salida, destino);
    throw e;
  }
}

/** Descifra `origen` en `destino`; si la frase es incorrecta o el archivo fue alterado lanza un error genérico y borra `destino`. */
export async function descifrarArchivo(origen: string, destino: string, frase: string): Promise<void> {
  const tamano = statSync(origen).size;
  if (tamano < LONGITUD_CABECERA + LONGITUD_TAG) throw errorDescifrado();
  const manejador = await open(origen, "r");
  let cabecera: Buffer;
  let tag: Buffer;
  try {
    cabecera = Buffer.alloc(LONGITUD_CABECERA);
    tag = Buffer.alloc(LONGITUD_TAG);
    await manejador.read(cabecera, 0, LONGITUD_CABECERA, 0);
    await manejador.read(tag, 0, LONGITUD_TAG, tamano - LONGITUD_TAG);
  } finally {
    await manejador.close();
  }
  if (!cabecera.subarray(0, MAGIA.length).equals(MAGIA)) throw errorDescifrado();
  const sal = cabecera.subarray(MAGIA.length, MAGIA.length + LONGITUD_SAL);
  const iv = cabecera.subarray(MAGIA.length + LONGITUD_SAL);
  const descifrador = createDecipheriv("aes-256-gcm", await derivarClave(frase, sal), iv, { authTagLength: LONGITUD_TAG });
  descifrador.setAAD(cabecera);
  descifrador.setAuthTag(tag);
  const salida = createWriteStream(destino, { mode: 0o600 });
  try {
    const fin = tamano - LONGITUD_TAG - 1;
    if (fin >= LONGITUD_CABECERA) {
      for await (const bloque of createReadStream(origen, { start: LONGITUD_CABECERA, end: fin })) {
        if (!salida.write(descifrador.update(bloque as Buffer))) await once(salida, "drain");
      }
    }
    salida.write(descifrador.final()); // lanza si la etiqueta no coincide
    salida.end();
    await once(salida, "finish");
  } catch {
    await descartar(salida, destino);
    throw errorDescifrado();
  }
}

/** Cierra el archivo (Windows no deja borrar uno abierto) y lo elimina */
async function descartar(salida: ReturnType<typeof createWriteStream>, ruta: string): Promise<void> {
  await new Promise<void>((resolver) => {
    salida.once("close", () => resolver());
    salida.destroy();
  });
  rmSync(ruta, { force: true });
}

function errorDescifrado(): AppError {
  return new AppError("ESTADO_INVALIDO", "No se pudo descifrar el respaldo: la frase es incorrecta o el archivo está dañado o alterado");
}
