// ============================================================
// tests/integration/server/retail.test.ts
// Módulo Retail/Ferretería: presentaciones, venta fraccionada, listas de precios y política de precio.
// ============================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PresentacionProducto, Producto } from "@prisma/client";
import type { ActorCaja } from "../../../src/server/services/turno.service";
import {
  abrirTurno, codigoError, configurarGiro, crearActor, crearClienteConCredito, crearEntorno, crearProducto, type Entorno,
} from "../helpers/entorno.helper";

let env: Entorno;
let admin: ActorCaja;
let cajero: ActorCaja;
let supervisor: ActorCaja;
let cola: Producto; // unidad UN, precio 1.00
let arroz: Producto; // unidad KG (fraccionable), precio 1.00
let paquete: PresentacionProducto; // x6, precio propio 5.00
let caja: PresentacionProducto; // x24, sin precio propio

beforeAll(async () => {
  env = await crearEntorno();
  admin = await crearActor(env, "ADMIN", "admin.retail");
  cajero = await crearActor(env, "CAJERO", "cajero.retail");
  supervisor = await crearActor(env, "SUPERVISOR", "super.retail");
  await abrirTurno(env, cajero.id);
  await abrirTurno(env, supervisor.id);

  cola = await crearProducto(env, { codigo: "COLA", precioVenta: 1, stock: 1000, costo: 0.5, aplicaIva: false });
  arroz = await crearProducto(env, { codigo: "ARROZ", precioVenta: 1, stock: 100, costo: 0.6, unidad: "KG", aplicaIva: false });
  paquete = await env.servicios.presentaciones.crear(cola.id, { nombre: "Paquete x6", factor: 6, precioVenta: 5, codigoBarras: "7000000000006" });
  caja = await env.servicios.presentaciones.crear(cola.id, { nombre: "Caja x24", factor: 24, codigoBarras: "7000000000024" });
}, 60_000);

afterAll(async () => {
  await env.cerrar();
});

const stockDe = async (id: string): Promise<number> => (await env.prisma.producto.findUniqueOrThrow({ where: { id } })).stockActual;

const vender = (actor: ActorCaja, lineas: unknown[], extra: Record<string, unknown> = {}, monto = 10_000) =>
  env.servicios.ventas.crear(
    { puntoEmisionId: env.seed.puntoEmisionId, lineas, pagos: [{ formaPago: "EFECTIVO", monto }], ...extra },
    actor
  );

describe("Presentaciones", () => {
  it("se listan ordenadas por factor y guardan sus datos", async () => {
    const lista = await env.servicios.presentaciones.listar(cola.id);
    expect(lista.map((p) => p.nombre)).toEqual(["Paquete x6", "Caja x24"]);
    expect(paquete).toMatchObject({ factor: 6, precioVenta: 5, codigoBarras: "7000000000006", status: "ACTIVO" });
    expect(caja.precioVenta).toBeNull();
  });

  it("valida factor, nombre y producto", async () => {
    const crear = (id: string, e: unknown) => env.servicios.presentaciones.crear(id, e);
    expect(await codigoError(crear(cola.id, { nombre: "Mala", factor: 0 }))).toBe("VALIDACION");
    expect(await codigoError(crear(cola.id, { nombre: "", factor: 2 }))).toBe("VALIDACION");
    expect(await codigoError(crear(cola.id, { nombre: "Neg", factor: -1 }))).toBe("VALIDACION");
    expect(await codigoError(crear("11111111-1111-4111-8111-111111111111", { nombre: "X", factor: 2 }))).toBe("NO_ENCONTRADO");
    const servicio = await crearProducto(env, { codigo: "SRV-P", tipo: "SERVICIO" });
    expect(await codigoError(crear(servicio.id, { nombre: "X", factor: 2 }))).toBe("VALIDACION");
  });

  it("rechaza nombre repetido y códigos de barras ya usados (por otra presentación o por un producto)", async () => {
    const crear = (e: unknown) => env.servicios.presentaciones.crear(cola.id, e);
    expect(await codigoError(crear({ nombre: "Paquete x6", factor: 6 }))).toBe("DUPLICADO");
    expect(await codigoError(crear({ nombre: "Otra", factor: 3, codigoBarras: "7000000000006" }))).toBe("DUPLICADO");
    await crearProducto(env, { codigo: "CON-BARRAS", codigoBarras: "7999999999999" });
    expect(await codigoError(crear({ nombre: "Otra2", factor: 3, codigoBarras: "7999999999999" }))).toBe("DUPLICADO");
  });

  it("un producto nuevo no puede reutilizar el código de barras de una presentación", async () => {
    expect(await codigoError(crearProducto(env, { codigo: "DUP-BAR", codigoBarras: "7000000000024" }))).toBe("DUPLICADO");
  });

  it("se actualiza precio, factor y estado; conserva la unicidad", async () => {
    const extra = await env.servicios.presentaciones.crear(cola.id, { nombre: "Display x12", factor: 12 });
    const act = await env.servicios.presentaciones.actualizar(extra.id, { precioVenta: 11, status: "INACTIVO" });
    expect(act).toMatchObject({ precioVenta: 11, status: "INACTIVO", factor: 12 });
    expect(await codigoError(env.servicios.presentaciones.actualizar(extra.id, { nombre: "Caja x24" }))).toBe("DUPLICADO");
    expect(await codigoError(env.servicios.presentaciones.actualizar(extra.id, { codigoBarras: "7000000000006" }))).toBe("DUPLICADO");
    expect(await codigoError(env.servicios.presentaciones.actualizar("no-existe", { factor: 2 }))).toBe("NO_ENCONTRADO");
    // mantener su propio nombre/código no cuenta como duplicado
    await env.servicios.presentaciones.actualizar(paquete.id, { nombre: "Paquete x6", codigoBarras: "7000000000006" });
  });

  it("la búsqueda por código de barras reconoce producto y presentación", async () => {
    await crearProducto(env, { codigo: "BAR-P", codigoBarras: "7123456789012" });
    const directo = await env.servicios.productos.porCodigoBarras("7123456789012");
    expect(directo).toMatchObject({ codigo: "BAR-P", presentacion: null });

    const porPresentacion = await env.servicios.productos.porCodigoBarras("7000000000024");
    expect(porPresentacion.codigo).toBe("COLA");
    expect(porPresentacion.presentacion).toMatchObject({ nombre: "Caja x24", factor: 24 });

    await env.servicios.presentaciones.actualizar(caja.id, { status: "INACTIVO" });
    expect(await codigoError(env.servicios.productos.porCodigoBarras("7000000000024"))).toBe("NO_ENCONTRADO");
    await env.servicios.presentaciones.actualizar(caja.id, { status: "ACTIVO" });
  });
});

describe("Venta por presentación y fraccionada", () => {
  it("2 paquetes (x6): precio propio, stock y Kardex en unidades base", async () => {
    const antes = await stockDe(cola.id);
    const v = await vender(cajero, [{ productoId: cola.id, presentacionId: paquete.id, cantidad: 2 }]);

    expect(v.subtotal).toBe(10); // 2 × 5.00 (sin enviar precio: lo resuelve el servidor)
    expect(v.lineas[0]).toMatchObject({
      presentacionId: paquete.id, factorConversion: 6, cantidad: 2, cantidadBase: 12, precioUnitario: 5, descripcion: "Producto COLA (Paquete x6)",
    });
    expect(await stockDe(cola.id)).toBe(antes - 12);
    const mov = await env.prisma.kardex.findFirstOrThrow({ where: { productoId: cola.id, referencia: v.id } });
    expect(mov).toMatchObject({ tipoMovimiento: "VENTA", cantidad: 12, costoUnitario: 0.5 });
    expect(v.lineas[0]?.costoUnitario).toBe(0.5); // costo por unidad base
  });

  it("la caja sin precio propio vale precio base × factor", async () => {
    const antes = await stockDe(cola.id);
    const v = await vender(cajero, [{ productoId: cola.id, presentacionId: caja.id, cantidad: 1 }]);
    expect(v.lineas[0]).toMatchObject({ precioUnitario: 24, cantidadBase: 24 });
    expect(await stockDe(cola.id)).toBe(antes - 24);
  });

  it("venta fraccionada de un producto por peso (KG)", async () => {
    const antes = await stockDe(arroz.id);
    const v = await vender(cajero, [{ productoId: arroz.id, cantidad: 2.35 }]);
    expect(v.subtotal).toBe(2.35);
    expect(v.lineas[0]).toMatchObject({ cantidad: 2.35, cantidadBase: 2.35, factorConversion: 1, presentacionId: null });
    expect(await stockDe(arroz.id)).toBeCloseTo(antes - 2.35, 6);
  });

  it("rechaza fracciones donde no corresponden", async () => {
    const stock = await stockDe(cola.id);
    expect(await codigoError(vender(cajero, [{ productoId: cola.id, cantidad: 1.5 }]))).toBe("VALIDACION"); // UN
    expect(await codigoError(vender(cajero, [{ productoId: cola.id, presentacionId: caja.id, cantidad: 0.5 }]))).toBe("VALIDACION");
    expect(await codigoError(vender(cajero, [{ productoId: arroz.id, cantidad: 1.23456 }]))).toBe("VALIDACION"); // > 4 decimales
    expect(await stockDe(cola.id)).toBe(stock);
  });

  it("la presentación debe pertenecer al producto y estar activa", async () => {
    expect(await codigoError(vender(cajero, [{ productoId: arroz.id, presentacionId: paquete.id, cantidad: 1 }]))).toBe("NO_ENCONTRADO");
    expect(await codigoError(vender(cajero, [{ productoId: cola.id, presentacionId: "11111111-1111-4111-8111-111111111111", cantidad: 1 }]))).toBe("NO_ENCONTRADO");
    const temporal = await env.servicios.presentaciones.crear(cola.id, { nombre: "Temporal x2", factor: 2 });
    await env.servicios.presentaciones.actualizar(temporal.id, { status: "INACTIVO" });
    expect(await codigoError(vender(cajero, [{ productoId: cola.id, presentacionId: temporal.id, cantidad: 1 }]))).toBe("VALIDACION");
  });

  it("el stock se valida en unidades base: una caja no cabe si quedan menos de 24 unidades", async () => {
    const poco = await crearProducto(env, { codigo: "POCO", precioVenta: 1, stock: 10, aplicaIva: false });
    const pres = await env.servicios.presentaciones.crear(poco.id, { nombre: "Caja x12", factor: 12 });
    expect(await codigoError(vender(cajero, [{ productoId: poco.id, presentacionId: pres.id, cantidad: 1 }]))).toBe("STOCK_INSUFICIENTE");
    expect(await stockDe(poco.id)).toBe(10);
  });

  it("la anulación revierte en unidades base al costo original", async () => {
    const antes = await stockDe(cola.id);
    const v = await vender(cajero, [{ productoId: cola.id, presentacionId: paquete.id, cantidad: 3 }]);
    expect(await stockDe(cola.id)).toBe(antes - 18);
    await env.servicios.ventas.anular(v.id, { motivo: "Devolución del cliente" }, supervisor);
    expect(await stockDe(cola.id)).toBe(antes);
    const dev = await env.prisma.kardex.findFirstOrThrow({ where: { productoId: cola.id, tipoMovimiento: "DEVOLUCION", referencia: v.id } });
    expect(dev).toMatchObject({ cantidad: 18, costoUnitario: 0.5 });
  });
});

describe("Política de precio", () => {
  it("un precio distinto del resuelto exige ventas:actualizar", async () => {
    const stock = await stockDe(cola.id);
    const linea = { productoId: cola.id, cantidad: 1, precioUnitario: 0.5 };
    expect(await codigoError(vender(cajero, [linea]))).toBe("VALIDACION");
    expect(await stockDe(cola.id)).toBe(stock);

    const v = await vender(supervisor, [linea]);
    expect(v.lineas[0]?.precioUnitario).toBe(0.5);
  });

  it("enviar el mismo precio que el del catálogo (con tolerancia) no requiere permiso", async () => {
    const v = await vender(cajero, [{ productoId: cola.id, cantidad: 1, precioUnitario: 1.001 }]);
    expect(v.lineas[0]?.precioUnitario).toBe(1);
  });

  it("un actor sin lista de permisos nunca puede modificar precios", async () => {
    const sinPermisos = { id: cajero.id, empresaId: cajero.empresaId };
    expect(await codigoError(vender(sinPermisos as ActorCaja, [{ productoId: cola.id, cantidad: 1, precioUnitario: 0.1 }]))).toBe("VALIDACION");
  });
});

describe("Listas de precios", () => {
  let listaId: string;
  let clienteId: string;

  beforeAll(async () => {
    const lista = await env.servicios.listasPrecio.crear({ nombre: "Mayorista", descripcion: "Clientes distribuidores" }, admin);
    listaId = lista.id;
    await env.servicios.listasPrecio.fijarPrecio(listaId, { productoId: cola.id, precio: 0.8 }, admin);
    await env.servicios.listasPrecio.fijarPrecio(listaId, { productoId: cola.id, presentacionId: paquete.id, precio: 4.5 }, admin);
    await env.servicios.listasPrecio.fijarPrecio(listaId, { productoId: arroz.id, precio: 0.9 }, admin);
    clienteId = (await crearClienteConCredito(env, "0926687856001", 0)).id;
    await env.servicios.listasPrecio.asignarACliente(clienteId, { listaPrecioId: listaId }, admin);
  });

  it("CRUD de listas: nombre único, edición y precios con detalle", async () => {
    expect(await codigoError(env.servicios.listasPrecio.crear({ nombre: "Mayorista" }, admin))).toBe("DUPLICADO");
    expect(await codigoError(env.servicios.listasPrecio.crear({ nombre: "x" }, admin))).toBe("VALIDACION");
    const otra = await env.servicios.listasPrecio.crear({ nombre: "Ferretería" }, admin);
    expect((await env.servicios.listasPrecio.actualizar(otra.id, { descripcion: "Contratistas" }, admin)).descripcion).toBe("Contratistas");
    expect(await codigoError(env.servicios.listasPrecio.actualizar(otra.id, { nombre: "Mayorista" }, admin))).toBe("DUPLICADO");
    expect(await codigoError(env.servicios.listasPrecio.actualizar("no-existe", { nombre: "Zzz" }, admin))).toBe("NO_ENCONTRADO");
    expect((await env.servicios.listasPrecio.listar(admin)).map((l) => l.nombre)).toEqual(["Ferretería", "Mayorista"]);

    const precios = await env.servicios.listasPrecio.precios(listaId, admin);
    expect(precios).toHaveLength(3);
    expect(precios.find((p) => p.presentacion !== null)).toMatchObject({ precio: 4.5, presentacion: { nombre: "Paquete x6" } });
  });

  it("fijar un precio existente lo actualiza (no duplica) y valida producto/presentación", async () => {
    const antes = await env.servicios.listasPrecio.precios(listaId, admin);
    const base = antes.find((p) => p.productoId === arroz.id && p.presentacionId === null);
    const actualizado = await env.servicios.listasPrecio.fijarPrecio(listaId, { productoId: arroz.id, precio: 0.95 }, admin);
    expect(actualizado.id).toBe(base?.id);
    expect((await env.servicios.listasPrecio.precios(listaId, admin))).toHaveLength(antes.length);
    await env.servicios.listasPrecio.fijarPrecio(listaId, { productoId: arroz.id, precio: 0.9 }, admin);

    expect(await codigoError(env.servicios.listasPrecio.fijarPrecio(listaId, { productoId: arroz.id, presentacionId: paquete.id, precio: 1 }, admin))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.listasPrecio.fijarPrecio(listaId, { productoId: "11111111-1111-4111-8111-111111111111", precio: 1 }, admin))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.listasPrecio.fijarPrecio(listaId, { productoId: cola.id, precio: 0 }, admin))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.listasPrecio.fijarPrecio("no-existe", { productoId: cola.id, precio: 1 }, admin))).toBe("NO_ENCONTRADO");
  });

  it("la venta usa la lista del cliente: precio de lista, de lista×factor o de catálogo", async () => {
    const v = await vender(
      cajero,
      [
        { productoId: cola.id, cantidad: 10 }, // lista base 0.80
        { productoId: cola.id, presentacionId: paquete.id, cantidad: 1 }, // lista presentación 4.50
        { productoId: cola.id, presentacionId: caja.id, cantidad: 1 }, // sin precio de caja en lista → 0.80 × 24
        { productoId: arroz.id, cantidad: 3 }, // lista 0.90
      ],
      { clienteId }
    );
    const precios = v.lineas.map((l) => l.precioUnitario).sort((a, b) => a - b);
    expect(precios).toEqual([0.8, 0.9, 4.5, 19.2]);
    expect(v.subtotal).toBe(8 + 4.5 + 19.2 + 2.7);
  });

  it("un cliente sin lista (o consumidor final) paga el precio de catálogo", async () => {
    const otro = await crearClienteConCredito(env, "1710034065001", 0);
    const v = await vender(cajero, [{ productoId: cola.id, cantidad: 10 }], { clienteId: otro.id });
    expect(v.lineas[0]?.precioUnitario).toBe(1);
    const cf = await vender(cajero, [{ productoId: cola.id, cantidad: 1 }]);
    expect(cf.lineas[0]?.precioUnitario).toBe(1);
  });

  it("un precio enviado por el cajero distinto al de la lista también requiere permiso", async () => {
    expect(await codigoError(vender(cajero, [{ productoId: cola.id, cantidad: 1, precioUnitario: 1 }], { clienteId }))).toBe("VALIDACION");
    const v = await vender(supervisor, [{ productoId: cola.id, cantidad: 1, precioUnitario: 1 }], { clienteId });
    expect(v.lineas[0]?.precioUnitario).toBe(1);
  });

  it("quitar un precio vuelve al de catálogo; los inexistentes dan NO_ENCONTRADO", async () => {
    const lista = await env.servicios.listasPrecio.crear({ nombre: "Temporal" }, admin);
    const precio = await env.servicios.listasPrecio.fijarPrecio(lista.id, { productoId: arroz.id, precio: 0.5 }, admin);
    const c = await crearClienteConCredito(env, "0301234567001", 0);
    await env.servicios.listasPrecio.asignarACliente(c.id, { listaPrecioId: lista.id }, admin);
    expect((await vender(cajero, [{ productoId: arroz.id, cantidad: 1 }], { clienteId: c.id })).lineas[0]?.precioUnitario).toBe(0.5);

    await env.servicios.listasPrecio.quitarPrecio(lista.id, precio.id, admin);
    expect((await vender(cajero, [{ productoId: arroz.id, cantidad: 1 }], { clienteId: c.id })).lineas[0]?.precioUnitario).toBe(1);
    expect(await codigoError(env.servicios.listasPrecio.quitarPrecio(lista.id, precio.id, admin))).toBe("NO_ENCONTRADO");
  });

  it("una lista inactiva no se aplica y no puede asignarse; se puede quitar la lista del cliente", async () => {
    const lista = await env.servicios.listasPrecio.crear({ nombre: "Promo" }, admin);
    await env.servicios.listasPrecio.fijarPrecio(lista.id, { productoId: arroz.id, precio: 0.1 }, admin);
    const c = await crearClienteConCredito(env, "0401234567001", 0);
    await env.servicios.listasPrecio.asignarACliente(c.id, { listaPrecioId: lista.id }, admin);
    await env.servicios.listasPrecio.actualizar(lista.id, { status: "INACTIVO" }, admin);

    expect((await vender(cajero, [{ productoId: arroz.id, cantidad: 1 }], { clienteId: c.id })).lineas[0]?.precioUnitario).toBe(1);
    const c2 = await crearClienteConCredito(env, "0501234567001", 0);
    expect(await codigoError(env.servicios.listasPrecio.asignarACliente(c2.id, { listaPrecioId: lista.id }, admin))).toBe("VALIDACION");

    const sin = await env.servicios.listasPrecio.asignarACliente(c.id, { listaPrecioId: null }, admin);
    expect(sin.listaPrecioId).toBeNull();
    expect(await codigoError(env.servicios.listasPrecio.asignarACliente("no-existe", { listaPrecioId: null }, admin))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.listasPrecio.asignarACliente(c.id, { listaPrecioId: "11111111-1111-4111-8111-111111111111" }, admin))).toBe("NO_ENCONTRADO");
  });

  it("con el módulo deshabilitado: las operaciones fallan y las ventas ignoran la lista asignada", async () => {
    await configurarGiro(env, { moduloListasPrecios: false });
    try {
      expect(await codigoError(env.servicios.listasPrecio.crear({ nombre: "Nueva lista" }, admin))).toBe("MODULO_DESHABILITADO");
      expect(await codigoError(env.servicios.listasPrecio.listar(admin))).toBe("MODULO_DESHABILITADO");
      expect(await codigoError(env.servicios.listasPrecio.precios(listaId, admin))).toBe("MODULO_DESHABILITADO");
      expect(await codigoError(env.servicios.listasPrecio.asignarACliente(clienteId, { listaPrecioId: null }, admin))).toBe("MODULO_DESHABILITADO");

      const v = await vender(cajero, [{ productoId: cola.id, cantidad: 10 }], { clienteId });
      expect(v.lineas[0]?.precioUnitario).toBe(1); // precio de catálogo, no 0.80
    } finally {
      await configurarGiro(env, { moduloListasPrecios: true });
    }
  });
});

describe("Catálogo: referencias válidas", () => {
  it("producto con categoría o unidad inexistentes → NO_ENCONTRADO (no error interno)", async () => {
    const base = {
      codigo: "REF-1", nombre: "Ref", tipo: "BIEN", precioCompra: 1, precioVenta: 2,
      categoriaId: env.categoriaId, unidadMedidaId: env.unidadMedidaId,
    };
    const inexistente = "11111111-1111-4111-8111-111111111111";
    expect(await codigoError(env.servicios.productos.crear({ ...base, categoriaId: inexistente }))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.productos.crear({ ...base, unidadMedidaId: inexistente }))).toBe("NO_ENCONTRADO");
    await env.servicios.productos.crear(base);
  });

  it("las unidades KG, LB, L y M permiten decimales; UN no", async () => {
    const unidades = await env.prisma.unidadMedida.findMany();
    const permiten = unidades.filter((u) => u.permiteDecimales).map((u) => u.codigo).sort();
    expect(permiten).toEqual(["KG", "L", "LB", "M"]);
  });
});
