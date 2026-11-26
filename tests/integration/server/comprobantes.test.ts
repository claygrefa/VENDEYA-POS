// ============================================================
// tests/integration/server/comprobantes.test.ts
// Facturas y notas de crédito electrónicas generadas desde ventas reales: XML válido contra los XSD oficiales,
// reglas de la Ficha Técnica, idempotencia, anulación (nota de crédito) y API.
// ============================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Cliente, Producto } from "@prisma/client";
import { parsearClaveAcceso, validarClaveAcceso } from "../../../src/server/services/sri/claveAcceso.util";
import { XsdValidatorService } from "../../../src/server/services/sri/xsdValidator.service";
import type { ActorCaja } from "../../../src/server/services/turno.service";
import {
  abrirTurno, codigoError, configurarGiro, crearActor, crearClienteConCredito, crearEntorno, crearProducto, PASSWORD_ADMIN, type Entorno,
} from "../helpers/entorno.helper";
import { verificarInvariantes } from "../helpers/invariantes.helper";

let env: Entorno;
let cajero: ActorCaja;
let supervisor: ActorCaja;
let xsd: XsdValidatorService;
let cliente: Cliente; // cédula 1710034065, con correo
let p15: Producto; // IVA 15 % (código 4)
let p5: Producto; // IVA 5 % (código 5)
let p0: Producto; // 0 % (código 0)
let pExento: Producto; // exento (código 7)
let pNoObjeto: Producto; // no objeto (código 6)

beforeAll(async () => {
  env = await crearEntorno();
  xsd = new XsdValidatorService();
  cajero = await crearActor(env, "CAJERO", "sri.caja");
  supervisor = await crearActor(env, "SUPERVISOR", "sri.super");
  await abrirTurno(env, cajero.id);
  p15 = await crearProducto(env, { codigo: "P15", precioVenta: 10, stock: 1000, costo: 4 });
  p5 = await crearProducto(env, { codigo: "P5", precioVenta: 4, stock: 1000, costo: 2, codigoIva: "5" });
  p0 = await crearProducto(env, { codigo: "P0", precioVenta: 3, stock: 1000, costo: 1, aplicaIva: false });
  pExento = await crearProducto(env, { codigo: "PEXE", precioVenta: 2, stock: 1000, costo: 1, codigoIva: "7" });
  pNoObjeto = await crearProducto(env, { codigo: "PNOB", precioVenta: 1, stock: 1000, costo: 0.5, codigoIva: "6" });
  cliente = await env.servicios.clientes.crear({
    tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "Juan Pérez", direccion: "Av. Siempre Viva 123", email: "juan@correo.ec", telefono: "0999999999",
  });
}, 60_000);

afterAll(async () => {
  await env.cerrar();
});

const vender = (lineas: unknown[], pagos: unknown[], extra: Record<string, unknown> = {}, actor: ActorCaja = cajero) =>
  env.servicios.ventas.crear({ puntoEmisionId: env.seed.puntoEmisionId, lineas, pagos, emitirFactura: true, ...extra }, actor);

const comprobanteDe = (ventaId: string) => env.prisma.comprobanteElectronico.findUniqueOrThrow({ where: { ventaId }, include: { colaSRI: true } });
const stockDe = async (id: string): Promise<number> => (await env.prisma.producto.findUniqueOrThrow({ where: { id } })).stockActual;
const secuencialFactura = async (): Promise<number> =>
  (await env.prisma.secuencialComprobante.findUnique({ where: { puntoEmisionId_tipoComprobante: { puntoEmisionId: env.seed.puntoEmisionId, tipoComprobante: "01" } } }))?.ultimo ?? 0;
const dato = (xml: string, etiqueta: string): string | undefined => new RegExp(`<${etiqueta}>([^<]*)</${etiqueta}>`).exec(xml)?.[1];

describe("Factura generada al vender", () => {
  it("queda PENDIENTE en la cola, con clave de acceso válida y XML que cumple el XSD oficial", async () => {
    const v = await vender([{ productoId: p15.id, cantidad: 2 }], [{ formaPago: "EFECTIVO", monto: 25 }], { clienteId: cliente.id });
    expect(v.advertencias).toEqual([]);
    expect(v.comprobante).toMatchObject({ estado: "PENDIENTE" });

    const c = await comprobanteDe(v.id);
    expect(c).toMatchObject({ tipoComprobante: "01", ambiente: "1", serie: "001-001", secuencial: "000000001", estado: "PENDIENTE", ventaId: v.id, comprobanteOrigenId: null });
    expect(c.colaSRI).toMatchObject({ prioridad: 5, intentos: 0 });
    expect(c.xmlFirmado).toBeNull();

    expect(validarClaveAcceso(c.claveAcceso)).toBe(true);
    expect(parsearClaveAcceso(c.claveAcceso)).toMatchObject({ tipoComprobante: "01", ruc: "9999999999001", ambiente: "1", serie: "001001", secuencial: "000000001", tipoEmision: "1" });
    expect(v.comprobante?.claveAcceso).toBe(c.claveAcceso);

    const xml = c.xmlGenerado as string;
    expect((await xsd.validar("factura", xml)).errores).toEqual([]);
    expect(dato(xml, "claveAcceso")).toBe(c.claveAcceso);
    expect(dato(xml, "ruc")).toBe("9999999999001");
    expect(dato(xml, "estab")).toBe("001");
    expect(dato(xml, "tipoIdentificacionComprador")).toBe("05");
    expect(dato(xml, "identificacionComprador")).toBe("1710034065");
    expect(dato(xml, "razonSocialComprador")).toBe("Juan Pérez");
    expect(dato(xml, "direccionComprador")).toBe("Av. Siempre Viva 123");
    expect(dato(xml, "totalSinImpuestos")).toBe("20.00");
    expect(dato(xml, "importeTotal")).toBe("23.00");
    expect(xml).toContain("<codigoPorcentaje>4</codigoPorcentaje>"); // 15 % = código 4
    expect(xml).toContain('<campoAdicional nombre="Email">juan@correo.ec</campoAdicional>');
    expect(xml).toContain(`<campoAdicional nombre="Venta">${v.numero}</campoAdicional>`);
    // la fecha del XML es la de la clave de acceso
    const d = dato(xml, "fechaEmision") as string;
    expect(c.claveAcceso.slice(0, 8)).toBe(d.replaceAll("/", ""));
    expect(await verificarInvariantes(env)).toEqual([]);
  });

  it("las cinco tarifas (15 %, 5 %, 0 %, no objeto y exento) se agrupan con sus códigos y cuadran con la venta", async () => {
    const v = await vender(
      [
        { productoId: p15.id, cantidad: 3 }, { productoId: p5.id, cantidad: 5 }, { productoId: p0.id, cantidad: 2 },
        { productoId: pExento.id, cantidad: 4 }, { productoId: pNoObjeto.id, cantidad: 10 },
      ],
      [{ formaPago: "EFECTIVO", monto: 100 }],
      { clienteId: cliente.id }
    );
    const xml = (await comprobanteDe(v.id)).xmlGenerado as string;
    expect((await xsd.validar("factura", xml)).errores).toEqual([]);

    const totales = /<totalConImpuestos>(.*?)<\/totalConImpuestos>/.exec(xml)?.[1] ?? "";
    const grupos = [...totales.matchAll(/<codigoPorcentaje>(\d+)<\/codigoPorcentaje><baseImponible>([\d.]+)<\/baseImponible><tarifa>([\d.]+)<\/tarifa><valor>([\d.]+)<\/valor>/g)].map((m) => m.slice(1, 5).join("|"));
    expect(grupos).toEqual(["0|6.00|0.00|0.00", "4|30.00|15.00|4.50", "5|20.00|5.00|1.00", "6|10.00|0.00|0.00", "7|8.00|0.00|0.00"]);
    expect(v.total).toBe(74 + 5.5);
    expect(dato(xml, "importeTotal")).toBe("79.50");
    expect(dato(xml, "totalSinImpuestos")).toBe("74.00");
    // las líneas guardaron su código SRI
    const codigos = (await env.prisma.lineaVenta.findMany({ where: { ventaId: v.id } })).map((l) => l.codigoIvaSRI).sort();
    expect(codigos).toEqual(["0", "4", "5", "6", "7"]);
  });

  it("descuento por valor y por porcentaje, pagos mixtos (el cambio no cuenta) y propina", async () => {
    const v = await vender(
      [{ productoId: p15.id, cantidad: 2, descuento: 10, tipoDescuento: "PORCENTAJE" }, { productoId: p5.id, cantidad: 1, descuento: 0.5, tipoDescuento: "VALOR" }],
      [{ formaPago: "TARJETA_DEBITO", monto: 10 }, { formaPago: "EFECTIVO", monto: 20 }],
      { clienteId: cliente.id, propina: 1.5 }
    );
    // 18 (+IVA 2.70) + 3.50 (+IVA 0.18 redondeado) ; propina 1.50
    const xml = (await comprobanteDe(v.id)).xmlGenerado as string;
    expect((await xsd.validar("factura", xml)).errores).toEqual([]);
    expect(dato(xml, "totalDescuento")).toBe("2.50");
    expect(dato(xml, "propina")).toBe("1.50");
    const importe = Number(dato(xml, "importeTotal"));
    expect(importe).toBeCloseTo(v.total + 1.5, 2);
    const pagos = [...xml.matchAll(/<pago><formaPago>(\d+)<\/formaPago><total>([\d.]+)<\/total><\/pago>/g)].map((m) => `${m[1]}:${m[2]}`);
    expect(pagos).toHaveLength(2);
    expect(pagos.reduce((a, p) => a + Number(p.split(":")[1]), 0)).toBeCloseTo(importe, 2); // pagos netos = importe total
    expect(pagos).toContain("16:10.00"); // tarjeta de débito
  });

  it("venta a crédito: forma de pago 01 con plazo en días", async () => {
    const credito = await crearClienteConCredito(env, "0926687856001", 500, 45);
    const v = await vender([{ productoId: p15.id, cantidad: 2 }], [{ formaPago: "CREDITO", monto: 23 }], { clienteId: credito.id });
    const xml = (await comprobanteDe(v.id)).xmlGenerado as string;
    expect((await xsd.validar("factura", xml)).errores).toEqual([]);
    expect(xml).toContain("<pago><formaPago>01</formaPago><total>23.00</total><plazo>45.00</plazo><unidadTiempo>dias</unidadTiempo></pago>");
    expect(dato(xml, "tipoIdentificacionComprador")).toBe("04");
  });

  it("las formas de pago internas se traducen a la Tabla 24 del SRI", async () => {
    const casos: Array<[string, string]> = [["TARJETA_CREDITO", "19"], ["TARJETA_DEBITO", "16"], ["TRANSFERENCIA", "20"], ["CHEQUE", "20"], ["EFECTIVO", "01"]];
    for (const [forma, codigo] of casos) {
      const v = await vender([{ productoId: p15.id, cantidad: 1 }], [{ formaPago: forma, monto: 11.5 }], { clienteId: cliente.id });
      expect(((await comprobanteDe(v.id)).xmlGenerado as string), forma).toContain(`<formaPago>${codigo}</formaPago>`);
    }
  });

  it("los secuenciales son consecutivos y solo los consumen las ventas que se facturan", async () => {
    const antes = await secuencialFactura();
    await vender([{ productoId: p15.id, cantidad: 1 }], [{ formaPago: "EFECTIVO", monto: 12 }], { clienteId: cliente.id });
    await vender([{ productoId: p15.id, cantidad: 1 }], [{ formaPago: "EFECTIVO", monto: 12 }], { clienteId: cliente.id, emitirFactura: false });
    await vender([{ productoId: p15.id, cantidad: 1 }], [{ formaPago: "EFECTIVO", monto: 12 }], { clienteId: cliente.id });
    expect(await secuencialFactura()).toBe(antes + 2);
    const ultimos = await env.prisma.comprobanteElectronico.findMany({ where: { tipoComprobante: "01" }, orderBy: { secuencial: "asc" } });
    expect(ultimos.map((c) => Number(c.secuencial))).toEqual(Array.from({ length: ultimos.length }, (_, i) => i + 1));
    expect(await verificarInvariantes(env)).toEqual([]);
  });

  it("texto con saltos de línea, comillas y caracteres especiales sigue siendo XML válido", async () => {
    const raro = await crearProducto(env, { codigo: "RARO&<1>", precioVenta: 5, stock: 50 });
    await env.prisma.producto.update({ where: { id: raro.id }, data: { nombre: 'Café "Premium"\n& <Especial> 250g' } });
    const c = await env.servicios.clientes.crear({ tipoIdentificacion: "05", identificacion: "0926687856", razonSocial: "María\nJosé & Hijos", direccion: "Calle\n1 y 2" });
    const v = await vender([{ productoId: raro.id, cantidad: 1 }], [{ formaPago: "EFECTIVO", monto: 6 }], { clienteId: c.id });
    const xml = (await comprobanteDe(v.id)).xmlGenerado as string;
    expect((await xsd.validar("factura", xml)).errores).toEqual([]);
    expect(xml).toContain("<razonSocialComprador>María José &amp; Hijos</razonSocialComprador>");
    expect(xml).toContain("<codigoPrincipal>RARO&amp;&lt;1&gt;</codigoPrincipal>");
  });

  it("ambiente de producción (código 2) y datos tributarios especiales del emisor", async () => {
    await env.prisma.empresa.update({
      where: { id: env.seed.empresaId },
      data: { ambienteSRI: "PRODUCCION", regimenTributario: "RIMPE_EMPRENDEDOR", contribuyenteEspecial: "5368", agenteRetencion: true, resolucionAgente: "NAC-DGERCGC19-00000001", obligadoContabilidad: true },
    });
    try {
      const v = await vender([{ productoId: p15.id, cantidad: 1 }], [{ formaPago: "EFECTIVO", monto: 12 }], { clienteId: cliente.id });
      const c = await comprobanteDe(v.id);
      expect(c.ambiente).toBe("2");
      expect(parsearClaveAcceso(c.claveAcceso).ambiente).toBe("2");
      const xml = c.xmlGenerado as string;
      expect((await xsd.validar("factura", xml)).errores).toEqual([]);
      expect(xml).toContain("<ambiente>2</ambiente>");
      expect(xml).toContain("<contribuyenteRimpe>CONTRIBUYENTE RÉGIMEN RIMPE</contribuyenteRimpe>");
      expect(xml).toContain("<contribuyenteEspecial>5368</contribuyenteEspecial><obligadoContabilidad>SI</obligadoContabilidad>");
      expect(dato(xml, "agenteRetencion")).toBe("19000000"); // solo dígitos y máximo 8
    } finally {
      await env.prisma.empresa.update({
        where: { id: env.seed.empresaId },
        data: { ambienteSRI: "PRUEBAS", regimenTributario: "GENERAL", contribuyenteEspecial: null, agenteRetencion: false, resolucionAgente: null, obligadoContabilidad: false },
      });
    }
  });

  it("líneas anteriores al registro del código SRI se deducen del porcentaje", async () => {
    const v = await vender([{ productoId: p15.id, cantidad: 1 }, { productoId: p5.id, cantidad: 1 }], [{ formaPago: "EFECTIVO", monto: 20 }], { clienteId: cliente.id, emitirFactura: false });
    await env.prisma.lineaVenta.updateMany({ where: { ventaId: v.id }, data: { codigoIvaSRI: "" } });
    const r = await env.servicios.comprobantes.emitirFactura(v.id, {}, supervisor);
    const xml = r.comprobante.xmlGenerado as string;
    expect((await xsd.validar("factura", xml)).errores).toEqual([]);
    expect(xml).toContain("<codigoPorcentaje>4</codigoPorcentaje>");
    expect(xml).toContain("<codigoPorcentaje>5</codigoPorcentaje>");
  });
});

describe("La venta nunca se pierde si la factura no puede generarse", () => {
  const sinRastro = async (ventaId: string, secuencialAntes: number): Promise<void> => {
    expect(await env.prisma.comprobanteElectronico.count({ where: { ventaId } })).toBe(0);
    expect(await secuencialFactura()).toBe(secuencialAntes);
    expect((await env.prisma.venta.findUniqueOrThrow({ where: { id: ventaId } })).estado).toBe("COMPLETADA");
  };

  it("Consumidor Final por más de USD 50: venta registrada, advertencia y sin factura", async () => {
    const antes = await secuencialFactura();
    const stock = await stockDe(p15.id);
    const v = await vender([{ productoId: p15.id, cantidad: 5 }], [{ formaPago: "EFECTIVO", monto: 60 }]); // 57.50 > 50, sin cliente
    expect(v.advertencias).toHaveLength(1);
    expect(v.advertencias[0]).toMatch(/Consumidor Final.*50/);
    expect(v.comprobante).toBeNull();
    await sinRastro(v.id, antes);
    expect(await stockDe(p15.id)).toBe(stock - 5); // la venta y su inventario sí quedaron
  });

  it("Consumidor Final hasta USD 50 sí se factura (07 / 9999999999999)", async () => {
    const v = await vender([{ productoId: p15.id, cantidad: 4 }], [{ formaPago: "EFECTIVO", monto: 46 }]); // 46.00
    expect(v.advertencias).toEqual([]);
    const xml = (await comprobanteDe(v.id)).xmlGenerado as string;
    expect((await xsd.validar("factura", xml)).errores).toEqual([]);
    expect(dato(xml, "tipoIdentificacionComprador")).toBe("07");
    expect(dato(xml, "identificacionComprador")).toBe("9999999999999");
    expect(dato(xml, "razonSocialComprador")).toBe("CONSUMIDOR FINAL");
  });

  it("después se puede facturar asignando el comprador, y repetir la llamada no crea otra factura", async () => {
    const v = await vender([{ productoId: p15.id, cantidad: 5 }], [{ formaPago: "EFECTIVO", monto: 60 }]);
    expect(v.comprobante).toBeNull();
    const antes = await secuencialFactura();

    expect(await codigoError(env.servicios.comprobantes.emitirFactura(v.id, {}, supervisor))).toBe("VALIDACION"); // sigue siendo CF > 50
    expect(await secuencialFactura()).toBe(antes);

    const r1 = await env.servicios.comprobantes.emitirFactura(v.id, { clienteId: cliente.id }, supervisor);
    expect(r1.creado).toBe(true);
    expect(dato(r1.comprobante.xmlGenerado as string, "identificacionComprador")).toBe("1710034065");
    expect((await env.prisma.venta.findUniqueOrThrow({ where: { id: v.id } })).clienteId).toBe(cliente.id);

    const r2 = await env.servicios.comprobantes.emitirFactura(v.id, {}, supervisor);
    expect(r2.creado).toBe(false);
    expect(r2.comprobante.id).toBe(r1.comprobante.id);
    expect(await secuencialFactura()).toBe(antes + 1);
  });

  it("propina superior al 10 % del subtotal, módulo de facturación apagado, RUC inválido y venta anulada", async () => {
    const antes = await secuencialFactura();
    const alta = await vender([{ productoId: p15.id, cantidad: 2 }], [{ formaPago: "EFECTIVO", monto: 30 }], { clienteId: cliente.id, propina: 2.5 }); // > 2.00
    expect(alta.advertencias[0]).toMatch(/propina.*10 %/);
    await sinRastro(alta.id, antes);
    const limite = await vender([{ productoId: p15.id, cantidad: 2 }], [{ formaPago: "EFECTIVO", monto: 30 }], { clienteId: cliente.id, propina: 2 }); // = 10 %
    expect(limite.advertencias).toEqual([]);

    await configurarGiro(env, { emitirFacturas: false });
    try {
      const v = await vender([{ productoId: p15.id, cantidad: 1 }], [{ formaPago: "EFECTIVO", monto: 12 }], { clienteId: cliente.id });
      expect(v.advertencias[0]).toMatch(/no está habilitado/);
      expect(v.comprobante).toBeNull();
    } finally {
      await configurarGiro(env, { emitirFacturas: true });
    }

    const ruc = (await env.prisma.empresa.findUniqueOrThrow({ where: { id: env.seed.empresaId } })).ruc;
    await env.prisma.empresa.update({ where: { id: env.seed.empresaId }, data: { ruc: "1790012345002" } });
    try {
      const v = await vender([{ productoId: p15.id, cantidad: 1 }], [{ formaPago: "EFECTIVO", monto: 12 }], { clienteId: cliente.id });
      expect(v.advertencias[0]).toMatch(/RUC inválido/);
      expect(v.comprobante).toBeNull();
    } finally {
      await env.prisma.empresa.update({ where: { id: env.seed.empresaId }, data: { ruc } });
    }

    const anulada = await vender([{ productoId: p15.id, cantidad: 1 }], [{ formaPago: "EFECTIVO", monto: 12 }], { clienteId: cliente.id, emitirFactura: false });
    await env.servicios.ventas.anular(anulada.id, { motivo: "Error de digitación" }, supervisor);
    expect(await codigoError(env.servicios.comprobantes.emitirFactura(anulada.id, {}, supervisor))).toBe("ESTADO_INVALIDO");
    expect(await codigoError(env.servicios.comprobantes.emitirFactura("no-existe", {}, supervisor))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.comprobantes.emitirFactura(anulada.id, { clienteId: "11111111-1111-4111-8111-111111111111" }, supervisor))).toBe("NO_ENCONTRADO");
    expect(await verificarInvariantes(env)).toEqual([]);
  });
});

describe("Anulación de ventas facturadas", () => {
  const facturar = async (extra: Record<string, unknown> = {}) => {
    const v = await vender([{ productoId: p15.id, cantidad: 2 }, { productoId: p0.id, cantidad: 1 }], [{ formaPago: "EFECTIVO", monto: 30 }], { clienteId: cliente.id, ...extra });
    return { venta: v, factura: await comprobanteDe(v.id) };
  };

  it("factura PENDIENTE: se anula localmente, sale de la cola y la venta se anula", async () => {
    const stock = await stockDe(p15.id);
    const { venta, factura } = await facturar();
    expect(await stockDe(p15.id)).toBe(stock - 2);
    await env.servicios.ventas.anular(venta.id, { motivo: "Cliente se arrepintió" }, supervisor);
    const despues = await comprobanteDe(venta.id);
    expect(despues).toMatchObject({ id: factura.id, estado: "ANULADO", colaSRI: null });
    expect(await stockDe(p15.id)).toBe(stock);
    expect(await env.prisma.comprobanteElectronico.count({ where: { tipoComprobante: "04" } })).toBe(0); // no hace falta nota de crédito
  });

  it("factura RECHAZADA o DEVUELTA también se anula localmente", async () => {
    for (const estado of ["RECHAZADO", "DEVUELTO"]) {
      const { venta, factura } = await facturar();
      await env.prisma.comprobanteElectronico.update({ where: { id: factura.id }, data: { estado } });
      await env.servicios.ventas.anular(venta.id, { motivo: `Rechazada por el SRI (${estado})` }, supervisor);
      expect((await comprobanteDe(venta.id)).estado).toBe("ANULADO");
    }
  });

  it("factura EN_PROCESO: no se anula hasta conocer la respuesta del SRI (nada cambia)", async () => {
    const { venta, factura } = await facturar();
    await env.prisma.comprobanteElectronico.update({ where: { id: factura.id }, data: { estado: "EN_PROCESO" } });
    const stock = await stockDe(p15.id);
    expect(await codigoError(env.servicios.ventas.anular(venta.id, { motivo: "Intento prematuro" }, supervisor))).toBe("ESTADO_INVALIDO");
    expect((await env.prisma.venta.findUniqueOrThrow({ where: { id: venta.id } })).estado).toBe("COMPLETADA");
    expect((await comprobanteDe(venta.id)).estado).toBe("EN_PROCESO");
    expect(await stockDe(p15.id)).toBe(stock);
  });

  it("factura AUTORIZADA: la anulación emite una nota de crédito por el total, válida contra el XSD", async () => {
    // La factura se emite en producción; al anular, la empresa ya volvió a "pruebas": la nota de crédito debe seguir al documento que modifica
    await env.prisma.empresa.update({ where: { id: env.seed.empresaId }, data: { ambienteSRI: "PRODUCCION" } });
    const { venta, factura } = await facturar();
    await env.prisma.empresa.update({ where: { id: env.seed.empresaId }, data: { ambienteSRI: "PRUEBAS" } });
    expect(factura.ambiente).toBe("2");
    await env.prisma.comprobanteElectronico.update({
      where: { id: factura.id },
      data: { estado: "AUTORIZADO", numeroAutorizacion: factura.claveAcceso, fechaAutorizacion: new Date() },
    });
    const stock = await stockDe(p15.id);

    await env.servicios.ventas.anular(venta.id, { motivo: "Devolución de la mercadería" }, supervisor);
    expect((await env.prisma.venta.findUniqueOrThrow({ where: { id: venta.id } })).estado).toBe("ANULADA");
    expect(await stockDe(p15.id)).toBe(stock + 2);

    const nc = await env.prisma.comprobanteElectronico.findFirstOrThrow({ where: { comprobanteOrigenId: factura.id }, include: { colaSRI: true } });
    expect(nc).toMatchObject({
      tipoComprobante: "04", estado: "PENDIENTE", ventaId: null, motivo: "Devolución de la mercadería",
      ambiente: "2", // hereda el ambiente de la factura que modifica
    });
    expect(nc.colaSRI).toMatchObject({ prioridad: 5 });
    expect(validarClaveAcceso(nc.claveAcceso)).toBe(true);
    expect(parsearClaveAcceso(nc.claveAcceso)).toMatchObject({ tipoComprobante: "04", ambiente: "2" });

    const xml = nc.xmlGenerado as string;
    expect((await xsd.validar("notaCredito", xml)).errores).toEqual([]);
    expect(dato(xml, "codDocModificado")).toBe("01");
    expect(dato(xml, "numDocModificado")).toBe(`${factura.serie}-${factura.secuencial}`);
    expect(dato(xml, "valorModificacion")).toBe(venta.total.toFixed(2));
    expect(dato(xml, "totalSinImpuestos")).toBe(venta.subtotal.toFixed(2));
    expect(dato(xml, "identificacionComprador")).toBe("1710034065");
    expect(xml).toContain("<motivo>Devolución de la mercadería</motivo>");
    // la factura autorizada se conserva tal cual
    expect((await comprobanteDe(venta.id)).estado).toBe("AUTORIZADO");
    expect(await verificarInvariantes(env)).toEqual([]);
  });

  it("las notas de crédito llevan su propia numeración, independiente de la de facturas", async () => {
    const creadas = [];
    for (let i = 0; i < 2; i++) {
      const { venta, factura } = await facturar();
      await env.prisma.comprobanteElectronico.update({ where: { id: factura.id }, data: { estado: "AUTORIZADO" } });
      await env.servicios.ventas.anular(venta.id, { motivo: `Devolución número ${i}` }, supervisor);
      creadas.push(await env.prisma.comprobanteElectronico.findFirstOrThrow({ where: { comprobanteOrigenId: factura.id } }));
    }
    const secuencias = (await env.prisma.comprobanteElectronico.findMany({ where: { tipoComprobante: "04" }, orderBy: { secuencial: "asc" } })).map((c) => Number(c.secuencial));
    expect(secuencias.length).toBeGreaterThanOrEqual(3);
    expect(secuencias).toEqual(secuencias.map((_, i) => i + 1));
    expect(creadas[1]?.secuencial).not.toBe(creadas[0]?.secuencial);
  });

  it("factura AUTORIZADA a Consumidor Final: no puede anularse automáticamente (la nota de crédito exige identificar)", async () => {
    const v = await vender([{ productoId: p15.id, cantidad: 1 }], [{ formaPago: "EFECTIVO", monto: 12 }]); // sin cliente → CF
    const factura = await comprobanteDe(v.id);
    await env.prisma.comprobanteElectronico.update({ where: { id: factura.id }, data: { estado: "AUTORIZADO" } });
    const stock = await stockDe(p15.id);
    const ncAntes = await env.prisma.comprobanteElectronico.count({ where: { tipoComprobante: "04" } });

    expect(await codigoError(env.servicios.ventas.anular(v.id, { motivo: "Devolución del cliente" }, supervisor))).toBe("ESTADO_INVALIDO");
    expect((await env.prisma.venta.findUniqueOrThrow({ where: { id: v.id } })).estado).toBe("COMPLETADA");
    expect(await stockDe(p15.id)).toBe(stock);
    expect(await env.prisma.comprobanteElectronico.count({ where: { tipoComprobante: "04" } })).toBe(ncAntes);
  });

  it("anular dos veces la misma venta autorizada no duplica la nota de crédito", async () => {
    const { venta, factura } = await facturar();
    await env.prisma.comprobanteElectronico.update({ where: { id: factura.id }, data: { estado: "AUTORIZADO" } });
    await env.servicios.ventas.anular(venta.id, { motivo: "Primera anulación" }, supervisor);
    expect(await codigoError(env.servicios.ventas.anular(venta.id, { motivo: "Segunda anulación" }, supervisor))).toBe("ESTADO_INVALIDO");
    expect(await env.prisma.comprobanteElectronico.count({ where: { comprobanteOrigenId: factura.id } })).toBe(1);
  });

  it("al terminar, el negocio es consistente (claves, secuenciales, facturas y notas de crédito)", async () => {
    expect(await verificarInvariantes(env)).toEqual([]);
  });
});

describe("Cobro de comandas con factura", () => {
  it("cobrar una cuenta con emitirFactura genera la factura de esa venta", async () => {
    await configurarGiro(env, { moduloMesas: true, moduloComandasCocina: true });
    const admin = await crearActor(env, "ADMIN", "sri.admin");
    const mesero = await crearActor(env, "MESERO", "sri.mesero");
    const mesa = await env.servicios.mesas.crear({ sucursalId: env.seed.sucursalId, numero: 1, nombre: "Mesa 1" }, admin);
    const c = await env.servicios.comandas.abrir({ mesaId: mesa.id }, mesero);
    await env.servicios.comandas.agregarItems(c.id, { items: [{ productoId: p15.id, cantidad: 2 }, { productoId: p5.id, cantidad: 1 }] }, mesero);
    const r = await env.servicios.comandas.cobrar(
      c.id,
      { puntoEmisionId: env.seed.puntoEmisionId, emitirFactura: true, clienteId: cliente.id, propina: 1, pagos: [{ formaPago: "EFECTIVO", monto: 40 }] },
      cajero
    );
    expect(r.cerrada).toBe(true);
    expect(r.venta.comprobante).toMatchObject({ estado: "PENDIENTE" });
    const xml = (await comprobanteDe(r.venta.id)).xmlGenerado as string;
    expect((await xsd.validar("factura", xml)).errores).toEqual([]);
    expect(dato(xml, "propina")).toBe("1.00");
    expect(await verificarInvariantes(env)).toEqual([]);
  });
});

describe("API de comprobantes", () => {
  const tokens: Record<string, string> = {};
  const api = (method: "GET" | "POST", url: string, quien?: string, payload?: unknown) =>
    env.backend.server.inject({
      method, url,
      ...(quien !== undefined ? { headers: { authorization: `Bearer ${tokens[quien]}` } } : {}),
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });

  beforeAll(async () => {
    const login = async (username: string, password: string): Promise<void> => {
      const r = await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
      tokens[username] = (r.json() as { token: string }).token;
    };
    await login("admin", PASSWORD_ADMIN);
    for (const [rol, username] of [["SUPERVISOR", "api.super"], ["CAJERO", "api.caja"], ["CONTADOR", "api.conta"]] as const) {
      await env.servicios.usuarios.crear({ empresaId: env.seed.empresaId, rol, username, password: "Clave12345", nombre: username, apellido: "Api" });
      await login(username, "Clave12345");
    }
    const id = (await env.prisma.usuario.findUniqueOrThrow({ where: { username: "api.caja" } })).id;
    await abrirTurno(env, id);
  });

  it("POST /ventas con emitirFactura devuelve la venta con su comprobante y las advertencias", async () => {
    const r = await api("POST", "/api/ventas", "api.caja", {
      puntoEmisionId: env.seed.puntoEmisionId, clienteId: cliente.id, emitirFactura: true,
      lineas: [{ productoId: p15.id, cantidad: 1 }], pagos: [{ formaPago: "EFECTIVO", monto: 12 }],
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ advertencias: [], comprobante: { estado: "PENDIENTE" } });

    const sinCliente = await api("POST", "/api/ventas", "api.caja", {
      puntoEmisionId: env.seed.puntoEmisionId, emitirFactura: true,
      lineas: [{ productoId: p15.id, cantidad: 6 }], pagos: [{ formaPago: "EFECTIVO", monto: 70 }],
    });
    expect(sinCliente.statusCode).toBe(201);
    const cuerpo = sinCliente.json() as { advertencias: string[]; comprobante: unknown };
    expect(cuerpo.comprobante).toBeNull();
    expect(cuerpo.advertencias[0]).toMatch(/Consumidor Final/);
  });

  it("GET /ventas/:id/ride: quien cobró guarda el PDF de la factura aunque no tenga permiso del monitor del SRI; sin factura 404", async () => {
    const venta = async (emitirFactura: boolean): Promise<string> => {
      const r = await api("POST", "/api/ventas", "api.caja", {
        puntoEmisionId: env.seed.puntoEmisionId, clienteId: cliente.id, emitirFactura,
        lineas: [{ productoId: p15.id, cantidad: 1 }], pagos: [{ formaPago: "EFECTIVO", monto: 12 }],
      });
      expect(r.statusCode).toBe(201);
      return (r.json() as { id: string }).id;
    };
    const conFactura = await venta(true);
    expect((await api("GET", "/api/comprobantes", "api.caja")).statusCode).toBe(403); // el monitor sigue vedado al cajero
    const pdf = await api("GET", `/api/ventas/${conFactura}/ride`, "api.caja");
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.headers["content-disposition"]).toMatch(/^attachment; filename="factura-\d{3}-\d{3}-\d{9}\.pdf"$/);
    expect(pdf.headers["x-comprobante-autorizado"]).toBe("NO"); // aún pendiente: el PDF lo marca «sin valor tributario»
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe("%PDF");
    expect((await api("GET", `/api/ventas/${conFactura}/ride`, "api.conta")).statusCode).toBe(200);

    const sinFactura = await venta(false);
    const r404 = await api("GET", `/api/ventas/${sinFactura}/ride`, "api.caja");
    expect(r404.statusCode).toBe(404);
    expect((r404.json() as { mensaje: string }).mensaje).toMatch(/no tiene factura electrónica/);
    expect((await api("GET", "/api/ventas/no-existe/ride", "api.caja")).statusCode).toBe(404);
    expect((await api("GET", `/api/ventas/${conFactura}/ride`)).statusCode).toBe(401);
  });

  it("GET /comprobantes: contador y supervisor lo ven (sin XML), el cajero no; filtros y paginación", async () => {
    expect((await api("GET", "/api/comprobantes", "api.caja")).statusCode).toBe(403);
    expect((await api("GET", "/api/comprobantes")).statusCode).toBe(401);
    const r = await api("GET", "/api/comprobantes?tipoComprobante=01&pageSize=5", "api.conta");
    expect(r.statusCode).toBe(200);
    const lista = r.json() as { total: number; items: Array<Record<string, unknown>> };
    expect(lista.total).toBeGreaterThan(5);
    expect(lista.items).toHaveLength(5);
    expect(lista.items[0]).not.toHaveProperty("xmlGenerado");
    expect(lista.items[0]).toMatchObject({ tipoComprobante: "01", estado: expect.any(String), colaSRI: expect.anything() });
    const nc = (await api("GET", "/api/comprobantes?tipoComprobante=04", "api.super")).json() as { items: Array<{ origen: { id: string } | null }> };
    expect(nc.items.length).toBeGreaterThan(0);
    expect(nc.items.every((i) => i.origen !== null)).toBe(true);
    expect((await api("GET", "/api/comprobantes?estado=XX", "api.conta")).statusCode).toBe(400);
    expect((await api("GET", "/api/comprobantes?tipoComprobante=99", "api.conta")).statusCode).toBe(400);
  });

  it("GET /comprobantes/:id trae el XML generado; 404 si no existe", async () => {
    const c = await env.prisma.comprobanteElectronico.findFirstOrThrow({ where: { tipoComprobante: "01" } });
    const r = await api("GET", `/api/comprobantes/${c.id}`, "api.conta");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id: c.id, claveAcceso: c.claveAcceso });
    expect((r.json() as { xmlGenerado: string }).xmlGenerado).toContain("<factura id=\"comprobante\" version=\"2.1.0\">");
    expect((await api("GET", "/api/comprobantes/no-existe", "api.conta")).statusCode).toBe(404);
  });

  it("POST /ventas/:id/comprobante: 201 al generar, 200 si ya existía, 400 si no cumple; solo con sri:crear", async () => {
    const v = await vender([{ productoId: p15.id, cantidad: 1 }], [{ formaPago: "EFECTIVO", monto: 12 }], { clienteId: cliente.id, emitirFactura: false });
    expect((await api("POST", `/api/ventas/${v.id}/comprobante`, "api.caja", {})).statusCode).toBe(403);
    expect((await api("POST", `/api/ventas/${v.id}/comprobante`, "api.conta", {})).statusCode).toBe(403);

    const primera = await api("POST", `/api/ventas/${v.id}/comprobante`, "api.super", {});
    expect(primera.statusCode).toBe(201);
    expect(primera.json()).toMatchObject({ creado: true, comprobante: { estado: "PENDIENTE", tipoComprobante: "01" } });
    const segunda = await api("POST", `/api/ventas/${v.id}/comprobante`, "api.super", {});
    expect(segunda.statusCode).toBe(200);
    expect(segunda.json()).toMatchObject({ creado: false });

    const grande = await vender([{ productoId: p15.id, cantidad: 6 }], [{ formaPago: "EFECTIVO", monto: 70 }], { emitirFactura: false });
    const rechazo = await api("POST", `/api/ventas/${grande.id}/comprobante`, "api.super", {});
    expect(rechazo.statusCode).toBe(400);
    expect(rechazo.json()).toMatchObject({ error: "VALIDACION" });
    expect((await api("POST", `/api/ventas/${grande.id}/comprobante`, "api.super", { clienteId: "x" })).statusCode).toBe(400);
    expect((await api("POST", "/api/ventas/no-existe/comprobante", "api.super", {})).statusCode).toBe(404);
  });
});

describe("Meta-prueba: los invariantes detectan comprobantes corruptos", () => {
  it("clave de acceso alterada, hueco de secuencial y factura de venta anulada sin nota de crédito", async () => {
    const c = await env.prisma.comprobanteElectronico.findFirstOrThrow({ where: { tipoComprobante: "01", estado: "PENDIENTE" } });
    expect(await verificarInvariantes(env)).toEqual([]);

    const alterada = c.claveAcceso.slice(0, 40) + String((Number(c.claveAcceso[40]) + 1) % 10) + c.claveAcceso.slice(41);
    await env.prisma.comprobanteElectronico.update({ where: { id: c.id }, data: { claveAcceso: alterada } });
    expect((await verificarInvariantes(env)).some((x) => x.startsWith("[comprobante]") && x.includes("clave de acceso inválida"))).toBe(true);
    await env.prisma.comprobanteElectronico.update({ where: { id: c.id }, data: { claveAcceso: c.claveAcceso } });

    await env.prisma.secuencialComprobante.updateMany({ where: { tipoComprobante: "01" }, data: { ultimo: { increment: 1 } } });
    expect((await verificarInvariantes(env)).some((x) => x.startsWith("[comprobante]") && x.includes("contador"))).toBe(true);
    await env.prisma.secuencialComprobante.updateMany({ where: { tipoComprobante: "01" }, data: { ultimo: { decrement: 1 } } });

    await env.prisma.venta.update({ where: { id: c.ventaId as string }, data: { estado: "ANULADA" } });
    expect((await verificarInvariantes(env)).some((x) => x.includes("la venta está anulada pero la factura sigue"))).toBe(true);
    await env.prisma.venta.update({ where: { id: c.ventaId as string }, data: { estado: "COMPLETADA" } });
    expect((await verificarInvariantes(env)).filter((x) => x.startsWith("[comprobante]"))).toEqual([]);
  });
});
