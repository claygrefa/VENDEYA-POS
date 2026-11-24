// ============================================================
// tests/integration/server/documentos-sri.test.ts
// Retenciones (07), liquidaciones de compra (03), guías de remisión (06) y ATS, de punta a punta: emisión desde datos
// reales, XML válido contra el XSD oficial, firma y envío por el SRI SIMULADO, ATS contra ventas y compras del entorno.
// ============================================================
import { DOMParser } from "@xmldom/xmldom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Cliente, Producto, Proveedor } from "@prisma/client";
import { aFechaCivilEcuador } from "../../../src/server/services/sri/fechaEcuador.util";
import { verificarFirmaXades } from "../../../src/server/services/sri/firma/xades.firma";
import { XsdValidatorService } from "../../../src/server/services/sri/xsdValidator.service";
import type { ActorCaja } from "../../../src/server/services/turno.service";
import { generarP12Prueba } from "../../helpers/certificados.helper";
import { iniciarSriSimulado, respuestaAutorizacion, type SriSimulado } from "../../helpers/sriSimulado.helper";
import { abrirTurno, codigoError, crearActor, crearEntorno, crearProducto, crearProveedor, PASSWORD_ADMIN, type Entorno } from "../helpers/entorno.helper";
import { verificarInvariantes } from "../helpers/invariantes.helper";

const RUC = "9999999999001";
const AUT_PROVEEDOR = "0805202401099234567800110010020000001231234567811";

let env: Entorno;
let sri: SriSimulado;
let admin: ActorCaja;
let supervisor: ActorCaja;
let cajero: ActorCaja;
let bodeguero: ActorCaja;
let p15: Producto;
let p0: Producto;
let cliente: Cliente;
let proveedor: Proveedor;
const xsd = new XsdValidatorService();
let numeroCompra = 1000;

const comprar = (extra: Record<string, unknown> = {}, proveedorId = proveedor.id) =>
  env.servicios.compras.crear(
    {
      proveedorId,
      sucursalId: env.seed.sucursalId,
      numeroFactura: `001-002-${String(++numeroCompra).padStart(9, "0")}`,
      autorizacion: AUT_PROVEEDOR,
      lineas: [{ productoId: p15.id, cantidad: 10, costoUnitario: 10 }, { productoId: p0.id, cantidad: 5, costoUnitario: 2 }],
      ...extra,
    },
    bodeguero
  );
const comprobante = (id: string) => env.prisma.comprobanteElectronico.findUniqueOrThrow({ where: { id }, include: { colaSRI: true, retenciones: true } });
const secuencial = async (tipo: string): Promise<number> =>
  (await env.prisma.secuencialComprobante.findUnique({ where: { puntoEmisionId_tipoComprobante: { puntoEmisionId: env.seed.puntoEmisionId, tipoComprobante: tipo } } }))?.ultimo ?? 0;
const retenciones = [
  { codigo: "1", codigoRetencion: "312", baseImponible: 110, porcentaje: 1.75 },
  { codigo: "2", codigoRetencion: "10", baseImponible: 15, porcentaje: 20 },
];
const guiaBase = () => ({
  puntoEmisionId: env.seed.puntoEmisionId,
  dirPartida: "Av. Amazonas N34-12, Quito",
  transportista: { tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "Transportes Pérez" },
  fechaInicioTransporte: new Date(Date.now() + 3_600_000).toISOString(),
  fechaFinTransporte: new Date(Date.now() + 86_400_000).toISOString(),
  placa: "PBA-1234",
  destinatarios: [
    { identificacion: "0992345678001", razonSocial: "Cliente Guayaquil S.A.", direccion: "Av. 9 de Octubre 100", motivoTraslado: "Venta", detalles: [{ codigoInterno: "P15", descripcion: "Producto", cantidad: 3 }] },
  ],
});

beforeAll(async () => {
  sri = await iniciarSriSimulado();
  env = await crearEntorno({ sri: { soap: { timeoutMs: 1_000, endpoints: { "1": sri.endpoints, "2": sri.endpoints } } } });
  admin = await crearActor(env, "ADMIN", "doc.admin");
  supervisor = await crearActor(env, "SUPERVISOR", "doc.super");
  cajero = await crearActor(env, "CAJERO", "doc.caja");
  bodeguero = await crearActor(env, "BODEGUERO", "doc.bodega");
  await abrirTurno(env, cajero.id);
  p15 = await crearProducto(env, { codigo: "P15", precioVenta: 10, stock: 500, costo: 4 });
  p0 = await crearProducto(env, { codigo: "P0", precioVenta: 3, stock: 500, costo: 1, aplicaIva: false });
  proveedor = await crearProveedor(env, { razonSocial: "Proveedor Andino S.A." });
  cliente = await env.servicios.clientes.crear({ tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "Juan Pérez", direccion: "Calle 1", email: "juan@correo.ec" });
  await env.prisma.empresa.update({ where: { id: env.seed.empresaId }, data: { agenteRetencion: true, resolucionAgente: "NAC-DGERCGC19-00000001" } });
  await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { emitirRetenciones: true, emitirGuiasRemision: true, emitirLiquidaciones: true } });
  const p12 = generarP12Prueba({ identificacion: RUC, password: "Clave-P12-1" });
  await env.servicios.certificados.guardar({ archivoBase64: p12.archivo.toString("base64"), password: p12.password }, admin);
}, 60_000);

afterAll(async () => {
  await env.cerrar();
  await sri.cerrar();
});

describe("Comprobante de retención", () => {
  it("se emite sobre una compra: XML válido, retenciones guardadas con su valor, cola con prioridad 1", async () => {
    const compra = await comprar(); // 100 + 10 de subtotal; IVA 15
    expect(compra).toMatchObject({ subtotal: 110, iva: 15, total: 125 });
    const antes = await secuencial("07");
    const r = await env.servicios.documentosSri.emitirRetencion(compra.id, { puntoEmisionId: env.seed.puntoEmisionId, retenciones }, supervisor);
    expect(r.creado).toBe(true);
    const c = await comprobante(r.comprobante.id);
    expect(c).toMatchObject({ tipoComprobante: "07", compraId: compra.id, estado: "PENDIENTE", secuencial: String(antes + 1).padStart(9, "0"), ventaId: null });
    expect(c.colaSRI).toMatchObject({ prioridad: 1 });
    expect(c.retenciones.map((l) => [l.codigoImpuesto, l.codigoRetencion, l.baseImponible, l.porcentaje, l.valor]).sort()).toEqual([
      ["1", "312", 110, 1.75, 1.93],
      ["2", "10", 15, 20, 3],
    ]);
    const xml = c.xmlGenerado as string;
    expect((await xsd.validar("retencion", xml)).errores).toEqual([]);
    expect(xml).toContain("<tipoIdentificacionSujetoRetenido>04</tipoIdentificacionSujetoRetenido><tipoSujetoRetenido>02</tipoSujetoRetenido>");
    expect(xml).toContain("<numDocSustento>001002000001001</numDocSustento>");
    expect(xml).toContain(`<numAutDocSustento>${AUT_PROVEEDOR}</numAutDocSustento>`);
    expect(xml).toContain("<impuestoDocSustento><codImpuestoDocSustento>2</codImpuestoDocSustento><codigoPorcentaje>4</codigoPorcentaje><baseImponible>100.00</baseImponible>");
    expect(xml).toContain("<agenteRetencion>19000000</agenteRetencion>");
    expect(await verificarInvariantes(env)).toEqual([]);
  });

  it("es idempotente: repetir la emisión devuelve la misma retención sin consumir secuencial", async () => {
    const compra = await comprar();
    const a = await env.servicios.documentosSri.emitirRetencion(compra.id, { puntoEmisionId: env.seed.puntoEmisionId, retenciones }, supervisor);
    const antes = await secuencial("07");
    const b = await env.servicios.documentosSri.emitirRetencion(compra.id, { puntoEmisionId: env.seed.puntoEmisionId, retenciones }, supervisor);
    expect(b).toMatchObject({ creado: false });
    expect(b.comprobante.id).toBe(a.comprobante.id);
    expect(await secuencial("07")).toBe(antes);
  });

  it("rechaza lo que no cumple las reglas, sin dejar rastro ni consumir secuencial", async () => {
    const compra = await comprar();
    const pe = env.seed.puntoEmisionId;
    const antes = await secuencial("07");
    const falla = (entrada: unknown, id = compra.id) => codigoError(env.servicios.documentosSri.emitirRetencion(id, entrada, supervisor));

    expect(await falla({ puntoEmisionId: pe, retenciones: [] })).toBe("VALIDACION");
    expect(await falla({ puntoEmisionId: pe, retenciones: [{ codigo: "1", codigoRetencion: "312", baseImponible: 500, porcentaje: 1.75 }] })).toBe("VALIDACION"); // base > subtotal
    expect(await falla({ puntoEmisionId: pe, retenciones: [{ codigo: "2", codigoRetencion: "10", baseImponible: 100, porcentaje: 20 }] })).toBe("VALIDACION"); // base > IVA
    expect(await falla({ puntoEmisionId: pe, retenciones: [retenciones[0], retenciones[0]] })).toBe("VALIDACION"); // repetida
    expect(await falla({ puntoEmisionId: "no-es-uuid", retenciones })).toBe("VALIDACION");
    expect(await falla({ puntoEmisionId: "11111111-1111-4111-8111-111111111111", retenciones })).toBe("NO_ENCONTRADO");
    expect(await falla({ puntoEmisionId: pe, retenciones }, "no-existe")).toBe("NO_ENCONTRADO");

    // número del documento que no permite armar el sustento
    const mala = await comprar({ numeroFactura: "F-ABC" });
    expect(await falla({ puntoEmisionId: pe, retenciones }, mala.id)).toBe("VALIDACION");
    expect(await secuencial("07")).toBe(antes);
    expect(await env.prisma.comprobanteElectronico.count({ where: { compraId: { in: [compra.id, mala.id] } } })).toBe(0);
  });

  it("solo un agente de retención, con el módulo activo", async () => {
    const compra = await comprar();
    const entrada = { puntoEmisionId: env.seed.puntoEmisionId, retenciones };
    await env.prisma.empresa.update({ where: { id: env.seed.empresaId }, data: { agenteRetencion: false } });
    expect(await codigoError(env.servicios.documentosSri.emitirRetencion(compra.id, entrada, supervisor))).toBe("VALIDACION");
    await env.prisma.empresa.update({ where: { id: env.seed.empresaId }, data: { agenteRetencion: true } });
    await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { emitirRetenciones: false } });
    expect(await codigoError(env.servicios.documentosSri.emitirRetencion(compra.id, entrada, supervisor))).toBe("MODULO_DESHABILITADO");
    await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { emitirRetenciones: true } });
    expect(await codigoError(env.servicios.documentosSri.emitirRetencion(compra.id, entrada, supervisor))).toBe("SIN_ERROR");
  });

  it("se firma, se envía al SRI y va antes que una factura pendiente (prioridad 1)", async () => {
    sri.reiniciar();
    await env.prisma.colaSRI.deleteMany({});
    await env.prisma.comprobanteElectronico.updateMany({ where: { estado: { in: ["PENDIENTE", "EN_PROCESO"] } }, data: { estado: "ANULADO" } });
    const v = await env.servicios.ventas.crear({ puntoEmisionId: env.seed.puntoEmisionId, lineas: [{ productoId: p15.id, cantidad: 1 }], pagos: [{ formaPago: "EFECTIVO", monto: 12 }], emitirFactura: true, clienteId: cliente.id }, cajero);
    const factura = await env.prisma.comprobanteElectronico.findUniqueOrThrow({ where: { ventaId: v.id } });
    const compra = await comprar();
    const r = await env.servicios.documentosSri.emitirRetencion(compra.id, { puntoEmisionId: env.seed.puntoEmisionId, retenciones }, supervisor);

    expect(await env.servicios.envioSri.procesarCola(10)).toBe(2);
    expect(sri.consultas).toEqual([r.comprobante.claveAcceso, factura.claveAcceso]); // la retención, aunque se creó después, va primero
    const c = await comprobante(r.comprobante.id);
    expect(c).toMatchObject({ estado: "AUTORIZADO", colaSRI: null });
    expect(verificarFirmaXades(c.xmlFirmado as string).valida).toBe(true);
    expect((await xsd.validar("retencion", c.xmlFirmado as string)).errores).toEqual([]);
    expect(sri.recepciones[0]).toBe(c.xmlFirmado);
  });
});

describe("Liquidación de compra", () => {
  it("se emite sobre una compra de tipo LIQUIDACION, con XML válido y a crédito con plazo", async () => {
    const prov = await crearProveedor(env, { razonSocial: "Agricultor Sin RUC" });
    await env.prisma.proveedor.update({ where: { id: prov.id }, data: { ruc: "1710034065", direccion: "Vía a Machachi km 4" } });
    const compra = await comprar({ tipoDocumento: "LIQUIDACION", numeroFactura: "LIQ-INT-1", autorizacion: undefined, formaPago: "CREDITO", diasCredito: 15 }, prov.id);
    const r = await env.servicios.documentosSri.emitirLiquidacion(compra.id, { puntoEmisionId: env.seed.puntoEmisionId }, supervisor);
    expect(r.creado).toBe(true);
    const c = await comprobante(r.comprobante.id);
    expect(c).toMatchObject({ tipoComprobante: "03", compraId: compra.id, estado: "PENDIENTE", ventaId: null });
    expect(c.colaSRI).toMatchObject({ prioridad: 5 });
    const xml = c.xmlGenerado as string;
    expect((await xsd.validar("liquidacionCompra", xml)).errores).toEqual([]);
    expect(xml).toContain("<tipoIdentificacionProveedor>05</tipoIdentificacionProveedor>");
    expect(xml).toContain("<direccionProveedor>Vía a Machachi km 4</direccionProveedor>");
    expect(xml).toContain("<importeTotal>125.00</importeTotal>");
    expect(xml).toContain("<plazo>15.00</plazo><unidadTiempo>dias</unidadTiempo>");
    // idempotente
    const otra = await env.servicios.documentosSri.emitirLiquidacion(compra.id, { puntoEmisionId: env.seed.puntoEmisionId }, supervisor);
    expect(otra).toMatchObject({ creado: false });
    expect(otra.comprobante.id).toBe(r.comprobante.id);
  });

  it("una compra con factura del proveedor no genera liquidación; sin módulo tampoco", async () => {
    const compra = await comprar();
    expect(await codigoError(env.servicios.documentosSri.emitirLiquidacion(compra.id, { puntoEmisionId: env.seed.puntoEmisionId }, supervisor))).toBe("VALIDACION");
    const liq = await comprar({ tipoDocumento: "LIQUIDACION", numeroFactura: "LIQ-INT-2", autorizacion: undefined });
    await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { emitirLiquidaciones: false } });
    expect(await codigoError(env.servicios.documentosSri.emitirLiquidacion(liq.id, { puntoEmisionId: env.seed.puntoEmisionId }, supervisor))).toBe("MODULO_DESHABILITADO");
    await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { emitirLiquidaciones: true } });
  });

  it("la retención de una liquidación se sustenta en la propia liquidación (exige emitirla antes)", async () => {
    const compra = await comprar({ tipoDocumento: "LIQUIDACION", numeroFactura: "LIQ-INT-3", autorizacion: undefined });
    const entrada = { puntoEmisionId: env.seed.puntoEmisionId, retenciones: [{ codigo: "1", codigoRetencion: "312", baseImponible: 110, porcentaje: 1.75 }] };
    expect(await codigoError(env.servicios.documentosSri.emitirRetencion(compra.id, entrada, supervisor))).toBe("ESTADO_INVALIDO");
    const liq = await env.servicios.documentosSri.emitirLiquidacion(compra.id, { puntoEmisionId: env.seed.puntoEmisionId }, supervisor);
    const ret = await env.servicios.documentosSri.emitirRetencion(compra.id, entrada, supervisor);
    const xml = ret.comprobante.xmlGenerado as string;
    expect(xml).toContain("<codDocSustento>03</codDocSustento>");
    expect(xml).toContain(`<numDocSustento>${liq.comprobante.serie.replace("-", "")}${liq.comprobante.secuencial}</numDocSustento>`);
    expect(xml).toContain(`<numAutDocSustento>${liq.comprobante.claveAcceso}</numAutDocSustento>`);
  });
});

describe("Guía de remisión", () => {
  it("se emite, valida contra el XSD, se firma y se envía", async () => {
    const r = await env.servicios.documentosSri.emitirGuiaRemision(guiaBase(), supervisor);
    expect(r.creado).toBe(true);
    const c = await comprobante(r.comprobante.id);
    expect(c).toMatchObject({ tipoComprobante: "06", compraId: null, ventaId: null, estado: "PENDIENTE" });
    expect((await xsd.validar("guiaRemision", c.xmlGenerado as string)).errores).toEqual([]);
    expect(c.xmlGenerado).toContain("<placa>PBA-1234</placa>");
    expect(await env.servicios.envioSri.procesar(c.id)).toBe("AUTORIZADO");
    expect(verificarFirmaXades((await comprobante(c.id)).xmlFirmado as string).valida).toBe(true);
  });

  it("con documento de sustento y rechazo de datos inválidos o módulo apagado", async () => {
    const conSustento = guiaBase();
    (conSustento.destinatarios[0] as Record<string, unknown>)["sustento"] = { codDoc: "01", numero: "001-001-000000123", numAutorizacion: AUT_PROVEEDOR, fechaEmision: new Date().toISOString() };
    const r = await env.servicios.documentosSri.emitirGuiaRemision(conSustento, supervisor);
    expect(r.comprobante.xmlGenerado).toContain("<codDocSustento>01</codDocSustento><numDocSustento>001-001-000000123</numDocSustento>");

    const antes = await secuencial("06");
    expect(await codigoError(env.servicios.documentosSri.emitirGuiaRemision({ ...guiaBase(), fechaFinTransporte: new Date(Date.now() - 86_400_000 * 5).toISOString() }, supervisor))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.documentosSri.emitirGuiaRemision({ ...guiaBase(), destinatarios: [] }, supervisor))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.documentosSri.emitirGuiaRemision({ ...guiaBase(), placa: "" }, supervisor))).toBe("VALIDACION");
    await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { emitirGuiasRemision: false } });
    expect(await codigoError(env.servicios.documentosSri.emitirGuiaRemision(guiaBase(), supervisor))).toBe("MODULO_DESHABILITADO");
    await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { emitirGuiasRemision: true } });
    expect(await secuencial("06")).toBe(antes);
  });
});

describe("Estados del SRI (ficha 7.2.3)", () => {
  it("un estado RECHAZADO (como lo ilustra la ficha) se trata igual que NO AUTORIZADO", async () => {
    sri.reiniciar();
    const r = await env.servicios.documentosSri.emitirGuiaRemision(guiaBase(), supervisor);
    sri.colaAutorizacion.push(respuestaAutorizacion("x", [{ estado: "RECHAZADO", mensajes: [{ identificador: "46", mensaje: "RUC no existe" }] }]));
    expect(await env.servicios.envioSri.procesar(r.comprobante.id)).toBe("RECHAZADO");
    expect(JSON.parse((await comprobante(r.comprobante.id)).mensajesRespuesta as string)[0]).toMatchObject({ identificador: "46" });
  });
});

describe("Anexo Transaccional Simplificado (ATS)", () => {
  const hoy = aFechaCivilEcuador(new Date());
  const periodo = { anio: hoy.anio, mes: hoy.mes };
  const analizar = (xml: string) => new DOMParser().parseFromString(xml, "text/xml") as unknown as Document;
  const textos = (doc: Document, nombre: string): string[] => Array.from({ length: doc.getElementsByTagName(nombre).length }, (_, i) => (doc.getElementsByTagName(nombre).item(i)?.textContent ?? ""));

  // El entorno ya tiene ventas autorizadas de pruebas anteriores: las cifras se comparan contra esa línea base
  let base = { total: 0, comprobantes: 0, grav: 0, cero: 0 };
  let totalFacturas = 0;
  let ventaNc = "";
  const sumaVentas = (doc: Document, nombre: string): number => {
    const ventas = doc.getElementsByTagName("ventas").item(0);
    if (ventas === null) return 0;
    return Array.from({ length: ventas.getElementsByTagName(nombre).length }, (_, i) => Number(ventas.getElementsByTagName(nombre).item(i)?.textContent ?? 0)).reduce((a, b) => a + b, 0);
  };

  beforeAll(async () => {
    sri.reiniciar();
    // limpia lo pendiente de pruebas anteriores para que el resumen cuente solo lo de esta sección
    await env.prisma.colaSRI.deleteMany({});
    await env.prisma.comprobanteElectronico.updateMany({ where: { estado: { in: ["PENDIENTE", "EN_PROCESO"] } }, data: { estado: "ANULADO" } });
    // las compras de pruebas anteriores (algunas incompletas a propósito) no forman parte de esta sección
    await env.prisma.compra.updateMany({ data: { estado: "ANULADA" } });
    const previo = await env.servicios.ats.generar(periodo, supervisor);
    const docPrevio = analizar(previo.xml);
    base = { total: previo.resumen.totalVentas, comprobantes: previo.resumen.comprobantesVenta, grav: sumaVentas(docPrevio, "baseImpGrav"), cero: sumaVentas(docPrevio, "baseImponible") };
    const vender = async (extra: Record<string, unknown>, monto: number) => {
      const v = await env.servicios.ventas.crear({ puntoEmisionId: env.seed.puntoEmisionId, lineas: [{ productoId: p15.id, cantidad: 2 }, { productoId: p0.id, cantidad: 1 }], pagos: [{ formaPago: "EFECTIVO", monto }], emitirFactura: true, ...extra }, cajero);
      const c = await env.prisma.comprobanteElectronico.findUniqueOrThrow({ where: { ventaId: v.id } });
      expect(await env.servicios.envioSri.procesar(c.id)).toBe("AUTORIZADO");
      return v;
    };
    const v1 = await vender({ clienteId: cliente.id }, 30); // 20 gravado + 3 al 0 % ; IVA 3
    await vender({}, 30); // consumidor final
    ventaNc = v1.id;
    totalFacturas = 2 * 23;
  });

  it("estructura del anexo, ventas por cliente, ventas por establecimiento y totales cuadrados con las ventas", async () => {
    const r = await env.servicios.ats.generar(periodo, supervisor);
    const doc = analizar(r.xml);
    const hijos = Array.from({ length: doc.documentElement.childNodes.length }, (_, i) => doc.documentElement.childNodes.item(i)).filter((n) => n?.nodeType === 1).map((n) => (n as Element).localName);
    expect(hijos).toEqual(["TipoIDInformante", "IdInformante", "razonSocial", "Anio", "Mes", "numEstabRuc", "totalVentas", "codigoOperativo", "ventas", "ventasEstablecimiento"]);
    expect(textos(doc, "IdInformante")).toEqual([RUC]);
    expect(textos(doc, "Mes")).toEqual([String(hoy.mes).padStart(2, "0")]);
    expect(textos(doc, "numEstabRuc")).toEqual(["001"]);
    expect(textos(doc, "totalVentas")).toEqual([(base.total + totalFacturas).toFixed(2)]);
    expect(textos(doc, "ventasEstab")).toEqual([(base.total + totalFacturas).toFixed(2)]);

    // por cliente: el cliente identificado y el consumidor final
    expect(textos(doc, "idCliente").sort()).toEqual(["1710034065", "9999999999999"]);
    expect(textos(doc, "tpIdCliente").sort()).toEqual(["05", "07"]);
    expect(new Set(textos(doc, "tipoComprobante"))).toEqual(new Set(["18"]));
    expect(sumaVentas(doc, "baseImpGrav")).toBeCloseTo(base.grav + 40, 2); // 2 facturas × 20 gravado
    expect(sumaVentas(doc, "baseImponible")).toBeCloseTo(base.cero + 6, 2); // 2 facturas × 3 al 0 %
    expect(sumaVentas(doc, "montoIva")).toBeCloseTo((base.grav + 40) * 0.15, 2);
    expect(r.resumen).toMatchObject({ anio: periodo.anio, mes: periodo.mes, totalVentas: base.total + totalFacturas, comprobantesVenta: base.comprobantes + 2, ventasPendientesAutorizacion: 0 });
  });

  it("las notas de crédito restan de las ventas y aparecen con su tipo (04)", async () => {
    await env.servicios.ventas.anular(ventaNc, { motivo: "Devolución total" }, supervisor);
    const nc = await env.prisma.comprobanteElectronico.findFirstOrThrow({ where: { tipoComprobante: "04", comprobanteOrigenId: { not: null } } });
    // pendiente de autorización: aún no entra al anexo y se informa
    let r = await env.servicios.ats.generar(periodo, supervisor);
    expect(r.resumen.ventasPendientesAutorizacion).toBe(1);
    expect(r.resumen.totalVentas).toBe(base.total + totalFacturas);
    expect(await env.servicios.envioSri.procesar(nc.id)).toBe("AUTORIZADO");

    r = await env.servicios.ats.generar(periodo, supervisor);
    expect(r.resumen).toMatchObject({ totalVentas: base.total + totalFacturas - 23, comprobantesVenta: base.comprobantes + 3, ventasPendientesAutorizacion: 0 });
    const doc = analizar(r.xml);
    expect(textos(doc, "tipoComprobante")).toEqual(expect.arrayContaining(["04", "18"]));
    expect(textos(doc, "totalVentas")).toEqual([(base.total + totalFacturas - 23).toFixed(2)]);
  });

  it("las compras salen con su base, IVA y las retenciones emitidas (IVA por porcentaje y renta en air)", async () => {
    const compra = await comprar({ numeroFactura: "001-003-000004567", autorizacion: AUT_PROVEEDOR });
    const ret = await env.servicios.documentosSri.emitirRetencion(compra.id, { puntoEmisionId: env.seed.puntoEmisionId, retenciones }, supervisor);
    const r = await env.servicios.ats.generar(periodo, supervisor);
    const doc = analizar(r.xml);
    const i = textos(doc, "secuencial").indexOf("4567");
    expect(i).toBeGreaterThanOrEqual(0);
    const det = Array.from({ length: doc.getElementsByTagName("detalleCompras").length }, (_, k) => doc.getElementsByTagName("detalleCompras").item(k) as Element)[i] as Element;
    const val = (n: string): string | undefined => det.getElementsByTagName(n).item(0)?.textContent ?? undefined;
    expect(val("tpIdProv")).toBe("01");
    expect(val("idProv")).toBe(proveedor.ruc);
    expect(val("tipoComprobante")).toBe("01");
    expect([val("establecimiento"), val("puntoEmision")]).toEqual(["001", "003"]);
    expect(val("autorizacion")).toBe(AUT_PROVEEDOR);
    expect([val("baseImpGrav"), val("baseImponible"), val("montoIva")]).toEqual(["100.00", "10.00", "15.00"]);
    expect(val("valRetServ20")).toBe("3.00");
    expect(val("valRetBien10")).toBe("0.00");
    expect([val("codRetAir"), val("baseImpAir"), val("porcentajeAir"), val("valRetAir")]).toEqual(["312", "110.00", "1.75", "1.93"]);
    expect(val("autRetencion1")).toBe(ret.comprobante.claveAcceso);
    expect(val("secRetencion1")).toBe(String(Number(ret.comprobante.secuencial)));
    expect(r.resumen.compras).toBeGreaterThan(0);
    expect(r.resumen.retenciones).toBeGreaterThan(0);
  });

  it("no genera un anexo incompleto: lista las compras a corregir", async () => {
    const mala = await comprar({ numeroFactura: "F-XYZ", autorizacion: undefined });
    const error = await env.servicios.ats.generar(periodo, supervisor).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/No se puede generar el ATS.*F-XYZ.*formato 001-001-000000123.*F-XYZ.*autorización/s);
    await env.prisma.compra.update({ where: { id: mala.id }, data: { estado: "ANULADA" } });
    expect((await env.servicios.ats.generar(periodo, supervisor)).resumen.compras).toBeGreaterThan(0);
  });

  it("un periodo sin movimiento da un anexo vacío válido y los periodos inválidos se rechazan", async () => {
    const r = await env.servicios.ats.generar({ anio: 2015, mes: 3 }, supervisor);
    expect(r.resumen).toMatchObject({ totalVentas: 0, comprobantesVenta: 0, compras: 0 });
    expect(r.xml).toContain("<codigoOperativo>IVA</codigoOperativo>");
    expect(r.xml).not.toContain("<compras>");
    expect(await codigoError(env.servicios.ats.generar({ anio: 2024, mes: 13 }, supervisor))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.ats.generar({}, supervisor))).toBe("VALIDACION");
  });
});

describe("API", () => {
  const tokens: Record<string, string> = {};
  const api = (method: "GET" | "POST", url: string, quien: string, payload?: unknown) =>
    env.backend.server.inject({ method, url, headers: { authorization: `Bearer ${tokens[quien]}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });

  beforeAll(async () => {
    const login = async (username: string, password: string): Promise<void> => {
      const r = await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
      tokens[username] = (r.json() as { token: string }).token;
    };
    await login("admin", PASSWORD_ADMIN);
    for (const [rol, username] of [["SUPERVISOR", "api.doc.super"], ["CONTADOR", "api.doc.conta"], ["CAJERO", "api.doc.caja"]] as const) {
      await env.servicios.usuarios.crear({ empresaId: env.seed.empresaId, rol, username, password: "Clave12345", nombre: username, apellido: "Api" });
      await login(username, "Clave12345");
    }
    await env.prisma.compra.updateMany({ where: { numeroFactura: { startsWith: "F-" } }, data: { estado: "ANULADA" } });
  });

  it("POST /compras/:id/retencion: 201 al emitir, 200 si ya existía; el cajero y el contador no pueden", async () => {
    const compra = await comprar();
    const cuerpo = { puntoEmisionId: env.seed.puntoEmisionId, retenciones };
    for (const quien of ["api.doc.caja", "api.doc.conta"]) expect((await api("POST", `/api/compras/${compra.id}/retencion`, quien, cuerpo)).statusCode).toBe(403);
    const a = await api("POST", `/api/compras/${compra.id}/retencion`, "api.doc.super", cuerpo);
    expect(a.statusCode).toBe(201);
    expect(a.json()).toMatchObject({ creado: true, comprobante: { tipoComprobante: "07", estado: "PENDIENTE" } });
    expect((await api("POST", `/api/compras/${compra.id}/retencion`, "api.doc.super", cuerpo)).statusCode).toBe(200);
    expect((await api("POST", `/api/compras/${compra.id}/retencion`, "api.doc.super", { puntoEmisionId: env.seed.puntoEmisionId })).statusCode).toBe(400);
    expect((await api("POST", "/api/compras/no-existe/retencion", "api.doc.super", cuerpo)).statusCode).toBe(404);
  });

  it("POST /compras/:id/liquidacion y POST /guias-remision", async () => {
    const liq = await comprar({ tipoDocumento: "LIQUIDACION", numeroFactura: "LIQ-API-1", autorizacion: undefined });
    expect((await api("POST", `/api/compras/${liq.id}/liquidacion`, "api.doc.caja", { puntoEmisionId: env.seed.puntoEmisionId })).statusCode).toBe(403);
    const r = await api("POST", `/api/compras/${liq.id}/liquidacion`, "api.doc.super", { puntoEmisionId: env.seed.puntoEmisionId });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ comprobante: { tipoComprobante: "03" } });

    expect((await api("POST", "/api/guias-remision", "api.doc.caja", guiaBase())).statusCode).toBe(403);
    const g = await api("POST", "/api/guias-remision", "api.doc.super", guiaBase());
    expect(g.statusCode).toBe(201);
    expect(g.json()).toMatchObject({ creado: true, comprobante: { tipoComprobante: "06" } });
    expect((await api("POST", "/api/guias-remision", "api.doc.super", { ...guiaBase(), destinatarios: [] })).statusCode).toBe(400);
  });

  it("GET /reportes/ats: XML descargable para quien puede exportar reportes; ?formato=json con el resumen; 400 si el periodo es inválido", async () => {
    const hoy = aFechaCivilEcuador(new Date());
    const url = `/api/reportes/ats?anio=${hoy.anio}&mes=${hoy.mes}`;
    expect((await api("GET", url, "api.doc.caja")).statusCode).toBe(403);
    for (const quien of ["api.doc.conta", "api.doc.super", "admin"]) {
      const r = await api("GET", url, quien);
      expect(r.statusCode, quien).toBe(200);
      expect(r.headers["content-type"]).toContain("application/xml");
      expect(r.headers["content-disposition"]).toBe(`attachment; filename="ATS-${hoy.anio}-${String(hoy.mes).padStart(2, "0")}.xml"`);
      expect(r.body.startsWith("<?xml")).toBe(true);
      expect(r.body).toContain(`<IdInformante>${RUC}</IdInformante>`);
    }
    const j = await api("GET", `${url}&formato=json`, "api.doc.conta");
    expect(j.json()).toMatchObject({ resumen: { anio: hoy.anio, mes: hoy.mes }, xml: expect.stringContaining("<iva>") });
    expect((await api("GET", "/api/reportes/ats?anio=2024&mes=0", "api.doc.conta")).statusCode).toBe(400);
    expect((await api("GET", "/api/reportes/ats", "api.doc.conta")).statusCode).toBe(400);
  });
});
