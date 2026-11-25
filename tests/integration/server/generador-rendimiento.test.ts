// ============================================================
// tests/integration/server/generador-rendimiento.test.ts — El generador de datos del banco de rendimiento, a pequeña escala
// Comprueba que lo que genera es CONSISTENTE (totales, secuenciales, cartera, cola del SRI, reproducibilidad), porque las mediciones
// de tests/performance dependen de que esos datos se parezcan a los de un negocio real.
// ============================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generarBase, crearAzar, NUM_CAJEROS, type ParametrosBase, type ResumenBase } from "../../performance/generador";
import { crearEntorno, type Entorno } from "../helpers/entorno.helper";

const P: ParametrosBase = { productos: 300, clientes: 60, dias: 3, ventasPorDia: 40, ventasTurnoAbierto: 25, semilla: 7 };
let env: Entorno;
let r: ResumenBase;

beforeAll(async () => {
  env = await crearEntorno();
  r = await generarBase(env.prisma, P);
}, 120_000);

afterAll(async () => {
  await env.cerrar();
});

describe("Generador de la base de rendimiento", () => {
  it("crea las cantidades pedidas", async () => {
    expect(r.ventas).toBe(P.dias * P.ventasPorDia + P.ventasTurnoAbierto);
    expect(await env.prisma.venta.count()).toBe(r.ventas);
    expect(await env.prisma.producto.count()).toBe(P.productos);
    expect(await env.prisma.cliente.count()).toBe(P.clientes + 1); // + Consumidor Final
    expect(await env.prisma.lineaVenta.count()).toBe(r.lineas);
    expect(r.lineas).toBeGreaterThanOrEqual(r.ventas);
    expect(await env.prisma.kardex.count()).toBe(r.lineas); // un movimiento por línea
    expect(await env.prisma.comprobanteElectronico.count()).toBe(r.ventas);
    expect(await env.prisma.pagoVenta.count()).toBe(r.ventas);
    expect(r.cajeros).toHaveLength(NUM_CAJEROS);
  });

  it("los totales de cada venta cuadran con sus líneas y con su pago", async () => {
    const ventas = await env.prisma.venta.findMany({ take: 40, include: { lineas: true, pagos: true } });
    for (const v of ventas) {
      expect(Math.abs(v.lineas.reduce((a, l) => a + l.subtotal, 0) - v.subtotal)).toBeLessThan(0.05);
      expect(Math.abs(v.lineas.reduce((a, l) => a + l.iva, 0) - v.iva)).toBeLessThan(0.05);
      expect(Math.abs(v.subtotal + v.iva - v.total)).toBeLessThan(0.02);
      expect(v.pagos).toHaveLength(1);
      expect(v.pagos[0]?.monto).toBe(v.total);
    }
  });

  it("los números de venta son únicos por punto, sin huecos, y los contadores del punto coinciden", async () => {
    for (const id of r.puntosEmision) {
      const punto = await env.prisma.puntoEmision.findUniqueOrThrow({ where: { id } });
      const ventas = await env.prisma.venta.findMany({ where: { puntoEmisionId: id }, select: { numero: true } });
      expect(ventas.length).toBe(punto.secuencialVenta);
      const numeros = ventas.map((v) => Number(v.numero.slice(-9))).sort((a, b) => a - b);
      expect(numeros[0]).toBe(1);
      expect(numeros.at(-1)).toBe(ventas.length);
      expect(new Set(numeros).size).toBe(numeros.length);
    }
  });

  it("deja un turno ABIERTO con las ventas extra, los demás cerrados; la cartera y la cola del SRI existen", async () => {
    const abiertos = await env.prisma.turnoCaja.findMany({ where: { estado: "ABIERTO" }, include: { cajero: true, _count: { select: { ventas: true } } } });
    expect(abiertos).toHaveLength(1);
    expect(abiertos[0]?.cajero.username).toBe(r.cajeroTurnoAbierto);
    expect(abiertos[0]?._count.ventas).toBeGreaterThanOrEqual(P.ventasTurnoAbierto);
    expect(await env.prisma.cuentaPorCobrar.count()).toBeGreaterThan(0);
    expect(await env.prisma.colaSRI.count()).toBe(await env.prisma.comprobanteElectronico.count({ where: { estado: "PENDIENTE" } }));
    const claves = await env.prisma.comprobanteElectronico.findMany({ select: { claveAcceso: true } });
    expect(new Set(claves.map((c) => c.claveAcceso)).size).toBe(claves.length);
    expect(claves.every((c) => /^\d{49}$/.test(c.claveAcceso))).toBe(true);
  });

  it("el azar es determinista: la misma semilla da la misma secuencia", () => {
    const a = crearAzar(123), b = crearAzar(123), c = crearAzar(124);
    const sa = Array.from({ length: 5 }, () => a.siguiente()), sb = Array.from({ length: 5 }, () => b.siguiente());
    expect(sa).toEqual(sb);
    expect(Array.from({ length: 5 }, () => c.siguiente())).not.toEqual(sa);
    expect(sa.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});
