// ============================================================
// tests/integration/server/lectores.test.ts
// Escaneo de códigos (producto, presentación y etiqueta de balanza) y balanza serial, con un puerto serie simulado.
// ============================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Producto } from "@prisma/client";
import type { PuertoSerie } from "../../../src/server/services/hardware/balanza.protocolo";
import { armarEtiquetaBalanza } from "../../../src/server/services/hardware/codigoBarras.util";
import type { ActorCaja } from "../../../src/server/services/turno.service";
import { codigoError, crearActor, crearEntorno, crearProducto, PASSWORD_ADMIN, type Entorno } from "../helpers/entorno.helper";

let env: Entorno;
let admin: ActorCaja;
let cajero: ActorCaja;
let queso: Producto; // KG, PLU 000123
let jabon: Producto; // LB, PLU 000456
let arroz: Producto; // UN, con código de barras normal

/** Lo que "envía" la balanza en cada lectura. */
const balanza = { tramas: ["ST,GS,+  2.500kg\r\n"] as string[], abre: true, silencio: false, lecturas: 0 };
const fabricaPuerto = (): PuertoSerie => {
  let receptor: (d: Buffer) => void = () => undefined;
  return {
    alRecibir: (r) => {
      receptor = r;
    },
    alFallar: () => undefined,
    abrir: async () => {
      balanza.lecturas += 1;
      if (!balanza.abre) throw new Error("El puerto COM3 no existe");
      if (balanza.silencio) return;
      for (const t of balanza.tramas) setTimeout(() => receptor(Buffer.from(t, "latin1")), 5);
    },
    cerrar: async () => undefined,
  };
};

beforeAll(async () => {
  env = await crearEntorno({ balanza: { fabricaPuerto, lectura: { timeoutMs: 300 } } });
  admin = await crearActor(env, "ADMIN", "lec.admin");
  cajero = await crearActor(env, "CAJERO", "lec.caja");
  queso = await crearProducto(env, { codigo: "QUESO", precioVenta: 8, stock: 50, unidad: "KG", codigoBarras: "000123" });
  jabon = await crearProducto(env, { codigo: "JABON", precioVenta: 2, stock: 50, unidad: "LB", codigoBarras: "456" });
  arroz = await crearProducto(env, { codigo: "ARROZ", precioVenta: 1.2, stock: 100, codigoBarras: "7861234567890" });
  await crearProducto(env, { codigo: "UNIDAD" /* UN con PLU: no se vende por peso */, precioVenta: 3, stock: 10, codigoBarras: "000999" });
  await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { moduloBalanza: true } });
  await env.prisma.presentacionProducto.create({ data: { productoId: arroz.id, nombre: "Caja x12", factor: 12, codigoBarras: "7861234000012" } });
}, 60_000);

afterAll(async () => {
  await env.cerrar();
});

beforeEach(async () => {
  Object.assign(balanza, { tramas: ["ST,GS,+  2.500kg\r\n"], abre: true, silencio: false, lecturas: 0 });
  await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { moduloBalanza: true, balanzaEtiqueta: "PESO" } });
});

describe("Escaneo de códigos", () => {
  it("código de producto → 1 unidad; código de presentación → 1 presentación de su producto", async () => {
    const p = await env.servicios.escaneo.resolver("7861234567890", cajero);
    expect(p).toMatchObject({ tipo: "PRODUCTO", cantidad: 1, presentacion: null, etiqueta: null });
    expect(p.producto.id).toBe(arroz.id);
    const c = await env.servicios.escaneo.resolver(" 7861234000012 ", cajero);
    expect(c).toMatchObject({ tipo: "PRESENTACION", cantidad: 1 });
    expect(c.presentacion).toMatchObject({ nombre: "Caja x12", factor: 12 });
    expect(c.producto.id).toBe(arroz.id);
  });

  it("etiqueta de balanza con PESO: el peso se convierte a la unidad del producto (kg y libras)", async () => {
    const kg = await env.servicios.escaneo.resolver(armarEtiquetaBalanza("123", 1.25, "PESO"), cajero);
    expect(kg).toMatchObject({ tipo: "BALANZA", cantidad: 1.25, etiqueta: { plu: "000123", tipo: "PESO", pesoKg: 1.25, importe: null } });
    expect(kg.producto.id).toBe(queso.id);
    const lb = await env.servicios.escaneo.resolver(armarEtiquetaBalanza("456", 2, "PESO"), cajero);
    expect(lb.producto.id).toBe(jabon.id);
    expect(lb.cantidad).toBe(4.409); // 2 kg = 4,409 lb
  });

  it("etiqueta con PRECIO: el importe se divide para el precio unitario del producto", async () => {
    await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { balanzaEtiqueta: "PRECIO" } });
    const r = await env.servicios.escaneo.resolver(armarEtiquetaBalanza("123", 10, "PRECIO"), cajero);
    expect(r).toMatchObject({ tipo: "BALANZA", cantidad: 1.25, etiqueta: { tipo: "PRECIO", importe: 10, pesoKg: null } }); // 10 / 8
  });

  it("errores: producto que no se vende por peso, PLU desconocido, verificador malo, peso 0, módulo apagado, código vacío", async () => {
    expect(await codigoError(env.servicios.escaneo.resolver(armarEtiquetaBalanza("999", 1, "PESO"), cajero))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.escaneo.resolver(armarEtiquetaBalanza("777", 1, "PESO"), cajero))).toBe("NO_ENCONTRADO");
    const buena = armarEtiquetaBalanza("123", 1, "PESO");
    const mala = buena.slice(0, 12) + String((Number(buena[12]) + 1) % 10);
    expect(await codigoError(env.servicios.escaneo.resolver(mala, cajero))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.escaneo.resolver(armarEtiquetaBalanza("123", 0, "PESO"), cajero))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.escaneo.resolver("   ", cajero))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.escaneo.resolver("x".repeat(65), cajero))).toBe("VALIDACION");
    await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { moduloBalanza: false } });
    expect(await codigoError(env.servicios.escaneo.resolver(armarEtiquetaBalanza("123", 1, "PESO"), cajero))).toBe("MODULO_DESHABILITADO");
    // los productos normales se escanean aunque no haya balanza
    expect((await env.servicios.escaneo.resolver("7861234567890", cajero)).tipo).toBe("PRODUCTO");
  });
});

describe("Balanza serial", () => {
  it("sin balanza configurada no se puede pesar; se configura solo con datos válidos", async () => {
    expect(await env.servicios.balanza.obtenerConfiguracion(admin)).toMatchObject({ habilitada: true, puerto: null, baudios: 9600, protocolo: "GENERICO", etiqueta: "PESO" });
    expect(await codigoError(env.servicios.balanza.leerPeso({}, cajero))).toBe("ESTADO_INVALIDO");
    expect(await codigoError(env.servicios.balanza.configurar({ puerto: "COM3; rm", protocolo: "CAS" }, admin))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.balanza.configurar({ puerto: "COM3", baudios: 1234 }, admin))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.balanza.configurar({ puerto: "COM3", protocolo: "MAGICO" }, admin))).toBe("VALIDACION");
    expect(await env.servicios.balanza.configurar({ puerto: "COM3", baudios: 9600, protocolo: "CAS", etiqueta: "PESO" }, admin)).toMatchObject({ puerto: "COM3", protocolo: "CAS" });
    expect(await env.servicios.balanza.configurar({ puerto: "/dev/ttyUSB0", baudios: 19200 }, admin)).toMatchObject({ puerto: "/dev/ttyUSB0", baudios: 19200, protocolo: "GENERICO" });
    await env.servicios.balanza.configurar({ puerto: "COM3", baudios: 9600, protocolo: "CAS" }, admin);
  });

  it("lee el peso estable, descuenta la tara y lo convierte a la unidad del producto", async () => {
    const solo = await env.servicios.balanza.leerPeso({}, cajero);
    expect(solo).toEqual({ brutoKg: 2.5, taraKg: 0, netoKg: 2.5, cantidad: null, unidad: null });
    const conTara = await env.servicios.balanza.leerPeso({ tara: 0.5, productoId: queso.id }, cajero);
    expect(conTara).toEqual({ brutoKg: 2.5, taraKg: 0.5, netoKg: 2, cantidad: 2, unidad: "KG" });
    const libras = await env.servicios.balanza.leerPeso({ productoId: jabon.id }, cajero);
    expect(libras).toMatchObject({ netoKg: 2.5, cantidad: 5.512, unidad: "LB" });
  });

  it("errores: tara mayor que el peso, producto que no se pesa, producto inexistente, módulo apagado", async () => {
    expect(await codigoError(env.servicios.balanza.leerPeso({ tara: 3 }, cajero))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.balanza.leerPeso({ productoId: arroz.id }, cajero))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.balanza.leerPeso({ productoId: "11111111-1111-4111-8111-111111111111" }, cajero))).toBe("NO_ENCONTRADO");
    expect(await codigoError(env.servicios.balanza.leerPeso({ tara: -1 }, cajero))).toBe("VALIDACION");
    await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { moduloBalanza: false } });
    expect(await codigoError(env.servicios.balanza.leerPeso({}, cajero))).toBe("MODULO_DESHABILITADO");
  });

  it("balanza apagada, peso inestable y puerto inexistente se informan sin colgar la caja", async () => {
    balanza.silencio = true;
    await expect(env.servicios.balanza.leerPeso({}, cajero)).rejects.toThrow(/no responde/);
    balanza.silencio = false;
    balanza.tramas = ["US,GS,+  2.500kg\r\n", "US,GS,+  2.600kg\r\n"];
    await expect(env.servicios.balanza.leerPeso({}, cajero)).rejects.toThrow(/no se estabilizó/);
    balanza.abre = false;
    await expect(env.servicios.balanza.leerPeso({}, cajero)).rejects.toThrow(/El puerto COM3 no existe/);
  });

  it("dos lecturas simultáneas no se pisan: la segunda espera el turno con un aviso", async () => {
    balanza.tramas = ["ST,GS,+  1.000kg\r\n"];
    const [a, b] = await Promise.allSettled([env.servicios.balanza.leerPeso({}, cajero), env.servicios.balanza.leerPeso({}, cajero)]);
    const resultados = [a, b];
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rechazada = resultados.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rechazada.reason as Error).message).toMatch(/otra operación/);
    expect(balanza.lecturas).toBe(1);
  });
});

describe("API", () => {
  const tokens: Record<string, string> = {};
  const api = (method: "GET" | "PUT", url: string, quien: string, payload?: unknown) =>
    env.backend.server.inject({ method, url, headers: { authorization: `Bearer ${tokens[quien]}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });

  beforeAll(async () => {
    const login = async (username: string, password: string): Promise<void> => {
      const r = await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
      tokens[username] = (r.json() as { token: string }).token;
    };
    await login("admin", PASSWORD_ADMIN);
    for (const [rol, username] of [["CAJERO", "lec.api.caja"], ["BODEGUERO", "lec.api.bodega"]] as const) {
      await env.servicios.usuarios.crear({ empresaId: env.seed.empresaId, rol, username, password: "Clave12345", nombre: username, apellido: "Api" });
      await login(username, "Clave12345");
    }
  });

  it("GET /escaneo/:codigo: el cajero escanea; el bodeguero (sin ventas:crear) no; 404 si no existe", async () => {
    const ok = await api("GET", "/api/escaneo/7861234000012", "lec.api.caja");
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ tipo: "PRESENTACION", cantidad: 1, presentacion: { factor: 12 }, producto: { codigo: "ARROZ" } });
    expect((await api("GET", "/api/escaneo/7861234000012", "lec.api.bodega")).statusCode).toBe(403);
    expect((await api("GET", "/api/escaneo/0000000000000", "lec.api.caja")).statusCode).toBe(404);
    const balanzaOk = await api("GET", `/api/escaneo/${armarEtiquetaBalanza("123", 0.75, "PESO")}`, "lec.api.caja");
    expect(balanzaOk.json()).toMatchObject({ tipo: "BALANZA", cantidad: 0.75, producto: { codigo: "QUESO" } });
  });

  it("GET/PUT /balanza y GET /balanza/peso", async () => {
    expect((await api("PUT", "/api/balanza", "lec.api.caja", { puerto: "COM4" })).statusCode).toBe(403);
    const put = await api("PUT", "/api/balanza", "admin", { puerto: "COM4", baudios: 9600, protocolo: "CAS" });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ puerto: "COM4", protocolo: "CAS" });
    expect((await api("PUT", "/api/balanza", "admin", { puerto: "x y" })).statusCode).toBe(400);
    expect((await api("GET", "/api/balanza", "lec.api.caja")).json()).toMatchObject({ puerto: "COM4" });

    const peso = await api("GET", `/api/balanza/peso?tara=0.5&productoId=${queso.id}`, "lec.api.caja");
    expect(peso.statusCode).toBe(200);
    expect(peso.json()).toEqual({ brutoKg: 2.5, taraKg: 0.5, netoKg: 2, cantidad: 2, unidad: "KG" });
    expect((await api("GET", "/api/balanza/peso?tara=abc", "lec.api.caja")).statusCode).toBe(400);
    expect((await api("GET", "/api/balanza/peso", "lec.api.bodega")).statusCode).toBe(403);
    balanza.silencio = true;
    const sinRespuesta = await api("GET", "/api/balanza/peso", "lec.api.caja");
    expect(sinRespuesta.statusCode).toBe(409);
    expect(sinRespuesta.json<{ mensaje: string }>().mensaje).toMatch(/no responde/);
  });
});
