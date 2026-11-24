// ============================================================
// tests/integration/server/pos-frontend.test.ts
// El cliente de la pantalla del POS (renderer) contra el backend REAL por HTTP: la forma de los datos que consume y que el
// total que se ve en pantalla coincide con el que registra el servidor.
// ============================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VentaInputSchema } from "../../../src/shared/schemas/venta.schema";
import { ApiCliente, ApiError } from "../../../src/renderer/services/api";
import { PosApi } from "../../../src/renderer/services/pos.api";
import { calcularCarrito, porcentajeIvaDe } from "../../../src/renderer/services/totales";
import { useCarrito } from "../../../src/renderer/store/carrito.store";
import { armarEtiquetaBalanza } from "../../../src/server/services/hardware/codigoBarras.util";
import { crearEntorno, crearProducto, PASSWORD_ADMIN, type Entorno } from "../helpers/entorno.helper";

let env: Entorno;
let api: PosApi;
let token: string | null = null;

beforeAll(async () => {
  env = await crearEntorno();
  api = new PosApi(new ApiCliente({ baseUrl: env.backend.url, cajaId: "caja-front", obtenerToken: () => token }));
  await crearProducto(env, { codigo: "P15", precioVenta: 10, stock: 100, costo: 4, codigoBarras: "7860000000015" });
  await crearProducto(env, { codigo: "P5", precioVenta: 4.35, stock: 100, costo: 2, codigoIva: "5" });
  await crearProducto(env, { codigo: "P0", precioVenta: 1.25, stock: 100, costo: 0.5, aplicaIva: false });
  await crearProducto(env, { codigo: "KILO", precioVenta: 3.4, stock: 100, costo: 1, unidad: "KG", aplicaIva: false, codigoBarras: "000321" });
  await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { moduloBalanza: true } });
}, 60_000);

afterAll(async () => {
  await env.cerrar();
});

describe("Cliente del POS contra el backend real", () => {
  it("ingreso, puntos de emisión y apertura de turno (sin turno la API lo indica como null)", async () => {
    await expect(api.login("admin", "mala")).rejects.toMatchObject({ codigo: "CREDENCIALES_INVALIDAS", status: 401 });
    const sesion = await api.login("admin", PASSWORD_ADMIN);
    token = sesion.token;
    expect(sesion.usuario).toMatchObject({ username: "admin", rol: "ADMIN" });
    expect(sesion.usuario.permisos).toContain("ventas:crear");

    const puntos = await api.puntosEmision();
    expect(puntos).toHaveLength(1);
    expect(puntos[0]).toMatchObject({ id: env.seed.puntoEmisionId, sucursal: { id: env.seed.sucursalId } });

    expect(await api.turnoActual()).toBeNull();
    const turno = await api.abrirTurno(env.seed.sucursalId, 100);
    expect(turno).toMatchObject({ estado: "ABIERTO", montoApertura: 100, sucursalId: env.seed.sucursalId });
    expect(await api.turnoActual()).toMatchObject({ id: turno.id });
  });

  it("el catálogo trae lo que la pantalla necesita: unidad de medida y tarifa de IVA", async () => {
    const r = await api.productos("P");
    const p15 = r.items.find((p) => p.codigo === "P15");
    expect(p15).toMatchObject({ nombre: "Producto P15", precioVenta: 10, aplicaIva: true, codigoIvaSRI: "4", unidadMedida: { codigo: "UN", permiteDecimales: false } });
    expect(r.items.find((p) => p.codigo === "KILO")?.unidadMedida).toMatchObject({ codigo: "KG", permiteDecimales: true });
    expect((await api.productos("zzzzzz")).items).toEqual([]);
    expect((await api.productos("")).items.length).toBeGreaterThanOrEqual(4);
  });

  it("escanear: producto por código de barras y etiqueta de balanza, con los mismos datos que el catálogo", async () => {
    const p = await api.escanear("7860000000015");
    expect(p).toMatchObject({ tipo: "PRODUCTO", cantidad: 1, producto: { codigo: "P15", unidadMedida: { codigo: "UN" } } });
    const b = await api.escanear(armarEtiquetaBalanza("321", 1.25, "PESO"));
    expect(b).toMatchObject({ tipo: "BALANZA", cantidad: 1.25, producto: { codigo: "KILO", unidadMedida: { codigo: "KG", permiteDecimales: true } } });
    await expect(api.escanear("0000000000000")).rejects.toMatchObject({ codigo: "NO_ENCONTRADO" });
  });

  it("el total que muestra la pantalla es el que registra el servidor (varias tarifas, descuento en %, kilos)", async () => {
    const catalogo = (await api.productos("")).items;
    const por = (c: string) => catalogo.find((p) => p.codigo === c) as (typeof catalogo)[number];
    useCarrito.getState().vaciar();
    const s = useCarrito.getState();
    s.agregar({ producto: por("P15"), cantidad: 3 });
    s.agregar({ producto: por("P5"), cantidad: 2 });
    s.agregar({ producto: por("P0"), cantidad: 7 });
    s.agregar({ producto: por("KILO"), cantidad: 1.375 });
    const dClave = useCarrito.getState().lineas[1]?.clave as string;
    useCarrito.getState().fijarDescuento(dClave, 12.5, "PORCENTAJE");
    const lineas = useCarrito.getState().lineas;
    const calculo = calcularCarrito(lineas);
    expect(lineas.map((l) => l.porcentajeIva)).toEqual([15, 5, 0, 0]);
    expect(lineas.map((l) => l.porcentajeIva)).toEqual(catalogo.filter((p) => ["P15", "P5", "P0", "KILO"].includes(p.codigo)).sort((a, b) => ["P15", "P5", "P0", "KILO"].indexOf(a.codigo) - ["P15", "P5", "P0", "KILO"].indexOf(b.codigo)).map(porcentajeIvaDe));

    // la misma carga útil que arma PosScreen: sin precios
    const entrada = {
      puntoEmisionId: env.seed.puntoEmisionId,
      lineas: lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad, descuento: l.descuento, tipoDescuento: l.tipoDescuento })),
      pagos: [{ formaPago: "EFECTIVO" as const, monto: 100 }],
      propina: 0,
      emitirFactura: false,
    };
    const venta = await api.crearVenta(VentaInputSchema.parse(entrada));
    expect(venta).toMatchObject({ subtotal: calculo.totales.subtotal, descuento: calculo.totales.descuento, iva: calculo.totales.iva, total: calculo.totales.total });
    expect(venta.pagos[0]?.cambio).toBeCloseTo(100 - calculo.totales.total, 2);
    expect(venta.numero).toMatch(/^001-001-\d{9}$/);
    expect(venta.advertencias).toEqual([]);
  });

  it("los errores del servidor llegan con su código para que la pantalla los muestre", async () => {
    const catalogo = (await api.productos("P15")).items;
    const base = { puntoEmisionId: env.seed.puntoEmisionId, pagos: [{ formaPago: "EFECTIVO" as const, monto: 100_000 }], propina: 0, emitirFactura: false };
    const sinStock = VentaInputSchema.parse({ ...base, lineas: [{ productoId: (catalogo[0] as { id: string }).id, cantidad: 5_000 }] });
    const e = await api.crearVenta(sinStock).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ codigo: "STOCK_INSUFICIENTE", status: 409 });
    const insuficiente = VentaInputSchema.parse({ ...base, pagos: [{ formaPago: "EFECTIVO", monto: 1 }], lineas: [{ productoId: (catalogo[0] as { id: string }).id, cantidad: 1 }] });
    await expect(api.crearVenta(insuficiente)).rejects.toMatchObject({ codigo: "VALIDACION", message: expect.stringMatching(/Pago insuficiente/) });
  });

  it("colaSri: el administrador la ve; sin permiso la API responde 403 y el cliente lo trata como «no disponible»", async () => {
    expect(await api.colaSri()).toMatchObject({ porEstado: expect.any(Object), pendientes: expect.any(Array) });
    await env.servicios.usuarios.crear({ empresaId: env.seed.empresaId, rol: "CAJERO", username: "front.caja", password: "Clave12345", nombre: "Front", apellido: "Caja" });
    const anterior = token;
    token = (await api.login("front.caja", "Clave12345")).token;
    expect(await api.colaSri()).toBeNull();
    expect((await api.impresora()).conexion).toBe("NINGUNA");
    expect(await api.balanza()).toMatchObject({ habilitada: true, puerto: null });
    token = anterior;
  });
});
