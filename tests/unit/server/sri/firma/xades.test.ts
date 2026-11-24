// ============================================================
// tests/unit/server/sri/firma/xades.test.ts
// Firma XAdES-BES (Ficha Técnica SRI, sección 6 y Anexo 14): estructura, verificación independiente con
// xml-crypto, sensibilidad a cualquier alteración y compatibilidad con el XSD oficial.
// ============================================================
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { AppError } from "../../../../../src/server/services/appError.util";
import { leerPkcs12, type MaterialFirma } from "../../../../../src/server/services/sri/firma/pkcs12.util";
import { NS_DS, NS_ETSI, firmarXmlXades, verificarFirmaXades } from "../../../../../src/server/services/sri/firma/xades.firma";
import { XsdValidatorService } from "../../../../../src/server/services/sri/xsdValidator.service";
import { generarP12Prueba } from "../../../../helpers/certificados.helper";
import { RUC_EMISOR, facturaEjemploXml, notaCreditoEjemploXml } from "../../../../helpers/sri.fixture";

let material: MaterialFirma;
let certificadoPem: string;
const xsd = new XsdValidatorService();

beforeAll(() => {
  const p12 = generarP12Prueba({ identificacion: RUC_EMISOR, password: "x-1" });
  material = leerPkcs12(p12.archivo, p12.password);
  certificadoPem = material.certificadoPem;
});

/** Verificación con una implementación distinta a la nuestra (flujo propio de xml-crypto). */
function verificaXmlCrypto(xml: string): boolean {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const nodo = doc.getElementsByTagNameNS(NS_DS, "Signature").item(0);
  if (nodo === null) return false;
  const sig = new SignedXml({ publicCert: certificadoPem });
  sig.loadSignature(nodo as unknown as Node);
  try {
    return sig.checkSignature(xml);
  } catch {
    return false;
  }
}

const alterar = (xml: string, de: string | RegExp, a: string | ((m: string) => string)): string => {
  const r = xml.replace(de, a as string);
  expect(r).not.toBe(xml); // la alteración debe haber cambiado algo
  return r;
};

describe("Estructura de la firma (Anexo 14 de la Ficha Técnica)", () => {
  it("la factura firmada contiene los elementos y algoritmos que exige el SRI", () => {
    const xml = firmarXmlXades(facturaEjemploXml(), material);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><factura id="comprobante" version="2.1.0">')).toBe(true);
    expect(xml).toContain(`<ds:Signature xmlns:ds="${NS_DS}" xmlns:etsi="${NS_ETSI}" Id="Signature`);
    expect(xml).toContain('<ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"');
    expect(xml).toContain('<ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"');
    expect(xml).toContain('Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"');
    expect(xml.match(/<ds:Reference /g)).toHaveLength(3);
    expect(xml).toContain('URI="#comprobante"');
    expect(xml).toContain('Type="http://uri.etsi.org/01903#SignedProperties"');
    expect(xml).toContain("<ds:X509Certificate>");
    expect(xml).toContain("<ds:RSAKeyValue><ds:Modulus>");
    expect(xml).toContain("<ds:Exponent>AQAB</ds:Exponent>");
    expect(xml).toContain("<etsi:SigningTime>");
    expect(xml).toContain("<etsi:SigningCertificate>");
    expect(xml).toContain("<etsi:MimeType>text/xml</etsi:MimeType>");
    expect(xml).toContain("<etsi:Description>contenido comprobante</etsi:Description>");
    // la firma es el último nodo del comprobante
    expect(xml.endsWith("</ds:Signature></factura>")).toBe(true);
  });

  it("SigningTime usa la hora de Ecuador (UTC−5) y el emisor sigue el formato RFC 2253 del ejemplo oficial", () => {
    const xml = firmarXmlXades(facturaEjemploXml(), material, { ahora: new Date("2024-03-06T00:30:05Z") });
    expect(xml).toContain("<etsi:SigningTime>2024-03-05T19:30:05-05:00</etsi:SigningTime>");
    // CN primero y C al final, como "CN=AC BANCO CENTRAL DEL ECUADOR,L=QUITO,OU=…,O=…,C=EC"
    expect(xml).toContain("<ds:X509IssuerName>CN=AC DE PRUEBA,L=QUITO,OU=ENTIDAD DE CERTIFICACION,O=AUTORIDAD DE PRUEBA\\, S.A.,C=EC</ds:X509IssuerName>");
    expect(xml).toContain(`<ds:X509SerialNumber>${BigInt("0x0a1b2c3d4e").toString()}</ds:X509SerialNumber>`);
  });

  it("los números de los Id son reproducibles con un generador fijo y distintos entre firmas", () => {
    let n = 100_000;
    const a = firmarXmlXades(facturaEjemploXml(), material, { generarNumero: () => n++, ahora: new Date("2024-05-10T15:00:00Z") });
    n = 100_000;
    const b = firmarXmlXades(facturaEjemploXml(), material, { generarNumero: () => n++, ahora: new Date("2024-05-10T15:00:00Z") });
    expect(a).toBe(b); // RSA PKCS#1 v1.5 es determinista
    expect(a).toContain('Id="Signature100000"');
    const c = firmarXmlXades(facturaEjemploXml(), material);
    expect(c).not.toBe(a);
  });

  it("firma la nota de crédito igual que la factura", async () => {
    const xml = firmarXmlXades(notaCreditoEjemploXml(), material);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><notaCredito id="comprobante" version="1.1.0">')).toBe(true);
    expect(verificarFirmaXades(xml)).toMatchObject({ valida: true, errores: [] });
    expect((await xsd.validar("notaCredito", xml)).errores).toEqual([]);
  });
});

describe("Verificación de la firma", () => {
  it("una firma recién hecha verifica con nuestro verificador Y con xml-crypto (implementación independiente)", () => {
    const xml = firmarXmlXades(facturaEjemploXml(), material);
    const r = verificarFirmaXades(xml);
    expect(r.errores).toEqual([]);
    expect(r.valida).toBe(true);
    expect(r.huellaCertificado).toBe(material.info.huella);
    expect(r.firmadoEn).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d-05:00$/);
    expect(verificaXmlCrypto(xml)).toBe(true);
  });

  it("el XML firmado sigue validando contra el XSD oficial del SRI (ds:Signature está permitido)", async () => {
    const xml = firmarXmlXades(facturaEjemploXml(), material);
    const r = await xsd.validar("factura", xml);
    expect(r.errores).toEqual([]);
    expect(r.valido).toBe(true);
  });

  it("el texto con acentos, & y < se conserva y la firma sigue siendo válida", () => {
    const xml = firmarXmlXades(facturaEjemploXml(), material);
    expect(xml).toContain("María José Pérez &amp; Hijos");
    expect(xml).toContain('Café "Premium" &amp; &lt;molido&gt; 250g');
    expect(verificarFirmaXades(xml).valida).toBe(true);
  });

  it("la verificación es independiente de cómo se serialice el XML (reformateo, orden de declaraciones)", () => {
    const xml = firmarXmlXades(facturaEjemploXml(), material);
    // el mismo documento con saltos de línea entre elementos de la firma (fuera de los valores) sigue verificando
    const reformateado = xml.replace("</ds:SignedInfo>", "</ds:SignedInfo>\n  ").replace("<ds:KeyInfo", "<ds:KeyInfo");
    expect(verificaXmlCrypto(reformateado)).toBe(true);
    expect(verificarFirmaXades(reformateado).valida).toBe(true);
  });

  it("firmar dos veces el mismo comprobante se rechaza", () => {
    const firmado = firmarXmlXades(facturaEjemploXml(), material);
    expect(() => firmarXmlXades(firmado, material)).toThrow(/ya está firmado/);
  });
});

describe("La firma detecta cualquier alteración", () => {
  const firmado = (): string => firmarXmlXades(facturaEjemploXml(), material);
  const rechazada = (xml: string): string[] => {
    const r = verificarFirmaXades(xml);
    expect(r.valida, "debía fallar la verificación").toBe(false);
    expect(verificaXmlCrypto(xml), "xml-crypto también debía rechazarla").toBe(false);
    return r.errores;
  };

  it("un byte del contenido del comprobante (importe, comprador, líneas)", () => {
    expect(rechazada(alterar(firmado(), "<importeTotal>24.20</importeTotal>", "<importeTotal>24.21</importeTotal>")).join()).toMatch(/#comprobante.*alterado/);
    expect(rechazada(alterar(firmado(), "<identificacionComprador>1710034065", "<identificacionComprador>1710034066")).join()).toMatch(/#comprobante/);
    expect(rechazada(alterar(firmado(), "<cantidad>2.000000</cantidad>", "<cantidad>3.000000</cantidad>")).join()).toMatch(/#comprobante/);
  });

  it("los nodos firmados de XAdES (SigningTime, certificado referenciado) y el KeyInfo", () => {
    expect(rechazada(alterar(firmado(), /<etsi:SigningTime>[^<]+/, "<etsi:SigningTime>2020-01-01T00:00:00-05:00")).join()).toMatch(/SignedProperties|alterado/);
    expect(rechazada(alterar(firmado(), /<ds:X509SerialNumber>\d+/, "<ds:X509SerialNumber>1")).join()).toMatch(/SignedProperties|alterado/);
    const otro = leerPkcs12(...(() => { const p = generarP12Prueba({ identificacion: RUC_EMISOR }); return [p.archivo, p.password] as const; })());
    const sustituido = alterar(firmado(), /<ds:X509Certificate>[^<]+/, `<ds:X509Certificate>${otro.certificadoDerBase64}`);
    expect(rechazada(sustituido).join()).toMatch(/KeyInfo|certificado|SignatureValue|SigningCertificate/i);
  });

  it("el valor de la firma y el SignedInfo", () => {
    expect(rechazada(alterar(firmado(), /<ds:SignatureValue Id="[^"]+">./, (m) => m.slice(0, -1) + (m.endsWith("A") ? "B" : "A"))).join()).toMatch(/SignatureValue/);
    expect(rechazada(alterar(firmado(), 'Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"', 'Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"')).join()).toMatch(/SHA-1|alterado|resumen/);
  });

  it("eliminar la firma o duplicarla", () => {
    const xml = firmado();
    expect(verificarFirmaXades(xml.replace(/<ds:Signature[\s\S]*<\/ds:Signature>/, "")).errores).toEqual(["El comprobante no tiene firma"]);
    const bloque = /<ds:Signature[\s\S]*<\/ds:Signature>/.exec(xml)?.[0] as string;
    expect(verificarFirmaXades(xml.replace("</factura>", `${bloque}</factura>`)).errores).toEqual(["El comprobante tiene más de una firma"]);
  });

  it("signature wrapping: mover el comprobante firmado dentro de otro documento y firmar contenido distinto", () => {
    const xml = firmado();
    const raizOriginal = /<factura id="comprobante"[\s\S]*<\/factura>/.exec(xml)?.[0] as string;
    // El atacante renombra el comprobante legítimo (para que ya no sea el elemento "#comprobante") y agrega uno falso
    const falso = raizOriginal.replace(/<ds:Signature[\s\S]*<\/ds:Signature>/, "").replace("<importeTotal>24.20</importeTotal>", "<importeTotal>0.01</importeTotal>");
    const envuelto = `<?xml version="1.0" encoding="UTF-8"?><sobre>${falso.replace("</factura>", "")}${raizOriginal.replace('id="comprobante"', 'id="original"')}</factura></sobre>`;
    expect(verificarFirmaXades(envuelto).valida).toBe(false);
  });

  it("dos elementos con el mismo Id (ambigüedad de referencia)", () => {
    const xml = firmado();
    const duplicado = xml.replace("<infoAdicional>", '<infoAdicional id="comprobante">');
    const errores = verificarFirmaXades(duplicado).errores.join();
    expect(errores).toMatch(/apunta a 2 elementos/);
  });

  it("XML mal formado", () => {
    expect(verificarFirmaXades("<factura><ds:Signature").valida).toBe(false);
    expect(() => firmarXmlXades("<factura id='comprobante'><a></factura>", material)).toThrow(AppError);
  });

  it("firmar exige que la raíz sea id=\"comprobante\"", () => {
    expect(() => firmarXmlXades("<factura><a>1</a></factura>", material)).toThrow(/id="comprobante"/);
  });
});

describe("Lectura de certificados .p12", () => {
  it("extrae titular, emisor, serie, huella, vigencia y clave de 2048 bits", () => {
    const p12 = generarP12Prueba({ cn: "MARÍA PÉREZ", identificacion: "1790012345001", vigenciaDias: 400 });
    const m = leerPkcs12(p12.archivo, p12.password);
    expect(m.info).toMatchObject({ titular: "MARÍA PÉREZ", bitsClave: 2048, serie: BigInt("0x0a1b2c3d4e").toString() });
    expect(m.info.emisor).toBe("CN=AC DE PRUEBA,L=QUITO,OU=ENTIDAD DE CERTIFICACION,O=AUTORIDAD DE PRUEBA\\, S.A.,C=EC");
    expect(m.info.huella).toMatch(/^[0-9a-f]{40}$/);
    expect(m.info.identificadores).toEqual(["1790012345001"]);
    expect(m.info.vigenteHasta.getTime()).toBeGreaterThan(m.info.vigenteDesde.getTime());
    expect(m.certificadoDerBase64).toMatch(/^MII/);
    expect(m.exponente).toBe("AQAB");
  });

  it("elige el certificado de la persona aunque el archivo traiga la cadena completa", () => {
    const p12 = generarP12Prueba({ conCadena: true, identificacion: RUC_EMISOR, cn: "TITULAR REAL" });
    expect(leerPkcs12(p12.archivo, p12.password).info.titular).toBe("TITULAR REAL");
  });

  it("acepta el cifrado clásico 3DES y el moderno AES-256", () => {
    for (const algoritmo of ["3des", "aes256"] as const) {
      const p12 = generarP12Prueba({ algoritmo, identificacion: RUC_EMISOR });
      const xml = firmarXmlXades(facturaEjemploXml(), leerPkcs12(p12.archivo, p12.password));
      expect(verificarFirmaXades(xml).valida, algoritmo).toBe(true);
    }
  });

  it("contraseña incorrecta y archivo dañado dan el mismo error genérico", () => {
    const p12 = generarP12Prueba();
    const mensajes = [leerPkcs12Falla(p12.archivo, "otra-clave"), leerPkcs12Falla(Buffer.from("esto no es un p12"), p12.password), leerPkcs12Falla(p12.archivo.subarray(0, 100), p12.password)];
    for (const m of mensajes) expect(m).toMatch(/contraseña es incorrecta o el archivo .p12 está dañado/);
    expect(new Set(mensajes).size).toBe(1);
  });

  it("detecta las identificaciones tanto en el sujeto como en extensiones", () => {
    const enSujeto = generarP12Prueba({ identificacion: "1710034065", identificacionEn: ["sujeto"] });
    expect(leerPkcs12(enSujeto.archivo, enSujeto.password).info.identificadores).toContain("1710034065");
    const sinNada = generarP12Prueba({});
    expect(leerPkcs12(sinNada.archivo, sinNada.password).info.identificadores).toEqual([]);
  });
});

function leerPkcs12Falla(archivo: Buffer, password: string): string {
  try {
    leerPkcs12(archivo, password);
  } catch (e) {
    return (e as Error).message;
  }
  return "NO FALLÓ";
}
