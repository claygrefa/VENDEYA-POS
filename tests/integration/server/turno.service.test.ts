// ============================================================
// tests/integration/server/turno.service.test.ts
// Ciclo de caja: apertura → ventas → movimientos → cierre ciego → reporte.
// ============================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Producto } from "@prisma/client";
import type { ActorCaja } from "../../../src/server/services/turno.service";
import { codigoError, crearActor, crearEntorno, crearProducto, type Entorno } from "../helpers/entorno.helper";

let env: Entorno;
let producto: Producto;
let cajero: ActorCaja;
let cajero2: ActorCaja;
let supervisor: ActorCaja;

beforeAll(async () => {
  env = await crearEntorno();
  producto = await crearProducto(env, { codigo: "T1", precioVenta: 10, stock: 500, costo: 4 });
  cajero = await crearActor(env, "CAJERO", "cajero.uno");
  cajero2 = await crearActor(env, "CAJERO", "cajero.dos");
  supervisor = await crearActor(env, "SUPERVISOR", "supervisor.uno");
}, 60_000);

afterAll(async () => {
  await env.cerrar();
});

const vender = (actor: ActorCaja, forma: string, monto: number, cantidad = 2) =>
  env.servicios.ventas.crear(
    {
      puntoEmisionId: env.seed.puntoEmisionId,
      lineas: [{ productoId: producto.id, cantidad, precioUnitario: 10 }],
      pagos: [{ formaPago: forma, monto }],
    },
    actor
  );

const abrir = (actor: ActorCaja, monto = 100) =>
  env.servicios.turnos.abrir({ sucursalId: env.seed.sucursalId, montoApertura: monto }, actor);

describe("TurnoService.abrir / actual", () => {
  it("abre un turno con monto inicial y lo devuelve como turno actual", async () => {
    const t = await abrir(cajero2, 50);
    expect(t).toMatchObject({ estado: "ABIERTO", montoApertura: 50, cajeroId: cajero2.id });
    const actual = await env.servicios.turnos.actual(cajero2);
    expect(actual.id).toBe(t.id);
    expect(actual.cajero.username).toBe("cajero.dos");
    await env.servicios.turnos.cerrar(t.id, { efectivoContado: 50 }, cajero2);
  });

  it("solo un turno abierto por cajero y sucursal", async () => {
    const t = await abrir(cajero2);
    expect(await codigoError(abrir(cajero2))).toBe("ESTADO_INVALIDO");
    await env.servicios.turnos.cerrar(t.id, { efectivoContado: 100 }, cajero2);
    // tras cerrar puede abrir otro
    const t2 = await abrir(cajero2);
    expect(t2.id).not.toBe(t.id);
    await env.servicios.turnos.cerrar(t2.id, { efectivoContado: 100 }, cajero2);
  });

  it("valida sucursal y monto de apertura", async () => {
    const inexistente = "11111111-1111-4111-8111-111111111111";
    expect(await codigoError(env.servicios.turnos.abrir({ sucursalId: inexistente, montoApertura: 0 }, cajero2))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.turnos.abrir({ sucursalId: env.seed.sucursalId, montoApertura: -1 }, cajero2))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.turnos.abrir({ sucursalId: env.seed.sucursalId }, { ...cajero2, empresaId: "otra" }))).toBe("NO_ENCONTRADO");
  });

  it("actual sin turno abierto → NO_ENCONTRADO", async () => {
    expect(await codigoError(env.servicios.turnos.actual(cajero2))).toBe("NO_ENCONTRADO");
  });
});

describe("Ciclo completo de caja con cierre ciego", () => {
  let turnoId: string;

  it("ventas, movimientos y anulaciones alimentan el cuadre", async () => {
    turnoId = (await abrir(cajero, 100)).id;

    await vender(cajero, "EFECTIVO", 25); // total 23, cambio 2 → +23 en caja
    await vender(cajero, "TARJETA_CREDITO", 23); // no afecta efectivo
    const anulada = await vender(cajero, "EFECTIVO", 23); // +23 ... y se anula
    await env.servicios.ventas.anular(anulada.id, { motivo: "Cliente se arrepintió" }, supervisor);

    await env.servicios.turnos.registrarMovimiento(turnoId, { tipo: "INGRESO", concepto: "Fondo adicional", monto: 20 }, cajero);
    await env.servicios.turnos.registrarMovimiento(turnoId, { tipo: "EGRESO", concepto: "Pago mensajero", monto: 10, referencia: "REC-1" }, cajero);

    // Esperado = 100 + (25 − 2) + 20 − 10 = 133 (la venta anulada no cuenta)
    const rep = await env.servicios.turnos.reporte(turnoId, supervisor);
    expect(rep.efectivo).toEqual({ esperado: 133, contado: null, diferencia: null });
  });

  it("CIERRE CIEGO: mientras está abierto el cajero no ve el esperado ni el efectivo de ventas", async () => {
    const rep = await env.servicios.turnos.reporte(turnoId, cajero);
    expect(rep.efectivo).toBeNull();
    expect(rep.porFormaPago.map((p) => p.formaPago)).toEqual(["TARJETA_CREDITO"]); // EFECTIVO oculto
    expect(rep.turno.estado).toBe("ABIERTO");
    expect(rep.ventas).toMatchObject({ cantidad: 2, total: 46 });
    expect(rep.ventas.anuladas).toEqual({ cantidad: 1, total: 23 });
    // el JSON completo no contiene el esperado
    // (como número JSON suelto: un UUID aleatorio puede contener «133» y no es una filtración)
    expect(JSON.stringify(rep)).not.toMatch(/[:,\[]133(\.\d+)?[,\}\]]/);
  });

  it("el cierre calcula esperado y diferencia (faltante) y los devuelve ya cerrado", async () => {
    const rep = await env.servicios.turnos.cerrar(turnoId, { efectivoContado: 130, observaciones: "Faltan 3" }, cajero);
    expect(rep.turno).toMatchObject({ estado: "CERRADO", observaciones: "Faltan 3" });
    expect(rep.turno.fechaCierre).not.toBeNull();
    expect(rep.efectivo).toEqual({ esperado: 133, contado: 130, diferencia: -3 });

    const bd = await env.prisma.turnoCaja.findUniqueOrThrow({ where: { id: turnoId } });
    expect(bd).toMatchObject({ estado: "CERRADO", montoCierreCiego: 130, montoCierreReal: 133, diferencia: -3 });
  });

  it("el reporte cerrado detalla formas de pago, movimientos y es visible para el cajero", async () => {
    const rep = await env.servicios.turnos.reporte(turnoId, cajero);
    const efectivo = rep.porFormaPago.find((p) => p.formaPago === "EFECTIVO");
    expect(efectivo).toMatchObject({ monto: 25, cambio: 2, neto: 23 }); // la anulada no cuenta
    expect(rep.porFormaPago.find((p) => p.formaPago === "TARJETA_CREDITO")).toMatchObject({ monto: 23, neto: 23 });
    expect(rep.movimientos).toMatchObject({ ingresos: 20, egresos: 10 });
    expect(rep.movimientos.detalle.map((m) => m.concepto)).toEqual(["Fondo adicional", "Pago mensajero"]);
    expect(rep.ventas).toMatchObject({ cantidad: 2, subtotal: 40, iva: 6, total: 46 });
    expect(rep.turno.cajero).toBe("cajero.uno Test");
  });

  it("un turno cerrado no admite ventas, movimientos ni un segundo cierre", async () => {
    expect(await codigoError(vender(cajero, "EFECTIVO", 25))).toBe("TURNO_REQUERIDO");
    expect(await codigoError(env.servicios.turnos.registrarMovimiento(turnoId, { tipo: "INGRESO", concepto: "Tarde", monto: 1 }, cajero))).toBe("ESTADO_INVALIDO");
    expect(await codigoError(env.servicios.turnos.cerrar(turnoId, { efectivoContado: 133 }, cajero))).toBe("ESTADO_INVALIDO");
  });
});

describe("TurnoService — sobrante, validaciones y permisos", () => {
  it("sobrante → diferencia positiva", async () => {
    const t = await abrir(cajero, 10);
    const rep = await env.servicios.turnos.cerrar(t.id, { efectivoContado: 12.5 }, cajero);
    expect(rep.efectivo).toEqual({ esperado: 10, contado: 12.5, diferencia: 2.5 });
  });

  it("movimientos: concepto obligatorio, monto positivo y no retirar más de lo que hay", async () => {
    const t = await abrir(cajero, 30);
    const mov = (e: unknown) => env.servicios.turnos.registrarMovimiento(t.id, e, cajero);
    expect(await codigoError(mov({ tipo: "INGRESO", concepto: "", monto: 5 }))).toBe("VALIDACION");
    expect(await codigoError(mov({ tipo: "INGRESO", concepto: "ab", monto: 5 }))).toBe("VALIDACION");
    expect(await codigoError(mov({ tipo: "INGRESO", concepto: "Válido", monto: 0 }))).toBe("VALIDACION");
    expect(await codigoError(mov({ tipo: "OTRO", concepto: "Válido", monto: 5 }))).toBe("VALIDACION");
    expect(await codigoError(mov({ tipo: "EGRESO", concepto: "Demasiado", monto: 30.01 }))).toBe("VALIDACION");
    await mov({ tipo: "EGRESO", concepto: "Exacto", monto: 30 }); // vaciar la caja es válido
    expect(await codigoError(mov({ tipo: "EGRESO", concepto: "Sin fondos", monto: 0.01 }))).toBe("VALIDACION");
    await env.servicios.turnos.cerrar(t.id, { efectivoContado: 0 }, cajero);
  });

  it("otro cajero no puede operar ni ver un turno ajeno; el supervisor sí", async () => {
    const t = await abrir(cajero, 40);
    expect(await codigoError(env.servicios.turnos.registrarMovimiento(t.id, { tipo: "INGRESO", concepto: "Intruso", monto: 1 }, cajero2))).toBe("SIN_PERMISO");
    expect(await codigoError(env.servicios.turnos.cerrar(t.id, { efectivoContado: 40 }, cajero2))).toBe("SIN_PERMISO");
    expect(await codigoError(env.servicios.turnos.reporte(t.id, cajero2))).toBe("SIN_PERMISO");

    const vista = await env.servicios.turnos.reporte(t.id, supervisor);
    expect(vista.efectivo?.esperado).toBe(40);
    const cierre = await env.servicios.turnos.cerrar(t.id, { efectivoContado: 40 }, supervisor);
    expect(cierre.efectivo).toEqual({ esperado: 40, contado: 40, diferencia: 0 });
  });

  it("turno inexistente o de otra empresa → NO_ENCONTRADO; cierre sin contado → VALIDACION", async () => {
    const t = await abrir(cajero, 5);
    expect(await codigoError(env.servicios.turnos.reporte("no-existe", cajero))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.turnos.reporte(t.id, { ...cajero, empresaId: "otra" }))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.turnos.cerrar(t.id, {}, cajero))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.turnos.cerrar(t.id, { efectivoContado: -1 }, cajero))).toBe("VALIDACION");
    await env.servicios.turnos.cerrar(t.id, { efectivoContado: 5 }, cajero);
  });

  it("cierres simultáneos: solo uno prospera", async () => {
    const t = await abrir(cajero, 5);
    const r = await Promise.all(Array.from({ length: 4 }, () => codigoError(env.servicios.turnos.cerrar(t.id, { efectivoContado: 5 }, cajero))));
    expect(r.filter((x) => x === "SIN_ERROR")).toHaveLength(1);
    expect(r.filter((x) => x === "ESTADO_INVALIDO")).toHaveLength(3);
  });
});
