// ============================================================
// tests/integration/server/nucleo-pos.test.ts
// Suite de integración del núcleo POS (cierre del Mes 2): escenarios extremo a extremo por giro,
// concurrencia mixta y verificación de invariantes (stock, Kardex, lotes, secuenciales, caja, cartera, mesas).
// ============================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActorCaja } from "../../../src/server/services/turno.service";
import {
  abrirTurno, codigoError, configurarGiro, crearActor, crearClienteConCredito, crearEntorno, crearProducto, crearProveedor, type Entorno,
} from "../helpers/entorno.helper";
import { verificarInvariantes } from "../helpers/invariantes.helper";

const DIA = 86_400_000;
const enDias = (n: number): Date => new Date(Date.now() + n * DIA);
const ok = async (env: Entorno): Promise<void> => expect(await verificarInvariantes(env)).toEqual([]);

const venta = (env: Entorno, actor: ActorCaja, lineas: unknown[], pagos: unknown[], extra: Record<string, unknown> = {}) =>
  env.servicios.ventas.crear({ puntoEmisionId: env.seed.puntoEmisionId, lineas, pagos, ...extra }, actor);

const esperadoCaja = async (env: Entorno, actor: ActorCaja, supervisor: ActorCaja): Promise<number> => {
  const t = await env.servicios.turnos.actual(actor);
  return (await env.servicios.turnos.reporte(t.id, supervisor)).efectivo?.esperado ?? NaN;
};

// ─────────────────────────────────────────────────────────────
describe("Escenario RETAIL: compras → ventas → anulaciones → cartera → caja", () => {
  let env: Entorno;
  let cajero1: ActorCaja;
  let cajero2: ActorCaja;
  let supervisor: ActorCaja;
  let bodeguero: ActorCaja;

  beforeAll(async () => {
    env = await crearEntorno();
    cajero1 = await crearActor(env, "CAJERO", "retail.caja1");
    cajero2 = await crearActor(env, "CAJERO", "retail.caja2");
    supervisor = await crearActor(env, "SUPERVISOR", "retail.super");
    bodeguero = await crearActor(env, "BODEGUERO", "retail.bodega");
  }, 60_000);
  afterAll(async () => env.cerrar());

  it("recorre la operación completa y mantiene todos los invariantes", async () => {
    // ── Catálogo y compras ────────────────────────────────
    const arroz = await crearProducto(env, { codigo: "ARROZ", precioVenta: 1.2, unidad: "KG", aplicaIva: false, costo: 0.7 });
    const cola = await crearProducto(env, { codigo: "COLA", precioVenta: 1, costo: 0.5 });
    const aceite = await crearProducto(env, { codigo: "ACEITE", precioVenta: 3, costo: 2 });
    const pack6 = await env.servicios.presentaciones.crear(cola.id, { nombre: "Pack x6", factor: 6, precioVenta: 5.5 });
    const caja24 = await env.servicios.presentaciones.crear(cola.id, { nombre: "Caja x24", factor: 24 });
    const p1 = await crearProveedor(env, { razonSocial: "Distribuidora Uno" });
    const p2 = await crearProveedor(env, { razonSocial: "Distribuidora Dos", diasPago: 45 });

    await env.servicios.compras.crear(
      { proveedorId: p1.id, sucursalId: env.seed.sucursalId, numeroFactura: "001-001-000000001", formaPago: "CONTADO",
        lineas: [{ productoId: arroz.id, cantidad: 100, costoUnitario: 0.7 }, { productoId: cola.id, cantidad: 600, costoUnitario: 0.5 }] },
      bodeguero
    );
    const compraCredito = await env.servicios.compras.crear(
      { proveedorId: p2.id, sucursalId: env.seed.sucursalId, numeroFactura: "002-001-000000009", formaPago: "CREDITO",
        lineas: [{ productoId: aceite.id, cantidad: 80, costoUnitario: 2 }] },
      bodeguero
    );
    expect(compraCredito).toMatchObject({ subtotal: 160, iva: 24, total: 184 });
    await ok(env);

    // ── Ventas ────────────────────────────────────────────
    await abrirTurno(env, cajero1.id);
    const a = await venta(env, cajero1, [{ productoId: arroz.id, cantidad: 2.5 }, { productoId: cola.id, cantidad: 4 }], [{ formaPago: "EFECTIVO", monto: 10 }]);
    expect(a).toMatchObject({ subtotal: 7, iva: 0.6, total: 7.6 });
    expect(a.pagos[0]?.cambio).toBe(2.4);

    const b = await venta(env, cajero1, [{ productoId: cola.id, presentacionId: pack6.id, cantidad: 2 }, { productoId: cola.id, presentacionId: caja24.id, cantidad: 1 }], [{ formaPago: "TARJETA_CREDITO", monto: 40.25 }]);
    expect(b).toMatchObject({ subtotal: 35, iva: 5.25, total: 40.25 });

    const c = await venta(env, cajero1, [{ productoId: aceite.id, cantidad: 2 }], [{ formaPago: "TARJETA_DEBITO", monto: 3 }, { formaPago: "EFECTIVO", monto: 5 }]);
    expect(c.total).toBe(6.9);
    expect(c.pagos.find((p) => p.formaPago === "EFECTIVO")?.cambio).toBe(1.1);
    await ok(env);

    // Crédito con límite
    const c1 = await crearClienteConCredito(env, "0926687856001", 100, 30);
    const d1 = await venta(env, cajero1, [{ productoId: aceite.id, cantidad: 10 }], [{ formaPago: "CREDITO", monto: 34.5 }], { clienteId: c1.id });
    expect(await codigoError(venta(env, cajero1, [{ productoId: aceite.id, cantidad: 20 }], [{ formaPago: "CREDITO", monto: 69 }], { clienteId: c1.id }))).toBe("LIMITE_CREDITO_EXCEDIDO");
    const d2 = await venta(env, cajero1, [{ productoId: aceite.id, cantidad: 15 }], [{ formaPago: "CREDITO", monto: 51.75 }], { clienteId: c1.id });

    // Lista de precios mayorista
    const lista = await env.servicios.listasPrecio.crear({ nombre: "Mayorista" }, supervisor);
    await env.servicios.listasPrecio.fijarPrecio(lista.id, { productoId: cola.id, precio: 0.8 }, supervisor);
    const c2 = await crearClienteConCredito(env, "1710034065001", 0);
    await env.servicios.listasPrecio.asignarACliente(c2.id, { listaPrecioId: lista.id }, supervisor);
    const e = await venta(env, cajero1, [{ productoId: cola.id, cantidad: 100 }], [{ formaPago: "EFECTIVO", monto: 100 }], { clienteId: c2.id });
    expect(e).toMatchObject({ subtotal: 80, iva: 12, total: 92 });
    await ok(env);

    // ── Anulaciones ───────────────────────────────────────
    await env.servicios.ventas.anular(a.id, { motivo: "Error de digitación" }, supervisor);
    await env.servicios.ventas.anular(d1.id, { motivo: "Cliente desistió" }, supervisor);
    expect((await env.prisma.cuentaPorCobrar.findUniqueOrThrow({ where: { ventaId: d1.id } })).estado).toBe("ANULADA");
    expect(await codigoError(env.servicios.ventas.anular(a.id, { motivo: "Otra vez más" }, supervisor))).toBe("ESTADO_INVALIDO");
    await ok(env);

    // ── Cartera: abonos hasta saldar ──────────────────────
    const cuenta = await env.prisma.cuentaPorCobrar.findUniqueOrThrow({ where: { ventaId: d2.id } });
    await env.servicios.cuentasPorCobrar.registrarAbono(cuenta.id, { monto: 20, formaPago: "TRANSFERENCIA" }, cajero1);
    await env.servicios.cuentasPorCobrar.registrarAbono(cuenta.id, { monto: 11.75, formaPago: "EFECTIVO" }, cajero1);
    expect(await codigoError(env.servicios.ventas.anular(d2.id, { motivo: "Con abonos" }, supervisor))).toBe("ESTADO_INVALIDO");
    const saldada = await env.servicios.cuentasPorCobrar.registrarAbono(cuenta.id, { monto: 20, formaPago: "TARJETA_DEBITO" }, cajero1);
    expect(saldada).toMatchObject({ saldo: 0, estado: "PAGADA" });
    await ok(env);

    // ── Cartera de proveedores y movimientos de caja ──────
    const cxp = compraCredito.cuentaPorPagar as { id: string };
    await env.servicios.cuentasPorPagar.registrarPago(cxp.id, { monto: 84, formaPago: "TRANSFERENCIA" }, bodeguero);
    await env.servicios.cuentasPorPagar.registrarPago(cxp.id, { monto: 50, formaPago: "EFECTIVO" }, cajero1);
    const turno1 = await env.servicios.turnos.actual(cajero1);
    await env.servicios.turnos.registrarMovimiento(turno1.id, { tipo: "INGRESO", concepto: "Fondo adicional", monto: 20 }, cajero1);
    await env.servicios.turnos.registrarMovimiento(turno1.id, { tipo: "EGRESO", concepto: "Compra de insumos", monto: 15 }, cajero1);
    await ok(env);

    // ── Cierre ciego con faltante ─────────────────────────
    const esperado = await esperadoCaja(env, cajero1, supervisor);
    expect(esperado).toBeGreaterThan(0);
    const cierre = await env.servicios.turnos.cerrar(turno1.id, { efectivoContado: esperado - 0.5, observaciones: "Faltante menor" }, cajero1);
    expect(cierre.efectivo).toEqual({ esperado, contado: esperado - 0.5, diferencia: -0.5 });
    expect(cierre.ventas.anuladas.cantidad).toBe(2);
    expect(cierre.ventas.cantidad).toBe(4); // b, c, d2 y e (a y d1 están anuladas)
    await ok(env);

    // ── Segundo cajero en otro turno ──────────────────────
    expect(await codigoError(venta(env, cajero2, [{ productoId: cola.id, cantidad: 1 }], [{ formaPago: "EFECTIVO", monto: 2 }]))).toBe("TURNO_REQUERIDO");
    await abrirTurno(env, cajero2.id);
    await venta(env, cajero2, [{ productoId: arroz.id, cantidad: 10 }], [{ formaPago: "EFECTIVO", monto: 12 }]);
    await ok(env);

    // Totales finales coherentes con el inventario comprado y vendido
    const stockCola = (await env.prisma.producto.findUniqueOrThrow({ where: { id: cola.id } })).stockActual;
    // 600 comprados − b (2 packs x6 + 1 caja x24 = 36) − e (100); la venta a se anuló y repuso sus 4
    expect(stockCola).toBe(464);
  });
});

// ─────────────────────────────────────────────────────────────
describe("Escenario FARMACIA: lotes, FEFO, vencimientos y ajustes", () => {
  let env: Entorno;
  let cajero: ActorCaja;
  let supervisor: ActorCaja;
  let admin: ActorCaja;

  beforeAll(async () => {
    env = await crearEntorno();
    await configurarGiro(env, { moduloLotes: true, moduloVencimientos: true });
    admin = await crearActor(env, "ADMIN", "farma.admin");
    cajero = await crearActor(env, "CAJERO", "farma.caja");
    supervisor = await crearActor(env, "SUPERVISOR", "farma.super");
    await abrirTurno(env, cajero.id);
  }, 60_000);
  afterAll(async () => env.cerrar());

  it("compras con lote, ventas FEFO, anulación, mermas y vencimientos conservan stock = suma de lotes", async () => {
    const med1 = await crearProducto(env, { codigo: "AMOX", precioVenta: 2, aplicaIva: false, requiereLote: true, tieneVencimiento: true, principioActivo: "amoxicilina" });
    const med2 = await crearProducto(env, { codigo: "IBU", precioVenta: 5, aplicaIva: false, requiereLote: true, tieneVencimiento: true, principioActivo: "ibuprofeno" });
    const plano = await crearProducto(env, { codigo: "VENDAS", precioVenta: 1, stock: 50, costo: 0.4 });
    const prov1 = await crearProveedor(env);
    const prov2 = await crearProveedor(env);

    const compra = (prov: string, factura: string, lineas: unknown[]) =>
      env.servicios.compras.crear({ proveedorId: prov, sucursalId: env.seed.sucursalId, numeroFactura: factura, lineas }, admin);
    await compra(prov1.id, "F-1", [
      { productoId: med1.id, cantidad: 40, costoUnitario: 1, lote: { numeroLote: "A", fechaVencimiento: enDias(30) } },
      { productoId: med1.id, cantidad: 60, costoUnitario: 1.1, lote: { numeroLote: "B", fechaVencimiento: enDias(90) } },
    ]);
    await compra(prov2.id, "F-2", [{ productoId: med2.id, cantidad: 30, costoUnitario: 3, lote: { numeroLote: "C", fechaVencimiento: enDias(20) } }]);
    await ok(env);

    // FEFO: 50 unidades = 40 del lote A + 10 del lote B
    const v1 = await venta(env, cajero, [{ productoId: med1.id, cantidad: 50 }, { productoId: plano.id, cantidad: 2 }], [{ formaPago: "EFECTIVO", monto: 200 }]);
    const porLote = Object.fromEntries(v1.lineas.filter((l) => l.loteId !== null).map((l) => [l.cantidad, l.loteId]));
    expect(Object.keys(porLote).sort((x, y) => Number(x) - Number(y))).toEqual(["10", "40"]);
    const lotes = Object.fromEntries((await env.prisma.lote.findMany()).map((l) => [l.numeroLote, l.cantidadActual]));
    expect(lotes).toMatchObject({ A: 0, B: 50, C: 30 });
    await ok(env);

    // Anulación restituye cada lote
    await env.servicios.ventas.anular(v1.id, { motivo: "Receta inválida" }, supervisor);
    expect(Object.fromEntries((await env.prisma.lote.findMany()).map((l) => [l.numeroLote, l.cantidadActual]))).toMatchObject({ A: 40, B: 60 });
    await ok(env);

    // Merma por lote (ajuste de salida) y bloqueo de lote
    await env.servicios.inventario.ajustar({ productoId: med1.id, tipo: "SALIDA", cantidad: 5, loteId: (await env.prisma.lote.findFirstOrThrow({ where: { numeroLote: "B" } })).id, motivo: "Merma por humedad" }, admin);
    const loteC = await env.prisma.lote.findFirstOrThrow({ where: { numeroLote: "C" } });
    await env.servicios.lotes.actualizar(loteC.id, { status: "BLOQUEADO" }, admin);
    expect(await codigoError(venta(env, cajero, [{ productoId: med2.id, cantidad: 1 }], [{ formaPago: "EFECTIVO", monto: 10 }]))).toBe("STOCK_INSUFICIENTE");
    await env.servicios.lotes.actualizar(loteC.id, { status: "ACTIVO" }, admin);
    await venta(env, cajero, [{ productoId: med2.id, cantidad: 12 }], [{ formaPago: "TARJETA_CREDITO", monto: 60 }]);
    await ok(env);

    // El tiempo pasa: el lote A vence y deja de venderse; aparece en alertas
    await env.prisma.lote.updateMany({ where: { numeroLote: "A" }, data: { fechaVencimiento: enDias(-1) } });
    const v2 = await venta(env, cajero, [{ productoId: med1.id, cantidad: 30 }], [{ formaPago: "EFECTIVO", monto: 100 }]);
    expect(v2.lineas.every((l) => l.loteId !== null)).toBe(true);
    expect(await env.prisma.lote.findFirstOrThrow({ where: { numeroLote: "A" } })).toMatchObject({ cantidadActual: 40 }); // intacto
    const alertas = await env.servicios.inventario.alertasVencimiento({ dias: 30 }, admin);
    expect(alertas.vencidos.map((x) => x.numeroLote)).toEqual(["A"]);
    expect(alertas.porVencer.map((x) => x.numeroLote)).toEqual(["C"]);

    // Con lote vencido en stock, el stock total excede lo vendible: pedir todo falla y no deja rastro
    const stock = (await env.prisma.producto.findUniqueOrThrow({ where: { id: med1.id } })).stockActual;
    expect(await codigoError(venta(env, cajero, [{ productoId: med1.id, cantidad: stock }], [{ formaPago: "EFECTIVO", monto: 1000 }]))).toBe("STOCK_INSUFICIENTE");
    await ok(env);
  });
});

// ─────────────────────────────────────────────────────────────
describe("Escenario RESTAURANTE: mesas, comandas, cobros por ítems y por partes", () => {
  let env: Entorno;
  let mesero: ActorCaja;
  let cajero: ActorCaja;
  let supervisor: ActorCaja;
  let admin: ActorCaja;

  beforeAll(async () => {
    env = await crearEntorno();
    await configurarGiro(env, { moduloMesas: true, moduloComandasCocina: true });
    admin = await crearActor(env, "ADMIN", "resto.admin");
    mesero = await crearActor(env, "MESERO", "resto.mesero");
    cajero = await crearActor(env, "CAJERO", "resto.caja");
    supervisor = await crearActor(env, "SUPERVISOR", "resto.super");
    await abrirTurno(env, cajero.id);
  }, 60_000);
  afterAll(async () => env.cerrar());

  it("una jornada completa deja caja, inventario, secuenciales y mesas consistentes", async () => {
    const plato = await crearProducto(env, { codigo: "LOMO", precioVenta: 10, stock: 100, costo: 4 });
    const bebida = await crearProducto(env, { codigo: "JUGO", precioVenta: 2, stock: 200, costo: 0.5, destino: "BARRA" });
    const postre = await crearProducto(env, { codigo: "FLAN", precioVenta: 3, stock: 50, costo: 1, aplicaIva: false });
    const mesas = [];
    for (let i = 1; i <= 6; i++) mesas.push(await env.servicios.mesas.crear({ sucursalId: env.seed.sucursalId, numero: i, nombre: `Mesa ${i}` }, admin));
    const [m1, m2, m3, m4, m5, m6] = mesas as [typeof mesas[number], typeof mesas[number], typeof mesas[number], typeof mesas[number], typeof mesas[number], typeof mesas[number]];

    const abrir = (m: { id: string }) => env.servicios.comandas.abrir({ mesaId: m.id }, mesero);
    const pedir = (id: string, items: unknown[]) => env.servicios.comandas.agregarItems(id, { items }, mesero);
    const cobro = (id: string, extra: Record<string, unknown> = {}) =>
      env.servicios.comandas.cobrar(id, { puntoEmisionId: env.seed.puntoEmisionId, pagos: [{ formaPago: "EFECTIVO", monto: 500 }], ...extra }, cajero);

    // Mesa 1: pedido, cocina, cobro por ítems con propina
    const c1 = await abrir(m1);
    await pedir(c1.id, [{ productoId: plato.id, cantidad: 2 }, { productoId: bebida.id, cantidad: 2 }, { productoId: postre.id, cantidad: 1 }]);
    await env.servicios.comandas.enviar(c1.id, mesero);
    const cocinaItems = await env.servicios.comandas.pendientesCocina({}, mesero);
    expect(cocinaItems.filter((i) => i.comandaId === c1.id)).toHaveLength(3);
    const ids1 = (await env.servicios.comandas.obtener(c1.id, mesero)).items.map((i) => i.id);
    await env.servicios.comandas.cambiarEstadoItem(c1.id, ids1[0] as string, { estado: "LISTO" }, mesero);
    await env.servicios.comandas.cambiarEstadoItem(c1.id, ids1[0] as string, { estado: "ENTREGADO" }, mesero);
    const r1 = await cobro(c1.id, { itemIds: [ids1[0] as string, ids1[1] as string], propina: 2 });
    expect(r1.cerrada).toBe(false);
    const r1b = await cobro(c1.id);
    expect(r1b.cerrada).toBe(true);
    await ok(env);

    // Mesa 2: división en 3 partes iguales con propina en la última
    const c2 = await abrir(m2);
    await pedir(c2.id, [{ productoId: plato.id, cantidad: 3 }, { productoId: bebida.id, cantidad: 4 }]);
    for (const parte of [1, 2, 3]) await cobro(c2.id, { modo: "PARTE_IGUAL", partes: 3, parte, propina: parte === 3 ? 1.5 : 0 });
    await ok(env);

    // Mesa 3: cuenta anulada por supervisor (con ítems enviados)
    const c3 = await abrir(m3);
    await pedir(c3.id, [{ productoId: plato.id, cantidad: 1 }]);
    await env.servicios.comandas.enviar(c3.id, mesero);
    await env.servicios.comandas.anular(c3.id, { motivo: "Los comensales se fueron" }, supervisor);

    // Mesas 4 y 5: se unen y se cobran juntas; mesa 6 queda abierta; la cuenta 5→mesa libre
    const c4 = await abrir(m4);
    const c5 = await abrir(m5);
    await pedir(c4.id, [{ productoId: plato.id, cantidad: 1 }]);
    await pedir(c5.id, [{ productoId: bebida.id, cantidad: 2 }, { productoId: postre.id, cantidad: 2 }]);
    await env.servicios.comandas.unir(c5.id, { comandaDestinoId: c4.id }, mesero);
    const c6 = await abrir(m6);
    await pedir(c6.id, [{ productoId: plato.id, cantidad: 2 }]);
    await env.servicios.comandas.mover(c6.id, { mesaId: m5.id }, mesero); // m5 quedó libre tras unir
    // 10 (plato) + 4 (jugos) + 6 (flanes, sin IVA) = 20; IVA 15 % solo sobre 14 = 2.10 → 22.10
    const r4 = await cobro(c4.id, { pagos: [{ formaPago: "TARJETA_CREDITO", monto: 22.1 }] });
    expect(r4).toMatchObject({ cerrada: true, venta: { subtotal: 20, iva: 2.1, total: 22.1 } });
    await ok(env);

    // La cuenta de la mesa 5 (antes mesa 6) sigue abierta: el plano y el stock lo reflejan
    const plano = await env.servicios.mesas.listar({}, mesero);
    expect(plano.find((m) => m.id === m5.id)?.cuenta).toMatchObject({ consumo: 20, items: 1 });
    expect(plano.find((m) => m.id === m4.id)?.estado).toBe("LIBRE");

    // Cuentas y ventas
    expect(await env.prisma.comanda.count({ where: { estado: "ABIERTA" } })).toBe(1);
    expect(await env.prisma.cobroComanda.count()).toBe(2 + 3 + 1);
    expect(await env.prisma.venta.count()).toBe(6);

    // Cierre de caja ciego sin diferencia
    const turno = await env.servicios.turnos.actual(cajero);
    const esperado = (await env.servicios.turnos.reporte(turno.id, supervisor)).efectivo?.esperado as number;
    const cierre = await env.servicios.turnos.cerrar(turno.id, { efectivoContado: esperado }, cajero);
    expect(cierre.efectivo?.diferencia).toBe(0);
    await ok(env);
  });
});

// ─────────────────────────────────────────────────────────────
describe("Concurrencia mixta sobre un mismo negocio", () => {
  let env: Entorno;
  let supervisor: ActorCaja;
  let bodeguero: ActorCaja;
  let cajeros: ActorCaja[];

  beforeAll(async () => {
    env = await crearEntorno();
    supervisor = await crearActor(env, "SUPERVISOR", "conc.super");
    bodeguero = await crearActor(env, "BODEGUERO", "conc.bodega");
    cajeros = [];
    for (const n of [1, 2, 3]) {
      const c = await crearActor(env, "CAJERO", `conc.caja${n}`);
      await abrirTurno(env, c.id);
      cajeros.push(c);
    }
  }, 60_000);
  afterAll(async () => env.cerrar());

  it("ventas, anulaciones, abonos, compras, ajustes y movimientos simultáneos no rompen ningún invariante", async () => {
    const libre = await crearProducto(env, { codigo: "LIBRE", precioVenta: 2, stock: 500, costo: 1 });
    const justo = await crearProducto(env, { codigo: "JUSTO", precioVenta: 2, stock: 10, costo: 1 }); // 10 unidades para 25 ventas
    const proveedores = [await crearProveedor(env), await crearProveedor(env), await crearProveedor(env)];
    const clientes = [];
    for (const [i, rucBase] of ["0926687856", "1710034065", "0992339411"].entries()) {
      clientes.push(await crearClienteConCredito(env, `${rucBase}001`, 500, 15 + i));
    }

    // Estado previo: ventas a crédito (para abonos) y ventas normales (para anular)
    const aCredito = [];
    for (const c of clientes) aCredito.push(await venta(env, cajeros[0] as ActorCaja, [{ productoId: libre.id, cantidad: 20 }], [{ formaPago: "CREDITO", monto: 46 }], { clienteId: c.id }));
    const paraAnular = [];
    for (let i = 0; i < 5; i++) paraAnular.push(await venta(env, cajeros[1] as ActorCaja, [{ productoId: libre.id, cantidad: 2 }], [{ formaPago: "EFECTIVO", monto: 5 }]));
    const cuentas = await env.prisma.cuentaPorCobrar.findMany();

    const tareas: Array<{ nombre: string; correr: () => Promise<unknown> }> = [];
    // 25 ventas de un producto con 10 unidades: exactamente 10 deben prosperar
    for (let i = 0; i < 25; i++) tareas.push({ nombre: "venta-justo", correr: () => venta(env, cajeros[i % 3] as ActorCaja, [{ productoId: justo.id, cantidad: 1 }], [{ formaPago: i % 2 === 0 ? "EFECTIVO" : "TARJETA_CREDITO", monto: i % 2 === 0 ? 5 : 2.3 }]) });
    for (let i = 0; i < 20; i++) tareas.push({ nombre: "venta-libre", correr: () => venta(env, cajeros[i % 3] as ActorCaja, [{ productoId: libre.id, cantidad: 1 + (i % 3) }], [{ formaPago: "EFECTIVO", monto: 20 }]) });
    for (const v of paraAnular) {
      tareas.push({ nombre: "anular", correr: () => env.servicios.ventas.anular(v.id, { motivo: "Anulación concurrente" }, supervisor) });
      tareas.push({ nombre: "anular", correr: () => env.servicios.ventas.anular(v.id, { motivo: "Anulación concurrente 2" }, supervisor) }); // duplicada a propósito
    }
    for (const c of cuentas) {
      for (let i = 0; i < 3; i++) tareas.push({ nombre: "abono", correr: () => env.servicios.cuentasPorCobrar.registrarAbono(c.id, { monto: 20, formaPago: i === 0 ? "EFECTIVO" : "TRANSFERENCIA" }, cajeros[0] as ActorCaja) });
    }
    proveedores.forEach((p, i) =>
      tareas.push({ nombre: "compra", correr: () => env.servicios.compras.crear({ proveedorId: p.id, sucursalId: env.seed.sucursalId, numeroFactura: `CC-${i}`, formaPago: i === 0 ? "CREDITO" : "CONTADO", lineas: [{ productoId: libre.id, cantidad: 30, costoUnitario: 1.2 + i }] }, bodeguero) })
    );
    for (let i = 0; i < 4; i++) tareas.push({ nombre: "ajuste", correr: () => env.servicios.inventario.ajustar({ productoId: libre.id, tipo: "SALIDA", cantidad: 2, motivo: "Merma por rotura" }, bodeguero) });
    for (const c of cajeros) {
      const turnoId = (await env.servicios.turnos.actual(c)).id;
      tareas.push({ nombre: "movimiento", correr: () => env.servicios.turnos.registrarMovimiento(turnoId, { tipo: "INGRESO", concepto: "Fondo adicional", monto: 10 }, c) });
    }

    // Se lanzan todas a la vez (orden mezclado)
    const mezcladas = [...tareas].sort((a, b) => (a.nombre + (a.correr.toString().length % 7)).localeCompare(b.nombre + (b.correr.toString().length % 5)));
    const resultados = await Promise.allSettled(mezcladas.map((t) => t.correr()));

    // Todo fallo debe ser un error de dominio esperado (nunca un timeout/lock de la BD ni un error interno)
    const permitidos = new Set(["STOCK_INSUFICIENTE", "ESTADO_INVALIDO", "VALIDACION"]);
    const inesperados = resultados.flatMap((r, i) =>
      r.status === "rejected" && !permitidos.has((r.reason as { codigo?: string }).codigo ?? "")
        ? [`${mezcladas[i]?.nombre}: ${String((r.reason as Error).message).slice(0, 120)}`]
        : []
    );
    expect(inesperados).toEqual([]);

    const resultadoDe = (nombre: string) => resultados.filter((_, i) => mezcladas[i]?.nombre === nombre);
    expect(resultadoDe("venta-justo").filter((r) => r.status === "fulfilled")).toHaveLength(10); // sin sobreventa
    expect(resultadoDe("anular").filter((r) => r.status === "fulfilled")).toHaveLength(5); // una por venta
    expect((await env.prisma.producto.findUniqueOrThrow({ where: { id: justo.id } })).stockActual).toBe(0);

    await ok(env);
  }, 180_000);
});

// ─────────────────────────────────────────────────────────────
describe("Meta-prueba: el verificador detecta corrupción de datos", () => {
  let env: Entorno;
  let cajero: ActorCaja;

  beforeAll(async () => {
    env = await crearEntorno();
    cajero = await crearActor(env, "CAJERO", "meta.caja");
    await abrirTurno(env, cajero.id);
    const p = await crearProducto(env, { codigo: "META", precioVenta: 10, stock: 20, costo: 4 });
    await venta(env, cajero, [{ productoId: p.id, cantidad: 3 }], [{ formaPago: "EFECTIVO", monto: 40 }]);
    const cliente = await crearClienteConCredito(env, "0926687856001", 100);
    await venta(env, cajero, [{ productoId: p.id, cantidad: 2 }], [{ formaPago: "CREDITO", monto: 23 }], { clienteId: cliente.id });
  }, 60_000);
  afterAll(async () => env.cerrar());

  it("un negocio sano no tiene violaciones", async () => {
    expect(await verificarInvariantes(env)).toEqual([]);
  });

  const corromper = async (descripcion: string, etiqueta: string, danar: () => Promise<unknown>, reparar: () => Promise<unknown>) => {
    await danar();
    try {
      const v = await verificarInvariantes(env);
      expect(v.some((x) => x.startsWith(etiqueta)), `${descripcion}: se esperaba una violación ${etiqueta}; hubo ${JSON.stringify(v)}`).toBe(true);
    } finally {
      await reparar();
    }
    expect(await verificarInvariantes(env)).toEqual([]);
  };

  it("stock que no coincide con el Kardex", async () => {
    const p = await env.prisma.producto.findFirstOrThrow({ where: { codigo: "META" } });
    await corromper("stock +1", "[stock]", () => env.prisma.producto.update({ where: { id: p.id }, data: { stockActual: { increment: 1 } } }), () => env.prisma.producto.update({ where: { id: p.id }, data: { stockActual: p.stockActual } }));
  });

  it("total de venta que no cuadra con sus líneas", async () => {
    const v = await env.prisma.venta.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    await corromper("total +5", "[venta]", () => env.prisma.venta.update({ where: { id: v.id }, data: { total: v.total + 5 } }), () => env.prisma.venta.update({ where: { id: v.id }, data: { total: v.total } }));
  });

  it("hueco en la numeración de ventas", async () => {
    const pt = await env.prisma.puntoEmision.findUniqueOrThrow({ where: { id: env.seed.puntoEmisionId } });
    await corromper("contador +1", "[secuencial]", () => env.prisma.puntoEmision.update({ where: { id: pt.id }, data: { secuencialVenta: { increment: 1 } } }), () => env.prisma.puntoEmision.update({ where: { id: pt.id }, data: { secuencialVenta: pt.secuencialVenta } }));
  });

  it("saldo de cartera inconsistente", async () => {
    const c = await env.prisma.cuentaPorCobrar.findFirstOrThrow();
    await corromper("saldo −5", "[cxc]", () => env.prisma.cuentaPorCobrar.update({ where: { id: c.id }, data: { saldo: c.saldo - 5 } }), () => env.prisma.cuentaPorCobrar.update({ where: { id: c.id }, data: { saldo: c.saldo } }));
  });

  it("pago de venta alterado (el neto cobrado deja de coincidir con total + propina)", async () => {
    await corromper("pago +1", "[venta]", () => env.prisma.pagoVenta.updateMany({ data: { monto: { increment: 1 } } }), () => env.prisma.pagoVenta.updateMany({ data: { monto: { decrement: 1 } } }));
  });

  it("movimiento de Kardex huérfano (cadena rota)", async () => {
    const mov = await env.prisma.kardex.findFirstOrThrow({ where: { tipoMovimiento: "VENTA" } });
    await corromper("stockAnterior alterado", "[kardex]", () => env.prisma.kardex.update({ where: { id: mov.id }, data: { stockAnterior: mov.stockAnterior + 3 } }), () => env.prisma.kardex.update({ where: { id: mov.id }, data: { stockAnterior: mov.stockAnterior } }));
  });

  it("arqueo guardado de un turno cerrado que no cuadra con sus ventas y movimientos", async () => {
    const supervisor: ActorCaja = { id: env.seed.adminId, empresaId: env.seed.empresaId, permisos: ["caja:actualizar"] };
    const turno = await env.servicios.turnos.actual(cajero);
    const esperado = (await env.servicios.turnos.reporte(turno.id, supervisor)).efectivo?.esperado as number;
    await env.servicios.turnos.cerrar(turno.id, { efectivoContado: esperado - 1 }, cajero);
    expect(await verificarInvariantes(env)).toEqual([]); // cierre legítimo, con faltante de 1.00

    await corromper(
      "esperado guardado +5", "[caja]",
      () => env.prisma.turnoCaja.update({ where: { id: turno.id }, data: { montoCierreReal: esperado + 5 } }),
      () => env.prisma.turnoCaja.update({ where: { id: turno.id }, data: { montoCierreReal: esperado } })
    );
    await corromper(
      "diferencia guardada incoherente", "[caja]",
      () => env.prisma.turnoCaja.update({ where: { id: turno.id }, data: { diferencia: 99 } }),
      () => env.prisma.turnoCaja.update({ where: { id: turno.id }, data: { diferencia: -1 } })
    );
  });
});
