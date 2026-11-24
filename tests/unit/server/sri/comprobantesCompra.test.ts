// ============================================================
// tests/unit/server/sri/comprobantesCompra.test.ts
// Retención (07), liquidación de compra (03) y guía de remisión (06): XML válido contra los XSD oficiales y reglas propias.
// ============================================================
import { describe, expect, it } from "vitest";
import {
  construirGuiaRemisionXml,
  construirLiquidacionXml,
  construirRetencionXml,
} from "../../../../src/server/services/sri/comprobantesCompra.builder";
import { XsdValidatorService } from "../../../../src/server/services/sri/xsdValidator.service";
import { guia, liquidacion, retencion } from "../../../helpers/documentosSri.fixture";

const xsd = new XsdValidatorService();

describe("Comprobante de retención 2.0.0", () => {
  it("cumple el XSD oficial y lleva los datos del sustento y de cada retención", async () => {
    const xml = construirRetencionXml(retencion());
    expect((await xsd.validar("retencion", xml)).errores).toEqual([]);
    expect(xml).toContain('<comprobanteRetencion id="comprobante" version="2.0.0">');
    expect(xml).toContain("<codDoc>07</codDoc>");
    expect(xml).toContain("<periodoFiscal>05/2024</periodoFiscal>");
    expect(xml).toContain("<razonSocialSujetoRetenido>PROVEEDOR &amp; HIJOS S.A.</razonSocialSujetoRetenido>");
    expect(xml).toContain("<codigo>1</codigo><codigoRetencion>312</codigoRetencion><baseImponible>100.00</baseImponible><porcentajeRetener>1.75</porcentajeRetener><valorRetenido>1.75</valorRetenido>");
    expect(xml).toContain("<codigo>2</codigo><codigoRetencion>10</codigoRetencion><baseImponible>15.00</baseImponible><porcentajeRetener>20.00</porcentajeRetener><valorRetenido>3.00</valorRetenido>");
    expect(xml).toContain("<numDocSustento>001002000000123</numDocSustento>");
  });

  it("rechaza datos inconsistentes: sin retenciones, valor que no corresponde, periodo o sustento mal formados", () => {
    expect(() => construirRetencionXml(retencion({ retenciones: [] }))).toThrow(/al menos una retención/);
    expect(() => construirRetencionXml(retencion({ retenciones: [{ codigo: "1", codigoRetencion: "312", baseImponible: 100, porcentaje: 1.75, valor: 5 }] }))).toThrow(/no corresponde/);
    expect(() => construirRetencionXml(retencion({ periodoFiscal: "2024-05" }))).toThrow(/Periodo fiscal/);
    expect(() => construirRetencionXml(retencion({ docSustento: { ...retencion().docSustento, numDocSustento: "001-002-123" } }))).toThrow(/15 dígitos/);
  });
});

describe("Liquidación de compra 1.1.0", () => {
  it("cumple el XSD oficial", async () => {
    const xml = construirLiquidacionXml(liquidacion());
    expect((await xsd.validar("liquidacionCompra", xml)).errores).toEqual([]);
    expect(xml).toContain('<liquidacionCompra id="comprobante" version="1.1.0">');
    expect(xml).toContain("<codDoc>03</codDoc>");
    expect(xml).toContain("<identificacionProveedor>1710034065</identificacionProveedor>");
    expect(xml).toContain("<importeTotal>125.00</importeTotal>");
  });

  it("los pagos deben cubrir el importe total", () => {
    const d = liquidacion();
    d.pagos = [{ formaPago: "01", total: 100 }];
    expect(() => construirLiquidacionXml(d)).toThrow(/no cubren el importe total/);
    d.pagos = [];
    expect(() => construirLiquidacionXml(d)).toThrow(/forma de pago/);
  });
});

describe("Guía de remisión 1.1.0", () => {
  it("cumple el XSD oficial, con y sin documento de sustento", async () => {
    const xml = construirGuiaRemisionXml(guia());
    expect((await xsd.validar("guiaRemision", xml)).errores).toEqual([]);
    expect(xml).toContain('<guiaRemision id="comprobante" version="1.1.0">');
    expect(xml).toContain("<placa>PBA-1234</placa>");
    expect(xml).toContain("<fechaIniTransporte>10/05/2024</fechaIniTransporte><fechaFinTransporte>11/05/2024</fechaFinTransporte>");
    const sin = guia();
    const dest = sin.destinatarios[0];
    if (dest !== undefined) delete dest.sustento;
    expect((await xsd.validar("guiaRemision", construirGuiaRemisionXml(sin))).errores).toEqual([]);
  });

  it("rechaza fechas invertidas y destinatarios sin productos", () => {
    const g = guia();
    g.fechaFinTransporte = new Date("2024-05-09T15:00:00Z");
    expect(() => construirGuiaRemisionXml(g)).toThrow(/anterior a la de inicio/);
    const h = guia();
    (h.destinatarios[0] as { detalles: unknown[] }).detalles = [];
    expect(() => construirGuiaRemisionXml(h)).toThrow(/no tiene productos/);
    expect(() => construirGuiaRemisionXml({ ...guia(), destinatarios: [] })).toThrow(/al menos un destinatario/);
  });
});
