// ============================================================
// tests/integration/server/farmacia.test.ts
// Módulo Farmacia: lotes, FEFO, compras con lote, ajustes, alertas y feature flags.
// ============================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Producto } from "@prisma/client";
import type { ActorCaja } from "../../../src/server/services/turno.service";
import {
  abrirTurno, codigoError, configurarGiro, crearActor, crearEntorno, crearLote, crearProducto, crearProveedor, type Entorno,
} from "../helpers/entorno.helper";

let env: Entorno;
let admin: ActorCaja;
let cajero: ActorCaja;
let supervisor: ActorCaja;

const DIA = 86_400_000;
const enDias = (n: number): Date => new Date(Date.now() + n * DIA);

beforeAll(async () => {
  env = await crearEntorno();
  admin = await crearActor(env, "ADMIN", "admin.farma");
  cajero = await crearActor(env, "CAJERO", "cajero.farma");
  supervisor = await crearActor(env, "SUPERVISOR", "super.farma");
  await abrirTurno(env, cajero.id);
}, 60_000);

afterAll(async () => {
  await env.cerrar();
});

let secuencia = 0;
/** Medicamento nuevo con lotes (aplicaIva false = tarifa 0%). */
const medicamento = (extra: Record<string, unknown> = {}): Promise<Producto> => {
  secuencia += 1;
  return crearProducto(env, {
    codigo: `MED${secuencia}`, precioVenta: 2, costo: 1, aplicaIva: false, requiereLote: true, tieneVencimiento: true,
    principioActivo: "paracetamol", ...extra,
  });
};

const stockDe = async (id: string): Promise<number> => (await env.prisma.producto.findUniqueOrThrow({ where: { id } })).stockActual;
const loteDe = (id: string) => env.prisma.lote.findUniqueOrThrow({ where: { id } });

const vender = (actor: ActorCaja, lineas: unknown[], monto = 10_000) =>
  env.servicios.ventas.crear(
    { puntoEmisionId: env.seed.puntoEmisionId, lineas, pagos: [{ formaPago: "EFECTIVO", monto }] },
    actor
  );

describe("Feature flags del giro (Retail: lotes y vencimientos deshabilitados)", () => {
  it("no se puede crear un producto con lote ni consultar lotes/vencimientos", async () => {
    const datos = {
      codigo: "FLAG-1", nombre: "Medicina", tipo: "BIEN", categoriaId: env.categoriaId, unidadMedidaId: env.unidadMedidaId,
      precioCompra: 1, precioVenta: 2,
    };
    expect(await codigoError(env.servicios.inventario.crearProducto({ ...datos, requiereLote: true }, admin))).toBe("MODULO_DESHABILITADO");
    expect(await codigoError(env.servicios.inventario.crearProducto({ ...datos, codigo: "FLAG-2", tieneVencimiento: true }, admin))).toBe("MODULO_DESHABILITADO");
    expect(await codigoError(env.servicios.lotes.listar({}, admin))).toBe("MODULO_DESHABILITADO");
    expect(await codigoError(env.servicios.inventario.alertasVencimiento({}, admin))).toBe("MODULO_DESHABILITADO");
    // un producto normal sí se crea
    expect((await env.servicios.inventario.crearProducto({ ...datos, codigo: "FLAG-3" }, admin)).codigo).toBe("FLAG-3");
  });

  it("activar el módulo de lotes habilita la operación (y vencimientos por separado)", async () => {
    await configurarGiro(env, { moduloLotes: true });
    expect(await codigoError(env.servicios.lotes.listar({}, admin))).toBe("SIN_ERROR");
    expect(await codigoError(env.servicios.inventario.alertasVencimiento({}, admin))).toBe("MODULO_DESHABILITADO");
    await configurarGiro(env, { moduloVencimientos: true });
    expect(await codigoError(env.servicios.inventario.alertasVencimiento({}, admin))).toBe("SIN_ERROR");
  });
});

describe("Productos con lote", () => {
  it("requiereLote solo aplica a bienes; no se cambia con existencias; búsqueda por principio activo", async () => {
    const datos = { nombre: "Med", categoriaId: env.categoriaId, unidadMedidaId: env.unidadMedidaId, precioCompra: 1, precioVenta: 2 };
    expect(await codigoError(env.servicios.inventario.crearProducto({ ...datos, codigo: "SRV-L", tipo: "SERVICIO", requiereLote: true }, admin))).toBe("VALIDACION");

    const normal = await crearProducto(env, { codigo: "NORMAL-L", stock: 5 });
    expect(await codigoError(env.servicios.inventario.actualizarProducto(normal.id, { requiereLote: true }, admin))).toBe("VALIDACION"); // tiene stock
    const vacio = await crearProducto(env, { codigo: "VACIO-L" });
    expect((await env.servicios.inventario.actualizarProducto(vacio.id, { requiereLote: true }, admin)).requiereLote).toBe(true);

    const med = await env.servicios.inventario.crearProducto(
      { ...datos, codigo: "PARA-500", tipo: "BIEN", requiereLote: true, principioActivo: "paracetamol", concentracion: "500 mg", formaFarmaceutica: "Tableta" },
      admin
    );
    expect(med).toMatchObject({ principioActivo: "paracetamol", concentracion: "500 mg", formaFarmaceutica: "Tableta" });
    const hallados = await env.servicios.productos.buscar({ search: "paraceta" });
    expect(hallados.items.map((p) => p.codigo)).toContain("PARA-500");
  });
});

describe("Lotes: alta, listado y edición", () => {
  it("el alta de un lote es una entrada de inventario (stock + Kardex) y repone el lote existente", async () => {
    const med = await medicamento();
    const lote = await crearLote(env, admin, { productoId: med.id, numeroLote: "L-001", dias: 90, cantidad: 50, costo: 1.2 });
    expect(lote).toMatchObject({ numeroLote: "L-001", cantidadInicial: 50, cantidadActual: 50, status: "ACTIVO" });
    expect(lote.producto.principioActivo).toBe("paracetamol");
    expect(await stockDe(med.id)).toBe(50);

    const mov = await env.prisma.kardex.findFirstOrThrow({ where: { productoId: med.id } });
    expect(mov).toMatchObject({ tipoMovimiento: "AJUSTE_ENTRADA", cantidad: 50, costoUnitario: 1.2, referencia: lote.id });

    // mismo número y misma fecha → suma al lote existente
    const fecha = lote.fechaVencimiento;
    const repuesto = await env.servicios.lotes.crear(
      { productoId: med.id, numeroLote: "L-001", fechaVencimiento: fecha, cantidad: 10, costoUnitario: 1.4 },
      admin
    );
    expect(repuesto).toMatchObject({ id: lote.id, cantidadActual: 60, cantidadInicial: 60 });
    expect(await stockDe(med.id)).toBe(60);
  });

  it("validaciones: otra fecha para el mismo lote, lote vencido, producto sin lote, cantidades y fechas", async () => {
    const med = await medicamento();
    await crearLote(env, admin, { productoId: med.id, numeroLote: "L-X", dias: 30, cantidad: 5 });
    const crear = (e: Record<string, unknown>) =>
      env.servicios.lotes.crear({ productoId: med.id, numeroLote: "L-N", fechaVencimiento: enDias(30), cantidad: 5, costoUnitario: 1, ...e }, admin);

    expect(await codigoError(crear({ numeroLote: "L-X", fechaVencimiento: enDias(60) }))).toBe("VALIDACION");
    expect(await codigoError(crear({ fechaVencimiento: enDias(-1) }))).toBe("VALIDACION");
    expect(await codigoError(crear({ cantidad: 0 }))).toBe("VALIDACION");
    expect(await codigoError(crear({ costoUnitario: -1 }))).toBe("VALIDACION");
    expect(await codigoError(crear({ fechaFabricacion: enDias(40) }))).toBe("VALIDACION");
    expect(await codigoError(crear({ productoId: "11111111-1111-4111-8111-111111111111" }))).toBe("NO_ENCONTRADO");

    const normal = await crearProducto(env, { codigo: `NOLOTE${++secuencia}` });
    expect(await codigoError(crear({ productoId: normal.id }))).toBe("VALIDACION");
    expect(await stockDe(med.id)).toBe(5); // nada de lo rechazado dejó rastro
  });

  it("listar con filtros, obtener y actualizar (fechas / bloqueo)", async () => {
    const med = await medicamento();
    const a = await crearLote(env, admin, { productoId: med.id, numeroLote: "A", dias: 20, cantidad: 5 });
    const b = await crearLote(env, admin, { productoId: med.id, numeroLote: "B", dias: 10, cantidad: 5 });

    const todos = await env.servicios.lotes.listar({ productoId: med.id }, admin);
    expect(todos.items.map((l) => l.numeroLote)).toEqual(["B", "A"]); // por vencimiento
    expect((await env.servicios.lotes.obtener(a.id, admin)).numeroLote).toBe("A");
    expect(await codigoError(env.servicios.lotes.obtener("no-existe", admin))).toBe("NO_ENCONTRADO");

    const bloqueado = await env.servicios.lotes.actualizar(b.id, { status: "BLOQUEADO" }, admin);
    expect(bloqueado.status).toBe("BLOQUEADO");
    expect((await env.servicios.lotes.listar({ productoId: med.id, status: "BLOQUEADO" }, admin)).items.map((l) => l.numeroLote)).toEqual(["B"]);
    expect((await env.servicios.lotes.listar({ productoId: med.id, page: "2", pageSize: "1" }, admin)).items).toHaveLength(1);

    const nuevaFecha = enDias(100);
    expect((await env.servicios.lotes.actualizar(a.id, { fechaVencimiento: nuevaFecha }, admin)).fechaVencimiento.getTime()).toBe(nuevaFecha.getTime());
    expect(await codigoError(env.servicios.lotes.actualizar(a.id, { fechaFabricacion: enDias(200) }, admin))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.lotes.actualizar(a.id, { status: "OTRO" }, admin))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.lotes.actualizar("no-existe", { status: "ACTIVO" }, admin))).toBe("NO_ENCONTRADO");
  });

  it("un lote bloqueado no admite nuevos ingresos", async () => {
    const med = await medicamento();
    const l = await crearLote(env, admin, { productoId: med.id, numeroLote: "BLK", dias: 30, cantidad: 5 });
    await env.servicios.lotes.actualizar(l.id, { status: "BLOQUEADO" }, admin);
    expect(
      await codigoError(env.servicios.lotes.crear({ productoId: med.id, numeroLote: "BLK", fechaVencimiento: l.fechaVencimiento, cantidad: 1, costoUnitario: 1 }, admin))
    ).toBe("VALIDACION");
  });
});

describe("Venta con selección automática FEFO", () => {
  let med: Producto;
  let loteA: { id: string }; // vence 10 d, 5 u
  let loteB: { id: string }; // vence 40 d, 20 u
  let loteC: { id: string }; // vence 5 d, 3 u
  let loteD: { id: string }; // vencido, 10 u
  let loteE: { id: string }; // bloqueado, 10 u

  beforeAll(async () => {
    med = await medicamento({ stockMinimo: 20 });
    loteA = await crearLote(env, admin, { productoId: med.id, numeroLote: "A", dias: 10, cantidad: 5 });
    loteB = await crearLote(env, admin, { productoId: med.id, numeroLote: "B", dias: 40, cantidad: 20 });
    loteC = await crearLote(env, admin, { productoId: med.id, numeroLote: "C", dias: 5, cantidad: 3 });
    loteD = await crearLote(env, admin, { productoId: med.id, numeroLote: "D", dias: 30, cantidad: 10 });
    loteE = await crearLote(env, admin, { productoId: med.id, numeroLote: "E", dias: 1, cantidad: 10 });
    await env.prisma.lote.update({ where: { id: loteD.id }, data: { fechaVencimiento: enDias(-1) } }); // ya vencido
    await env.servicios.lotes.actualizar(loteE.id, { status: "BLOQUEADO" }, admin);
  });

  it("asigna el lote que vence primero y reparte la cantidad entre lotes, ignorando vencidos y bloqueados", async () => {
    expect(await stockDe(med.id)).toBe(48);
    const v = await vender(cajero, [{ productoId: med.id, cantidad: 6 }]);

    // C (3) → A (3); B, D y E no se tocan
    const porLote = Object.fromEntries(v.lineas.map((l) => [l.loteId, l.cantidad]));
    expect(porLote).toEqual({ [loteC.id]: 3, [loteA.id]: 3 });
    expect(v.lineas.every((l) => l.cantidadBase === l.cantidad && l.productoId === med.id)).toBe(true);
    expect(v.subtotal).toBe(12); // 6 × 2.00 repartido en dos líneas

    expect((await loteDe(loteC.id)).cantidadActual).toBe(0);
    expect((await loteDe(loteA.id)).cantidadActual).toBe(2);
    expect((await loteDe(loteB.id)).cantidadActual).toBe(20);
    expect((await loteDe(loteD.id)).cantidadActual).toBe(10);
    expect((await loteDe(loteE.id)).cantidadActual).toBe(10);
    expect(await stockDe(med.id)).toBe(42);
    expect(await env.prisma.kardex.count({ where: { productoId: med.id, tipoMovimiento: "VENTA", referencia: v.id } })).toBe(2);
  });

  it("la venta siguiente continúa con el lote vigente más próximo a vencer", async () => {
    const v = await vender(cajero, [{ productoId: med.id, cantidad: 3 }]); // A tiene 2, luego B
    const porLote = Object.fromEntries(v.lineas.map((l) => [l.loteId, l.cantidad]));
    expect(porLote).toEqual({ [loteA.id]: 2, [loteB.id]: 1 });
    expect((await loteDe(loteA.id)).cantidadActual).toBe(0);
    expect((await loteDe(loteB.id)).cantidadActual).toBe(19);
  });

  it("el descuento por valor se prorratea entre los lotes y la suma es exacta", async () => {
    const m = await medicamento();
    await crearLote(env, admin, { productoId: m.id, numeroLote: "P1", dias: 10, cantidad: 3 });
    await crearLote(env, admin, { productoId: m.id, numeroLote: "P2", dias: 20, cantidad: 10 });
    const v = await vender(cajero, [{ productoId: m.id, cantidad: 6, descuento: 1.01, tipoDescuento: "VALOR" }]);
    expect(v.lineas).toHaveLength(2);
    expect(v.descuento).toBe(1.01);
    expect(v.subtotal).toBe(10.99); // 12.00 − 1.01
  });

  it("descuento porcentual se mantiene en cada línea", async () => {
    const m = await medicamento();
    await crearLote(env, admin, { productoId: m.id, numeroLote: "Q1", dias: 10, cantidad: 3 });
    await crearLote(env, admin, { productoId: m.id, numeroLote: "Q2", dias: 20, cantidad: 10 });
    const v = await vender(cajero, [{ productoId: m.id, cantidad: 6, descuento: 10, tipoDescuento: "PORCENTAJE" }]);
    expect(v.lineas.map((l) => l.descuento)).toEqual([0.6, 0.6]); // 3 u + 3 u, 10 % de 6.00 cada una
    expect(v.subtotal).toBe(10.8);
  });

  it("no alcanzan los lotes vigentes aunque el stock total (con lotes vencidos/bloqueados) sí → STOCK_INSUFICIENTE y rollback", async () => {
    const m = await medicamento();
    const bueno = await crearLote(env, admin, { productoId: m.id, numeroLote: "OK", dias: 10, cantidad: 4 });
    const vencido = await crearLote(env, admin, { productoId: m.id, numeroLote: "VENC", dias: 10, cantidad: 50 });
    await env.prisma.lote.update({ where: { id: vencido.id }, data: { fechaVencimiento: enDias(-3) } });
    expect(await stockDe(m.id)).toBe(54);

    const ventas = await env.prisma.venta.count();
    expect(await codigoError(vender(cajero, [{ productoId: m.id, cantidad: 10 }]))).toBe("STOCK_INSUFICIENTE");
    expect(await env.prisma.venta.count()).toBe(ventas);
    expect(await stockDe(m.id)).toBe(54);
    expect((await loteDe(bueno.id)).cantidadActual).toBe(4);
  });

  it("dos líneas del mismo producto en una venta no consumen dos veces el mismo lote", async () => {
    const m = await medicamento();
    const l1 = await crearLote(env, admin, { productoId: m.id, numeroLote: "X1", dias: 10, cantidad: 5 });
    const l2 = await crearLote(env, admin, { productoId: m.id, numeroLote: "X2", dias: 20, cantidad: 20 });
    const v = await vender(cajero, [
      { productoId: m.id, cantidad: 4 },
      { productoId: m.id, cantidad: 4 },
    ]);
    expect((await loteDe(l1.id)).cantidadActual).toBe(0);
    expect((await loteDe(l2.id)).cantidadActual).toBe(17);
    expect(v.lineas.reduce((a, l) => a + l.cantidad, 0)).toBe(8);
    expect(await stockDe(m.id)).toBe(17);
  });

  it("lote explícito: se respeta; vencido, bloqueado, de otro producto o insuficiente se rechazan", async () => {
    const m = await medicamento();
    const lote = await crearLote(env, admin, { productoId: m.id, numeroLote: "EX1", dias: 10, cantidad: 5 });
    const otro = await crearLote(env, admin, { productoId: m.id, numeroLote: "EX2", dias: 5, cantidad: 5 }); // vencería antes (FEFO elegiría este)
    await vender(cajero, [{ productoId: m.id, cantidad: 2, loteId: lote.id }]);
    expect((await loteDe(lote.id)).cantidadActual).toBe(3);
    expect((await loteDe(otro.id)).cantidadActual).toBe(5);

    expect(await codigoError(vender(cajero, [{ productoId: m.id, cantidad: 9, loteId: lote.id }]))).toBe("STOCK_INSUFICIENTE");
    await env.prisma.lote.update({ where: { id: otro.id }, data: { fechaVencimiento: enDias(-1) } });
    expect(await codigoError(vender(cajero, [{ productoId: m.id, cantidad: 1, loteId: otro.id }]))).toBe("VALIDACION");
    const ajeno = await medicamento();
    expect(await codigoError(vender(cajero, [{ productoId: ajeno.id, cantidad: 1, loteId: lote.id }]))).toBe("NO_ENCONTRADO");
  });

  it("con presentación, FEFO puede partir la caja entre lotes (cantidad fraccionada en unidades de venta)", async () => {
    const m = await medicamento();
    const caja = await env.servicios.presentaciones.crear(m.id, { nombre: "Caja x10", factor: 10, precioVenta: 18 });
    const l1 = await crearLote(env, admin, { productoId: m.id, numeroLote: "CJ1", dias: 10, cantidad: 15 });
    const l2 = await crearLote(env, admin, { productoId: m.id, numeroLote: "CJ2", dias: 20, cantidad: 20 });

    const v = await vender(cajero, [{ productoId: m.id, presentacionId: caja.id, cantidad: 2 }]); // 20 u base: 15 + 5
    const porLote = Object.fromEntries(v.lineas.map((l) => [l.loteId, { cant: l.cantidad, base: l.cantidadBase }]));
    expect(porLote).toEqual({ [l1.id]: { cant: 1.5, base: 15 }, [l2.id]: { cant: 0.5, base: 5 } });
    expect(v.subtotal).toBe(36); // 2 cajas × 18.00
    expect(await stockDe(m.id)).toBe(15);

    // la anulación devuelve exactamente lo descontado de cada lote
    await env.servicios.ventas.anular(v.id, { motivo: "Se devuelve la caja" }, supervisor);
    expect((await loteDe(l1.id)).cantidadActual).toBe(15);
    expect((await loteDe(l2.id)).cantidadActual).toBe(20);
    expect(await stockDe(m.id)).toBe(35);
  });

  it("anular una venta repartida entre lotes repone cada lote y el stock", async () => {
    const m = await medicamento();
    const l1 = await crearLote(env, admin, { productoId: m.id, numeroLote: "R1", dias: 10, cantidad: 4 });
    const l2 = await crearLote(env, admin, { productoId: m.id, numeroLote: "R2", dias: 20, cantidad: 10 });
    const v = await vender(cajero, [{ productoId: m.id, cantidad: 7 }]);
    expect((await loteDe(l1.id)).cantidadActual).toBe(0);
    expect((await loteDe(l2.id)).cantidadActual).toBe(7);

    await env.servicios.ventas.anular(v.id, { motivo: "Receta anulada" }, supervisor);
    expect((await loteDe(l1.id)).cantidadActual).toBe(4);
    expect((await loteDe(l2.id)).cantidadActual).toBe(10);
    expect(await stockDe(m.id)).toBe(14);
    expect(await env.prisma.kardex.count({ where: { productoId: m.id, tipoMovimiento: "DEVOLUCION" } })).toBe(2);
  });
});

describe("Compras con lote", () => {
  const compra = (proveedorId: string, lineas: unknown[], extra: Record<string, unknown> = {}) =>
    env.servicios.compras.crear(
      { proveedorId, sucursalId: env.seed.sucursalId, numeroFactura: `F-${Math.random().toString(36).slice(2, 10)}`, lineas, ...extra },
      admin
    );

  it("un producto con lote exige número y vencimiento; con ellos crea el lote ligado al proveedor", async () => {
    const med = await medicamento();
    const prov = await crearProveedor(env);

    expect(await codigoError(compra(prov.id, [{ productoId: med.id, cantidad: 10, costoUnitario: 1 }]))).toBe("VALIDACION");
    expect(await stockDe(med.id)).toBe(0);

    const venc = enDias(120);
    const c = await compra(prov.id, [{ productoId: med.id, cantidad: 10, costoUnitario: 1.5, lote: { numeroLote: "COMP-1", fechaVencimiento: venc } }]);
    expect(c.total).toBe(15);
    const lote = await env.prisma.lote.findUniqueOrThrow({ where: { productoId_numeroLote: { productoId: med.id, numeroLote: "COMP-1" } } });
    expect(lote).toMatchObject({ cantidadActual: 10, cantidadInicial: 10, proveedorId: prov.id });
    expect(await stockDe(med.id)).toBe(10);
    expect((await env.prisma.producto.findUniqueOrThrow({ where: { id: med.id } })).costoPromedio).toBe(1.5);

    // misma compra de reposición del mismo lote suma
    await compra(prov.id, [{ productoId: med.id, cantidad: 5, costoUnitario: 1.5, lote: { numeroLote: "COMP-1", fechaVencimiento: venc } }]);
    expect((await loteDe(lote.id)).cantidadActual).toBe(15);
    expect(await stockDe(med.id)).toBe(15);
  });

  it("rechaza lote vencido o con otra fecha, y lote en productos que no lo manejan; sin dejar rastro", async () => {
    const med = await medicamento();
    const normal = await crearProducto(env, { codigo: `PLANO${++secuencia}` });
    const prov = await crearProveedor(env);
    const compras = await env.prisma.compra.count();

    expect(await codigoError(compra(prov.id, [{ productoId: med.id, cantidad: 1, costoUnitario: 1, lote: { numeroLote: "V", fechaVencimiento: enDias(-1) } }]))).toBe("VALIDACION");
    expect(await codigoError(compra(prov.id, [{ productoId: normal.id, cantidad: 1, costoUnitario: 1, lote: { numeroLote: "Z", fechaVencimiento: enDias(10) } }]))).toBe("VALIDACION");
    await compra(prov.id, [{ productoId: med.id, cantidad: 2, costoUnitario: 1, lote: { numeroLote: "FIJO", fechaVencimiento: enDias(50) } }]);
    expect(await codigoError(compra(prov.id, [{ productoId: med.id, cantidad: 2, costoUnitario: 1, lote: { numeroLote: "FIJO", fechaVencimiento: enDias(80) } }]))).toBe("VALIDACION");

    expect(await env.prisma.compra.count()).toBe(compras + 1); // solo la válida
    expect(await stockDe(med.id)).toBe(2);
  });
});

describe("Ajustes de inventario y Kardex", () => {
  it("producto sin lote: entrada con costo y salida, con motivo en el Kardex", async () => {
    const p = await crearProducto(env, { codigo: `AJ${++secuencia}`, stock: 10, costo: 2 });
    const ent = await env.servicios.inventario.ajustar({ productoId: p.id, tipo: "ENTRADA", cantidad: 10, costoUnitario: 4, motivo: "Bonificación proveedor" }, admin);
    expect(ent.producto).toMatchObject({ stockActual: 20, costoPromedio: 3 });
    expect(ent.movimiento).toMatchObject({ tipoMovimiento: "AJUSTE_ENTRADA", observacion: "Ajuste: Bonificación proveedor" });

    const sal = await env.servicios.inventario.ajustar({ productoId: p.id, tipo: "SALIDA", cantidad: 5, motivo: "Merma por rotura" }, admin);
    expect(sal.producto.stockActual).toBe(15);
    expect(sal.movimiento).toMatchObject({ tipoMovimiento: "AJUSTE_SALIDA", costoUnitario: 3 });
  });

  it("validaciones: motivo, costo en entrada, stock, servicio y producto inexistente", async () => {
    const p = await crearProducto(env, { codigo: `AJV${++secuencia}`, stock: 2, costo: 1 });
    const ajustar = (e: Record<string, unknown>) => env.servicios.inventario.ajustar({ productoId: p.id, tipo: "SALIDA", cantidad: 1, motivo: "Conteo físico", ...e }, admin);
    expect(await codigoError(ajustar({ motivo: "ab" }))).toBe("VALIDACION");
    expect(await codigoError(ajustar({ tipo: "ENTRADA" }))).toBe("VALIDACION"); // falta costo
    expect(await codigoError(ajustar({ cantidad: 3 }))).toBe("STOCK_INSUFICIENTE");
    expect(await codigoError(ajustar({ cantidad: 0 }))).toBe("VALIDACION");
    expect(await codigoError(ajustar({ productoId: "11111111-1111-4111-8111-111111111111" }))).toBe("NO_ENCONTRADO");
    expect(await codigoError(ajustar({ loteId: "11111111-1111-4111-8111-111111111111" }))).toBe("VALIDACION"); // no maneja lotes
    const servicio = await crearProducto(env, { codigo: `SRVA${++secuencia}`, tipo: "SERVICIO" });
    expect(await codigoError(ajustar({ productoId: servicio.id }))).toBe("VALIDACION");
    expect(await stockDe(p.id)).toBe(2);
  });

  it("producto con lote: la entrada trae el lote y la salida indica de cuál descontar", async () => {
    const med = await medicamento();
    const ajustar = (e: Record<string, unknown>) => env.servicios.inventario.ajustar({ productoId: med.id, cantidad: 4, motivo: "Conteo de inventario", ...e }, admin);

    expect(await codigoError(ajustar({ tipo: "ENTRADA", costoUnitario: 1 }))).toBe("VALIDACION"); // falta lote
    const venc = enDias(60);
    await ajustar({ tipo: "ENTRADA", costoUnitario: 1, lote: { numeroLote: "AJ-L", fechaVencimiento: venc } });
    const lote = await env.prisma.lote.findUniqueOrThrow({ where: { productoId_numeroLote: { productoId: med.id, numeroLote: "AJ-L" } } });
    expect(lote.cantidadActual).toBe(4);
    expect(await stockDe(med.id)).toBe(4);

    expect(await codigoError(ajustar({ tipo: "SALIDA" }))).toBe("VALIDACION"); // falta loteId
    expect(await codigoError(ajustar({ tipo: "SALIDA", cantidad: 5, loteId: lote.id }))).toBe("STOCK_INSUFICIENTE");
    expect((await loteDe(lote.id)).cantidadActual).toBe(4);
    await ajustar({ tipo: "SALIDA", cantidad: 3, loteId: lote.id });
    expect((await loteDe(lote.id)).cantidadActual).toBe(1);
    expect(await stockDe(med.id)).toBe(1);
  });

  it("consulta de Kardex paginada, del más reciente al más antiguo", async () => {
    const p = await crearProducto(env, { codigo: `KX${++secuencia}`, stock: 10, costo: 1 });
    await env.servicios.inventario.ajustar({ productoId: p.id, tipo: "SALIDA", cantidad: 1, motivo: "Muestra gratis" }, admin);
    await env.servicios.inventario.ajustar({ productoId: p.id, tipo: "SALIDA", cantidad: 2, motivo: "Merma vencida" }, admin);

    const k = await env.servicios.inventario.kardexDe(p.id, {});
    expect(k.total).toBe(3);
    expect(k.items.map((m) => m.cantidad)).toEqual([2, 1, 10]);
    expect(k.items[0]).toMatchObject({ stockAnterior: 9, stockResultante: 7 });
    expect(k.producto.codigo).toBe(p.codigo);

    const pagina = await env.servicios.inventario.kardexDe(p.id, { page: "2", pageSize: "2" });
    expect(pagina.items).toHaveLength(1);
    expect(await codigoError(env.servicios.inventario.kardexDe("no-existe", {}))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.inventario.kardexDe(p.id, { pageSize: "9999" }))).toBe("VALIDACION");
  });
});

describe("Alertas de vencimiento y de stock mínimo", () => {
  it("clasifica lotes vencidos y por vencer dentro de la ventana, ordenados por fecha", async () => {
    const med = await medicamento({ principioActivo: "ibuprofeno" });
    const vencido = await crearLote(env, admin, { productoId: med.id, numeroLote: "V-OLD", dias: 30, cantidad: 4 });
    await env.prisma.lote.update({ where: { id: vencido.id }, data: { fechaVencimiento: enDias(-2) } });
    await crearLote(env, admin, { productoId: med.id, numeroLote: "V-5", dias: 5, cantidad: 3 });
    await crearLote(env, admin, { productoId: med.id, numeroLote: "V-20", dias: 20, cantidad: 3 });
    await crearLote(env, admin, { productoId: med.id, numeroLote: "V-60", dias: 60, cantidad: 3 });
    const agotado = await crearLote(env, admin, { productoId: med.id, numeroLote: "V-0", dias: 3, cantidad: 1 });
    await env.prisma.lote.update({ where: { id: agotado.id }, data: { cantidadActual: 0 } });
    const bloq = await crearLote(env, admin, { productoId: med.id, numeroLote: "V-BLK", dias: 4, cantidad: 3 });
    await env.servicios.lotes.actualizar(bloq.id, { status: "BLOQUEADO" }, admin);

    const r = await env.servicios.inventario.alertasVencimiento({ dias: "30" }, admin);
    const mios = (l: { productoId: string }) => l.productoId === med.id;
    expect(r.dias).toBe(30);
    expect(r.vencidos.filter(mios).map((a) => a.numeroLote)).toEqual(["V-OLD"]);
    expect(r.vencidos.find(mios)).toMatchObject({ diasRestantes: -2, cantidadActual: 4, principioActivo: "ibuprofeno", codigo: med.codigo });
    expect(r.porVencer.filter(mios).map((a) => a.numeroLote)).toEqual(["V-5", "V-20"]); // sin agotados, bloqueados ni V-60
    expect(r.porVencer.find((a) => a.numeroLote === "V-5")?.diasRestantes).toBe(5);

    const ventana = await env.servicios.inventario.alertasVencimiento({ dias: "0" }, admin);
    expect(ventana.porVencer.filter(mios)).toHaveLength(0);
    expect(ventana.vencidos.filter(mios)).toHaveLength(1);

    const ancha = await env.servicios.inventario.alertasVencimiento({ dias: "90" }, admin);
    expect(ancha.porVencer.filter(mios).map((a) => a.numeroLote)).toEqual(["V-5", "V-20", "V-60"]);
    expect((await env.servicios.inventario.alertasVencimiento({}, admin)).dias).toBe(30); // valor por defecto
    expect(await codigoError(env.servicios.inventario.alertasVencimiento({ dias: "-1" }, admin))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.inventario.alertasVencimiento({ dias: "999" }, admin))).toBe("VALIDACION");
  });

  it("alertas de stock mínimo: solo bienes activos con mínimo configurado y stock en/bajo el mínimo", async () => {
    const bajo = await crearProducto(env, { codigo: `MIN-BAJO${++secuencia}`, stock: 3, stockMinimo: 10 });
    const igual = await crearProducto(env, { codigo: `MIN-IGUAL${++secuencia}`, stock: 10, stockMinimo: 10 });
    const sobre = await crearProducto(env, { codigo: `MIN-OK${++secuencia}`, stock: 11, stockMinimo: 10 });
    const sinMinimo = await crearProducto(env, { codigo: `MIN-NO${++secuencia}`, stock: 0 });
    const inactivo = await crearProducto(env, { codigo: `MIN-INACT${++secuencia}`, stock: 1, stockMinimo: 10 });
    await env.prisma.producto.update({ where: { id: inactivo.id }, data: { status: "INACTIVO" } });

    const r = await env.servicios.inventario.alertasStock();
    const codigos = r.items.map((i) => i.codigo);
    expect(codigos).toEqual(expect.arrayContaining([bajo.codigo, igual.codigo]));
    for (const fuera of [sobre, sinMinimo, inactivo]) expect(codigos).not.toContain(fuera.codigo);
    expect(r.items.find((i) => i.codigo === bajo.codigo)).toMatchObject({ stockActual: 3, stockMinimo: 10, faltante: 7 });
    expect(r.total).toBe(r.items.length);
  });
});
