// ============================================================
// tests/unit/server/sri/comprobantesCompra.test.ts
// Retención (07), liquidación de compra (03) y guía de remisión (06): XML válido contra los XSD oficiales y reglas propias.
// ============================================================
import { describe, expect, it } from "vitest";
import { generarClaveAcceso } from "../../../../src/server/services/sri/claveAcceso.util";
import {
  construirGuiaRemisionXml,
  construirLiquidacionXml,
  construirRetencionXml,
  type DatosGuiaRemision,
  type DatosLiquidacion,
  type DatosRetencion,
} from "../../../../src/server/services/sri/comprobantesCompra.builder";
import { XsdValidatorService } from "../../../../src/server/services/sri/xsdValidator.service";
import { RUC_EMISOR, emisorEjemplo } from "../../../helpers/sri.fixture";

const xsd = new XsdValidatorService();
const fecha = new Date("2024-05-10T15:00:00Z");
const clave = (tipo: string): string => generarClaveAcceso({ fechaEmision: fecha, tipoComprobante: tipo, ruc: RUC_EMISOR, ambiente: "1", establecimiento: "001", puntoEmision: "001", secuencial: 1, codigoNumerico: "12345678" });

const retencion = (cambios: Partial<DatosRetencion> = {}): DatosRetencion => ({
  emisor: emisorEjemplo,
  claveAcceso: clave("07"),
  secuencial: "000000001",
  fechaEmision: fecha,
  sujeto: { tipoIdentificacion: "04", identificacion: "0992345678001", razonSocial: "PROVEEDOR & HIJOS S.A.", tipoSujeto: "02", parteRelacionada: false },
  periodoFiscal: "05/2024",
  docSustento: {
    codSustento: "01",
    codDocSustento: "01",
    numDocSustento: "001002000000123",
    fechaEmision: new Date("2024-05-08T15:00:00Z"),
    fechaRegistroContable: new Date("2024-05-08T15:00:00Z"),
    numAutorizacion: "0805202401099234567800110010020000001231234567811",
    totalSinImpuestos: 100,
    importeTotal: 115,
    impuestos: [{ codigoPorcentaje: "4", baseImponible: 100, tarifa: 15, valor: 15 }],
    pagos: [{ formaPago: "20", total: 115 }],
  },
  retenciones: [
    { codigo: "1", codigoRetencion: "312", baseImponible: 100, porcentaje: 1.75, valor: 1.75 },
    { codigo: "2", codigoRetencion: "10", baseImponible: 15, porcentaje: 20, valor: 3 },
  ],
  infoAdicional: [{ nombre: "Email", valor: "compras@andina.ec" }],
  ...cambios,
});

const liquidacion = (): DatosLiquidacion => ({
  emisor: emisorEjemplo,
  claveAcceso: clave("03"),
  secuencial: "000000001",
  fechaEmision: fecha,
  proveedor: { tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "María Pérez", direccion: "Vía a Machachi km 4" },
  lineas: [{ codigoPrincipal: "PAPA", descripcion: "Papa chola quintal", unidadMedida: "Quintal", cantidad: 10, precioUnitario: 12.5, descuento: 0, precioTotalSinImpuesto: 125, impuesto: { codigoPorcentaje: "0", tarifa: 0, baseImponible: 125, valor: 0 } }],
  pagos: [{ formaPago: "01", total: 125 }],
  infoAdicional: [],
});

const guia = (): DatosGuiaRemision => ({
  emisor: emisorEjemplo,
  claveAcceso: clave("06"),
  secuencial: "000000001",
  dirPartida: "Av. Amazonas N34-12, Quito",
  transportista: { tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "Transportes Pérez" },
  fechaInicioTransporte: new Date("2024-05-10T15:00:00Z"),
  fechaFinTransporte: new Date("2024-05-11T15:00:00Z"),
  placa: "PBA-1234",
  destinatarios: [
    {
      identificacion: "0992345678001",
      razonSocial: "Cliente Guayaquil S.A.",
      direccion: "Av. 9 de Octubre 100, Guayaquil",
      motivoTraslado: "Venta",
      codEstabDestino: "001",
      ruta: "Quito - Guayaquil",
      sustento: { codDoc: "01", numero: "001-001-000000123", numAutorizacion: "0805202401099234567800110010010000001231234567811", fechaEmision: new Date("2024-05-08T15:00:00Z") },
      detalles: [{ codigoInterno: "P001", descripcion: "Café molido 250g", cantidad: 20 }],
    },
  ],
  infoAdicional: [],
});

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
