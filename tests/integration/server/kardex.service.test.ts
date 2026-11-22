// ============================================================
// tests/integration/server/kardex.service.test.ts — Kardex valorado (costo promedio ponderado)
// ============================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { codigoError, crearEntorno, crearProducto, type Entorno } from "../helpers/entorno.helper";

let env: Entorno;

beforeAll(async () => {
  env = await crearEntorno();
}, 60_000);

afterAll(async () => {
  await env.cerrar();
});

describe("KardexService", () => {
  it("entradas recalculan el costo promedio ponderado y registran el movimiento", async () => {
    const p = await crearProducto(env, { codigo: "K1" });
    const k = env.servicios.kardex;

    const m1 = await k.registrarEntrada(env.prisma, { productoId: p.id, cantidad: 10, costoUnitario: 2, tipoMovimiento: "COMPRA" });
    expect(m1).toMatchObject({ stockAnterior: 0, stockResultante: 10, costoPromAnterior: 0, costoPromResultante: 2, costoTotal: 20 });

    const m2 = await k.registrarEntrada(env.prisma, { productoId: p.id, cantidad: 10, costoUnitario: 4, tipoMovimiento: "COMPRA" });
    expect(m2).toMatchObject({ stockAnterior: 10, stockResultante: 20, costoPromAnterior: 2, costoPromResultante: 3 });

    const actual = await env.prisma.producto.findUniqueOrThrow({ where: { id: p.id } });
    expect(actual.stockActual).toBe(20);
    expect(actual.costoPromedio).toBe(3);
  });

  it("salidas usan el costo promedio vigente y no lo alteran", async () => {
    const p = await crearProducto(env, { codigo: "K2", stock: 20, costo: 3 });
    const k = env.servicios.kardex;

    const s = await k.registrarSalida(env.prisma, { productoId: p.id, cantidad: 5, tipoMovimiento: "VENTA", referencia: "v1" });
    expect(s).toMatchObject({ costoUnitario: 3, costoTotal: 15, stockAnterior: 20, stockResultante: 15, costoPromResultante: 3, referencia: "v1" });

    const e = await k.registrarEntrada(env.prisma, { productoId: p.id, cantidad: 5, costoUnitario: 6, tipoMovimiento: "COMPRA" });
    expect(e.costoPromResultante).toBe(3.75); // (15*3 + 5*6) / 20
  });

  it("stock insuficiente: lanza error y no modifica stock ni registra movimiento", async () => {
    const p = await crearProducto(env, { codigo: "K3", stock: 2, costo: 1 });
    expect(await codigoError(env.servicios.kardex.registrarSalida(env.prisma, { productoId: p.id, cantidad: 3, tipoMovimiento: "VENTA" }))).toBe(
      "STOCK_INSUFICIENTE"
    );
    expect((await env.prisma.producto.findUniqueOrThrow({ where: { id: p.id } })).stockActual).toBe(2);
    expect(await env.prisma.kardex.count({ where: { productoId: p.id } })).toBe(1); // solo la compra inicial
  });

  it("permite vaciar el stock exacto y soporta cantidades decimales", async () => {
    const p = await crearProducto(env, { codigo: "K4", stock: 2.5, costo: 1 });
    await env.servicios.kardex.registrarSalida(env.prisma, { productoId: p.id, cantidad: 0.5, tipoMovimiento: "AJUSTE_SALIDA" });
    await env.servicios.kardex.registrarSalida(env.prisma, { productoId: p.id, cantidad: 2, tipoMovimiento: "VENTA" });
    expect((await env.prisma.producto.findUniqueOrThrow({ where: { id: p.id } })).stockActual).toBe(0);
  });

  it("con stock agotado la siguiente entrada fija el costo (no promedia contra 0)", async () => {
    const p = await crearProducto(env, { codigo: "K5", stock: 4, costo: 10 });
    await env.servicios.kardex.registrarSalida(env.prisma, { productoId: p.id, cantidad: 4, tipoMovimiento: "VENTA" });
    const e = await env.servicios.kardex.registrarEntrada(env.prisma, { productoId: p.id, cantidad: 2, costoUnitario: 7, tipoMovimiento: "COMPRA" });
    expect(e.costoPromResultante).toBe(7);
  });

  it("valida cantidad, costo y existencia del producto", async () => {
    const p = await crearProducto(env, { codigo: "K6" });
    const k = env.servicios.kardex;
    expect(await codigoError(k.registrarEntrada(env.prisma, { productoId: p.id, cantidad: 0, costoUnitario: 1, tipoMovimiento: "COMPRA" }))).toBe("VALIDACION");
    expect(await codigoError(k.registrarEntrada(env.prisma, { productoId: p.id, cantidad: 1, costoUnitario: -1, tipoMovimiento: "COMPRA" }))).toBe("VALIDACION");
    expect(await codigoError(k.registrarSalida(env.prisma, { productoId: p.id, cantidad: -1, tipoMovimiento: "VENTA" }))).toBe("VALIDACION");
    expect(await codigoError(k.registrarSalida(env.prisma, { productoId: "no-existe", cantidad: 1, tipoMovimiento: "VENTA" }))).toBe("NO_ENCONTRADO");
    expect(await codigoError(k.registrarEntrada(env.prisma, { productoId: "no-existe", cantidad: 1, costoUnitario: 1, tipoMovimiento: "COMPRA" }))).toBe("NO_ENCONTRADO");
  });

  it("dentro de una transacción fallida no queda ningún rastro (stock, costo ni movimiento)", async () => {
    const p = await crearProducto(env, { codigo: "K7", stock: 10, costo: 2 });
    await expect(
      env.prisma.$transaction(async (tx) => {
        await env.servicios.kardex.registrarEntrada(tx, { productoId: p.id, cantidad: 10, costoUnitario: 10, tipoMovimiento: "COMPRA" });
        throw new Error("fallo simulado");
      })
    ).rejects.toThrow("fallo simulado");
    const actual = await env.prisma.producto.findUniqueOrThrow({ where: { id: p.id } });
    expect(actual).toMatchObject({ stockActual: 10, costoPromedio: 2 });
    expect(await env.prisma.kardex.count({ where: { productoId: p.id } })).toBe(1);
  });

  it("historial devuelve los movimientos en orden cronológico", async () => {
    const p = await crearProducto(env, { codigo: "K8", stock: 5, costo: 1 });
    await env.servicios.kardex.registrarSalida(env.prisma, { productoId: p.id, cantidad: 1, tipoMovimiento: "VENTA" });
    const h = await env.servicios.kardex.historial(env.prisma, p.id);
    expect(h.map((m) => m.tipoMovimiento)).toEqual(["COMPRA", "VENTA"]);
  });
});
