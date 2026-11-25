// ============================================================
// tests/integration/renderer/gestion-backend.test.ts
// El cliente de las vistas de gestión (renderer) contra el backend REAL: los datos que envían los formularios son los que el
// servidor acepta y las respuestas tienen la forma que las pantallas esperan (inventario, clientes, compras, caja, reportes, SRI).
// ============================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiCliente } from "../../../src/renderer/services/api";
import { GestionApi } from "../../../src/renderer/services/gestion.api";
import { PosApi } from "../../../src/renderer/services/pos.api";
import { crearEntorno, PASSWORD_ADMIN, type Entorno } from "../helpers/entorno.helper";

let env: Entorno;
let g: GestionApi;
let pos: PosApi;
let token: string | null = null;
let turnoId = "";

beforeAll(async () => {
  env = await crearEntorno();
  const http = new ApiCliente({ baseUrl: env.backend.url, cajaId: "caja-gestion", obtenerToken: () => token });
  g = new GestionApi(http);
  pos = new PosApi(http);
  token = (await pos.login("admin", PASSWORD_ADMIN)).token;
  turnoId = (await pos.abrirTurno(env.seed.sucursalId, 100)).id;
}, 60_000);

afterAll(async () => {
  await env.cerrar();
});

describe("Inventario", () => {
  it("catálogos, alta y edición de producto (con la carga útil del formulario), ajuste y kardex", async () => {
    const cat = await g.catalogos();
    const categoriaId = cat.categorias[0]?.id as string;
    const unidadMedidaId = (cat.unidades.find((u) => u.codigo === "UN") as { id: string }).id;
    const creado = await g.guardarProducto(null, { codigo: "GV1", codigoBarras: null, nombre: "Producto de gestión", tipo: "BIEN", categoriaId, unidadMedidaId, precioCompra: 4, precioVenta: 10, stockMinimo: 5, aplicaIva: true, codigoIvaSRI: "4", requiereLote: false, tieneVencimiento: false });
    expect(creado).toMatchObject({ codigo: "GV1", precioVenta: 10, stockMinimo: 5 });

    const editado = await g.guardarProducto(creado.id, { codigo: "GV1", codigoBarras: null, nombre: "Producto editado", tipo: "BIEN", categoriaId, unidadMedidaId, precioCompra: 4, precioVenta: 12, stockMinimo: 5, aplicaIva: false, codigoIvaSRI: "0", requiereLote: false, tieneVencimiento: false });
    expect(editado).toMatchObject({ nombre: "Producto editado", precioVenta: 12, aplicaIva: false });

    await g.ajustar({ productoId: creado.id, tipo: "ENTRADA", cantidad: 3, costoUnitario: 4, motivo: "Conteo inicial" });
    const lista = await g.productos("GV1");
    expect(lista.items[0]).toMatchObject({ codigo: "GV1", stockActual: 3, stockMinimo: 5, precioCompra: 4, unidadMedida: { codigo: "UN" } });
    const k = await g.kardex(creado.id);
    expect(k.producto).toMatchObject({ stockActual: 3 });
    expect(k.items[0]).toMatchObject({ tipoMovimiento: "AJUSTE_ENTRADA", cantidad: 3, stockResultante: 3, observacion: expect.stringContaining("Conteo inicial") });
    expect((await g.alertasStock()).items.map((a) => a.codigo)).toContain("GV1"); // 3 < mínimo 5
    // Sin el módulo de vencimientos del giro la API lo dice con su código: la pantalla lo muestra como aviso, no como fallo
    await expect(g.alertasVencimiento(30)).rejects.toMatchObject({ codigo: "MODULO_DESHABILITADO" });
    await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { moduloVencimientos: true } });
    expect(await g.alertasVencimiento(30)).toMatchObject({ dias: 30, vencidos: [], porVencer: [] });
    await expect(g.ajustar({ productoId: creado.id, tipo: "SALIDA", cantidad: 1, motivo: "x" })).rejects.toMatchObject({ codigo: "VALIDACION" });
  });
});

describe("Clientes y proveedores", () => {
  it("alta y edición de cliente con los datos del formulario; cuentas por cobrar y abono", async () => {
    const c = await g.guardarCliente(null, { tipoIdentificacion: "05", identificacion: "0926687856", razonSocial: "María Zambrano", limiteCredito: 200, diasCredito: 15, descuentoHabitual: 0, email: null, telefono: "0988888888", direccion: null });
    expect(c).toMatchObject({ razonSocial: "María Zambrano" });
    await expect(g.guardarCliente(null, { tipoIdentificacion: "05", identificacion: "1234567890", razonSocial: "X Y", limiteCredito: 0, diasCredito: 0, descuentoHabitual: 0, email: null, telefono: null, direccion: null })).rejects.toMatchObject({ codigo: "VALIDACION", message: expect.stringContaining("Cédula") });
    expect(await g.guardarCliente(c.id, { tipoIdentificacion: "05", identificacion: "0926687856", razonSocial: "María Zambrano", limiteCredito: 300, diasCredito: 15, descuentoHabitual: 0, email: "maria@correo.ec", telefono: "0988888888", direccion: "Calle 1" })).toMatchObject({ limiteCredito: 300 });
    expect((await g.clientes("zambrano")).items).toHaveLength(1);

    // venta a crédito → cuenta por cobrar → abono
    const producto = (await g.productos("GV1")).items[0] as { id: string };
    await env.servicios.kardex.registrarEntrada(env.prisma, { productoId: producto.id, cantidad: 50, costoUnitario: 4, tipoMovimiento: "COMPRA", observacion: "stock" });
    await pos.crearVenta({ puntoEmisionId: env.seed.puntoEmisionId, clienteId: c.id, lineas: [{ productoId: producto.id, cantidad: 2, descuento: 0, tipoDescuento: "VALOR" }], pagos: [{ formaPago: "CREDITO", monto: 24 }], propina: 0, emitirFactura: false });
    const cuentas = await g.cuentasPorCobrar();
    expect(cuentas.items[0]).toMatchObject({ saldo: 24, estado: "PENDIENTE", cliente: { razonSocial: "María Zambrano" } });
    expect(cuentas.items[0]?.venta.numero).toMatch(/^001-001-/);
    await g.abonar(cuentas.items[0]?.id as string, { monto: 10, formaPago: "EFECTIVO" });
    expect((await g.cuentasPorCobrar()).items[0]).toMatchObject({ saldo: 14, estado: "PARCIAL" });
    expect((await g.cuentasPorCobrar(1, true)).items).toHaveLength(0); // aún no vence
  });

  it("proveedores, compra con la carga útil del formulario, cuentas por pagar y pago", async () => {
    const p = await g.guardarProveedor(null, { ruc: "1790012345001", razonSocial: "Distribuidora Andina", email: null, telefono: "022345678", diasPago: 30 });
    expect(p).toMatchObject({ ruc: "1790012345001", diasPago: 30, status: "ACTIVO" });
    await expect(g.guardarProveedor(null, { ruc: "1790012345001", razonSocial: "Otra", email: null, telefono: null, diasPago: 30 })).rejects.toMatchObject({ codigo: "DUPLICADO" });
    expect(await g.guardarProveedor(p.id, { ruc: "1790012345001", razonSocial: "Distribuidora Andina", email: null, telefono: "022345678", diasPago: 45, status: "ACTIVO" })).toMatchObject({ diasPago: 45 });

    const producto = (await g.productos("GV1")).items[0] as { id: string };
    const compra = await g.crearCompra({ proveedorId: p.id, sucursalId: env.seed.sucursalId, numeroFactura: "001-001-000000800", tipoDocumento: "FACTURA", formaPago: "CREDITO", diasCredito: 45, autorizacion: "0805202401099234567800110010020000001231234567811", lineas: [{ productoId: producto.id, cantidad: 10, costoUnitario: 4.5 }] });
    expect(compra).toMatchObject({ numeroFactura: "001-001-000000800" });
    expect((await g.compras("Andina")).items[0]).toMatchObject({ numeroFactura: "001-001-000000800", proveedor: "Distribuidora Andina", formaPago: "CREDITO" });
    const cuentas = await g.cuentasPorPagar();
    expect(cuentas.items[0]).toMatchObject({ proveedor: { razonSocial: "Distribuidora Andina" }, compra: { numeroFactura: "001-001-000000800" } });
    const saldo = cuentas.items[0]?.saldo as number;
    await g.pagar(cuentas.items[0]?.id as string, { monto: saldo, formaPago: "TRANSFERENCIA", referencia: "TRX-1" });
    expect((await g.cuentasPorPagar()).items[0]).toMatchObject({ saldo: 0, estado: "PAGADA" });
  });
});

describe("Caja", () => {
  it("reporte con cierre «ciego» para quien no es supervisor, movimientos, ventas del turno, anulación y cierre", async () => {
    const producto = (await g.productos("GV1")).items[0] as { id: string };
    const v = await pos.crearVenta({ puntoEmisionId: env.seed.puntoEmisionId, lineas: [{ productoId: producto.id, cantidad: 1, descuento: 0, tipoDescuento: "VALOR" }], pagos: [{ formaPago: "EFECTIVO", monto: 20 }], propina: 0, emitirFactura: false });
    await g.movimiento(turnoId, { tipo: "EGRESO", concepto: "Pago mensajero", monto: 5 });
    const rep = await g.reporteTurno(turnoId);
    expect(rep.turno).toMatchObject({ estado: "ABIERTO", montoApertura: 100 });
    expect(rep.movimientos).toMatchObject({ egresos: 5 });
    expect(rep.porFormaPago.find((f) => f.formaPago === "EFECTIVO")?.neto).toBeGreaterThan(0);

    const ventas = await g.ventas(turnoId);
    expect(ventas.items.find((x) => x.id === v.id)).toMatchObject({ numero: v.numero, estado: "COMPLETADA", cajero: expect.any(String) });
    await g.anularVenta(v.id, "Error de digitación");
    expect((await g.ventas(turnoId)).items.find((x) => x.id === v.id)?.estado).toBe("ANULADA");
    await expect(g.anularVenta(v.id, "otra vez")).rejects.toMatchObject({ codigo: expect.stringMatching(/ESTADO_INVALIDO|VALIDACION/) });

    const cierre = await g.cerrarTurno(turnoId, { efectivoContado: 95, observaciones: "Prueba" });
    expect(cierre.turno.estado).toBe("CERRADO");
    expect(cierre.efectivo).toMatchObject({ contado: 95 });
    expect(typeof cierre.efectivo?.esperado).toBe("number");
    expect(typeof cierre.efectivo?.diferencia).toBe("number");
    await expect(g.cerrarTurno(turnoId, { efectivoContado: 1 })).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
  });
});

describe("Reportes y monitor SRI", () => {
  it("reportes en JSON con la forma que pinta la pantalla, y CSV descargable", async () => {
    const r = await g.reporte("ventas", { agrupar: "producto" });
    expect(r.columnas.map((c) => c.clave)).toEqual(["grupo", "cantidad", "subtotal", "descuento", "iva", "total"]);
    expect(r.filas.length).toBeGreaterThan(0);
    expect(Object.keys(r.totales)).toEqual(expect.arrayContaining(["cantidad", "total"]));
    expect((await g.reporte("stock", {})).filas.some((f) => f["codigo"] === "GV1")).toBe(true);
    expect((await g.reporte("cartera", {})).totales).toMatchObject({ porCobrar: 14 });

    const csv = await g.reporteCsv("ventas", { agrupar: "producto" });
    expect(csv.nombre).toBe("reporte-ventas.csv");
    const texto = Buffer.from(await csv.blob.arrayBuffer()).toString("utf8");
    expect(texto.startsWith("﻿Producto,Cantidad,")).toBe(true);
    await expect(g.reporte("inventado", {})).rejects.toMatchObject({ codigo: "VALIDACION" });
  });

  it("comprobantes: listado con filtros, cola, reintento, RIDE y ATS", async () => {
    const cliente = await g.guardarCliente(null, { tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "Juan Pérez", limiteCredito: 0, diasCredito: 0, descuentoHabitual: 0, email: "j@correo.ec", telefono: null, direccion: null });
    const producto = (await g.productos("GV1")).items[0] as { id: string };
    await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { emitirFacturas: true } });
    const turno2 = await pos.abrirTurno(env.seed.sucursalId, 50);
    expect(turno2.id).not.toBe(turnoId);
    const venta = await pos.crearVenta({ puntoEmisionId: env.seed.puntoEmisionId, clienteId: cliente.id, lineas: [{ productoId: producto.id, cantidad: 1, descuento: 0, tipoDescuento: "VALOR" }], pagos: [{ formaPago: "EFECTIVO", monto: 20 }], propina: 0, emitirFactura: true });
    expect(venta.comprobante?.estado).toBe("PENDIENTE");

    const lista = await g.comprobantes("PENDIENTE", "01");
    const c = lista.items.find((x) => x.id === venta.comprobante?.id);
    expect(c).toMatchObject({ tipoComprobante: "01", estado: "PENDIENTE", serie: "001-001", intentosEnvio: 0 });
    expect((await g.comprobantes("AUTORIZADO", "")).items).toHaveLength(0);
    expect((await g.colaSri()).porEstado["PENDIENTE"]).toBeGreaterThanOrEqual(1);
    expect(await g.reintentar(c?.id as string)).toEqual({ id: c?.id, estado: "PENDIENTE" });

    const ride = await g.ride(c?.id as string);
    expect(ride.nombre).toMatch(/^factura-001-001-\d{9}\.pdf$/);
    expect(Buffer.from(await ride.blob.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    const hoy = new Date(Date.now() - 5 * 3_600_000);
    const ats = await g.ats(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1);
    expect(ats.nombre).toMatch(/^ATS-\d{4}-\d{2}\.xml$/);
    expect(Buffer.from(await ats.blob.arrayBuffer()).toString("utf8")).toContain("<IdInformante>9999999999999".slice(0, 14));
  });
});
