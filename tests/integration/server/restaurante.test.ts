// ============================================================
// tests/integration/server/restaurante.test.ts
// Módulo Restaurantes: mesas, cuentas abiertas, cocina/barra, mover/unir y cobro dividido.
// ============================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Mesa, Producto } from "@prisma/client";
import type { ActorCaja } from "../../../src/server/services/turno.service";
import {
  abrirTurno, codigoError, configurarGiro, crearActor, crearEntorno, crearProducto, type Entorno,
} from "../helpers/entorno.helper";

let env: Entorno;
let admin: ActorCaja;
let mesero: ActorCaja;
let mesero2: ActorCaja;
let cocina: ActorCaja;
let cajero: ActorCaja;
let supervisor: ActorCaja;
let bodeguero: ActorCaja;
let plato: Producto; // 10.00 + IVA 15 %, cocina
let bebida: Producto; // 2.00 + IVA 15 %, barra
let postre: Producto; // 3.00, IVA 0 %, cocina

beforeAll(async () => {
  env = await crearEntorno();
  admin = await crearActor(env, "ADMIN", "admin.resto");
  mesero = await crearActor(env, "MESERO", "mesero.uno");
  mesero2 = await crearActor(env, "MESERO", "mesero.dos");
  cocina = await crearActor(env, "COCINA", "cocina.uno");
  cajero = await crearActor(env, "CAJERO", "cajero.resto");
  supervisor = await crearActor(env, "SUPERVISOR", "super.resto");
  bodeguero = await crearActor(env, "BODEGUERO", "bodega.resto");
  await abrirTurno(env, cajero.id);

  plato = await crearProducto(env, { codigo: "PLATO", precioVenta: 10, stock: 200, costo: 4, destino: "COCINA" });
  bebida = await crearProducto(env, { codigo: "BEBIDA", precioVenta: 2, stock: 500, costo: 0.5, destino: "BARRA" });
  postre = await crearProducto(env, { codigo: "POSTRE", precioVenta: 3, stock: 100, costo: 1, destino: "COCINA", aplicaIva: false });
}, 60_000);

afterAll(async () => {
  await env.cerrar();
});

let numeroMesa = 0;
const nuevaMesa = (zona = "SALON", extra: Record<string, unknown> = {}): Promise<Mesa> => {
  numeroMesa += 1;
  return env.servicios.mesas.crear(
    { sucursalId: env.seed.sucursalId, numero: numeroMesa, nombre: `Mesa ${numeroMesa}`, capacidad: 4, zona, ...extra },
    admin
  );
};

const abrir = async (mesa?: Mesa, actor: ActorCaja = mesero) => env.servicios.comandas.abrir({ mesaId: (mesa ?? (await nuevaMesa())).id }, actor);
const pedir = (comandaId: string, items: Array<{ productoId: string; cantidad: number; observaciones?: string }>, actor: ActorCaja = mesero) =>
  env.servicios.comandas.agregarItems(comandaId, { items }, actor);

const cobrar = (comandaId: string, extra: Record<string, unknown> = {}, actor: ActorCaja = cajero) =>
  env.servicios.comandas.cobrar(
    comandaId,
    { puntoEmisionId: env.seed.puntoEmisionId, pagos: [{ formaPago: "EFECTIVO", monto: 500 }], ...extra },
    actor
  );

/** Segunda empresa con los módulos de restaurante activos: sirve para comprobar el aislamiento por empresa. */
async function actorDeOtraEmpresa(): Promise<ActorCaja> {
  const empresa = await env.prisma.empresa.create({
    data: {
      ruc: `179${Date.now().toString().slice(-7)}001`, razonSocial: "Otra S.A.", nombreComercial: "Otra", direccionMatriz: "x",
      telefono: "1", email: "o@o.ec", tipoContribuyente: "SOCIEDAD", regimenTributario: "GENERAL",
    },
  });
  await env.prisma.configuracionGiro.create({ data: { empresaId: empresa.id, giroNegocio: "RESTAURANTE", moduloMesas: true, moduloComandasCocina: true } });
  return { id: mesero.id, empresaId: empresa.id, permisos: mesero.permisos };
}

const stockDe = async (id: string): Promise<number> => (await env.prisma.producto.findUniqueOrThrow({ where: { id } })).stockActual;
const mesaDe = (id: string) => env.prisma.mesa.findUniqueOrThrow({ where: { id } });
const comandaDe = (id: string) => env.prisma.comanda.findUniqueOrThrow({ where: { id }, include: { items: true, cobros: true } });
const itemsDe = async (comandaId: string) => (await env.servicios.comandas.obtener(comandaId, mesero)).items;

describe("Módulo deshabilitado (giro Retail)", () => {
  it("mesas y comandas responden MODULO_DESHABILITADO hasta que se activan los módulos", async () => {
    expect(await codigoError(env.servicios.mesas.listar({}, admin))).toBe("MODULO_DESHABILITADO");
    expect(await codigoError(env.servicios.mesas.crear({ sucursalId: env.seed.sucursalId, numero: 1, nombre: "X" }, admin))).toBe("MODULO_DESHABILITADO");
    expect(await codigoError(env.servicios.comandas.listar({}, mesero))).toBe("MODULO_DESHABILITADO");
    expect(await codigoError(env.servicios.comandas.pendientesCocina({}, cocina))).toBe("MODULO_DESHABILITADO");

    await configurarGiro(env, { moduloMesas: true, moduloComandasCocina: true });
    expect(await codigoError(env.servicios.mesas.listar({}, admin))).toBe("SIN_ERROR");
  });
});

describe("Plano de mesas", () => {
  it("crea mesas con número único por sucursal y las lista por zona con su estado", async () => {
    const a = await nuevaMesa("SALON", { capacidad: 6 });
    const t = await nuevaMesa("TERRAZA");
    expect(a).toMatchObject({ estado: "LIBRE", status: "ACTIVO", capacidad: 6, zona: "SALON" });

    expect(await codigoError(env.servicios.mesas.crear({ sucursalId: env.seed.sucursalId, numero: a.numero, nombre: "Repetida" }, admin))).toBe("DUPLICADO");
    expect(await codigoError(env.servicios.mesas.crear({ sucursalId: "11111111-1111-4111-8111-111111111111", numero: 900, nombre: "X" }, admin))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.mesas.crear({ sucursalId: env.seed.sucursalId, numero: 0, nombre: "X" }, admin))).toBe("VALIDACION");

    const terraza = await env.servicios.mesas.listar({ zona: "TERRAZA" }, mesero);
    expect(terraza.map((m) => m.id)).toContain(t.id);
    expect(terraza.every((m) => m.zona === "TERRAZA" && m.cuenta === null)).toBe(true);
    expect((await env.servicios.mesas.listar({ sucursalId: env.seed.sucursalId }, mesero)).length).toBeGreaterThanOrEqual(2);
  });

  it("actualiza datos, impide números repetidos y oculta las inactivas", async () => {
    const m = await nuevaMesa();
    const otra = await nuevaMesa();
    expect((await env.servicios.mesas.actualizar(m.id, { nombre: "Mesa VIP", capacidad: 8 }, admin))).toMatchObject({ nombre: "Mesa VIP", capacidad: 8 });
    expect(await codigoError(env.servicios.mesas.actualizar(m.id, { numero: otra.numero }, admin))).toBe("DUPLICADO");
    expect(await codigoError(env.servicios.mesas.actualizar("no-existe", { nombre: "X" }, admin))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.mesas.actualizar(m.id, { capacidad: 0 }, admin))).toBe("VALIDACION");

    await env.servicios.mesas.actualizar(m.id, { status: "INACTIVO" }, admin);
    expect((await env.servicios.mesas.listar({}, mesero)).map((x) => x.id)).not.toContain(m.id);
    expect(await codigoError(env.servicios.comandas.abrir({ mesaId: m.id }, mesero))).toBe("VALIDACION");
  });

  it("estado manual LIBRE/RESERVADA solo sin cuenta abierta; una mesa con cuenta no se desactiva", async () => {
    const m = await nuevaMesa();
    expect((await env.servicios.mesas.cambiarEstado(m.id, { estado: "RESERVADA" }, mesero)).estado).toBe("RESERVADA");
    expect((await env.servicios.mesas.cambiarEstado(m.id, { estado: "LIBRE" }, mesero)).estado).toBe("LIBRE");
    expect(await codigoError(env.servicios.mesas.cambiarEstado(m.id, { estado: "OCUPADA" }, mesero))).toBe("VALIDACION");

    await abrir(m);
    expect(await codigoError(env.servicios.mesas.cambiarEstado(m.id, { estado: "LIBRE" }, mesero))).toBe("ESTADO_INVALIDO");
    expect(await codigoError(env.servicios.mesas.actualizar(m.id, { status: "INACTIVO" }, admin))).toBe("ESTADO_INVALIDO");
  });

  it("el plano muestra el consumo vigente de la cuenta abierta", async () => {
    const m = await nuevaMesa();
    const c = await abrir(m);
    await pedir(c.id, [{ productoId: plato.id, cantidad: 2 }, { productoId: bebida.id, cantidad: 3 }]);
    const fila = (await env.servicios.mesas.listar({}, mesero)).find((x) => x.id === m.id);
    expect(fila?.estado).toBe("OCUPADA");
    expect(fila?.cuenta).toMatchObject({ id: c.id, numero: c.numero, consumo: 26, items: 2, comensales: 1, meseroId: mesero.id });
  });
});

describe("Apertura de cuentas", () => {
  it("abre la cuenta, ocupa la mesa y numera las comandas de forma consecutiva por sucursal", async () => {
    const m1 = await nuevaMesa();
    const m2 = await nuevaMesa();
    const c1 = await env.servicios.comandas.abrir({ mesaId: m1.id, comensales: 3, observaciones: "Cumpleaños" }, mesero);
    const c2 = await abrir(m2, mesero2);
    expect(c1).toMatchObject({ estado: "ABIERTA", comensales: 3, observaciones: "Cumpleaños", meseroId: mesero.id, mesa: { id: m1.id } });
    expect(c1.resumen).toEqual({ items: 0, consumo: 0, porCobrar: 0 });
    expect(c2.numero).toBe(c1.numero + 1);
    expect(c2.meseroId).toBe(mesero2.id);
    expect((await mesaDe(m1.id)).estado).toBe("OCUPADA");
  });

  it("una mesa no puede tener dos cuentas abiertas (ni siquiera simultáneas)", async () => {
    const m = await nuevaMesa();
    await abrir(m);
    expect(await codigoError(abrir(m))).toBe("ESTADO_INVALIDO");

    const libre = await nuevaMesa();
    const r = await Promise.all(Array.from({ length: 4 }, () => codigoError(abrir(libre, mesero))));
    expect(r.filter((x) => x === "SIN_ERROR")).toHaveLength(1);
    expect(r.filter((x) => x === "ESTADO_INVALIDO")).toHaveLength(3);
    expect(await env.prisma.comanda.count({ where: { mesaId: libre.id, estado: "ABIERTA" } })).toBe(1);
  });

  it("una mesa reservada puede ocuparse; valida mesa, mesero y comensales", async () => {
    const m = await nuevaMesa();
    await env.servicios.mesas.cambiarEstado(m.id, { estado: "RESERVADA" }, mesero);
    expect((await abrir(m)).estado).toBe("ABIERTA");
    expect((await mesaDe(m.id)).estado).toBe("OCUPADA");

    const libre = await nuevaMesa();
    const inexistente = "11111111-1111-4111-8111-111111111111";
    expect(await codigoError(env.servicios.comandas.abrir({ mesaId: inexistente }, mesero))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.comandas.abrir({ mesaId: libre.id, meseroId: inexistente }, mesero))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.comandas.abrir({ mesaId: libre.id, comensales: 0 }, mesero))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.comandas.abrir({ mesaId: libre.id }, await actorDeOtraEmpresa()))).toBe("NO_ENCONTRADO");
    expect((await mesaDe(libre.id)).estado).toBe("LIBRE"); // los intentos fallidos no la ocuparon
  });

  it("listar y obtener respetan filtros y la empresa", async () => {
    const m = await nuevaMesa();
    const c = await abrir(m);
    const abiertas = await env.servicios.comandas.listar({ estado: "ABIERTA", mesaId: m.id }, mesero);
    expect(abiertas.map((x) => x.id)).toEqual([c.id]);
    expect((await env.servicios.comandas.listar({ estado: "CERRADA", mesaId: m.id }, mesero))).toHaveLength(0);
    expect((await env.servicios.comandas.obtener(c.id, cajero)).numero).toBe(c.numero);
    const otra = await actorDeOtraEmpresa();
    expect(await codigoError(env.servicios.comandas.obtener(c.id, otra))).toBe("NO_ENCONTRADO");
    expect(await env.servicios.comandas.listar({}, otra)).toHaveLength(0);
    expect(await env.servicios.mesas.listar({}, otra)).toHaveLength(0);
    expect(await codigoError(env.servicios.comandas.listar({ estado: "RARA" }, mesero))).toBe("VALIDACION");
  });
});

describe("Pedidos (ítems)", () => {
  it("fija precio y destino al pedir; el cambio de precio posterior no afecta lo ya pedido", async () => {
    const c = await abrir();
    const r = await pedir(c.id, [
      { productoId: plato.id, cantidad: 2, observaciones: "Sin cebolla" },
      { productoId: bebida.id, cantidad: 1 },
    ]);
    expect(r.items).toHaveLength(2);
    const p = r.items.find((i) => i.productoId === plato.id);
    expect(p).toMatchObject({ cantidad: 2, precioUnitario: 10, total: 20, estado: "PENDIENTE", destino: "COCINA", observaciones: "Sin cebolla", envio: 0 });
    expect(r.items.find((i) => i.productoId === bebida.id)?.destino).toBe("BARRA");
    expect(r.resumen).toEqual({ items: 2, consumo: 22, porCobrar: 22 });

    await env.prisma.producto.update({ where: { id: plato.id }, data: { precioVenta: 12 } });
    try {
      const mas = await pedir(c.id, [{ productoId: plato.id, cantidad: 1 }]);
      const precios = mas.items.filter((i) => i.productoId === plato.id).map((i) => i.precioUnitario).sort();
      expect(precios).toEqual([10, 12, ]); // el primero conserva 10.00; el nuevo se pide a 12.00
    } finally {
      await env.prisma.producto.update({ where: { id: plato.id }, data: { precioVenta: 10 } });
    }
  });

  it("valida producto, cantidad, fracciones y estado de la cuenta", async () => {
    const c = await abrir();
    const inexistente = "11111111-1111-4111-8111-111111111111";
    expect(await codigoError(pedir(c.id, [{ productoId: inexistente, cantidad: 1 }]))).toBe("NO_ENCONTRADO");
    expect(await codigoError(pedir(c.id, [{ productoId: plato.id, cantidad: 0 }]))).toBe("VALIDACION");
    expect(await codigoError(pedir(c.id, [{ productoId: plato.id, cantidad: 1.5 }]))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.comandas.agregarItems(c.id, { items: [] }, mesero))).toBe("VALIDACION");
    expect(await codigoError(pedir("no-existe", [{ productoId: plato.id, cantidad: 1 }]))).toBe("NO_ENCONTRADO");

    const inactivo = await crearProducto(env, { codigo: "INACT", precioVenta: 1 });
    await env.prisma.producto.update({ where: { id: inactivo.id }, data: { status: "INACTIVO" } });
    expect(await codigoError(pedir(c.id, [{ productoId: inactivo.id, cantidad: 1 }]))).toBe("VALIDACION");
    // un ítem inválido no deja los demás a medias
    expect(await codigoError(pedir(c.id, [{ productoId: plato.id, cantidad: 1 }, { productoId: inexistente, cantidad: 1 }]))).toBe("NO_ENCONTRADO");
    expect(await itemsDe(c.id)).toHaveLength(0);
  });

  it("cancelar: un pendiente se quita libremente; uno enviado exige supervisor y motivo", async () => {
    const c = await abrir();
    await pedir(c.id, [{ productoId: plato.id, cantidad: 1 }, { productoId: bebida.id, cantidad: 1 }, { productoId: postre.id, cantidad: 1 }]);
    const [i1, i2] = await itemsDe(c.id);

    const tras = await env.servicios.comandas.cancelarItem(c.id, (i1 as { id: string }).id, {}, mesero);
    expect(tras.items.find((i) => i.id === i1?.id)?.estado).toBe("CANCELADO");
    expect(tras.resumen.items).toBe(2);
    expect(await codigoError(env.servicios.comandas.cancelarItem(c.id, (i1 as { id: string }).id, {}, mesero))).toBe("ESTADO_INVALIDO");
    expect(await codigoError(env.servicios.comandas.cancelarItem(c.id, "no-existe", {}, mesero))).toBe("NO_ENCONTRADO");

    await env.servicios.comandas.enviar(c.id, mesero);
    const enviado = (i2 as { id: string }).id;
    expect(await codigoError(env.servicios.comandas.cancelarItem(c.id, enviado, { motivo: "Se equivocó" }, mesero))).toBe("SIN_PERMISO");
    expect(await codigoError(env.servicios.comandas.cancelarItem(c.id, enviado, {}, supervisor))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.comandas.cancelarItem(c.id, enviado, { motivo: "no" }, supervisor))).toBe("VALIDACION");
    const ok = await env.servicios.comandas.cancelarItem(c.id, enviado, { motivo: "Cliente se fue sin esperar" }, supervisor);
    expect(ok.items.find((i) => i.id === enviado)).toMatchObject({ estado: "CANCELADO", motivoCancelacion: "Cliente se fue sin esperar" });
  });
});

describe("Cocina y barra", () => {
  it("enviar agrupa por destino, numera los envíos y solo manda lo pendiente", async () => {
    const m = await nuevaMesa();
    const c = await abrir(m);
    await pedir(c.id, [{ productoId: plato.id, cantidad: 2, observaciones: "Bien cocido" }, { productoId: bebida.id, cantidad: 2 }, { productoId: postre.id, cantidad: 1 }]);

    const t1 = await env.servicios.comandas.enviar(c.id, mesero);
    expect(t1).toMatchObject({ comandaId: c.id, numeroComanda: c.numero, mesa: m.nombre, envio: 1 });
    const porDestino = Object.fromEntries(t1.destinos.map((d) => [d.destino, d.items.map((i) => `${i.producto}x${i.cantidad}`).sort()]));
    expect(porDestino).toEqual({ COCINA: ["Producto POSTREx1", "Producto PLATOx2"].sort(), BARRA: ["Producto BEBIDAx2"] });
    expect(t1.destinos.find((d) => d.destino === "COCINA")?.items.find((i) => i.producto === "Producto PLATO")?.observaciones).toBe("Bien cocido");

    expect(await codigoError(env.servicios.comandas.enviar(c.id, mesero))).toBe("VALIDACION"); // nada pendiente

    await pedir(c.id, [{ productoId: bebida.id, cantidad: 1 }]);
    const t2 = await env.servicios.comandas.enviar(c.id, mesero);
    expect(t2.envio).toBe(2);
    expect(t2.destinos).toHaveLength(1);
    expect(t2.destinos[0]).toMatchObject({ destino: "BARRA" });
    expect(t2.destinos[0]?.items).toHaveLength(1);

    const items = await itemsDe(c.id);
    expect(items.every((i) => i.estado === "EN_PREPARACION" && i.enviadoAt !== null)).toBe(true);
    expect(items.map((i) => i.envio).sort()).toEqual([1, 1, 1, 2]);
  });

  it("la vista de cocina lista por destino, del más antiguo al más reciente, y respeta el estado", async () => {
    const c1 = await abrir();
    await pedir(c1.id, [{ productoId: plato.id, cantidad: 1 }, { productoId: bebida.id, cantidad: 1 }]);
    await env.servicios.comandas.enviar(c1.id, mesero);
    const c2 = await abrir();
    await pedir(c2.id, [{ productoId: plato.id, cantidad: 3 }]);
    await env.servicios.comandas.enviar(c2.id, mesero);
    await pedir(c2.id, [{ productoId: postre.id, cantidad: 1 }]); // pendiente: no se ve en cocina

    const cocinaItems = (await env.servicios.comandas.pendientesCocina({ destino: "COCINA" }, cocina)).filter((i) => [c1.id, c2.id].includes(i.comandaId));
    expect(cocinaItems.map((i) => `${i.comanda.numero}:${i.producto.nombre}`)).toEqual([`${c1.numero}:Producto PLATO`, `${c2.numero}:Producto PLATO`]);
    expect(cocinaItems[0]?.comanda.mesa.nombre).toBeTruthy();

    const barra = (await env.servicios.comandas.pendientesCocina({ destino: "BARRA" }, cocina)).filter((i) => i.comandaId === c1.id);
    expect(barra).toHaveLength(1);

    const [primero] = cocinaItems;
    await env.servicios.comandas.cambiarEstadoItem((primero as { comandaId: string }).comandaId, (primero as { id: string }).id, { estado: "LISTO" }, cocina);
    expect((await env.servicios.comandas.pendientesCocina({ destino: "COCINA" }, cocina)).map((i) => i.id)).not.toContain(primero?.id);
    expect((await env.servicios.comandas.pendientesCocina({ destino: "COCINA", estado: "LISTO" }, cocina)).map((i) => i.id)).toContain(primero?.id);
    expect(await codigoError(env.servicios.comandas.pendientesCocina({ destino: "SOTANO" }, cocina))).toBe("VALIDACION");
  });

  it("estados del ítem: EN_PREPARACION → LISTO → ENTREGADO, sin saltos ni retrocesos", async () => {
    const c = await abrir();
    await pedir(c.id, [{ productoId: plato.id, cantidad: 1 }]);
    const [item] = await itemsDe(c.id);
    const id = (item as { id: string }).id;
    const cambiar = (estado: string, actor: ActorCaja = cocina) => env.servicios.comandas.cambiarEstadoItem(c.id, id, { estado }, actor);

    expect(await codigoError(cambiar("LISTO"))).toBe("ESTADO_INVALIDO"); // aún no se envió
    expect(await codigoError(cambiar("ENTREGADO", mesero))).toBe("ESTADO_INVALIDO");
    await env.servicios.comandas.enviar(c.id, mesero);
    expect(await codigoError(cambiar("ENTREGADO", mesero))).toBe("ESTADO_INVALIDO"); // sin pasar por LISTO
    expect((await cambiar("LISTO")).items[0]?.estado).toBe("LISTO");
    expect(await codigoError(cambiar("LISTO"))).toBe("ESTADO_INVALIDO");
    expect((await cambiar("ENTREGADO", mesero)).items[0]?.estado).toBe("ENTREGADO");
    expect(await codigoError(cambiar("PENDIENTE"))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.comandas.cambiarEstadoItem(c.id, "no-existe", { estado: "LISTO" }, cocina))).toBe("NO_ENCONTRADO");
  });

  it("sin el módulo de cocina: no hay envío y un pendiente se entrega directamente", async () => {
    await configurarGiro(env, { moduloComandasCocina: false });
    try {
      const c = await abrir();
      await pedir(c.id, [{ productoId: bebida.id, cantidad: 1 }]);
      const [item] = await itemsDe(c.id);
      expect(await codigoError(env.servicios.comandas.enviar(c.id, mesero))).toBe("MODULO_DESHABILITADO");
      expect(await codigoError(env.servicios.comandas.pendientesCocina({}, cocina))).toBe("MODULO_DESHABILITADO");
      expect(await codigoError(env.servicios.comandas.cambiarEstadoItem(c.id, (item as { id: string }).id, { estado: "LISTO" }, mesero))).toBe("ESTADO_INVALIDO");
      expect((await env.servicios.comandas.cambiarEstadoItem(c.id, (item as { id: string }).id, { estado: "ENTREGADO" }, mesero)).items[0]?.estado).toBe("ENTREGADO");
    } finally {
      await configurarGiro(env, { moduloComandasCocina: true });
    }
  });
});

describe("Mover y unir cuentas", () => {
  it("mover: la cuenta pasa a una mesa libre; la anterior se libera", async () => {
    const origen = await nuevaMesa();
    const destino = await nuevaMesa("TERRAZA");
    const c = await abrir(origen);
    await pedir(c.id, [{ productoId: plato.id, cantidad: 1 }]);

    const movida = await env.servicios.comandas.mover(c.id, { mesaId: destino.id }, mesero);
    expect(movida.mesa.id).toBe(destino.id);
    expect(movida.items).toHaveLength(1);
    expect((await mesaDe(origen.id)).estado).toBe("LIBRE");
    expect((await mesaDe(destino.id)).estado).toBe("OCUPADA");
  });

  it("mover valida destino: misma mesa, ocupada, inactiva, de otra sucursal o inexistente", async () => {
    const a = await nuevaMesa();
    const ocupada = await nuevaMesa();
    const inactiva = await nuevaMesa();
    await env.servicios.mesas.actualizar(inactiva.id, { status: "INACTIVO" }, admin);
    const c = await abrir(a);
    await abrir(ocupada);

    const sucursal2 = await env.prisma.sucursal.create({ data: { empresaId: env.seed.empresaId, codigo: "002", nombre: "Norte", direccion: "x", telefono: "1" } });
    const lejana = await env.prisma.mesa.create({ data: { sucursalId: sucursal2.id, numero: 1, nombre: "Mesa Norte" } });

    const mover = (mesaId: string) => env.servicios.comandas.mover(c.id, { mesaId }, mesero);
    expect(await codigoError(mover(a.id))).toBe("VALIDACION");
    expect(await codigoError(mover(ocupada.id))).toBe("ESTADO_INVALIDO");
    expect(await codigoError(mover(inactiva.id))).toBe("VALIDACION");
    expect(await codigoError(mover(lejana.id))).toBe("VALIDACION");
    expect(await codigoError(mover("11111111-1111-4111-8111-111111111111"))).toBe("NO_ENCONTRADO");
    expect((await mesaDe(a.id)).estado).toBe("OCUPADA");
  });

  it("unir: los ítems pasan a la cuenta destino, la origen queda UNIDA y su mesa libre", async () => {
    const m1 = await nuevaMesa();
    const m2 = await nuevaMesa();
    const origen = await env.servicios.comandas.abrir({ mesaId: m1.id, comensales: 2 }, mesero);
    const destino = await env.servicios.comandas.abrir({ mesaId: m2.id, comensales: 3 }, mesero);
    await pedir(origen.id, [{ productoId: plato.id, cantidad: 2 }, { productoId: bebida.id, cantidad: 2 }]);
    await pedir(destino.id, [{ productoId: postre.id, cantidad: 1 }]);

    const unida = await env.servicios.comandas.unir(origen.id, { comandaDestinoId: destino.id }, mesero);
    expect(unida.id).toBe(destino.id);
    expect(unida.items).toHaveLength(3);
    expect(unida.comensales).toBe(5);
    expect(unida.resumen.consumo).toBe(27); // 20 + 4 + 3
    expect((await comandaDe(origen.id)).estado).toBe("UNIDA");
    expect((await mesaDe(m1.id)).estado).toBe("LIBRE");
    expect((await mesaDe(m2.id)).estado).toBe("OCUPADA");
    expect(await codigoError(pedir(origen.id, [{ productoId: plato.id, cantidad: 1 }]))).toBe("ESTADO_INVALIDO");
  });

  it("unir valida: consigo misma, cuenta cerrada y otra sucursal", async () => {
    const c1 = await abrir();
    const c2 = await abrir();
    expect(await codigoError(env.servicios.comandas.unir(c1.id, { comandaDestinoId: c1.id }, mesero))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.comandas.unir(c1.id, { comandaDestinoId: "11111111-1111-4111-8111-111111111111" }, mesero))).toBe("NO_ENCONTRADO");
    await env.servicios.comandas.anular(c2.id, { motivo: "Mesa cancelada" }, supervisor);
    expect(await codigoError(env.servicios.comandas.unir(c1.id, { comandaDestinoId: c2.id }, mesero))).toBe("ESTADO_INVALIDO");
  });
});

describe("Pre-cuenta", () => {
  it("calcula el IVA por producto y simula la división en partes iguales", async () => {
    const c = await abrir();
    await pedir(c.id, [{ productoId: plato.id, cantidad: 2 }, { productoId: bebida.id, cantidad: 3 }, { productoId: postre.id, cantidad: 1 }]);
    const pre = await env.servicios.comandas.preCuenta(c.id, {}, cajero);
    // 20 + 6 gravados (IVA 3.90) + 3 sin IVA
    expect(pre.totales).toEqual({ subtotal: 29, descuento: 0, iva: 3.9, total: 32.9 });
    expect(pre.items).toHaveLength(3);
    expect(pre.partes).toBeUndefined();

    const tres = await env.servicios.comandas.preCuenta(c.id, { partes: "3" }, cajero);
    expect(tres.partes?.map((p) => p.parte)).toEqual([1, 2, 3]);
    expect(tres.partes?.every((p) => !p.cobrada)).toBe(true);
    const suma = tres.partes?.reduce((a, p) => a + p.total, 0) ?? 0;
    expect(Math.abs(suma - 32.9)).toBeLessThan(0.05); // diferencias de centavos por redondeo por línea
    expect(await codigoError(env.servicios.comandas.preCuenta(c.id, { partes: "1" }, cajero))).toBe("VALIDACION");
  });
});

describe("Cobro por ítems", () => {
  it("cada cobro es una venta independiente; la cuenta se cierra y la mesa se libera al saldarla", async () => {
    const m = await nuevaMesa();
    const c = await abrir(m);
    await pedir(c.id, [{ productoId: plato.id, cantidad: 1 }, { productoId: plato.id, cantidad: 1 }, { productoId: bebida.id, cantidad: 1 }]);
    const items = await itemsDe(c.id);
    const [p1, p2, b1] = items as [typeof items[number], typeof items[number], typeof items[number]];
    const stockPlato = await stockDe(plato.id);
    const stockBebida = await stockDe(bebida.id);

    // 1.er comensal paga solo su plato
    const r1 = await cobrar(c.id, { itemIds: [p1.id], clienteNombre: "Ana" });
    expect(r1.cerrada).toBe(false);
    expect(r1.venta).toMatchObject({ subtotal: 10, iva: 1.5, total: 11.5, estado: "COMPLETADA", clienteNombre: "Ana" });
    expect(r1.venta.observaciones).toBe(`Comanda ${c.numero} - ${m.nombre}`);
    expect(r1.comanda.resumen).toEqual({ items: 3, consumo: 22, porCobrar: 12 });
    expect(r1.comanda.items.find((i) => i.id === p1.id)).toMatchObject({ cobrado: true, ventaId: r1.venta.id });
    expect(await stockDe(plato.id)).toBe(stockPlato - 1); // el stock se descuenta al cobrar
    expect((await mesaDe(m.id)).estado).toBe("OCUPADA");

    // se puede seguir pidiendo tras un cobro parcial
    await pedir(c.id, [{ productoId: postre.id, cantidad: 1 }]);

    // el resto se cobra en otra venta
    const r2 = await cobrar(c.id);
    expect(r2.cerrada).toBe(true);
    expect(r2.venta.id).not.toBe(r1.venta.id);
    expect(r2.venta.numero).not.toBe(r1.venta.numero);
    expect(r2.venta.lineas).toHaveLength(3); // plato 2, bebida, postre
    expect(r2.comanda).toMatchObject({ estado: "CERRADA", resumen: { porCobrar: 0 } });
    expect(r2.comanda.fechaCierre).not.toBeNull();
    expect(r2.comanda.cobros.map((x) => x.modo)).toEqual(["ITEMS", "ITEMS"]);
    expect((await mesaDe(m.id)).estado).toBe("LIBRE");
    expect(await stockDe(plato.id)).toBe(stockPlato - 2);
    expect(await stockDe(bebida.id)).toBe(stockBebida - 1);
    expect(p2.id).toBeTruthy();
    expect(b1.id).toBeTruthy();

    // una cuenta cerrada no admite más cobros ni pedidos
    expect(await codigoError(cobrar(c.id))).toBe("ESTADO_INVALIDO");
    expect(await codigoError(pedir(c.id, [{ productoId: plato.id, cantidad: 1 }]))).toBe("ESTADO_INVALIDO");
  });

  it("no se cobra dos veces un ítem, ni uno cancelado, ni ítems ajenos", async () => {
    const c = await abrir();
    await pedir(c.id, [{ productoId: plato.id, cantidad: 1 }, { productoId: bebida.id, cantidad: 1 }, { productoId: postre.id, cantidad: 1 }]);
    const [a, b, d] = (await itemsDe(c.id)).map((i) => ({ id: i.id })) as [{ id: string }, { id: string }, { id: string }];
    await env.servicios.comandas.cancelarItem(c.id, b.id, {}, mesero);
    await cobrar(c.id, { itemIds: [a.id] });

    expect(await codigoError(cobrar(c.id, { itemIds: [a.id] }))).toBe("VALIDACION"); // ya cobrado
    expect(await codigoError(cobrar(c.id, { itemIds: [b.id] }))).toBe("VALIDACION"); // cancelado
    expect(await codigoError(cobrar(c.id, { itemIds: ["11111111-1111-4111-8111-111111111111"] }))).toBe("VALIDACION");
    expect((await cobrar(c.id, { itemIds: [d.id] })).cerrada).toBe(true); // el cancelado no impide cerrar
  });

  it("cobros simultáneos del mismo ítem: solo uno prospera y el stock baja una vez", async () => {
    const c = await abrir();
    await pedir(c.id, [{ productoId: plato.id, cantidad: 1 }, { productoId: bebida.id, cantidad: 1 }]);
    const [a] = (await itemsDe(c.id)).map((i) => ({ id: i.id })) as [{ id: string }];
    const antes = await stockDe(plato.id);
    const r = await Promise.all(Array.from({ length: 3 }, () => codigoError(cobrar(c.id, { itemIds: [a.id] }))));
    expect(r.filter((x) => x === "SIN_ERROR")).toHaveLength(1);
    expect(await stockDe(plato.id)).toBe(antes - 1);
    expect(await env.prisma.cobroComanda.count({ where: { comandaId: c.id } })).toBe(1);
  });

  it("se cobra al precio pactado aunque el catálogo haya cambiado (el cajero no necesita permiso de precio)", async () => {
    const c = await abrir();
    await pedir(c.id, [{ productoId: plato.id, cantidad: 1 }]);
    await env.prisma.producto.update({ where: { id: plato.id }, data: { precioVenta: 15 } });
    try {
      const r = await cobrar(c.id);
      expect(r.venta.lineas[0]?.precioUnitario).toBe(10);
      expect(r.venta.total).toBe(11.5);
    } finally {
      await env.prisma.producto.update({ where: { id: plato.id }, data: { precioVenta: 10 } });
    }
  });

  it("propina: no lleva IVA, se suma al valor a pagar y entra al efectivo del turno", async () => {
    const c = await abrir();
    await pedir(c.id, [{ productoId: plato.id, cantidad: 1 }]);
    const turno = await env.servicios.turnos.actual(cajero);
    const esperado = async () => (await env.servicios.turnos.reporte(turno.id, supervisor)).efectivo?.esperado ?? NaN;
    const antes = await esperado();

    // 11.50 + 1.50 de propina = 13.00: con 12.00 no alcanza
    expect(await codigoError(cobrar(c.id, { propina: 1.5, pagos: [{ formaPago: "EFECTIVO", monto: 12 }] }))).toBe("VALIDACION");
    expect((await comandaDe(c.id)).estado).toBe("ABIERTA");

    const r = await cobrar(c.id, { propina: 1.5, pagos: [{ formaPago: "EFECTIVO", monto: 20 }] });
    expect(r.venta).toMatchObject({ subtotal: 10, iva: 1.5, total: 11.5, propina: 1.5 });
    expect(r.venta.pagos[0]).toMatchObject({ monto: 20, cambio: 7 });
    expect(await esperado()).toBe(antes + 13); // 20 recibidos − 7 de cambio
    expect(await codigoError(cobrar(c.id, { propina: -1 }))).toBe("VALIDACION");
  });

  it("pago mixto y a crédito se manejan como en cualquier venta", async () => {
    const c = await abrir();
    await pedir(c.id, [{ productoId: plato.id, cantidad: 2 }]);
    const r = await cobrar(c.id, { pagos: [{ formaPago: "TARJETA_CREDITO", monto: 10 }, { formaPago: "EFECTIVO", monto: 13 }] });
    expect(r.venta.total).toBe(23);
    expect(r.venta.pagos.map((p) => p.formaPago).sort()).toEqual(["EFECTIVO", "TARJETA_CREDITO"]);
  });

  it("falla sin dejar rastro: stock insuficiente, sin turno, punto de otra sucursal y sin permiso", async () => {
    const escaso = await crearProducto(env, { codigo: "ESCASO", precioVenta: 5, stock: 1, destino: "COCINA" });
    const c = await abrir();
    await pedir(c.id, [{ productoId: plato.id, cantidad: 1 }, { productoId: escaso.id, cantidad: 4 }]); // ni entero ni por mitades cabe en el stock (1)
    const ventas = await env.prisma.venta.count();
    const secuencial = (await env.prisma.puntoEmision.findUniqueOrThrow({ where: { id: env.seed.puntoEmisionId } })).secuencialVenta;
    const stock = await stockDe(plato.id);

    expect(await codigoError(cobrar(c.id))).toBe("STOCK_INSUFICIENTE");
    expect(await codigoError(cobrar(c.id, { modo: "PARTE_IGUAL", partes: 2, parte: 1 }))).toBe("STOCK_INSUFICIENTE");
    const despues = await comandaDe(c.id);
    expect(despues).toMatchObject({ estado: "ABIERTA", divisionPartes: null });
    expect(despues.items.every((i) => !i.cobrado)).toBe(true);
    expect(despues.cobros).toHaveLength(0);
    expect(await env.prisma.venta.count()).toBe(ventas);
    expect((await env.prisma.puntoEmision.findUniqueOrThrow({ where: { id: env.seed.puntoEmisionId } })).secuencialVenta).toBe(secuencial);
    expect(await stockDe(plato.id)).toBe(stock);

    // sin turno abierto (el mesero no abrió caja)
    expect(await codigoError(cobrar(c.id, { itemIds: [(despues.items[0] as { id: string }).id] }, mesero))).toBe("TURNO_REQUERIDO");
    // sin permiso para cobrar cuentas
    expect(await codigoError(cobrar(c.id, {}, bodeguero))).toBe("SIN_PERMISO");
    // punto de emisión de otra sucursal
    const sucursal2 = await env.prisma.sucursal.create({ data: { empresaId: env.seed.empresaId, codigo: "009", nombre: "Otra", direccion: "x", telefono: "1" } });
    const punto2 = await env.prisma.puntoEmision.create({ data: { sucursalId: sucursal2.id, codigo: "001", descripcion: "Caja" } });
    expect(await codigoError(cobrar(c.id, { puntoEmisionId: punto2.id }))).toBe("VALIDACION");
    expect(await codigoError(cobrar(c.id, { pagos: [] }))).toBe("VALIDACION");
  });
});

describe("Cobro en partes iguales", () => {
  it("cada parte es una venta; el stock total descontado es exacto y la cuenta cierra con la última", async () => {
    const m = await nuevaMesa();
    const c = await abrir(m);
    await pedir(c.id, [{ productoId: plato.id, cantidad: 1 }, { productoId: bebida.id, cantidad: 3 }]);
    const stockPlato = await stockDe(plato.id);
    const stockBebida = await stockDe(bebida.id);

    const r1 = await cobrar(c.id, { modo: "PARTE_IGUAL", partes: 3, parte: 1 });
    expect(r1.cerrada).toBe(false);
    expect(r1.comanda.divisionPartes).toBe(3);
    expect(r1.venta.lineas.find((l) => l.productoId === plato.id)?.cantidad).toBe(0.3333);
    expect(r1.venta.lineas.find((l) => l.productoId === bebida.id)?.cantidad).toBe(1);

    const r2 = await cobrar(c.id, { modo: "PARTE_IGUAL", partes: 3, parte: 2 });
    expect(r2.cerrada).toBe(false);
    const pre = await env.servicios.comandas.preCuenta(c.id, {}, cajero);
    expect(pre.partes?.map((p) => p.cobrada)).toEqual([true, true, false]);

    const r3 = await cobrar(c.id, { modo: "PARTE_IGUAL", partes: 3, parte: 3 });
    expect(r3.cerrada).toBe(true);
    expect(r3.venta.lineas.find((l) => l.productoId === plato.id)?.cantidad).toBe(0.3334); // la última absorbe el resto
    expect(r3.comanda).toMatchObject({ estado: "CERRADA", resumen: { porCobrar: 0 } });
    expect(r3.comanda.cobros.map((x) => [x.modo, x.parte])).toEqual([["PARTE_IGUAL", 1], ["PARTE_IGUAL", 2], ["PARTE_IGUAL", 3]]);
    expect((await mesaDe(m.id)).estado).toBe("LIBRE");

    expect(await stockDe(plato.id)).toBeCloseTo(stockPlato - 1, 6);
    expect(await stockDe(bebida.id)).toBeCloseTo(stockBebida - 3, 6);
    const totales = [r1, r2, r3].map((r) => r.venta.total);
    expect(Math.abs(totales.reduce((a, b) => a + b, 0) - 18.4)).toBeLessThan(0.05); // (10 + 6) + IVA 15 %
    expect(new Set([r1, r2, r3].map((r) => r.venta.numero)).size).toBe(3);
  });

  it("reglas de la división: parte repetida, partes distintas, mezcla con ítems y contenido congelado", async () => {
    const c = await abrir();
    await pedir(c.id, [{ productoId: plato.id, cantidad: 2 }, { productoId: bebida.id, cantidad: 2 }]);
    const [a] = (await itemsDe(c.id)).map((i) => ({ id: i.id })) as [{ id: string }];
    await cobrar(c.id, { modo: "PARTE_IGUAL", partes: 2, parte: 1 });

    expect(await codigoError(cobrar(c.id, { modo: "PARTE_IGUAL", partes: 2, parte: 1 }))).toBe("ESTADO_INVALIDO"); // parte ya cobrada
    expect(await codigoError(cobrar(c.id, { modo: "PARTE_IGUAL", partes: 3, parte: 2 }))).toBe("VALIDACION"); // otro nº de partes
    expect(await codigoError(cobrar(c.id, { itemIds: [a.id] }))).toBe("ESTADO_INVALIDO"); // no se mezcla con ítems
    expect(await codigoError(cobrar(c.id))).toBe("ESTADO_INVALIDO");
    expect(await codigoError(pedir(c.id, [{ productoId: postre.id, cantidad: 1 }]))).toBe("ESTADO_INVALIDO"); // contenido congelado
    expect(await codigoError(env.servicios.comandas.cancelarItem(c.id, a.id, {}, mesero))).toBe("ESTADO_INVALIDO");
    expect(await codigoError(env.servicios.comandas.anular(c.id, { motivo: "Con cobros" }, supervisor))).toBe("ESTADO_INVALIDO");
    expect((await cobrar(c.id, { modo: "PARTE_IGUAL", partes: 2, parte: 2 })).cerrada).toBe(true);
  });

  it("no se divide una cuenta que ya tuvo cobros por ítems", async () => {
    const c = await abrir();
    await pedir(c.id, [{ productoId: plato.id, cantidad: 1 }, { productoId: bebida.id, cantidad: 1 }]);
    const [a] = (await itemsDe(c.id)).map((i) => ({ id: i.id })) as [{ id: string }];
    await cobrar(c.id, { itemIds: [a.id] });
    expect(await codigoError(cobrar(c.id, { modo: "PARTE_IGUAL", partes: 2, parte: 1 }))).toBe("ESTADO_INVALIDO");
  });

  it("validación de parámetros: partes/parte obligatorios, parte ≤ partes y exclusividad de modos", async () => {
    const c = await abrir();
    await pedir(c.id, [{ productoId: plato.id, cantidad: 1 }]);
    const [a] = (await itemsDe(c.id)).map((i) => ({ id: i.id })) as [{ id: string }];
    expect(await codigoError(cobrar(c.id, { modo: "PARTE_IGUAL" }))).toBe("VALIDACION");
    expect(await codigoError(cobrar(c.id, { modo: "PARTE_IGUAL", partes: 2 }))).toBe("VALIDACION");
    expect(await codigoError(cobrar(c.id, { modo: "PARTE_IGUAL", partes: 2, parte: 3 }))).toBe("VALIDACION");
    expect(await codigoError(cobrar(c.id, { modo: "PARTE_IGUAL", partes: 1, parte: 1 }))).toBe("VALIDACION");
    expect(await codigoError(cobrar(c.id, { modo: "PARTE_IGUAL", partes: 2, parte: 1, itemIds: [a.id] }))).toBe("VALIDACION");
    expect(await codigoError(cobrar(c.id, { modo: "ITEMS", partes: 2 }))).toBe("VALIDACION");
    expect(await codigoError(cobrar(c.id, { modo: "RARO" }))).toBe("VALIDACION");
  });
});

describe("Anular una cuenta", () => {
  it("solo un supervisor, con motivo: cancela los ítems, libera la mesa y no toca el inventario", async () => {
    const m = await nuevaMesa();
    const c = await abrir(m);
    await pedir(c.id, [{ productoId: plato.id, cantidad: 2 }, { productoId: bebida.id, cantidad: 1 }]);
    await env.servicios.comandas.enviar(c.id, mesero);
    const stock = await stockDe(plato.id);

    expect(await codigoError(env.servicios.comandas.anular(c.id, { motivo: "Se fueron" }, mesero))).toBe("SIN_PERMISO");
    expect(await codigoError(env.servicios.comandas.anular(c.id, { motivo: "Se fueron" }, cajero))).toBe("SIN_PERMISO");
    expect(await codigoError(env.servicios.comandas.anular(c.id, { motivo: "no" }, supervisor))).toBe("VALIDACION");

    const a = await env.servicios.comandas.anular(c.id, { motivo: "Se fueron sin consumir" }, supervisor);
    expect(a).toMatchObject({ estado: "ANULADA", motivoAnulacion: "Se fueron sin consumir", resumen: { items: 0, consumo: 0 } });
    expect(a.items.every((i) => i.estado === "CANCELADO")).toBe(true);
    expect((await mesaDe(m.id)).estado).toBe("LIBRE");
    expect(await stockDe(plato.id)).toBe(stock);
    expect(await codigoError(env.servicios.comandas.anular(c.id, { motivo: "Otra vez más" }, supervisor))).toBe("ESTADO_INVALIDO");
    // la mesa puede volver a usarse
    expect((await abrir(m)).numero).toBeGreaterThan(c.numero);
  });

  it("una cuenta con cobros no se anula", async () => {
    const c = await abrir();
    await pedir(c.id, [{ productoId: plato.id, cantidad: 1 }, { productoId: bebida.id, cantidad: 1 }]);
    const [a] = (await itemsDe(c.id)).map((i) => ({ id: i.id })) as [{ id: string }];
    await cobrar(c.id, { itemIds: [a.id] });
    expect(await codigoError(env.servicios.comandas.anular(c.id, { motivo: "Intento con cobros" }, supervisor))).toBe("ESTADO_INVALIDO");
  });
});
