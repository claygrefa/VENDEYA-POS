// ============================================================
// tests/unit/server/sri/ride.test.ts — RIDE: datos desde el XML de cada tipo, código de barras y PDF
// ============================================================
import { describe, expect, it } from "vitest";
import { construirGuiaRemisionXml, construirLiquidacionXml, construirRetencionXml } from "../../../../src/server/services/sri/comprobantesCompra.builder";
import { construirXmlAutorizado } from "../../../../src/server/services/sri/envioSri.service";
import { datosRideDesdeXml, fechaHoraAutorizacion, separarAutorizacion } from "../../../../src/server/services/sri/ride/ride.datos";
import { barrasCode128, generarRidePdf } from "../../../../src/server/services/sri/ride/ride.pdf";
import { guia, liquidacion, retencion } from "../../../helpers/documentosSri.fixture";
import { paginasDePdf, textoDePdf, textoPlanoDePdf } from "../../../helpers/pdf.helper";
import { facturaEjemploXml, notaCreditoEjemploXml } from "../../../helpers/sri.fixture";

const autorizar = (xml: string, clave: string): string =>
  construirXmlAutorizado({ estado: "AUTORIZADO", numeroAutorizacion: clave, fechaAutorizacion: new Date("2024-05-10T20:30:15Z"), ambiente: "PRUEBAS", comprobante: null, mensajes: [] }, xml);
const claveDe = (xml: string): string => /<claveAcceso>(\d{49})<\/claveAcceso>/.exec(xml)?.[1] as string;

describe("Datos del RIDE desde el XML", () => {
  it("factura: emisor, cliente, detalle, totales por tarifa y formas de pago", () => {
    const d = datosRideDesdeXml(facturaEjemploXml());
    expect(d).toMatchObject({ titulo: "FACTURA", autorizado: false, numero: "001-001-000000001", ambiente: "PRUEBAS", numeroAutorizacion: null });
    expect(d.emisor).toMatchObject({ razonSocial: "COMERCIAL ANDINA S.A.", nombreComercial: "ANDINA", ruc: "1790012345001", obligadoContabilidad: "SI" });
    expect(d.receptor).toMatchObject({ etiqueta: "Cliente", razonSocial: "María José Pérez & Hijos", identificacion: "1710034065" });
    expect(d.fechaEmision).toBe("10/05/2024");
    expect(d.tablas[0]?.filas).toHaveLength(2);
    expect(d.tablas[0]?.filas[0]).toEqual(["P001", 'Café "Premium" & <molido> 250g', "2", "10.00", "0.00", "20.00"]);
    const totales = Object.fromEntries(d.totales);
    expect(totales).toMatchObject({ "SUBTOTAL 15%": "20.00", "SUBTOTAL 0%": "1.20", "SUBTOTAL SIN IMPUESTOS": "21.20", "IVA 15%": "3.00", "VALOR TOTAL": "24.20" });
    expect(d.pagos).toEqual([["SIN UTILIZACIÓN DEL SISTEMA FINANCIERO", "24.20"]]);
    expect(d.infoAdicional).toEqual([["Email", "maria@correo.ec"]]);
  });

  it("el XML autorizado marca el RIDE como autorizado, con el número y la hora de Ecuador", () => {
    const xml = facturaEjemploXml();
    const clave = claveDe(xml);
    const d = datosRideDesdeXml(autorizar(xml, clave));
    expect(d).toMatchObject({ autorizado: true, numeroAutorizacion: clave, fechaAutorizacion: "10/05/2024 15:30:15", claveAcceso: clave });
    expect(separarAutorizacion(xml).autorizacion).toBeNull();
    expect(fechaHoraAutorizacion("2012-03-05T16:57:34.997-05:00")).toBe("05/03/2012 16:57:34");
  });

  it("nota de crédito: documento modificado, motivo y valor total", () => {
    const d = datosRideDesdeXml(notaCreditoEjemploXml());
    expect(d.titulo).toBe("NOTA DE CRÉDITO");
    expect(d.extras).toEqual(expect.arrayContaining([["Comprobante que se modifica", "FACTURA 001-001-000000001"], ["Razón de modificación", "Anulación de la venta"]]));
    expect(Object.fromEntries(d.totales)["VALOR TOTAL"]).toBe("24.20");
  });

  it("retención: sustento, impuesto, código, base, porcentaje y valor, con el total retenido", () => {
    const d = datosRideDesdeXml(construirRetencionXml(retencion()));
    expect(d.titulo).toBe("COMPROBANTE DE RETENCIÓN");
    expect(d.receptor).toMatchObject({ etiqueta: "Sujeto retenido", razonSocial: "PROVEEDOR & HIJOS S.A.", identificacion: "0992345678001" });
    expect(d.extras).toEqual([["Ejercicio fiscal", "05/2024"]]);
    expect(d.tablas[0]?.filas).toEqual([
      ["FACTURA 001-002-000000123", "08/05/2024", "RENTA", "312", "100.00", "1.75", "1.75"],
      ["FACTURA 001-002-000000123", "08/05/2024", "IVA", "10", "15.00", "20.00", "3.00"],
    ]);
    expect(d.totales).toEqual([["TOTAL RETENIDO", "4.75"]]);
  });

  it("liquidación de compra: el proveedor y el detalle", () => {
    const d = datosRideDesdeXml(construirLiquidacionXml(liquidacion()));
    expect(d.titulo).toContain("LIQUIDACIÓN DE COMPRA");
    expect(d.receptor).toMatchObject({ etiqueta: "Proveedor", razonSocial: "María Pérez", direccion: "Vía a Machachi km 4" });
    expect(d.tablas[0]?.filas[0]?.[1]).toBe("Papa chola quintal");
    expect(Object.fromEntries(d.totales)["VALOR TOTAL"]).toBe("125.00");
  });

  it("guía de remisión: transportista, ruta y los productos de cada destinatario", () => {
    const d = datosRideDesdeXml(construirGuiaRemisionXml(guia()));
    expect(d.titulo).toBe("GUÍA DE REMISIÓN");
    expect(d.receptor).toMatchObject({ etiqueta: "Transportista", razonSocial: "Transportes Pérez" });
    expect(d.extras).toEqual(expect.arrayContaining([["Placa", "PBA-1234"], ["Punto de partida", "Av. Amazonas N34-12, Quito"]]));
    expect(d.tablas[0]?.titulo).toContain("Cliente Guayaquil S.A.");
    expect(d.tablas[0]?.filas).toEqual([["P001", "Café molido 250g", "20"]]);
  });

  it("rechaza XML que no es un comprobante o de un tipo sin RIDE", () => {
    expect(() => datosRideDesdeXml("<a><b/></a>")).toThrow(/no es un comprobante electrónico/);
    expect(() => datosRideDesdeXml("<a><b")).toThrow(/bien formado/);
    expect(() => datosRideDesdeXml(facturaEjemploXml().replace("<codDoc>01</codDoc>", "<codDoc>05</codDoc>"))).toThrow(/No hay RIDE para el tipo de comprobante 05/);
  });
});

describe("Código de barras Code 128 de la clave de acceso", () => {
  it("las barras codifican los 49 dígitos con el ancho total correcto y terminan con el patrón de parada", () => {
    const clave = claveDe(facturaEjemploXml());
    const sbs = barrasCode128(clave);
    expect(sbs.length % 2).toBe(1); // barra, espacio, …, barra
    const modulos = sbs.reduce((a, b) => a + b, 0);
    // inicio (11) + 1 símbolo en B + cambio a C (11) + 24 pares + control (11) + parada (13)
    expect(modulos).toBe(11 * (1 + 1 + 1 + 24 + 1) + 13);
    expect(sbs.slice(-7)).toEqual([2, 3, 3, 1, 1, 1, 2]); // patrón de parada del Code 128
    expect(barrasCode128(clave)).toEqual(sbs); // determinista
    expect(barrasCode128(clave.replace(/\d$/, "0"))).not.toEqual(sbs);
  });
});

describe("PDF del RIDE", () => {
  it("es un PDF A4 con el texto del comprobante (sin comprimir para poder leerlo)", async () => {
    const xml = facturaEjemploXml();
    const clave = claveDe(xml);
    const pdf = await generarRidePdf(datosRideDesdeXml(autorizar(xml, clave)), { comprimir: false });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.subarray(-6).toString()).toContain("%%EOF");
    expect(pdf.toString("latin1")).toContain("/MediaBox [0 0 595.28 841.89]");
    const texto = textoDePdf(pdf);
    for (const esperado of ["FACTURA", "No. 001-001-000000001", "R.U.C.: 1790012345001", "COMERCIAL ANDINA S.A.", "AMBIENTE", "PRUEBAS", "NORMAL", clave, "María José Pérez & Hijos", "1710034065", "24.20", "VALOR TOTAL", "SUBTOTAL 15%", "IVA 15%", "SIN UTILIZACIÓN DEL SISTEMA FINANCIERO", "maria@correo.ec", "10/05/2024 15:30:15"]) {
      expect(texto, esperado).toContain(esperado);
    }
    expect(texto).not.toContain("SIN VALOR TRIBUTARIO");
    expect(texto).not.toContain("NO AUTORIZADO");
    expect(paginasDePdf(pdf)).toBe(1);
  });

  it("un comprobante sin autorización lleva la marca de agua y la leyenda de pie", async () => {
    const pdf = await generarRidePdf(datosRideDesdeXml(facturaEjemploXml()), { comprimir: false });
    const texto = textoPlanoDePdf(pdf);
    expect(texto).toContain("SIN VALOR TRIBUTARIO");
    expect(texto).toContain("NO AUTORIZADO POR EL SRI");
    expect(texto).toContain("Documento sin autorización del SRI");
  });

  it("los otros cuatro tipos también se generan y muestran sus datos propios", async () => {
    const casos: Array<[string, string, string[]]> = [
      ["nota de crédito", notaCreditoEjemploXml(), ["NOTA DE CRÉDITO", "Anulación de la venta", "Comprobante que se modifica"]],
      ["retención", construirRetencionXml(retencion()), ["COMPROBANTE DE RETENCIÓN", "TOTAL RETENIDO", "4.75", "RENTA", "05/2024"]],
      ["liquidación", construirLiquidacionXml(liquidacion()), ["LIQUIDACIÓN DE COMPRA", "Papa chola quintal", "125.00"]],
      ["guía", construirGuiaRemisionXml(guia()), ["GUÍA DE REMISIÓN", "PBA-1234", "Cliente Guayaquil S.A.", "Café molido 250g"]],
    ];
    for (const [nombre, xml, textos] of casos) {
      const texto = textoDePdf(await generarRidePdf(datosRideDesdeXml(xml), { comprimir: false }));
      for (const esperado of textos) expect(texto, `${nombre}: ${esperado}`).toContain(esperado);
    }
  });

  it("muchas líneas de detalle pasan a más páginas y el pie numera todas", async () => {
    const xml = facturaEjemploXml();
    const d = datosRideDesdeXml(xml);
    const base = d.tablas[0];
    if (base === undefined) throw new Error("sin detalle");
    d.tablas = [{ ...base, filas: Array.from({ length: 120 }, (_, i) => [`C${i}`, `Producto número ${i}`, "1", "1.00", "0.00", "1.00"]) }];
    const pdf = await generarRidePdf(d, { comprimir: false });
    const paginas = paginasDePdf(pdf);
    expect(paginas).toBeGreaterThanOrEqual(3);
    const texto = textoPlanoDePdf(pdf);
    expect(texto).toContain(`Página 1 de ${paginas}`);
    expect(texto).toContain(`Página ${paginas} de ${paginas}`);
    expect(texto).toContain("Producto número 119");
    expect(texto).toContain("VALOR TOTAL");
  });

  it("comprimido (el modo normal) sigue siendo un PDF válido y más pequeño", async () => {
    const d = datosRideDesdeXml(facturaEjemploXml());
    const sin = await generarRidePdf(d, { comprimir: false });
    const con = await generarRidePdf(d);
    expect(con.subarray(0, 5).toString()).toBe("%PDF-");
    expect(con.length).toBeLessThan(sin.length);
  });
});
