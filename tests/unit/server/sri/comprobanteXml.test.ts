// ============================================================
// tests/unit/server/sri/comprobanteXml.test.ts
// Constructores de XML (Factura 2.1.0 y Nota de Crédito 1.1.0) validados contra los XSD OFICIALES del SRI.
// ============================================================
import { beforeAll, describe, expect, it } from "vitest";
import { AppError } from "../../../../src/server/services/appError.util";
import { generarClaveAcceso } from "../../../../src/server/services/sri/claveAcceso.util";
import type { DatosFactura, DatosNotaCredito, LineaComprobante } from "../../../../src/server/services/sri/comprobante.types";
import {
  agruparImpuestos,
  calcularTotalesComprobante,
  construirFacturaXml,
  construirNotaCreditoXml,
} from "../../../../src/server/services/sri/comprobanteXml.builder";
import { limpiarTexto } from "../../../../src/server/services/sri/xmlTexto.util";
import { XsdValidatorService } from "../../../../src/server/services/sri/xsdValidator.service";

let xsd: XsdValidatorService;
beforeAll(() => {
  xsd = new XsdValidatorService();
});

const emisor = {
  ambiente: "1" as const,
  razonSocial: "COMERCIAL ANDINA S.A.",
  nombreComercial: "ANDINA",
  ruc: "1790012345001",
  dirMatriz: "Av. Amazonas N34-12 y Atahualpa, Quito",
  contribuyenteRimpe: false,
  obligadoContabilidad: true,
  estab: "001",
  ptoEmi: "001",
  dirEstablecimiento: "Av. Amazonas N34-12, Quito",
};

const linea = (o: Partial<LineaComprobante> & { codigo?: string } = {}): LineaComprobante => ({
  codigoPrincipal: "P001",
  descripcion: "Arroz 1kg",
  unidadMedida: "Unidad",
  cantidad: 2,
  precioUnitario: 10,
  descuento: 0,
  precioTotalSinImpuesto: 20,
  impuesto: { codigoPorcentaje: o.codigo ?? "4", tarifa: o.codigo === "0" || o.codigo === "6" || o.codigo === "7" ? 0 : 15, baseImponible: 20, valor: o.codigo === "0" || o.codigo === "6" || o.codigo === "7" ? 0 : 3 },
  ...o,
});

function factura(cambios: Partial<DatosFactura> = {}): DatosFactura {
  const fechaEmision = new Date("2024-05-10T15:00:00Z");
  const claveAcceso = generarClaveAcceso({ fechaEmision, tipoComprobante: "01", ruc: emisor.ruc, ambiente: "1", establecimiento: "001", puntoEmision: "001", secuencial: 1, codigoNumerico: "12345678" });
  return {
    emisor,
    claveAcceso,
    secuencial: "000000001",
    fechaEmision,
    comprador: { tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "Juan Pérez", direccion: "Calle 1 y Calle 2" },
    lineas: [linea()],
    propina: 0,
    pagos: [{ formaPago: "01", total: 23 }],
    infoAdicional: [{ nombre: "Email", valor: "juan@correo.ec" }],
    ...cambios,
  };
}

function notaCredito(cambios: Partial<DatosNotaCredito> = {}): DatosNotaCredito {
  const fechaEmision = new Date("2024-05-12T15:00:00Z");
  const claveAcceso = generarClaveAcceso({ fechaEmision, tipoComprobante: "04", ruc: emisor.ruc, ambiente: "1", establecimiento: "001", puntoEmision: "001", secuencial: 1, codigoNumerico: "87654321" });
  return {
    emisor,
    claveAcceso,
    secuencial: "000000001",
    fechaEmision,
    comprador: { tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "Juan Pérez" },
    docModificado: { codDoc: "01", numero: "001-001-000000001", fechaEmision: new Date("2024-05-10T15:00:00Z") },
    motivo: "Anulación de la venta",
    lineas: [linea()],
    infoAdicional: [],
    ...cambios,
  };
}

const exigirValido = async (tipo: "factura" | "notaCredito", xml: string): Promise<void> => {
  const r = await xsd.validar(tipo, xml);
  expect(r.errores.map((e) => e.mensaje)).toEqual([]);
  expect(r.valido).toBe(true);
};

describe("Factura 2.1.0", () => {
  it("una factura típica valida contra el XSD oficial y trae los datos esperados", async () => {
    const xml = construirFacturaXml(factura());
    await exigirValido("factura", xml);
    expect(xml).toContain('<factura id="comprobante" version="2.1.0">');
    expect(xml).toContain("<ambiente>1</ambiente><tipoEmision>1</tipoEmision>");
    expect(xml).toContain("<codDoc>01</codDoc><estab>001</estab><ptoEmi>001</ptoEmi><secuencial>000000001</secuencial>");
    expect(xml).toContain("<fechaEmision>10/05/2024</fechaEmision>");
    expect(xml).toContain("<totalSinImpuestos>20.00</totalSinImpuestos>");
    expect(xml).toContain("<importeTotal>23.00</importeTotal>");
    expect(xml).toContain("<moneda>DOLAR</moneda>");
    expect(xml).toContain("<cantidad>2.000000</cantidad><precioUnitario>10.000000</precioUnitario>");
    expect(xml).toContain('<campoAdicional nombre="Email">juan@correo.ec</campoAdicional>');
    expect(xml).not.toContain("contribuyenteRimpe");
  });

  it("totalConImpuestos agrupa por código de tarifa: 15 %, 5 %, 0 %, no objeto y exento", async () => {
    const lineas = [
      linea({ codigoPrincipal: "A", precioTotalSinImpuesto: 20, impuesto: { codigoPorcentaje: "4", tarifa: 15, baseImponible: 20, valor: 3 } }),
      linea({ codigoPrincipal: "B", precioTotalSinImpuesto: 10, impuesto: { codigoPorcentaje: "4", tarifa: 15, baseImponible: 10, valor: 1.5 } }),
      linea({ codigoPrincipal: "C", precioTotalSinImpuesto: 8, impuesto: { codigoPorcentaje: "5", tarifa: 5, baseImponible: 8, valor: 0.4 } }),
      linea({ codigoPrincipal: "D", precioTotalSinImpuesto: 5, impuesto: { codigoPorcentaje: "0", tarifa: 0, baseImponible: 5, valor: 0 } }),
      linea({ codigoPrincipal: "E", precioTotalSinImpuesto: 4, impuesto: { codigoPorcentaje: "6", tarifa: 0, baseImponible: 4, valor: 0 } }),
      linea({ codigoPrincipal: "F", precioTotalSinImpuesto: 3, impuesto: { codigoPorcentaje: "7", tarifa: 0, baseImponible: 3, valor: 0 } }),
    ];
    const xml = construirFacturaXml(factura({ lineas, pagos: [{ formaPago: "01", total: 54.9 }] }));
    await exigirValido("factura", xml);
    const totales = /<totalConImpuestos>(.*?)<\/totalConImpuestos>/.exec(xml)?.[1] ?? "";
    const grupos = [...totales.matchAll(/<codigoPorcentaje>(\d+)<\/codigoPorcentaje><baseImponible>([\d.]+)<\/baseImponible><tarifa>([\d.]+)<\/tarifa><valor>([\d.]+)<\/valor>/g)].map((m) => m.slice(1, 5).join("|"));
    expect(grupos).toEqual(["0|5.00|0.00|0.00", "4|30.00|15.00|4.50", "5|8.00|5.00|0.40", "6|4.00|0.00|0.00", "7|3.00|0.00|0.00"]);
    expect(xml).toContain("<totalSinImpuestos>50.00</totalSinImpuestos>");
    expect(xml).toContain("<importeTotal>54.90</importeTotal>");
  });

  it("descuentos, cantidades fraccionarias y precios con 6 decimales", async () => {
    const l = linea({ cantidad: 0.3333, precioUnitario: 10, descuento: 0.5, precioTotalSinImpuesto: 2.83, impuesto: { codigoPorcentaje: "4", tarifa: 15, baseImponible: 2.83, valor: 0.42 } });
    const xml = construirFacturaXml(factura({ lineas: [l], pagos: [{ formaPago: "01", total: 3.25 }] }));
    await exigirValido("factura", xml);
    expect(xml).toContain("<cantidad>0.333300</cantidad>");
    expect(xml).toContain("<descuento>0.50</descuento>");
    expect(xml).toContain("<totalDescuento>0.50</totalDescuento>");
  });

  it("propina: no lleva IVA y forma parte del importe total", async () => {
    const xml = construirFacturaXml(factura({ propina: 2, pagos: [{ formaPago: "01", total: 25 }] }));
    await exigirValido("factura", xml);
    expect(xml).toContain("<propina>2.00</propina><importeTotal>25.00</importeTotal>");
    expect(xml).toContain("<totalSinImpuestos>20.00</totalSinImpuestos>");
  });

  it("pagos: une los de la misma forma, y la venta a crédito lleva plazo y unidad de tiempo", async () => {
    const xml = construirFacturaXml(
      factura({
        pagos: [
          { formaPago: "19", total: 10 },
          { formaPago: "19", total: 3 },
          { formaPago: "01", total: 10, plazo: 30, unidadTiempo: "dias" },
        ],
      })
    );
    await exigirValido("factura", xml);
    const pagos = [...xml.matchAll(/<pago>(.*?)<\/pago>/g)].map((m) => m[1]);
    expect(pagos).toEqual([
      "<formaPago>19</formaPago><total>13.00</total>",
      "<formaPago>01</formaPago><total>10.00</total><plazo>30.00</plazo><unidadTiempo>dias</unidadTiempo>",
    ]);
  });

  it("emisor: RIMPE, contribuyente especial y agente de retención aparecen donde el XSD los espera", async () => {
    const xml = construirFacturaXml(
      factura({ emisor: { ...emisor, contribuyenteRimpe: true, contribuyenteEspecial: "5368", agenteRetencion: "1234", obligadoContabilidad: false } })
    );
    await exigirValido("factura", xml);
    expect(xml).toContain("<agenteRetencion>1234</agenteRetencion><contribuyenteRimpe>CONTRIBUYENTE RÉGIMEN RIMPE</contribuyenteRimpe>");
    expect(xml).toContain("<contribuyenteEspecial>5368</contribuyenteEspecial><obligadoContabilidad>NO</obligadoContabilidad>");
  });

  it("Consumidor Final (07) y los demás tipos de identificación del comprador", async () => {
    for (const [tipo, id] of [["07", "9999999999999"], ["04", "1790012345001"], ["06", "AB123456"], ["08", "X-998877"]] as const) {
      const xml = construirFacturaXml(factura({ comprador: { tipoIdentificacion: tipo, identificacion: id, razonSocial: tipo === "07" ? "CONSUMIDOR FINAL" : "Cliente" } }));
      await exigirValido("factura", xml);
      expect(xml).toContain(`<tipoIdentificacionComprador>${tipo}</tipoIdentificacionComprador>`);
    }
  });

  it("saneamiento de texto: saltos de línea, caracteres XML, exceso de longitud y vacíos", async () => {
    const l = linea({ descripcion: `Línea 1\nLínea 2\t& <b>"negrita"</b> ${"x".repeat(400)}`, codigoPrincipal: "CODIGO-MUY-LARGO-QUE-EXCEDE-25-CARACTERES" });
    const xml = construirFacturaXml(factura({ lineas: [l], comprador: { tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "  \n  " } }));
    await exigirValido("factura", xml);
    expect(xml).toContain("Línea 1 Línea 2 &amp; &lt;b&gt;");
    expect(xml).toContain("<razonSocialComprador>N/A</razonSocialComprador>");
    expect(/<codigoPrincipal>(.*?)<\/codigoPrincipal>/.exec(xml)?.[1]).toHaveLength(25);
    expect(/<descripcion>(.*?)<\/descripcion>/.exec(xml)?.[1]?.length).toBeLessThanOrEqual(400); // escapado puede alargar, pero ≤300 de texto
  });

  it("máximo 15 campos adicionales y se omiten los vacíos", async () => {
    const campos = Array.from({ length: 20 }, (_, i) => ({ nombre: `Campo${i}`, valor: `valor ${i}` }));
    const xml = construirFacturaXml(factura({ infoAdicional: [{ nombre: "Vacío", valor: "  " }, ...campos] }));
    await exigirValido("factura", xml);
    expect((xml.match(/<campoAdicional /g) ?? []).length).toBe(15);
    expect(xml).not.toContain("Vacío");
    expect(construirFacturaXml(factura({ infoAdicional: [] }))).not.toContain("infoAdicional");
  });

  it("rechaza datos inconsistentes antes de generar nada", () => {
    expect(() => construirFacturaXml(factura({ pagos: [{ formaPago: "01", total: 22 }] }))).toThrow(/no cubren/);
    expect(() => construirFacturaXml(factura({ pagos: [] }))).toThrow(AppError);
    expect(() => construirFacturaXml(factura({ lineas: [] }))).toThrow(/al menos una línea/);
    expect(() => construirFacturaXml(factura({ claveAcceso: "123" }))).toThrow(/49 dígitos/);
    expect(() => construirFacturaXml(factura({ secuencial: "1" }))).toThrow(/9 dígitos/);
  });

  it("el XSD oficial rechaza lo que el generador no debe producir (validación real, no de adorno)", async () => {
    const xml = construirFacturaXml(factura());
    const casos: Array<[string, string, RegExp]> = [
      ["ambiente inválido", xml.replace("<ambiente>1</ambiente>", "<ambiente>3</ambiente>"), /ambiente/],
      ["RUC que no termina en 001", xml.replace("<ruc>1790012345001</ruc>", "<ruc>1790012345002</ruc>"), /ruc/],
      ["3 decimales en un total", xml.replace("<totalSinImpuestos>20.00", "<totalSinImpuestos>20.001"), /totalSinImpuestos/],
      ["clave de acceso corta", xml.replace(/<claveAcceso>\d{49}/, "<claveAcceso>123"), /claveAcceso/],
      ["fecha con formato ISO", xml.replace("<fechaEmision>10/05/2024", "<fechaEmision>2024-05-10"), /fechaEmision/],
      ["forma de pago inexistente", xml.replace("<formaPago>01</formaPago>", "<formaPago>99</formaPago>"), /formaPago/],
    ];
    for (const [nombre, malo, patron] of casos) {
      const r = await xsd.validar("factura", malo);
      expect(r.valido, nombre).toBe(false);
      expect(r.errores.some((e) => patron.test(e.mensaje)), `${nombre}: ${JSON.stringify(r.errores)}`).toBe(true);
    }
    // un nodo fuera de orden también se rechaza
    const fueraDeOrden = xml.replace("<propina>0.00</propina><importeTotal>23.00</importeTotal>", "<importeTotal>23.00</importeTotal><propina>0.00</propina>");
    expect((await xsd.validar("factura", fueraDeOrden)).valido).toBe(false);
  });
});

describe("Nota de crédito 1.1.0", () => {
  it("una nota de crédito típica valida contra el XSD oficial", async () => {
    const xml = construirNotaCreditoXml(notaCredito());
    await exigirValido("notaCredito", xml);
    expect(xml).toContain('<notaCredito id="comprobante" version="1.1.0">');
    expect(xml).toContain("<codDoc>04</codDoc>");
    expect(xml).toContain("<codDocModificado>01</codDocModificado><numDocModificado>001-001-000000001</numDocModificado><fechaEmisionDocSustento>10/05/2024</fechaEmisionDocSustento>");
    expect(xml).toContain("<totalSinImpuestos>20.00</totalSinImpuestos><valorModificacion>23.00</valorModificacion>");
    expect(xml).toContain("<motivo>Anulación de la venta</motivo>");
    expect(xml).toContain("<codigoInterno>P001</codigoInterno>");
  });

  it("varias tarifas e información adicional", async () => {
    const lineas = [
      linea({ codigoPrincipal: "A", precioTotalSinImpuesto: 20, impuesto: { codigoPorcentaje: "4", tarifa: 15, baseImponible: 20, valor: 3 } }),
      linea({ codigoPrincipal: "B", precioTotalSinImpuesto: 5, impuesto: { codigoPorcentaje: "0", tarifa: 0, baseImponible: 5, valor: 0 } }),
    ];
    const xml = construirNotaCreditoXml(notaCredito({ lineas, infoAdicional: [{ nombre: "Factura", valor: "001-001-000000001" }] }));
    await exigirValido("notaCredito", xml);
    expect(xml).toContain("<valorModificacion>28.00</valorModificacion>");
  });

  it("no admite Consumidor Final ni un número de documento mal formado", () => {
    const cf = { tipoIdentificacion: "07" as const, identificacion: "9999999999999", razonSocial: "CONSUMIDOR FINAL" };
    expect(() => construirNotaCreditoXml(notaCredito({ comprador: cf }))).toThrow(/Consumidor Final/);
    expect(() => construirNotaCreditoXml(notaCredito({ docModificado: { codDoc: "01", numero: "1-1-1", fechaEmision: new Date() } }))).toThrow(/documento modificado/);
  });

  it("el XSD de la nota de crédito rechaza un tipo de documento modificado inválido", async () => {
    const malo = construirNotaCreditoXml(notaCredito()).replace("<codDocModificado>01</codDocModificado>", "<codDocModificado>1</codDocModificado>");
    const r = await xsd.validar("notaCredito", malo);
    expect(r.valido).toBe(false);
    expect(r.errores[0]?.elemento).toBe("codDocModificado");
  });
});

describe("Cálculos auxiliares", () => {
  it("agruparImpuestos suma bases y valores por código y los ordena numéricamente", () => {
    const g = agruparImpuestos([
      linea({ impuesto: { codigoPorcentaje: "10", tarifa: 13, baseImponible: 1, valor: 0.13 } }),
      linea({ impuesto: { codigoPorcentaje: "4", tarifa: 15, baseImponible: 2, valor: 0.3 } }),
      linea({ impuesto: { codigoPorcentaje: "4", tarifa: 15, baseImponible: 3, valor: 0.45 } }),
    ]);
    expect(g.map((x) => [x.codigoPorcentaje, x.baseImponible, x.valor])).toEqual([["4", 5, 0.75], ["10", 1, 0.13]]);
  });

  it("calcularTotalesComprobante", () => {
    const t = calcularTotalesComprobante([linea({ descuento: 1, precioTotalSinImpuesto: 19, impuesto: { codigoPorcentaje: "4", tarifa: 15, baseImponible: 19, valor: 2.85 } })]);
    expect(t).toMatchObject({ totalSinImpuestos: 19, totalDescuento: 1, totalImpuestos: 2.85 });
  });

  it("limpiarTexto: caracteres de control, espacios y respaldo", () => {
    expect(limpiarTexto("a\u0000b\u0007c", 10)).toBe("abc");
    expect(limpiarTexto("  uno   dos  ", 10)).toBe("uno dos");
    expect(limpiarTexto(null, 10)).toBe("N/A");
    expect(limpiarTexto("", 10, "-")).toBe("-");
    expect(limpiarTexto("abcdef", 3)).toBe("abc");
  });
});
