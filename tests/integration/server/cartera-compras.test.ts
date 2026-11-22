// ============================================================
// tests/integration/server/cartera-compras.test.ts
// Cuentas por cobrar (ventas a crédito), compras y cuentas por pagar.
// ============================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Producto } from "@prisma/client";
import type { ActorCaja } from "../../../src/server/services/turno.service";
import {
  abrirTurno, codigoError, crearActor, crearClienteConCredito, crearEntorno, crearProducto, crearProveedor, type Entorno,
} from "../helpers/entorno.helper";

let env: Entorno;
let producto: Producto;
let cajero: ActorCaja;
let bodeguero: ActorCaja;
let supervisor: ActorCaja;

beforeAll(async () => {
  env = await crearEntorno();
  producto = await crearProducto(env, { codigo: "CR1", precioVenta: 10, stock: 1000, costo: 4 });
  cajero = await crearActor(env, "CAJERO", "cajero.cartera");
  bodeguero = await crearActor(env, "BODEGUERO", "bodeguero.cartera");
  supervisor = await crearActor(env, "SUPERVISOR", "super.cartera");
  await abrirTurno(env, cajero.id);
}, 60_000);

afterAll(async () => {
  await env.cerrar();
});

const DIA = 86_400_000;

const ventaCredito = (clienteId: string, monto: number, cantidad = 2) =>
  env.servicios.ventas.crear(
    {
      puntoEmisionId: env.seed.puntoEmisionId,
      clienteId,
      lineas: [{ productoId: producto.id, cantidad, precioUnitario: 10 }],
      pagos: [{ formaPago: "CREDITO", monto }],
    },
    cajero
  );

const stockDe = async (id: string): Promise<number> => (await env.prisma.producto.findUniqueOrThrow({ where: { id } })).stockActual;

const efectivoEsperado = async (actor: ActorCaja): Promise<number> => {
  const t = await env.servicios.turnos.actual(actor);
  const rep = await env.servicios.turnos.reporte(t.id, supervisor);
  return rep.efectivo?.esperado ?? NaN;
};

describe("Cuentas por cobrar — generación por venta a crédito", () => {
  it("crea la CxC con saldo, estado PENDIENTE y vencimiento = fecha + diasCredito; no mueve efectivo", async () => {
    const cliente = await crearClienteConCredito(env, "0926687856001", 100, 30);
    const antes = await efectivoEsperado(cajero);
    const v = await ventaCredito(cliente.id, 23);

    const cuenta = await env.prisma.cuentaPorCobrar.findUniqueOrThrow({ where: { ventaId: v.id } });
    expect(cuenta).toMatchObject({ clienteId: cliente.id, montoTotal: 23, saldo: 23, estado: "PENDIENTE" });
    const dias = Math.round((cuenta.fechaVencimiento.getTime() - cuenta.fechaEmision.getTime()) / DIA);
    expect(dias).toBe(30);
    expect(await efectivoEsperado(cajero)).toBe(antes);
  });

  it("una venta con pago mixto (crédito + efectivo) solo genera CxC por la parte a crédito", async () => {
    const cliente = await crearClienteConCredito(env, "1710034065001", 100, 15);
    const v = await env.servicios.ventas.crear(
      {
        puntoEmisionId: env.seed.puntoEmisionId,
        clienteId: cliente.id,
        lineas: [{ productoId: producto.id, cantidad: 2, precioUnitario: 10 }],
        pagos: [{ formaPago: "EFECTIVO", monto: 3 }, { formaPago: "CREDITO", monto: 20 }],
      },
      cajero
    );
    const cuenta = await env.prisma.cuentaPorCobrar.findUniqueOrThrow({ where: { ventaId: v.id } });
    expect(cuenta.montoTotal).toBe(20);
  });

  it("límite de crédito: se valida contra el saldo pendiente y revierte la venta completa", async () => {
    const cliente = await crearClienteConCredito(env, "0992339411001", 50, 30);
    await ventaCredito(cliente.id, 23); // pendiente 23, límite 50
    const stock = await stockDe(producto.id);
    const ventas = await env.prisma.venta.count();

    // 23 + 34.5 = 57.5 > 50
    expect(await codigoError(ventaCredito(cliente.id, 34.5, 3))).toBe("LIMITE_CREDITO_EXCEDIDO");
    expect(await stockDe(producto.id)).toBe(stock);
    expect(await env.prisma.venta.count()).toBe(ventas);

    // 23 + 23 = 46 ≤ 50 sí pasa
    await ventaCredito(cliente.id, 23);
  });

  it("cliente sin crédito autorizado (límite 0) no puede comprar a crédito", async () => {
    const cliente = await crearClienteConCredito(env, "1790012345001", 0);
    expect(await codigoError(ventaCredito(cliente.id, 23))).toBe("LIMITE_CREDITO_EXCEDIDO");
  });
});

describe("Cuentas por cobrar — abonos", () => {
  let cuentaId: string;
  let ventaId: string;
  let clienteId: string;

  beforeAll(async () => {
    const cliente = await crearClienteConCredito(env, "0190012345001", 500, 30);
    clienteId = cliente.id;
    const v = await ventaCredito(cliente.id, 23);
    ventaId = v.id;
    cuentaId = (await env.prisma.cuentaPorCobrar.findUniqueOrThrow({ where: { ventaId } })).id;
  });

  it("abono parcial por transferencia: saldo, estado PARCIAL y sin movimiento de caja", async () => {
    const movimientos = await env.prisma.movimientoCaja.count({ where: { categoria: "ABONO_CXC" } });
    const c = await env.servicios.cuentasPorCobrar.registrarAbono(cuentaId, { monto: 10, formaPago: "TRANSFERENCIA", referencia: "TRX-9" }, cajero);
    expect(c).toMatchObject({ saldo: 13, estado: "PARCIAL" });
    expect(c.pagos).toHaveLength(1);
    expect(c.pagos[0]).toMatchObject({ monto: 10, formaPago: "TRANSFERENCIA", referencia: "TRX-9", turnoId: null });
    expect(await env.prisma.movimientoCaja.count({ where: { categoria: "ABONO_CXC" } })).toBe(movimientos);
  });

  it("abono en efectivo sin turno abierto → TURNO_REQUERIDO y no cambia el saldo", async () => {
    const sinTurno = await crearActor(env, "CAJERO", "cajero.sin.turno.cxc");
    expect(await codigoError(env.servicios.cuentasPorCobrar.registrarAbono(cuentaId, { monto: 5, formaPago: "EFECTIVO" }, sinTurno))).toBe("TURNO_REQUERIDO");
    expect((await env.prisma.cuentaPorCobrar.findUniqueOrThrow({ where: { id: cuentaId } })).saldo).toBe(13);
  });

  it("abono en efectivo: ingresa a la caja del turno (INGRESO ABONO_CXC) y aumenta el esperado", async () => {
    const antes = await efectivoEsperado(cajero);
    const c = await env.servicios.cuentasPorCobrar.registrarAbono(cuentaId, { monto: 5, formaPago: "EFECTIVO" }, cajero);
    expect(c).toMatchObject({ saldo: 8, estado: "PARCIAL" });
    expect(await efectivoEsperado(cajero)).toBe(antes + 5);

    const mov = await env.prisma.movimientoCaja.findFirstOrThrow({ where: { referencia: cuentaId, categoria: "ABONO_CXC" } });
    expect(mov).toMatchObject({ tipo: "INGRESO", monto: 5, usuarioId: cajero.id });
    expect(c.pagos.at(-1)?.turnoId).toBe(mov.turnoId);
  });

  it("no admite abonos mayores al saldo ni montos inválidos", async () => {
    expect(await codigoError(env.servicios.cuentasPorCobrar.registrarAbono(cuentaId, { monto: 8.01, formaPago: "TRANSFERENCIA" }, cajero))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.cuentasPorCobrar.registrarAbono(cuentaId, { monto: 0, formaPago: "TRANSFERENCIA" }, cajero))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.cuentasPorCobrar.registrarAbono(cuentaId, { monto: 1, formaPago: "CREDITO" }, cajero))).toBe("VALIDACION");
    expect((await env.prisma.cuentaPorCobrar.findUniqueOrThrow({ where: { id: cuentaId } })).saldo).toBe(8);
  });

  it("una venta a crédito con abonos no puede anularse (y nada cambia)", async () => {
    const stock = await stockDe(producto.id);
    expect(await codigoError(env.servicios.ventas.anular(ventaId, { motivo: "Intento con abonos" }, supervisor))).toBe("ESTADO_INVALIDO");
    expect((await env.prisma.venta.findUniqueOrThrow({ where: { id: ventaId } })).estado).toBe("COMPLETADA");
    expect(await stockDe(producto.id)).toBe(stock);
  });

  it("el pago final liquida la cuenta (PAGADA, saldo 0) y libera el crédito del cliente", async () => {
    const c = await env.servicios.cuentasPorCobrar.registrarAbono(cuentaId, { monto: 8, formaPago: "TARJETA_DEBITO" }, cajero);
    expect(c).toMatchObject({ saldo: 0, estado: "PAGADA" });
    expect(c.pagos.map((p) => p.monto)).toEqual([10, 5, 8]);
    expect(await codigoError(env.servicios.cuentasPorCobrar.registrarAbono(cuentaId, { monto: 1, formaPago: "TRANSFERENCIA" }, cajero))).toBe("ESTADO_INVALIDO");
    // con la cuenta pagada vuelve a haber cupo completo (límite 500)
    await ventaCredito(clienteId, 460, 40); // 400 + IVA, solo cabe porque la cuenta anterior quedó pagada
  });
});

describe("Cuentas por cobrar — anulación, concurrencia, listados y alcance", () => {
  it("anular una venta a crédito sin abonos anula su CxC y libera el cupo", async () => {
    const cliente = await crearClienteConCredito(env, "0301234567001", 30, 30);
    const v = await ventaCredito(cliente.id, 23);
    expect(await codigoError(ventaCredito(cliente.id, 23))).toBe("LIMITE_CREDITO_EXCEDIDO");

    await env.servicios.ventas.anular(v.id, { motivo: "Error de facturación" }, supervisor);
    const cuenta = await env.prisma.cuentaPorCobrar.findUniqueOrThrow({ where: { ventaId: v.id } });
    expect(cuenta).toMatchObject({ estado: "ANULADA", saldo: 0 });
    await ventaCredito(cliente.id, 23); // el cupo se liberó
  });

  it("abonos simultáneos: nunca se paga de más ni se pierde un abono", async () => {
    const cliente = await crearClienteConCredito(env, "0401234567001", 500, 30);
    const v = await ventaCredito(cliente.id, 23);
    const cuenta = await env.prisma.cuentaPorCobrar.findUniqueOrThrow({ where: { ventaId: v.id } });

    // 5 abonos de 10 contra saldo 23: caben 2 (20); el 3.º de 10 no cabe
    const r = await Promise.all(
      Array.from({ length: 5 }, () => codigoError(env.servicios.cuentasPorCobrar.registrarAbono(cuenta.id, { monto: 10, formaPago: "TRANSFERENCIA" }, cajero)))
    );
    expect(r.filter((x) => x === "SIN_ERROR")).toHaveLength(2);
    expect(r.filter((x) => x === "VALIDACION")).toHaveLength(3);
    const final = await env.prisma.cuentaPorCobrar.findUniqueOrThrow({ where: { id: cuenta.id }, include: { pagos: true } });
    expect(final.saldo).toBe(3);
    expect(final.pagos).toHaveLength(2);
  });

  it("listar: filtros por estado, cliente y vencidas, con paginación", async () => {
    const cliente = await crearClienteConCredito(env, "0501234567001", 1000, 30);
    const v1 = await ventaCredito(cliente.id, 23);
    await ventaCredito(cliente.id, 11.5, 1);
    const c1 = await env.prisma.cuentaPorCobrar.findUniqueOrThrow({ where: { ventaId: v1.id } });
    await env.prisma.cuentaPorCobrar.update({ where: { id: c1.id }, data: { fechaVencimiento: new Date(Date.now() - 5 * DIA) } });

    const todas = await env.servicios.cuentasPorCobrar.listar({ clienteId: cliente.id }, cajero);
    expect(todas.total).toBe(2);
    expect(todas.items[0]?.id).toBe(c1.id); // ordenadas por vencimiento ascendente
    expect(todas.items[0]?.cliente.razonSocial).toBe(`Cliente ${cliente.identificacion}`);

    const vencidas = await env.servicios.cuentasPorCobrar.listar({ clienteId: cliente.id, vencidas: "true" }, cajero);
    expect(vencidas.items.map((c) => c.id)).toEqual([c1.id]);

    const pagina = await env.servicios.cuentasPorCobrar.listar({ clienteId: cliente.id, page: "2", pageSize: "1" }, cajero);
    expect(pagina.items).toHaveLength(1);
    expect(pagina.items[0]?.id).not.toBe(c1.id);

    expect((await env.servicios.cuentasPorCobrar.listar({ clienteId: cliente.id, estado: "PAGADA" }, cajero)).total).toBe(0);
    expect(await codigoError(env.servicios.cuentasPorCobrar.listar({ estado: "XX" }, cajero))).toBe("VALIDACION");
  });

  it("no se accede a cuentas de otra empresa", async () => {
    const cuenta = await env.prisma.cuentaPorCobrar.findFirstOrThrow();
    const otra = { ...cajero, empresaId: "otra" };
    expect(await codigoError(env.servicios.cuentasPorCobrar.obtener(cuenta.id, otra))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.cuentasPorCobrar.registrarAbono(cuenta.id, { monto: 1, formaPago: "TRANSFERENCIA" }, otra))).toBe("NO_ENCONTRADO");
    expect((await env.servicios.cuentasPorCobrar.listar({}, otra)).total).toBe(0);
  });
});

describe("Compras", () => {
  const compra = (proveedorId: string, extra: Record<string, unknown> = {}, lineas?: unknown[]) => ({
    proveedorId,
    sucursalId: env.seed.sucursalId,
    numeroFactura: `001-001-${Math.random().toString().slice(2, 11)}`,
    lineas: lineas ?? [{ productoId: producto.id, cantidad: 10, costoUnitario: 4 }],
    ...extra,
  });

  it("compra de contado: totales con IVA, entrada a Kardex y costo promedio ponderado", async () => {
    const p = await crearProducto(env, { codigo: "CO1", stock: 10, costo: 2 });
    const prov = await crearProveedor(env);
    const c = await env.servicios.compras.crear(
      compra(prov.id, { numeroFactura: "001-001-000000100" }, [{ productoId: p.id, cantidad: 10, costoUnitario: 4 }]),
      bodeguero
    );
    expect(c).toMatchObject({ subtotal: 40, iva: 6, total: 46, formaPago: "CONTADO", estado: "REGISTRADA", usuarioId: bodeguero.id });
    expect(c.lineas[0]).toMatchObject({ cantidad: 10, costoUnitario: 4, porcentajeIva: 15, total: 46 });
    expect(c.cuentaPorPagar).toBeNull();

    const actual = await env.prisma.producto.findUniqueOrThrow({ where: { id: p.id } });
    expect(actual).toMatchObject({ stockActual: 20, costoPromedio: 3 }); // (10×2 + 10×4)/20
    const mov = await env.prisma.kardex.findFirstOrThrow({ where: { productoId: p.id, referencia: c.id } });
    expect(mov).toMatchObject({ tipoMovimiento: "COMPRA", cantidad: 10, costoUnitario: 4, stockAnterior: 10, stockResultante: 20 });
  });

  it("producto sin IVA y varias líneas", async () => {
    const a = await crearProducto(env, { codigo: "CO2A", stock: 0 });
    const b = await crearProducto(env, { codigo: "CO2B", stock: 0, aplicaIva: false });
    const prov = await crearProveedor(env);
    const c = await env.servicios.compras.crear(
      compra(prov.id, {}, [{ productoId: a.id, cantidad: 2, costoUnitario: 10 }, { productoId: b.id, cantidad: 5, costoUnitario: 2 }]),
      bodeguero
    );
    expect(c).toMatchObject({ subtotal: 30, iva: 3, total: 33 });
  });

  it("compra a crédito: genera la CxP con vencimiento según el proveedor o el plazo indicado", async () => {
    const p30 = await crearProveedor(env, { diasPago: 30 });
    const c1 = await env.servicios.compras.crear(compra(p30.id, { formaPago: "CREDITO" }), bodeguero);
    expect(c1.cuentaPorPagar).toMatchObject({ saldo: 46, estado: "PENDIENTE" });
    const cuenta1 = await env.prisma.cuentaPorPagar.findUniqueOrThrow({ where: { compraId: c1.id } });
    expect(Math.round((cuenta1.fechaVencimiento.getTime() - cuenta1.fechaEmision.getTime()) / DIA)).toBe(30);

    const c2 = await env.servicios.compras.crear(compra(p30.id, { formaPago: "CREDITO", diasCredito: 45 }), bodeguero);
    const cuenta2 = await env.prisma.cuentaPorPagar.findUniqueOrThrow({ where: { compraId: c2.id } });
    expect(Math.round((cuenta2.fechaVencimiento.getTime() - cuenta2.fechaEmision.getTime()) / DIA)).toBe(45);
  });

  it("rechaza factura duplicada del mismo proveedor, pero no de otro", async () => {
    const a = await crearProveedor(env);
    const b = await crearProveedor(env);
    const datos = compra(a.id, { numeroFactura: "001-002-000000777" });
    await env.servicios.compras.crear(datos, bodeguero);
    expect(await codigoError(env.servicios.compras.crear(datos, bodeguero))).toBe("DUPLICADO");
    await env.servicios.compras.crear({ ...datos, proveedorId: b.id }, bodeguero);
  });

  it("validaciones: proveedor/sucursal/producto inexistentes, servicio, proveedor inactivo y costo inválido", async () => {
    const prov = await crearProveedor(env);
    const inexistente = "11111111-1111-4111-8111-111111111111";
    const servicio = await crearProducto(env, { codigo: "CO5S", tipo: "SERVICIO" });
    const inactivo = await crearProveedor(env, { status: "INACTIVO" });

    expect(await codigoError(env.servicios.compras.crear(compra(inexistente), bodeguero))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.compras.crear(compra(prov.id, { sucursalId: inexistente }), bodeguero))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.compras.crear(compra(prov.id), { ...bodeguero, empresaId: "otra" }))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.compras.crear(compra(prov.id, {}, [{ productoId: inexistente, cantidad: 1, costoUnitario: 1 }]), bodeguero))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.compras.crear(compra(prov.id, {}, [{ productoId: servicio.id, cantidad: 1, costoUnitario: 1 }]), bodeguero))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.compras.crear(compra(inactivo.id), bodeguero))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.compras.crear(compra(prov.id, {}, [{ productoId: producto.id, cantidad: 1, costoUnitario: 0 }]), bodeguero))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.compras.crear(compra(prov.id, {}, []), bodeguero))).toBe("VALIDACION");
  });

  it("si una línea falla se revierte todo: sin compra, sin Kardex ni stock", async () => {
    const p = await crearProducto(env, { codigo: "CO6", stock: 5, costo: 1 });
    const prov = await crearProveedor(env);
    const compras = await env.prisma.compra.count();
    const inexistente = "11111111-1111-4111-8111-111111111111";
    expect(
      await codigoError(
        env.servicios.compras.crear(
          compra(prov.id, { formaPago: "CREDITO" }, [{ productoId: p.id, cantidad: 5, costoUnitario: 9 }, { productoId: inexistente, cantidad: 1, costoUnitario: 1 }]),
          bodeguero
        )
      )
    ).toBe("NO_ENCONTRADO");
    expect(await env.prisma.compra.count()).toBe(compras);
    expect(await env.prisma.producto.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ stockActual: 5, costoPromedio: 1 });
    expect(await env.prisma.kardex.count({ where: { productoId: p.id } })).toBe(1);
  });

  it("obtener devuelve la compra con líneas y respeta la empresa", async () => {
    const prov = await crearProveedor(env);
    const c = await env.servicios.compras.crear(compra(prov.id), bodeguero);
    expect((await env.servicios.compras.obtener(c.id, bodeguero)).lineas).toHaveLength(1);
    expect(await codigoError(env.servicios.compras.obtener(c.id, { ...bodeguero, empresaId: "otra" }))).toBe("NO_ENCONTRADO");
  });
});

describe("Cuentas por pagar — pagos", () => {
  let cuentaId: string;

  beforeAll(async () => {
    const prov = await crearProveedor(env, { razonSocial: "Distribuidora Andina" });
    const c = await env.servicios.compras.crear(
      { proveedorId: prov.id, sucursalId: env.seed.sucursalId, numeroFactura: "001-001-000009999", formaPago: "CREDITO",
        lineas: [{ productoId: producto.id, cantidad: 25, costoUnitario: 4 }] }, // total 115
      bodeguero
    );
    cuentaId = (c.cuentaPorPagar as { id: string }).id;
  });

  it("pago parcial por transferencia → PARCIAL, sin tocar la caja", async () => {
    const egresos = await env.prisma.movimientoCaja.count({ where: { categoria: "PAGO_CXP" } });
    const c = await env.servicios.cuentasPorPagar.registrarPago(cuentaId, { monto: 15, formaPago: "TRANSFERENCIA", referencia: "TRX-1" }, bodeguero);
    expect(c).toMatchObject({ saldo: 100, estado: "PARCIAL" });
    expect(await env.prisma.movimientoCaja.count({ where: { categoria: "PAGO_CXP" } })).toBe(egresos);
  });

  it("pago en efectivo exige turno abierto y fondos; sale como EGRESO de la caja", async () => {
    expect(await codigoError(env.servicios.cuentasPorPagar.registrarPago(cuentaId, { monto: 10, formaPago: "EFECTIVO" }, bodeguero))).toBe("TURNO_REQUERIDO");

    // el cajero tiene turno abierto; la caja tiene dinero por las ventas/abonos en efectivo
    const antes = await efectivoEsperado(cajero);
    expect(await codigoError(env.servicios.cuentasPorPagar.registrarPago(cuentaId, { monto: antes + 1, formaPago: "EFECTIVO" }, cajero))).toBe("VALIDACION");

    const c = await env.servicios.cuentasPorPagar.registrarPago(cuentaId, { monto: 20, formaPago: "EFECTIVO" }, cajero);
    expect(c).toMatchObject({ saldo: 80, estado: "PARCIAL" });
    expect(await efectivoEsperado(cajero)).toBe(antes - 20);
    const mov = await env.prisma.movimientoCaja.findFirstOrThrow({ where: { referencia: cuentaId, categoria: "PAGO_CXP" } });
    expect(mov).toMatchObject({ tipo: "EGRESO", monto: 20 });
    expect(mov.concepto).toContain("Distribuidora Andina");
  });

  it("no paga más que el saldo; el pago final liquida; luego no admite pagos", async () => {
    expect(await codigoError(env.servicios.cuentasPorPagar.registrarPago(cuentaId, { monto: 80.01, formaPago: "TRANSFERENCIA" }, bodeguero))).toBe("VALIDACION");
    const c = await env.servicios.cuentasPorPagar.registrarPago(cuentaId, { monto: 80, formaPago: "CHEQUE", referencia: "CH-55" }, bodeguero);
    expect(c).toMatchObject({ saldo: 0, estado: "PAGADA" });
    expect(c.pagos.map((p) => p.monto)).toEqual([15, 20, 80]);
    expect(await codigoError(env.servicios.cuentasPorPagar.registrarPago(cuentaId, { monto: 1, formaPago: "TRANSFERENCIA" }, bodeguero))).toBe("ESTADO_INVALIDO");
  });

  it("listar con filtro de vencidas y alcance por empresa", async () => {
    const prov = await crearProveedor(env);
    const c = await env.servicios.compras.crear(
      { proveedorId: prov.id, sucursalId: env.seed.sucursalId, numeroFactura: "001-001-000008888", formaPago: "CREDITO",
        lineas: [{ productoId: producto.id, cantidad: 1, costoUnitario: 4 }] },
      bodeguero
    );
    const id = (c.cuentaPorPagar as { id: string }).id;
    expect((await env.servicios.cuentasPorPagar.listar({ proveedorId: prov.id, vencidas: "true" }, bodeguero)).total).toBe(0);
    await env.prisma.cuentaPorPagar.update({ where: { id }, data: { fechaVencimiento: new Date(Date.now() - DIA) } });
    const vencidas = await env.servicios.cuentasPorPagar.listar({ proveedorId: prov.id, vencidas: "true" }, bodeguero);
    expect(vencidas.items.map((x) => x.id)).toEqual([id]);
    expect(vencidas.items[0]?.proveedor.razonSocial).toBe(prov.razonSocial);
    expect((await env.servicios.cuentasPorPagar.listar({}, { ...bodeguero, empresaId: "otra" })).total).toBe(0);
    expect(await codigoError(env.servicios.cuentasPorPagar.obtener(id, { ...bodeguero, empresaId: "otra" }))).toBe("NO_ENCONTRADO");
  });
});
