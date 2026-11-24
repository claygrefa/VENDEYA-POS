// ============================================================
// tests/helpers/certificados.helper.ts
// Genera certificados .p12 de PRUEBA en memoria (autofirmados, con la estructura que usan las entidades
// ecuatorianas). Nunca se escribe ni se versiona un certificado real.
// ============================================================
import { generateKeyPairSync } from "crypto";
import forge from "node-forge";

export interface OpcionesP12 {
  password?: string;
  cn?: string;
  /** RUC o cédula que se incluye en el certificado */
  identificacion?: string;
  /** Dónde va la identificación: en el sujeto (serialNumber) y/o en una extensión propia (como Security Data) */
  identificacionEn?: Array<"sujeto" | "extension">;
  bits?: 1024 | 2048 | 3072;
  /** Días de vigencia desde `desde` (negativo = ya vencido al terminar) */
  vigenciaDias?: number;
  desde?: Date;
  emisorCn?: string;
  /** Incluye un certificado intermedio de otra entidad en el archivo (cadena) */
  conCadena?: boolean;
  /** Algoritmo de cifrado del PKCS#12 */
  algoritmo?: "3des" | "aes256";
  serie?: string;
}

export interface P12Prueba {
  archivo: Buffer;
  password: string;
  certificadoPem: string;
  clavePrivadaPem: string;
}

const OID_RUC = "1.3.6.1.4.1.37746.3.1";

function claveForge(bits: number): { privada: forge.pki.rsa.PrivateKey; publica: forge.pki.rsa.PublicKey } {
  // La generación nativa de Node es instantánea; forge solo se usa para armar el certificado y el PKCS#12
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: bits,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return { privada: forge.pki.privateKeyFromPem(privateKey), publica: forge.pki.publicKeyFromPem(publicKey) };
}

function crearCertificado(opts: Required<Pick<OpcionesP12, "cn" | "emisorCn" | "serie">> & {
  publica: forge.pki.rsa.PublicKey;
  firmante: forge.pki.rsa.PrivateKey;
  desde: Date;
  hasta: Date;
  identificacion: string | undefined;
  en: Array<"sujeto" | "extension">;
}): forge.pki.Certificate {
  const cert = forge.pki.createCertificate();
  cert.publicKey = opts.publica;
  cert.serialNumber = opts.serie;
  cert.validity.notBefore = opts.desde;
  cert.validity.notAfter = opts.hasta;
  const sujeto: forge.pki.CertificateField[] = [
    { name: "countryName", value: "EC" },
    { name: "organizationName", value: "ENTIDAD DE PRUEBA" },
    { name: "commonName", value: opts.cn },
  ];
  if (opts.identificacion !== undefined && opts.en.includes("sujeto")) sujeto.push({ name: "serialNumber", value: opts.identificacion });
  cert.setSubject(sujeto);
  cert.setIssuer([
    { name: "countryName", value: "EC" },
    { name: "organizationName", value: "AUTORIDAD DE PRUEBA, S.A." },
    { name: "organizationalUnitName", value: "ENTIDAD DE CERTIFICACION" },
    { name: "localityName", value: "QUITO" },
    { name: "commonName", value: opts.emisorCn },
  ]);
  const extensiones: unknown[] = [{ name: "basicConstraints", cA: false }, { name: "keyUsage", digitalSignature: true, nonRepudiation: true }];
  if (opts.identificacion !== undefined && opts.en.includes("extension")) {
    const der = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.UTF8, false, forge.util.encodeUtf8(opts.identificacion));
    extensiones.push({ id: OID_RUC, critical: false, value: forge.asn1.toDer(der).getBytes() });
  }
  cert.setExtensions(extensiones);
  cert.sign(opts.firmante, forge.md.sha256.create());
  return cert;
}

export function generarP12Prueba(o: OpcionesP12 = {}): P12Prueba {
  const password = o.password ?? "Clave-De-Prueba-1";
  const desde = o.desde ?? new Date(Date.now() - 30 * 86_400_000);
  const hasta = new Date(desde.getTime() + (o.vigenciaDias ?? 730) * 86_400_000);
  const { privada, publica } = claveForge(o.bits ?? 2048);

  const cert = crearCertificado({
    cn: o.cn ?? "JUAN PEREZ PRUEBA",
    emisorCn: o.emisorCn ?? "AC DE PRUEBA",
    serie: o.serie ?? "0a1b2c3d4e",
    publica,
    firmante: privada,
    desde,
    hasta,
    identificacion: o.identificacion,
    en: o.identificacionEn ?? ["extension"],
  });
  const cadena: forge.pki.Certificate[] = [cert];
  if (o.conCadena === true) {
    const ca = claveForge(2048);
    cadena.push(crearCertificado({ cn: "AC INTERMEDIA", emisorCn: "AC RAIZ", serie: "01", publica: ca.publica, firmante: ca.privada, desde, hasta, identificacion: undefined, en: [] }));
  }

  const asn1 = forge.pkcs12.toPkcs12Asn1(privada, cadena, password, { algorithm: o.algoritmo ?? "3des", generateLocalKeyId: true, friendlyName: "firma" });
  return {
    archivo: Buffer.from(forge.asn1.toDer(asn1).getBytes(), "binary"),
    password,
    certificadoPem: forge.pki.certificateToPem(cert),
    clavePrivadaPem: forge.pki.privateKeyToPem(privada),
  };
}
