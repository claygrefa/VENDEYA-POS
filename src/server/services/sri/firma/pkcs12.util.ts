// ============================================================
// src/server/services/sri/firma/pkcs12.util.ts — Lectura y validación de certificados .p12 (PKCS#12)
// Usa node-forge: soporta el cifrado clásico (RC2/3DES) que emplean las entidades certificadoras de Ecuador.
// ============================================================
import { createHash } from "crypto";
import forge from "node-forge";
import { AppError } from "../../appError.util";

/** Longitud mínima de clave RSA exigida por la Ficha Técnica (6.8). */
export const BITS_MINIMOS_CLAVE = 2048;
/** Días antes del vencimiento a partir de los cuales se advierte. */
export const DIAS_AVISO_VENCIMIENTO = 30;

export interface InfoCertificado {
  /** CN del titular */
  titular: string;
  /** Emisor en formato RFC 2253 (el que usa el ejemplo de la ficha: CN=…,OU=…,O=…,C=EC) */
  emisor: string;
  /** Número de serie en decimal */
  serie: string;
  /** SHA-1 del certificado DER, en hexadecimal */
  huella: string;
  vigenteDesde: Date;
  vigenteHasta: Date;
  bitsClave: number;
  /** Cédulas/RUC (10 o 13 dígitos) encontrados en el sujeto y en las extensiones del certificado */
  identificadores: string[];
}

/** Material necesario para firmar: nunca debe serializarse ni registrarse. */
export interface MaterialFirma {
  clavePrivadaPem: string;
  certificadoPem: string;
  certificadoDerBase64: string;
  /** Módulo y exponente de la clave pública (base64 de los enteros sin ceros a la izquierda) */
  modulo: string;
  exponente: string;
  /** Subject/Issuer tal como deben aparecer en `X509IssuerName` de XAdES */
  emisorRfc2253: string;
  serieDecimal: string;
  /** SHA-1 del certificado en base64 (para `CertDigest`) */
  huellaSha1Base64: string;
  info: InfoCertificado;
}

// ── Helpers ──────────────────────────────────────────────────

function escaparRfc2253(valor: string): string {
  let r = valor.replace(/([,+"\\<>;])/g, "\\$1");
  if (r.startsWith("#") || r.startsWith(" ")) r = `\\${r}`;
  if (r.endsWith(" ")) r = `${r.slice(0, -1)}\\ `;
  return r;
}

/** DN en orden RFC 2253 (el atributo más específico primero), como lo imprime Java en el ejemplo del SRI. */
export function nombreRfc2253(atributos: forge.pki.CertificateField[]): string {
  return [...atributos]
    .reverse()
    .map((a) => `${a.shortName ?? a.name ?? a.type ?? "?"}=${escaparRfc2253(String(a.value))}`)
    .join(",");
}

function enteroABase64(valor: forge.jsbn.BigInteger): string {
  let hex = valor.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  return Buffer.from(hex, "hex").toString("base64");
}

/** Cadenas de 10 o 13 dígitos (cédula / RUC) halladas en el sujeto y en los valores de las extensiones. */
function buscarIdentificadores(cert: forge.pki.Certificate): string[] {
  const textos: string[] = cert.subject.attributes.map((a) => String(a.value));
  for (const ext of cert.extensions as Array<{ value?: unknown }>) {
    if (typeof ext.value === "string") textos.push(ext.value); // DER crudo: los números van como texto ASCII
  }
  const encontrados = new Set<string>();
  for (const t of textos) {
    for (const m of t.matchAll(/\d+/g)) {
      if (m[0].length === 10 || m[0].length === 13) encontrados.add(m[0]);
    }
  }
  return [...encontrados];
}

// ── Lectura ──────────────────────────────────────────────────

/**
 * Abre un .p12 y extrae la clave privada con su certificado. La contraseña incorrecta y el archivo dañado
 * producen el mismo error (no se distingue para no ayudar a un ataque de adivinación).
 */
export function leerPkcs12(archivo: Buffer, password: string): MaterialFirma {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(archivo.toString("binary")));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch {
    throw new AppError("VALIDACION", "No se pudo abrir el certificado: la contraseña es incorrecta o el archivo .p12 está dañado");
  }

  const { pkcs8ShroudedKeyBag, keyBag, certBag } = forge.pki.oids;
  const bolsas = (tipo: string): forge.pkcs12.Bag[] => (p12.getBags({ bagType: tipo })[tipo] ?? []) as forge.pkcs12.Bag[];
  const claves = [...bolsas(pkcs8ShroudedKeyBag as string), ...bolsas(keyBag as string)]
    .map((b) => b.key as forge.pki.rsa.PrivateKey | undefined)
    .filter((k): k is forge.pki.rsa.PrivateKey => k !== undefined && "n" in k && "d" in k);
  const certificados = bolsas(certBag as string)
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => c !== undefined);

  if (claves.length === 0) throw new AppError("VALIDACION", "El archivo .p12 no contiene una clave privada RSA");
  // El certificado de la persona es el que corresponde a la clave privada (el archivo puede traer toda la cadena)
  const hallado = claves
    .map((k) => ({ k, c: certificados.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n.compareTo(k.n) === 0) }))
    .find((par) => par.c !== undefined);
  if (hallado === undefined || hallado.c === undefined) {
    throw new AppError("VALIDACION", "El archivo .p12 no contiene el certificado que corresponde a la clave privada");
  }
  const { k: clave, c: cert } = hallado;

  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), "binary");
  const huella = createHash("sha1").update(der).digest();
  const emisorRfc2253 = nombreRfc2253(cert.issuer.attributes);
  const serieDecimal = BigInt(`0x${cert.serialNumber}`).toString();

  return {
    clavePrivadaPem: forge.pki.privateKeyToPem(clave),
    certificadoPem: forge.pki.certificateToPem(cert),
    certificadoDerBase64: der.toString("base64"),
    modulo: enteroABase64(clave.n),
    exponente: enteroABase64(clave.e),
    emisorRfc2253,
    serieDecimal,
    huellaSha1Base64: huella.toString("base64"),
    info: {
      titular: String(cert.subject.getField("CN")?.value ?? cert.subject.attributes[0]?.value ?? "(sin nombre)"),
      emisor: emisorRfc2253,
      serie: serieDecimal,
      huella: huella.toString("hex"),
      vigenteDesde: cert.validity.notBefore,
      vigenteHasta: cert.validity.notAfter,
      bitsClave: clave.n.bitLength(),
      identificadores: buscarIdentificadores(cert),
    },
  };
}

// ── Validación para el emisor ────────────────────────────────

export interface OpcionesValidacion {
  /** RUC de la empresa (13 dígitos) */
  ruc: string;
  ahora?: Date;
  /** El administrador confirma que el titular es correcto aunque su RUC/cédula no aparezca en el certificado */
  confirmarTitular?: boolean;
}

const formato = (f: Date): string => f.toISOString().slice(0, 10);

/**
 * Comprueba que el certificado sirva para firmar los comprobantes de la empresa.
 * Devuelve advertencias (p. ej. próximo a vencer); lanza AppError si no es utilizable.
 */
export function validarCertificadoParaEmisor(info: InfoCertificado, opciones: OpcionesValidacion): string[] {
  const ahora = opciones.ahora ?? new Date();
  if (info.bitsClave < BITS_MINIMOS_CLAVE) {
    throw new AppError("VALIDACION", `La clave del certificado es de ${info.bitsClave} bits; el SRI exige al menos ${BITS_MINIMOS_CLAVE}`);
  }
  if (ahora.getTime() > info.vigenteHasta.getTime()) {
    throw new AppError("VALIDACION", `El certificado está vencido desde el ${formato(info.vigenteHasta)}`);
  }
  if (ahora.getTime() < info.vigenteDesde.getTime()) {
    throw new AppError("VALIDACION", `El certificado aún no es válido (vigente desde el ${formato(info.vigenteDesde)})`);
  }
  // Los RUC de persona natural son la cédula + "001": se acepta cualquiera de las dos formas
  const buscados = [opciones.ruc, opciones.ruc.slice(0, 10)];
  if (!info.identificadores.some((id) => buscados.includes(id))) {
    // Un certificado que declara OTRO RUC/cédula jamás se acepta; la confirmación solo cubre a los que no declaran ninguno
    if (info.identificadores.length > 0) {
      throw new AppError("VALIDACION", `El certificado no corresponde al RUC ${opciones.ruc} de la empresa (identificadores del certificado: ${info.identificadores.join(", ")})`);
    }
    if (opciones.confirmarTitular !== true) {
      throw new AppError(
        "VALIDACION",
        `No se pudo comprobar que el certificado corresponda al RUC ${opciones.ruc} (identificadores del certificado: ninguno). ` +
          "Si el titular es correcto, confírmelo explícitamente al cargarlo"
      );
    }
  }
  const advertencias: string[] = [];
  const dias = Math.floor((info.vigenteHasta.getTime() - ahora.getTime()) / 86_400_000);
  if (dias <= DIAS_AVISO_VENCIMIENTO) advertencias.push(`El certificado vence en ${dias} día(s): renuévelo antes del ${formato(info.vigenteHasta)}`);
  return advertencias;
}
