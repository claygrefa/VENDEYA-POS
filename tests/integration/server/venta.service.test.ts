// ============================================================
// tests/integration/server/venta.service.test.ts
// Motor transaccional de ventas: cálculo, pagos, stock/Kardex, rollback, anulación y concurrencia.
// ============================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Producto } from "@prisma/client";
import type { ActorVenta } from "../../../src/server/services/venta.service";
import { abrirTurno, codigoError, crearEntorno, crearProducto, type Entorno } from "../helpers/entorno.helper";

let env: Entorno;
let actor: ActorVenta;

beforeAll(async () => {
  env = await crearEntorno();
  actor = { id: env.seed.adminId, empresaId: env.seed.empresaId };
  await abrirTurno(env, actor.id);
}, 60_000);

afterAll(async () => {
  await env.cerrar();
});

const linea = (p: Producto, cantidad: number, extra: Record<string, unknown> = {}) => ({
  productoId: p.id,
  cantidad,
  precioUnitario: p.precioVenta,
  ...extra,
});

const venta = (lineas: unknown[], pagos: unknown[], extra: Record<string, unknown> = {}) => ({
  puntoEmisionId: env.seed.puntoEmisionId,
  lineas,
  pagos,
  ...extra,
});

const stockDe = async (id: string): Promise<number> =>
  (await env.prisma.producto.findUniqueOrThrow({ where: { id } })).stockActual;

const secuencial = async (): Promise<number> =>
  (await env.prisma.puntoEmision.findUniqueOrThrow({ where: { id: env.seed.puntoEmisionId } })).secuencialVenta;

describe("VentaService.crear — cálculo y persistencia", () => {
  it("venta con IVA 15%: totales, número, pagos, cambio, stock y Kardex", async () => {
    const p = await crearProducto(env, { codigo: "V1", precioVenta: 10, stock: 50, costo: 4 });
    const v = await env.servicios.ventas.crear(venta([linea(p, 2)], [{ formaPago: "EFECTIVO", monto: 25 }]), actor);

    expect(v).toMatchObject({ subtotal: 20, descuento: 0, iva: 3, total: 23, estado: "COMPLETADA", cajeroId: actor.id });
    expect(v.numero).toMatch(/^001-001-\d{9}$/);
    expect(v.clienteRuc).toBe("9999999999999");
    expect(v.clienteNombre).toBe("CONSUMIDOR FINAL");
    expect(v.lineas).toHaveLength(1);
    expect(v.lineas[0]).toMatchObject({ subtotal: 20, iva: 3, porcentajeIva: 15, total: 23, costoUnitario: 4, descripcion: "Producto V1" });
    expect(v.pagos[0]).toMatchObject({ formaPago: "EFECTIVO", monto: 25, cambio: 2 });

    expect(await stockDe(p.id)).toBe(48);
    const mov = await env.prisma.kardex.findFirstOrThrow({ where: { productoId: p.id, tipoMovimiento: "VENTA" } });
    expect(mov).toMatchObject({ cantidad: 2, costoUnitario: 4, stockAnterior: 50, stockResultante: 48, referencia: v.id });
  });

  it("producto sin IVA y mezcla de tarifas", async () => {
    const gravado = await crearProducto(env, { codigo: "V2A", precioVenta: 10, stock: 10 });
    const exento = await crearProducto(env, { codigo: "V2B", precioVenta: 5, stock: 10, aplicaIva: false });
    const v = await env.servicios.ventas.crear(
      venta([linea(gravado, 1), linea(exento, 2)], [{ formaPago: "TARJETA_CREDITO", monto: 21.5 }]),
      actor
    );
    expect(v).toMatchObject({ subtotal: 20, iva: 1.5, total: 21.5 });
    expect(v.lineas.map((l) => l.porcentajeIva).sort()).toEqual([0, 15]);
  });

  it("descuentos por valor y por porcentaje, distribuidos por línea", async () => {
    const p = await crearProducto(env, { codigo: "V3", precioVenta: 10, stock: 20 });
    const v = await env.servicios.ventas.crear(
      venta(
        [linea(p, 2, { descuento: 5, tipoDescuento: "VALOR" }), linea(p, 2, { descuento: 10, tipoDescuento: "PORCENTAJE" })],
        [{ formaPago: "EFECTIVO", monto: 40 }]
      ),
      actor
    );
    expect(v.descuento).toBe(7);
    expect(v.subtotal).toBe(33); // 15 + 18
    expect(v.iva).toBe(4.95);
    expect(v.total).toBe(37.95);
    expect(await stockDe(p.id)).toBe(16);
  });

  it("pagos múltiples: el cambio se asigna al efectivo", async () => {
    const p = await crearProducto(env, { codigo: "V4", precioVenta: 10, stock: 10 });
    const v = await env.servicios.ventas.crear(
      venta([linea(p, 2)], [
        { formaPago: "TARJETA_DEBITO", monto: 10, referencia: "AUT-123" },
        { formaPago: "EFECTIVO", monto: 15 },
      ]),
      actor
    );
    const porForma = Object.fromEntries(v.pagos.map((x) => [x.formaPago, x]));
    expect(porForma["TARJETA_DEBITO"]).toMatchObject({ monto: 10, cambio: 0, referencia: "AUT-123" });
    expect(porForma["EFECTIVO"]).toMatchObject({ monto: 15, cambio: 2 });
  });

  it("los secuenciales son consecutivos y el número usa los códigos de sucursal y punto", async () => {
    const p = await crearProducto(env, { codigo: "V5", precioVenta: 1, stock: 10 });
    const pago = [{ formaPago: "EFECTIVO", monto: 2 }];
    const a = await env.servicios.ventas.crear(venta([linea(p, 1)], pago), actor);
    const b = await env.servicios.ventas.crear(venta([linea(p, 1)], pago), actor);
    const n = (x: string): number => parseInt(x.split("-")[2] as string, 10);
    expect(n(b.numero)).toBe(n(a.numero) + 1);
    expect(a.numero.startsWith("001-001-")).toBe(true);
  });

  it("producto de tipo SERVICIO no mueve stock ni Kardex", async () => {
    const s = await crearProducto(env, { codigo: "V6", tipo: "SERVICIO", precioVenta: 20 });
    const v = await env.servicios.ventas.crear(venta([linea(s, 1)], [{ formaPago: "EFECTIVO", monto: 23 }]), actor);
    expect(v.total).toBe(23);
    expect(v.lineas[0]?.costoUnitario).toBe(0);
    expect(await env.prisma.kardex.count({ where: { productoId: s.id } })).toBe(0);
  });

  it("toma el nombre y la identificación del cliente registrado", async () => {
    const p = await crearProducto(env, { codigo: "V7", precioVenta: 1, stock: 5 });
    const cliente = await env.servicios.clientes.crear({ tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "Juan Pérez" });
    const v = await env.servicios.ventas.crear(venta([linea(p, 1)], [{ formaPago: "EFECTIVO", monto: 2 }], { clienteId: cliente.id }), actor);
    expect(v).toMatchObject({ clienteId: cliente.id, clienteRuc: "1710034065", clienteNombre: "Juan Pérez" });
  });

  it("la venta a crédito exige cliente registrado", async () => {
    const p = await crearProducto(env, { codigo: "V8", precioVenta: 1, stock: 5 });
    const pago = [{ formaPago: "CREDITO", monto: 1.15 }];
    expect(await codigoError(env.servicios.ventas.crear(venta([linea(p, 1)], pago), actor))).toBe("VALIDACION");
    const c = await env.servicios.clientes.crear({ tipoIdentificacion: "04", identificacion: "0926687856001", razonSocial: "Empresa X" });
    const v = await env.servicios.ventas.crear(venta([linea(p, 1)], pago, { clienteId: c.id }), actor);
    expect(v.pagos[0]?.formaPago).toBe("CREDITO");
  });
});

describe("VentaService.crear — validaciones y rollback", () => {
  it("pago insuficiente → error y no consume secuencial ni stock", async () => {
    const p = await crearProducto(env, { codigo: "R1", precioVenta: 10, stock: 10 });
    const antes = await secuencial();
    const ventas = await env.prisma.venta.count();
    expect(await codigoError(env.servicios.ventas.crear(venta([linea(p, 1)], [{ formaPago: "EFECTIVO", monto: 11 }]), actor))).toBe("VALIDACION");
    expect(await secuencial()).toBe(antes);
    expect(await env.prisma.venta.count()).toBe(ventas);
    expect(await stockDe(p.id)).toBe(10);
  });

  it("excedente con tarjeta no es válido", async () => {
    const p = await crearProducto(env, { codigo: "R2", precioVenta: 10, stock: 10 });
    expect(await codigoError(env.servicios.ventas.crear(venta([linea(p, 1)], [{ formaPago: "TARJETA_CREDITO", monto: 20 }]), actor))).toBe("VALIDACION");
  });

  it("stock insuficiente en la 2ª línea revierte TODO (venta, líneas, pagos, stock, Kardex y secuencial)", async () => {
    const ok = await crearProducto(env, { codigo: "R3A", precioVenta: 10, stock: 10 });
    const escaso = await crearProducto(env, { codigo: "R3B", precioVenta: 10, stock: 1 });
    const antes = { seq: await secuencial(), ventas: await env.prisma.venta.count(), lineas: await env.prisma.lineaVenta.count(), pagos: await env.prisma.pagoVenta.count() };
    const kardexAntes = await env.prisma.kardex.count();

    const codigo = await codigoError(
      env.servicios.ventas.crear(venta([linea(ok, 3), linea(escaso, 2)], [{ formaPago: "EFECTIVO", monto: 100 }]), actor)
    );
    expect(codigo).toBe("STOCK_INSUFICIENTE");

    expect(await stockDe(ok.id)).toBe(10);
    expect(await stockDe(escaso.id)).toBe(1);
    expect(await secuencial()).toBe(antes.seq);
    expect(await env.prisma.venta.count()).toBe(antes.ventas);
    expect(await env.prisma.lineaVenta.count()).toBe(antes.lineas);
    expect(await env.prisma.pagoVenta.count()).toBe(antes.pagos);
    expect(await env.prisma.kardex.count()).toBe(kardexAntes);
  });

  it("la misma mercadería repartida en varias líneas se valida de forma acumulada", async () => {
    const p = await crearProducto(env, { codigo: "R4", precioVenta: 1, stock: 3 });
    expect(await codigoError(env.servicios.ventas.crear(venta([linea(p, 2), linea(p, 2)], [{ formaPago: "EFECTIVO", monto: 10 }]), actor))).toBe("STOCK_INSUFICIENTE");
    expect(await stockDe(p.id)).toBe(3);
  });

  it("sin turno abierto → TURNO_REQUERIDO (sin consumir secuencial)", async () => {
    const p = await crearProducto(env, { codigo: "R5", precioVenta: 1, stock: 3 });
    const sinTurno = await env.servicios.usuarios.crear({
      empresaId: env.seed.empresaId, rol: "CAJERO", username: "cajero.sin.turno", password: "Cajero1234", nombre: "S", apellido: "T",
    });
    const antes = await secuencial();
    expect(
      await codigoError(env.servicios.ventas.crear(venta([linea(p, 1)], [{ formaPago: "EFECTIVO", monto: 2 }]), { id: sinTurno.id, empresaId: env.seed.empresaId }))
    ).toBe("TURNO_REQUERIDO");
    expect(await secuencial()).toBe(antes);
  });

  it("un turno CERRADO no habilita ventas", async () => {
    const p = await crearProducto(env, { codigo: "R6", precioVenta: 1, stock: 3 });
    const u = await env.servicios.usuarios.crear({
      empresaId: env.seed.empresaId, rol: "CAJERO", username: "cajero.cerrado", password: "Cajero1234", nombre: "C", apellido: "C",
    });
    const turno = await abrirTurno(env, u.id);
    await env.prisma.turnoCaja.update({ where: { id: turno.id }, data: { estado: "CERRADO", fechaCierre: new Date() } });
    expect(
      await codigoError(env.servicios.ventas.crear(venta([linea(p, 1)], [{ formaPago: "EFECTIVO", monto: 2 }]), { id: u.id, empresaId: env.seed.empresaId }))
    ).toBe("TURNO_REQUERIDO");
  });

  it("punto de emisión inexistente, de otra empresa, o producto/cliente inexistentes → NO_ENCONTRADO", async () => {
    const p = await crearProducto(env, { codigo: "R7", precioVenta: 1, stock: 3 });
    const pago = [{ formaPago: "EFECTIVO", monto: 2 }];
    const inexistente = "11111111-1111-4111-8111-111111111111";
    expect(await codigoError(env.servicios.ventas.crear(venta([linea(p, 1)], pago, { puntoEmisionId: inexistente }), actor))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.ventas.crear(venta([linea(p, 1)], pago), { id: actor.id, empresaId: "otra-empresa" }))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.ventas.crear(venta([{ productoId: inexistente, cantidad: 1, precioUnitario: 1 }], pago), actor))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.ventas.crear(venta([linea(p, 1)], pago, { clienteId: inexistente }), actor))).toBe("NO_ENCONTRADO");
  });

  it("producto inactivo, descuento excesivo y entrada mal formada → VALIDACION", async () => {
    const p = await crearProducto(env, { codigo: "R8", precioVenta: 10, stock: 3 });
    const pago = [{ formaPago: "EFECTIVO", monto: 50 }];
    expect(await codigoError(env.servicios.ventas.crear(venta([linea(p, 1, { descuento: 11 })], pago), actor))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.ventas.crear({ lineas: [], pagos: [] }, actor))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.ventas.crear(venta([linea(p, -1)], pago), actor))).toBe("VALIDACION");
    await env.prisma.producto.update({ where: { id: p.id }, data: { status: "INACTIVO" } });
    expect(await codigoError(env.servicios.ventas.crear(venta([linea(p, 1)], pago), actor))).toBe("VALIDACION");
  });

  it("IVA sin tarifa vigente configurada → VALIDACION", async () => {
    const p = await crearProducto(env, { codigo: "R9", precioVenta: 10, stock: 3 });
    await env.prisma.producto.update({ where: { id: p.id }, data: { codigoIvaSRI: "99" } });
    expect(await codigoError(env.servicios.ventas.crear(venta([linea(p, 1)], [{ formaPago: "EFECTIVO", monto: 20 }]), actor))).toBe("VALIDACION");
  });

  it("usa la tarifa de impuesto asignada al producto (tarifaImpuestoId)", async () => {
    const p = await crearProducto(env, { codigo: "R10", precioVenta: 100, stock: 3 });
    const tarifa5 = await env.prisma.tarifaImpuesto.findFirstOrThrow({ where: { empresaId: env.seed.empresaId, codigo: "3" } });
    await env.prisma.producto.update({ where: { id: p.id }, data: { tarifaImpuestoId: tarifa5.id } });
    const v = await env.servicios.ventas.crear(venta([linea(p, 1)], [{ formaPago: "EFECTIVO", monto: 105 }]), actor);
    expect(v).toMatchObject({ iva: 5, total: 105 });
    expect(v.lineas[0]?.porcentajeIva).toBe(5);
  });
});

describe("VentaService.crear — lotes", () => {
  const nuevoLote = async (productoId: string, cantidad: number, dias: number) =>
    env.prisma.lote.create({
      data: {
        productoId, numeroLote: `L-${Math.random().toString(36).slice(2, 8)}`, cantidadInicial: cantidad, cantidadActual: cantidad,
        fechaVencimiento: new Date(Date.now() + dias * 86_400_000),
      },
    });

  it("descuenta del lote indicado", async () => {
    const p = await crearProducto(env, { codigo: "L1", precioVenta: 1, stock: 10 });
    const lote = await nuevoLote(p.id, 10, 30);
    await env.servicios.ventas.crear(venta([linea(p, 4, { loteId: lote.id })], [{ formaPago: "EFECTIVO", monto: 5 }]), actor);
    expect((await env.prisma.lote.findUniqueOrThrow({ where: { id: lote.id } })).cantidadActual).toBe(6);
  });

  it("rechaza lote vencido, insuficiente o de otro producto (sin efectos parciales)", async () => {
    const p = await crearProducto(env, { codigo: "L2", precioVenta: 1, stock: 10 });
    const otro = await crearProducto(env, { codigo: "L2B", precioVenta: 1, stock: 10 });
    const vencido = await nuevoLote(p.id, 10, -1);
    const corto = await nuevoLote(p.id, 1, 30);
    const ajeno = await nuevoLote(otro.id, 10, 30);
    const pago = [{ formaPago: "EFECTIVO", monto: 10 }];

    expect(await codigoError(env.servicios.ventas.crear(venta([linea(p, 1, { loteId: vencido.id })], pago), actor))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.ventas.crear(venta([linea(p, 2, { loteId: corto.id })], pago), actor))).toBe("STOCK_INSUFICIENTE");
    expect(await codigoError(env.servicios.ventas.crear(venta([linea(p, 1, { loteId: ajeno.id })], pago), actor))).toBe("NO_ENCONTRADO");
    expect(await stockDe(p.id)).toBe(10);
    expect((await env.prisma.lote.findUniqueOrThrow({ where: { id: corto.id } })).cantidadActual).toBe(1);
  });
});

describe("VentaService.anular", () => {
  it("revierte stock (al costo original), registra DEVOLUCION y marca la venta", async () => {
    const p = await crearProducto(env, { codigo: "A1", precioVenta: 10, stock: 10, costo: 4 });
    const v = await env.servicios.ventas.crear(venta([linea(p, 3)], [{ formaPago: "EFECTIVO", monto: 40 }]), actor);
    expect(await stockDe(p.id)).toBe(7);

    const a = await env.servicios.ventas.anular(v.id, { motivo: "Error de digitación" }, actor);
    expect(a).toMatchObject({ estado: "ANULADA", motivoAnulacion: "Error de digitación", anuladaPorId: actor.id });
    expect(a.fechaAnulacion).not.toBeNull();
    expect(await stockDe(p.id)).toBe(10);

    const dev = await env.prisma.kardex.findFirstOrThrow({ where: { productoId: p.id, tipoMovimiento: "DEVOLUCION" } });
    expect(dev).toMatchObject({ cantidad: 3, costoUnitario: 4, stockAnterior: 7, stockResultante: 10, referencia: v.id });
    expect((await env.prisma.producto.findUniqueOrThrow({ where: { id: p.id } })).costoPromedio).toBe(4);
  });

  it("anular dos veces → ESTADO_INVALIDO y el stock no se repone dos veces", async () => {
    const p = await crearProducto(env, { codigo: "A2", precioVenta: 10, stock: 10 });
    const v = await env.servicios.ventas.crear(venta([linea(p, 2)], [{ formaPago: "EFECTIVO", monto: 30 }]), actor);
    await env.servicios.ventas.anular(v.id, { motivo: "Cliente desistió" }, actor);
    expect(await codigoError(env.servicios.ventas.anular(v.id, { motivo: "Otra vez por error" }, actor))).toBe("ESTADO_INVALIDO");
    expect(await stockDe(p.id)).toBe(10);
  });

  it("anulaciones simultáneas: solo una prospera y el stock se repone una vez", async () => {
    const p = await crearProducto(env, { codigo: "A3", precioVenta: 10, stock: 10 });
    const v = await env.servicios.ventas.crear(venta([linea(p, 4)], [{ formaPago: "EFECTIVO", monto: 50 }]), actor);
    const resultados = await Promise.all(
      Array.from({ length: 4 }, () => codigoError(env.servicios.ventas.anular(v.id, { motivo: "Concurrente 123" }, actor)))
    );
    expect(resultados.filter((r) => r === "SIN_ERROR")).toHaveLength(1);
    expect(resultados.filter((r) => r === "ESTADO_INVALIDO")).toHaveLength(3);
    expect(await stockDe(p.id)).toBe(10);
    expect(await env.prisma.kardex.count({ where: { productoId: p.id, tipoMovimiento: "DEVOLUCION" } })).toBe(1);
  });

  it("repone el lote y no toca productos tipo SERVICIO", async () => {
    const p = await crearProducto(env, { codigo: "A4", precioVenta: 1, stock: 10 });
    const s = await crearProducto(env, { codigo: "A4S", tipo: "SERVICIO", precioVenta: 5 });
    const lote = await env.prisma.lote.create({
      data: { productoId: p.id, numeroLote: "LA4", cantidadInicial: 10, cantidadActual: 10, fechaVencimiento: new Date(Date.now() + 86_400_000 * 30) },
    });
    const v = await env.servicios.ventas.crear(
      venta([linea(p, 5, { loteId: lote.id }), linea(s, 1)], [{ formaPago: "EFECTIVO", monto: 15 }]),
      actor
    );
    expect((await env.prisma.lote.findUniqueOrThrow({ where: { id: lote.id } })).cantidadActual).toBe(5);
    await env.servicios.ventas.anular(v.id, { motivo: "Devolución total" }, actor);
    expect((await env.prisma.lote.findUniqueOrThrow({ where: { id: lote.id } })).cantidadActual).toBe(10);
    expect(await stockDe(p.id)).toBe(10);
    expect(await env.prisma.kardex.count({ where: { productoId: s.id } })).toBe(0);
  });

  it("una venta con factura AUTORIZADA no se anula (requiere nota de crédito) y nada cambia", async () => {
    const p = await crearProducto(env, { codigo: "A5", precioVenta: 10, stock: 10 });
    const v = await env.servicios.ventas.crear(venta([linea(p, 1)], [{ formaPago: "EFECTIVO", monto: 20 }]), actor);
    await env.prisma.comprobanteElectronico.create({
      data: {
        ventaId: v.id, empresaId: env.seed.empresaId, sucursalId: env.seed.sucursalId, puntoEmisionId: env.seed.puntoEmisionId,
        claveAcceso: "1".repeat(49), tipoComprobante: "01", serie: "001-001", secuencial: "000000001", fechaEmision: new Date(), estado: "AUTORIZADO",
      },
    });
    expect(await codigoError(env.servicios.ventas.anular(v.id, { motivo: "Intento inválido" }, actor))).toBe("ESTADO_INVALIDO");
    expect((await env.prisma.venta.findUniqueOrThrow({ where: { id: v.id } })).estado).toBe("COMPLETADA");
    expect(await stockDe(p.id)).toBe(9);
  });

  it("valida motivo, existencia y pertenencia a la empresa", async () => {
    const p = await crearProducto(env, { codigo: "A6", precioVenta: 1, stock: 5 });
    const v = await env.servicios.ventas.crear(venta([linea(p, 1)], [{ formaPago: "EFECTIVO", monto: 2 }]), actor);
    expect(await codigoError(env.servicios.ventas.anular(v.id, { motivo: "ab" }, actor))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.ventas.anular(v.id, {}, actor))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.ventas.anular("no-existe", { motivo: "Motivo válido" }, actor))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.ventas.anular(v.id, { motivo: "Motivo válido" }, { id: actor.id, empresaId: "otra" }))).toBe("NO_ENCONTRADO");
    expect((await env.prisma.venta.findUniqueOrThrow({ where: { id: v.id } })).estado).toBe("COMPLETADA");
  });

  it("obtener devuelve la venta con detalle y respeta la empresa", async () => {
    const p = await crearProducto(env, { codigo: "A7", precioVenta: 1, stock: 5 });
    const v = await env.servicios.ventas.crear(venta([linea(p, 1)], [{ formaPago: "EFECTIVO", monto: 2 }]), actor);
    const leida = await env.servicios.ventas.obtener(v.id, actor);
    expect(leida.lineas).toHaveLength(1);
    expect(leida.pagos).toHaveLength(1);
    expect(await codigoError(env.servicios.ventas.obtener(v.id, { id: actor.id, empresaId: "otra" }))).toBe("NO_ENCONTRADO");
  });
});

describe("VentaService — concurrencia", () => {
  it("20 ventas simultáneas: secuenciales únicos y consecutivos, stock exacto", async () => {
    const p = await crearProducto(env, { codigo: "C1", precioVenta: 1, stock: 100 });
    const base = await secuencial();
    const resultados = await Promise.all(
      Array.from({ length: 20 }, () => env.servicios.ventas.crear(venta([linea(p, 1)], [{ formaPago: "EFECTIVO", monto: 2 }]), actor))
    );
    const numeros = resultados.map((v) => parseInt(v.numero.split("-")[2] as string, 10)).sort((a, b) => a - b);
    expect(new Set(numeros).size).toBe(20);
    expect(numeros).toEqual(Array.from({ length: 20 }, (_, i) => base + i + 1));
    expect(await stockDe(p.id)).toBe(80);
    expect(await env.prisma.kardex.count({ where: { productoId: p.id, tipoMovimiento: "VENTA" } })).toBe(20);
  }, 120_000);

  it("sobreventa imposible: 12 ventas simultáneas con stock 5 → exactamente 5 prosperan", async () => {
    const p = await crearProducto(env, { codigo: "C2", precioVenta: 1, stock: 5 });
    const base = await secuencial();
    const resultados = await Promise.allSettled(
      Array.from({ length: 12 }, () => env.servicios.ventas.crear(venta([linea(p, 1)], [{ formaPago: "EFECTIVO", monto: 2 }]), actor))
    );
    const ok = resultados.filter((r) => r.status === "fulfilled");
    const fallidas = resultados.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(5);
    expect(fallidas).toHaveLength(7);
    expect(fallidas.every((f) => (f.reason as { codigo?: string }).codigo === "STOCK_INSUFICIENTE")).toBe(true);
    expect(await stockDe(p.id)).toBe(0);
    // Los rollbacks no dejan huecos en la numeración
    expect(await secuencial()).toBe(base + 5);
  }, 120_000);
});
