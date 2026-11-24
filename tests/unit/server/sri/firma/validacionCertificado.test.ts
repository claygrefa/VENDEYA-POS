// ============================================================
// tests/unit/server/sri/firma/validacionCertificado.test.ts — reglas para usar un .p12 como firma del emisor
// ============================================================
import { describe, expect, it } from "vitest";
import { leerPkcs12, validarCertificadoParaEmisor, type InfoCertificado } from "../../../../../src/server/services/sri/firma/pkcs12.util";
import { generarP12Prueba, type OpcionesP12 } from "../../../../helpers/certificados.helper";

const RUC = "1790012345001";
const info = (o: OpcionesP12): InfoCertificado => {
  const p = generarP12Prueba(o);
  return leerPkcs12(p.archivo, p.password).info;
};

describe("validarCertificadoParaEmisor", () => {
  it("acepta un certificado vigente del mismo RUC y no advierte", () => {
    expect(validarCertificadoParaEmisor(info({ identificacion: RUC }), { ruc: RUC })).toEqual([]);
  });

  it("acepta la cédula del titular cuando el RUC es de persona natural (cédula + 001)", () => {
    expect(validarCertificadoParaEmisor(info({ identificacion: "1710034065", identificacionEn: ["sujeto"] }), { ruc: "1710034065001" })).toEqual([]);
  });

  it("rechaza un certificado de otro RUC e indica qué identificadores trae", () => {
    expect(() => validarCertificadoParaEmisor(info({ identificacion: "0992345678001" }), { ruc: RUC })).toThrow(/no corresponde al RUC 1790012345001.*0992345678001/);
  });

  it("rechaza un certificado sin ningún identificador salvo confirmación explícita del titular", () => {
    const i = info({});
    expect(() => validarCertificadoParaEmisor(i, { ruc: RUC })).toThrow(/ninguno/);
    expect(validarCertificadoParaEmisor(i, { ruc: RUC, confirmarTitular: true })).toEqual([]);
  });

  it("un certificado que declara OTRO RUC no se acepta jamás, ni con confirmarTitular", () => {
    const ajeno = info({ identificacion: "0992345678001" });
    expect(() => validarCertificadoParaEmisor(ajeno, { ruc: RUC, confirmarTitular: true })).toThrow(/no corresponde al RUC/);
  });

  it("rechaza certificados vencidos y aún no vigentes, incluso con confirmarTitular", () => {
    const vencido = info({ identificacion: RUC, desde: new Date(Date.now() - 400 * 86_400_000), vigenciaDias: 100 });
    expect(() => validarCertificadoParaEmisor(vencido, { ruc: RUC, confirmarTitular: true })).toThrow(/vencido desde el \d{4}-\d\d-\d\d/);
    const futuro = info({ identificacion: RUC, desde: new Date(Date.now() + 10 * 86_400_000) });
    expect(() => validarCertificadoParaEmisor(futuro, { ruc: RUC })).toThrow(/aún no es válido/);
  });

  it("rechaza claves de menos de 2048 bits (Ficha Técnica 6.8)", () => {
    expect(() => validarCertificadoParaEmisor(info({ identificacion: RUC, bits: 1024 }), { ruc: RUC })).toThrow(/1024 bits.*2048/);
  });

  it("advierte cuando faltan 30 días o menos", () => {
    const porVencer = info({ identificacion: RUC, desde: new Date(Date.now() - 10 * 86_400_000), vigenciaDias: 25 });
    const avisos = validarCertificadoParaEmisor(porVencer, { ruc: RUC });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatch(/vence en 1[45] día/);
  });

  it("la fecha de referencia es inyectable", () => {
    const i = info({ identificacion: RUC, vigenciaDias: 730 });
    const futuro = new Date(i.vigenteHasta.getTime() + 86_400_000);
    expect(() => validarCertificadoParaEmisor(i, { ruc: RUC, ahora: futuro })).toThrow(/vencido/);
  });
});
