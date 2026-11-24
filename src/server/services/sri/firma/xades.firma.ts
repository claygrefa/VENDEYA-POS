// ============================================================
// src/server/services/sri/firma/xades.firma.ts — Firma XAdES-BES de comprobantes electrónicos
//
// Especificación (Ficha Técnica SRI v2.34, sección 6 y Anexo 14):
//   · XAdES-BES (esquema 1.3.2), firma ENVELOPED, UTF-8
//   · Canonicalización C14N 1.0 inclusiva · RSA-SHA1 (digest SHA-1) · clave RSA de 2048 bits
//   · La firma cubre: el comprobante (`#comprobante`), las `SignedProperties` y el `KeyInfo` con el certificado
//
// La canonicalización la hace el canonicalizador de xml-crypto; el armado de la estructura XAdES es propio
// (xml-crypto no puede firmar referencias a elementos que viven dentro de la propia firma).
// ============================================================
import { createHash, createSign, createVerify, randomInt, X509Certificate } from "crypto";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { C14nCanonicalization, findAncestorNs } from "xml-crypto";
import { AppError } from "../../appError.util";
import { fechaHoraIsoEcuador } from "../fechaEcuador.util";
import type { MaterialFirma } from "./pkcs12.util";

export const NS_DS = "http://www.w3.org/2000/09/xmldsig#";
export const NS_ETSI = "http://uri.etsi.org/01903/v1.3.2#";
const ALG_C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const ALG_RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
const ALG_SHA1 = "http://www.w3.org/2000/09/xmldsig#sha1";
const ALG_ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const TIPO_SIGNED_PROPERTIES = "http://uri.etsi.org/01903#SignedProperties";
const DECLARACION_XML = '<?xml version="1.0" encoding="UTF-8"?>';

export interface OpcionesFirma {
  /** Momento de la firma (por defecto, ahora); se escribe en `SigningTime` con la hora de Ecuador */
  ahora?: Date;
  /** Generador de los números de los Id (para pruebas reproducibles) */
  generarNumero?: () => number;
}

export interface ResultadoVerificacion {
  valida: boolean;
  errores: string[];
  /** SHA-1 (hex) del certificado con el que se firmó, si se pudo leer */
  huellaCertificado: string | null;
  /** Valor de `SigningTime` */
  firmadoEn: string | null;
}

// ── DOM y canonicalización ───────────────────────────────────

const analizador = new DOMParser({
  errorHandler: {
    // xmldom degrada a "warning" errores graves (p. ej. etiquetas sin cerrar): un comprobante se rechaza por cualquiera
    warning: (m) => {
      throw new Error(m);
    },
    error: (m) => {
      throw new Error(m);
    },
    fatalError: (m) => {
      throw new Error(m);
    },
  },
});

function parsear(xml: string): Document {
  try {
    return analizador.parseFromString(xml, "text/xml") as unknown as Document;
  } catch (e) {
    throw new AppError("VALIDACION", `El XML no está bien formado: ${(e as Error).message.slice(0, 160)}`);
  }
}

const sha1Base64 = (texto: string): string => createHash("sha1").update(texto, "utf8").digest("base64");

/** C14N inclusivo del elemento en su contexto (hereda los espacios de nombres de sus ancestros). */
function canonizar(doc: Document, el: Element): string {
  const id = el.getAttribute("Id") !== "" ? el.getAttribute("Id") : el.getAttribute("id");
  const atributo = el.getAttribute("Id") !== "" ? "Id" : "id";
  const ancestorNamespaces = el === doc.documentElement ? [] : findAncestorNs(doc, `//*[@${atributo}='${id}']`);
  return new C14nCanonicalization().process(el, { ancestorNamespaces });
}

function elementosHijos(el: Element, nombreLocal: string, ns: string): Element[] {
  const salida: Element[] = [];
  for (let n = el.firstChild; n !== null; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as Element).localName === nombreLocal && (n as Element).namespaceURI === ns) salida.push(n as Element);
  }
  return salida;
}

function todosLosElementos(doc: Document): Element[] {
  const lista = doc.getElementsByTagName("*");
  return Array.from({ length: lista.length }, (_, i) => lista.item(i) as Element);
}

/** Elementos cuyo atributo Id / id / ID vale `id` (debe haber exactamente uno: defensa contra duplicados). */
function porId(doc: Document, id: string): Element[] {
  return todosLosElementos(doc).filter((e) => ["Id", "id", "ID"].some((a) => e.getAttribute(a) === id));
}

function estaDentro(nodo: Node, ancestro: Node): boolean {
  for (let n: Node | null = nodo; n !== null; n = n.parentNode) if (n === ancestro) return true;
  return false;
}

const texto = (el: Element | undefined): string => (el?.textContent ?? "").trim();

// ── Firma ────────────────────────────────────────────────────

interface Ids {
  firma: string;
  signedInfo: string;
  refSignedProperties: string;
  signedProperties: string;
  certificado: string;
  refComprobante: string;
  valorFirma: string;
  objeto: string;
}

function generarIds(next: () => number): Ids {
  const n = (): number => next();
  const firma = `Signature${n()}`;
  return {
    firma,
    signedInfo: `Signature-SignedInfo${n()}`,
    refSignedProperties: `SignedPropertiesID${n()}`,
    signedProperties: `${firma}-SignedProperties${n()}`,
    certificado: `Certificate${n()}`,
    refComprobante: `Reference-ID-${n()}`,
    valorFirma: `SignatureValue${n()}`,
    objeto: `${firma}-Object${n()}`,
  };
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Estructura XAdES-BES del Anexo 14, con los valores calculados (digests y firma) aún vacíos. */
function plantillaFirma(i: Ids, m: MaterialFirma, firmadoEn: string): string {
  const metodoDigest = `<ds:DigestMethod Algorithm="${ALG_SHA1}"></ds:DigestMethod>`;
  return (
    `<ds:Signature xmlns:ds="${NS_DS}" xmlns:etsi="${NS_ETSI}" Id="${i.firma}">` +
    `<ds:SignedInfo Id="${i.signedInfo}">` +
    `<ds:CanonicalizationMethod Algorithm="${ALG_C14N}"></ds:CanonicalizationMethod>` +
    `<ds:SignatureMethod Algorithm="${ALG_RSA_SHA1}"></ds:SignatureMethod>` +
    `<ds:Reference Id="${i.refSignedProperties}" Type="${TIPO_SIGNED_PROPERTIES}" URI="#${i.signedProperties}">${metodoDigest}<ds:DigestValue></ds:DigestValue></ds:Reference>` +
    `<ds:Reference URI="#${i.certificado}">${metodoDigest}<ds:DigestValue></ds:DigestValue></ds:Reference>` +
    `<ds:Reference Id="${i.refComprobante}" URI="#comprobante"><ds:Transforms><ds:Transform Algorithm="${ALG_ENVELOPED}"></ds:Transform></ds:Transforms>${metodoDigest}<ds:DigestValue></ds:DigestValue></ds:Reference>` +
    `</ds:SignedInfo>` +
    `<ds:SignatureValue Id="${i.valorFirma}"></ds:SignatureValue>` +
    `<ds:KeyInfo Id="${i.certificado}"><ds:X509Data><ds:X509Certificate>${m.certificadoDerBase64}</ds:X509Certificate></ds:X509Data>` +
    `<ds:KeyValue><ds:RSAKeyValue><ds:Modulus>${m.modulo}</ds:Modulus><ds:Exponent>${m.exponente}</ds:Exponent></ds:RSAKeyValue></ds:KeyValue></ds:KeyInfo>` +
    `<ds:Object Id="${i.objeto}"><etsi:QualifyingProperties Target="#${i.firma}">` +
    `<etsi:SignedProperties Id="${i.signedProperties}"><etsi:SignedSignatureProperties>` +
    `<etsi:SigningTime>${firmadoEn}</etsi:SigningTime>` +
    `<etsi:SigningCertificate><etsi:Cert><etsi:CertDigest>${metodoDigest}<ds:DigestValue>${m.huellaSha1Base64}</ds:DigestValue></etsi:CertDigest>` +
    `<etsi:IssuerSerial><ds:X509IssuerName>${esc(m.emisorRfc2253)}</ds:X509IssuerName><ds:X509SerialNumber>${m.serieDecimal}</ds:X509SerialNumber></etsi:IssuerSerial></etsi:Cert></etsi:SigningCertificate>` +
    `</etsi:SignedSignatureProperties>` +
    `<etsi:SignedDataObjectProperties><etsi:DataObjectFormat ObjectReference="#${i.refComprobante}"><etsi:Description>contenido comprobante</etsi:Description><etsi:MimeType>text/xml</etsi:MimeType></etsi:DataObjectFormat></etsi:SignedDataObjectProperties>` +
    `</etsi:SignedProperties></etsi:QualifyingProperties></ds:Object>` +
    `</ds:Signature>`
  );
}

/** Firma el XML de un comprobante sin firmar y devuelve el XML con la firma XAdES-BES incorporada. */
export function firmarXmlXades(xml: string, material: MaterialFirma, opciones: OpcionesFirma = {}): string {
  const doc = parsear(xml);
  const raiz = doc.documentElement;
  if (raiz.getAttribute("id") !== "comprobante") {
    throw new AppError("VALIDACION", 'El elemento raíz del comprobante debe tener id="comprobante"');
  }
  if (elementosHijos(raiz, "Signature", NS_DS).length > 0) throw new AppError("ESTADO_INVALIDO", "El comprobante ya está firmado");

  const ids = generarIds(opciones.generarNumero ?? (() => randomInt(100_000, 1_000_000)));
  // Resumen del comprobante ANTES de insertar la firma (equivale a la transformación enveloped-signature)
  const digestComprobante = sha1Base64(canonizar(doc, raiz));

  const firma = parsear(plantillaFirma(ids, material, fechaHoraIsoEcuador(opciones.ahora ?? new Date()))).documentElement;
  raiz.appendChild(doc.importNode(firma, true));

  const signedProperties = porId(doc, ids.signedProperties)[0] as Element;
  const keyInfo = porId(doc, ids.certificado)[0] as Element;
  const signedInfo = porId(doc, ids.signedInfo)[0] as Element;
  const digests = elementosHijos(signedInfo, "Reference", NS_DS).map((r) => elementosHijos(r, "DigestValue", NS_DS)[0] as Element);
  const poner = (el: Element, valor: string): void => {
    el.appendChild(doc.createTextNode(valor));
  };
  poner(digests[0] as Element, sha1Base64(canonizar(doc, signedProperties)));
  poner(digests[1] as Element, sha1Base64(canonizar(doc, keyInfo)));
  poner(digests[2] as Element, digestComprobante);

  // Los digests ya están dentro de SignedInfo: ahora se canoniza y se firma
  const valor = createSign("RSA-SHA1").update(canonizar(doc, signedInfo), "utf8").sign(material.clavePrivadaPem, "base64");
  poner(porId(doc, ids.valorFirma)[0] as Element, valor);

  return DECLARACION_XML + new XMLSerializer().serializeToString(raiz as unknown as Node);
}

// ── Verificación ─────────────────────────────────────────────

/**
 * Verifica una firma XAdES-BES del SRI: los tres resúmenes, la firma RSA-SHA1 con el certificado incluido y la
 * coherencia del certificado con `SigningCertificate`. No valida la cadena de confianza ni la revocación.
 */
export function verificarFirmaXades(xmlFirmado: string): ResultadoVerificacion {
  const errores: string[] = [];
  const resultado = (huella: string | null = null, firmadoEn: string | null = null): ResultadoVerificacion => ({
    valida: errores.length === 0,
    errores,
    huellaCertificado: huella,
    firmadoEn,
  });

  let doc: Document;
  try {
    doc = parsear(xmlFirmado);
  } catch (e) {
    errores.push((e as Error).message);
    return resultado();
  }
  const raiz = doc.documentElement;
  const firmas = elementosHijos(raiz, "Signature", NS_DS);
  if (firmas.length !== 1) {
    errores.push(firmas.length === 0 ? "El comprobante no tiene firma" : "El comprobante tiene más de una firma");
    return resultado();
  }
  const firma = firmas[0] as Element;
  const signedInfo = elementosHijos(firma, "SignedInfo", NS_DS)[0];
  const valorFirma = elementosHijos(firma, "SignatureValue", NS_DS)[0];
  const keyInfo = elementosHijos(firma, "KeyInfo", NS_DS)[0];
  if (signedInfo === undefined || valorFirma === undefined || keyInfo === undefined) {
    errores.push("Estructura de firma incompleta (SignedInfo, SignatureValue o KeyInfo ausentes)");
    return resultado();
  }

  // Algoritmos exigidos por la ficha
  const alg = (el: Element | undefined): string => el?.getAttribute("Algorithm") ?? "";
  if (alg(elementosHijos(signedInfo, "CanonicalizationMethod", NS_DS)[0]) !== ALG_C14N) errores.push("Canonicalización distinta de C14N 1.0 inclusiva");
  if (alg(elementosHijos(signedInfo, "SignatureMethod", NS_DS)[0]) !== ALG_RSA_SHA1) errores.push("Algoritmo de firma distinto de RSA-SHA1");

  // Certificado
  let cert: X509Certificate | undefined;
  const base64Cert = texto(elementosHijos(elementosHijos(keyInfo, "X509Data", NS_DS)[0] ?? keyInfo, "X509Certificate", NS_DS)[0]);
  try {
    cert = new X509Certificate(Buffer.from(base64Cert, "base64"));
  } catch {
    errores.push("El certificado incluido en KeyInfo no es válido");
  }
  const huellaHex = cert === undefined ? null : createHash("sha1").update(cert.raw).digest("hex");

  // Referencias: cada resumen debe coincidir
  const referencias = elementosHijos(signedInfo, "Reference", NS_DS);
  const uris = referencias.map((r) => r.getAttribute("URI"));
  let signedPropertiesEl: Element | undefined;
  let cubreComprobante = false;
  let cubreKeyInfo = false;
  let cubreSignedProperties = false;

  for (const ref of referencias) {
    const uri = ref.getAttribute("URI") ?? "";
    const esperado = texto(elementosHijos(ref, "DigestValue", NS_DS)[0]);
    if (alg(elementosHijos(ref, "DigestMethod", NS_DS)[0]) !== ALG_SHA1) errores.push(`La referencia ${uri} no usa SHA-1`);
    if (!uri.startsWith("#")) {
      errores.push(`Referencia no admitida: "${uri}"`);
      continue;
    }
    const destinos = porId(doc, uri.slice(1));
    if (destinos.length !== 1) {
      errores.push(`La referencia ${uri} apunta a ${destinos.length} elementos (debe ser exactamente 1)`);
      continue;
    }
    const destino = destinos[0] as Element;
    let canonico: string;
    if (uri === "#comprobante") {
      // Defensa contra "signature wrapping": el elemento firmado debe ser la raíz del documento
      if (destino !== raiz) errores.push("La referencia #comprobante no apunta al elemento raíz del documento");
      const transforms = elementosHijos(elementosHijos(ref, "Transforms", NS_DS)[0] ?? ref, "Transform", NS_DS).map((t) => alg(t));
      if (!transforms.includes(ALG_ENVELOPED)) errores.push("Falta la transformación enveloped-signature");
      const copia = raiz.cloneNode(true) as Element;
      for (const f of elementosHijos(copia, "Signature", NS_DS)) copia.removeChild(f);
      canonico = new C14nCanonicalization().process(copia, { ancestorNamespaces: [] });
      cubreComprobante = true;
    } else {
      if (destino.parentNode === null || (destino !== keyInfo && !estaDentro(destino, firma))) errores.push(`La referencia ${uri} apunta fuera de la firma`);
      canonico = canonizar(doc, destino);
      if (destino === keyInfo) cubreKeyInfo = true;
      if (destino.localName === "SignedProperties") {
        cubreSignedProperties = true;
        signedPropertiesEl = destino;
      }
    }
    if (sha1Base64(canonico) !== esperado) errores.push(`El resumen de la referencia ${uri} no coincide: el contenido fue alterado`);
  }
  if (!cubreComprobante) errores.push("La firma no cubre el comprobante");
  if (!cubreKeyInfo) errores.push("La firma no cubre el certificado (KeyInfo)");
  if (!cubreSignedProperties) errores.push("La firma no cubre las SignedProperties de XAdES");
  if (referencias.length !== 3) errores.push(`Se esperaban 3 referencias y hay ${referencias.length} (${uris.join(", ")})`);

  // Firma RSA sobre SignedInfo canonicalizado
  if (cert !== undefined) {
    const ok = createVerify("RSA-SHA1").update(canonizar(doc, signedInfo), "utf8").verify(cert.publicKey, texto(valorFirma), "base64");
    if (!ok) errores.push("El valor de la firma (SignatureValue) no es válido para el certificado incluido");
  }

  // SigningCertificate debe corresponder al certificado de KeyInfo
  let firmadoEn: string | null = null;
  if (signedPropertiesEl !== undefined) {
    const lista = signedPropertiesEl.getElementsByTagNameNS(NS_ETSI, "SigningTime");
    firmadoEn = lista.length > 0 ? texto(lista.item(0) as Element) : null;
    const digestCert = signedPropertiesEl.getElementsByTagNameNS(NS_ETSI, "CertDigest").item(0);
    const valorDigest = digestCert === null ? "" : texto(elementosHijos(digestCert as Element, "DigestValue", NS_DS)[0]);
    if (cert !== undefined && valorDigest !== createHash("sha1").update(cert.raw).digest("base64")) {
      errores.push("SigningCertificate no corresponde al certificado de KeyInfo");
    }
  }
  return resultado(huellaHex, firmadoEn);
}
