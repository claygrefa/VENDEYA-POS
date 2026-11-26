// ============================================================
// tests/integration/server/sync-lan.test.ts
// Sincronización multi-caja por WebSocket contra el backend REAL escuchando en un puerto: varias cajas conectadas,
// eventos de los cambios, reanudación tras una desconexión, bitácora podada, sesiones revocadas y cajas caídas.
// ============================================================
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import WebSocket from "ws";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Producto } from "@prisma/client";
import { iniciarBackend } from "../../../src/server";
import { ClienteSync, type ReceptoresSync, type WebSocketLike } from "../../../src/server/services/sync/syncCliente";
import { CIERRE_CAJA_DUPLICADA, CIERRE_MODULO_DESHABILITADO, CIERRE_NO_AUTENTICADO, CIERRE_SESION_REVOCADA, type EventoDifundido } from "../../../src/server/services/sync/sync.service";
import { generarP12Prueba } from "../../helpers/certificados.helper";
import { iniciarSriSimulado, type SriSimulado } from "../../helpers/sriSimulado.helper";
import { abrirTurno, crearActor, crearEntorno, crearProducto, PASSWORD_ADMIN, type Entorno } from "../helpers/entorno.helper";

let env: Entorno;
let sri: SriSimulado;
let producto: Producto;
const tokens: Record<string, string> = {};
const abiertos: Array<{ desconectar: () => void }> = [];

const wsUrl = (): string => env.backend.url.replace(/^http/, "ws");
const esperar = async (cond: () => boolean, ms = 15_000): Promise<void> => {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("Condición no cumplida a tiempo");
};
const pausa = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const habilitarLan = async (valor: boolean): Promise<void> => {
  await env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: { sincronizacionLAN: valor } });
  env.servicios.sync.olvidarConfiguracion();
};

interface Caja {
  cliente: ClienteSync;
  eventos: Array<EventoDifundido & { reenviado?: boolean }>;
  presencia: string[];
  resyncs: number;
  cierres: number[];
}

function caja(cajaId: string, token: string, extra: { desdeSeq?: number; esperasMs?: number[] } = {}): Caja {
  const c: Caja = { cliente: undefined as unknown as ClienteSync, eventos: [], presencia: [], resyncs: 0, cierres: [] };
  const receptores: ReceptoresSync = {
    evento: (e) => c.eventos.push(e),
    resync: () => {
      c.resyncs += 1;
    },
    presencia: (ev, cj) => c.presencia.push(`${ev}:${cj.cajaId}`),
    cerrado: (codigo) => c.cierres.push(codigo),
  };
  c.cliente = new ClienteSync({ url: wsUrl(), token, cajaId, crearSocket: (u) => new WebSocket(u) as unknown as ConstructorParameters<typeof ClienteSync>[0]["crearSocket"] extends (u: string) => infer R ? R : never, ...extra }, receptores);
  abiertos.push(c.cliente);
  c.cliente.conectar();
  return c;
}

const api = (method: "GET" | "POST" | "PATCH", url: string, token: string, cajaId: string | null, payload?: unknown) =>
  env.backend.server.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}`, ...(cajaId !== null ? { "x-caja-id": cajaId } : {}) },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

/** Una venta real por la API (cambia stock, turno y deja un evento). */
const vender = (token: string, cajaId: string) =>
  api("POST", "/api/ventas", token, cajaId, { puntoEmisionId: env.seed.puntoEmisionId, lineas: [{ productoId: producto.id, cantidad: 1 }], pagos: [{ formaPago: "EFECTIVO", monto: 20 }] });

beforeAll(async () => {
  sri = await iniciarSriSimulado();
  env = await crearEntorno({ sync: { podarCada: 5, retencion: 4, latidoMs: 3_600_000 }, sri: { soap: { timeoutMs: 1_000, endpoints: { "1": sri.endpoints } } } });
  producto = await crearProducto(env, { codigo: "SYNC1", precioVenta: 10, stock: 1000, costo: 4 });
  await habilitarLan(true);
  const cajeroA = await crearActor(env, "CAJERO", "sync.a");
  await crearActor(env, "CAJERO", "sync.b");
  await abrirTurno(env, cajeroA.id);
  for (const [username, password] of [["admin", PASSWORD_ADMIN], ["sync.a", "Clave12345"], ["sync.b", "Clave12345"]] as const) {
    const r = await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
    tokens[username] = (r.json() as { token: string }).token;
  }
}, 60_000);

afterAll(async () => {
  await env.cerrar();
  await sri.cerrar();
});

afterEach(() => {
  for (const a of abiertos.splice(0)) a.desconectar();
});

describe("Conexión y autenticación", () => {
  it("una conexión repetida reutiliza el socket y al cerrar quita los callbacks del cliente", () => {
    let abiertos = 0;
    let cerrados = 0;
    const socket: WebSocketLike = {
      onopen: null, onmessage: null, onclose: null, onerror: null,
      close: () => { cerrados++; },
    };
    const cliente = new ClienteSync({ url: wsUrl(), token: tokens.admin!, cajaId: "limpieza", crearSocket: () => {
      abiertos++;
      return socket;
    } });
    cliente.conectar();
    cliente.conectar();
    expect(abiertos).toBe(1);
    cliente.desconectar();
    expect(cerrados).toBe(1);
    expect(socket).toMatchObject({ onopen: null, onmessage: null, onclose: null });
  });

  it("el backend por defecto atiende solo a este equipo; con redLocal escucha en toda la red", async () => {
    expect(env.backend.host).toBe("127.0.0.1");
    const dir = mkdtempSync(path.join(os.tmpdir(), "vendeya-lan-"));
    const b = await iniciarBackend({ dbPath: path.join(dir, "data", "vendeya.db"), migrationsDir: path.resolve(__dirname, "../../../prisma/migrations"), port: 0, logLevel: "silent", redLocal: true });
    try {
      expect(b.host).toBe("0.0.0.0");
    } finally {
      await b.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sin token, con token falso o con la sincronización apagada el servidor cierra con un código claro", async () => {
    const cerrar = (url: string): Promise<number> =>
      new Promise((resolve) => {
        const ws = new WebSocket(url);
        ws.on("close", (codigo) => resolve(codigo));
        ws.on("error", () => undefined);
      });
    expect(await cerrar(`${wsUrl()}/api/sync`)).toBe(CIERRE_NO_AUTENTICADO);
    expect(await cerrar(`${wsUrl()}/api/sync?token=falso&cajaId=x`)).toBe(CIERRE_NO_AUTENTICADO);
    await habilitarLan(false);
    expect(await cerrar(`${wsUrl()}/api/sync?token=${tokens["sync.a"]}&cajaId=x`)).toBe(CIERRE_MODULO_DESHABILITADO);
    await habilitarLan(true);
  });

  it("al conectar recibe «hola» con el último evento y las cajas presentes; las demás cajas ven llegar y salir", async () => {
    const a = caja("caja-A", tokens["sync.a"] as string);
    await esperar(() => a.cliente.estado === "CONECTADO");
    const b = caja("caja-B", tokens["sync.b"] as string);
    await esperar(() => b.cliente.estado === "CONECTADO");
    await esperar(() => a.presencia.includes("conectada:caja-B"));
    const r = await api("GET", "/api/sync/cajas", tokens["admin"] as string, null);
    expect(r.json<{ cajas: Array<{ cajaId: string }> }>().cajas.map((c) => c.cajaId).sort()).toEqual(["caja-A", "caja-B"]);
    b.cliente.desconectar();
    await esperar(() => a.presencia.includes("desconectada:caja-B"));
  });
});

describe("Difusión de cambios", () => {
  it("lo que hace una caja lo reciben todas (también la que lo originó), numerado y con quién y desde dónde", async () => {
    const a = caja("caja-A", tokens["sync.a"] as string);
    const b = caja("caja-B", tokens["sync.b"] as string);
    await esperar(() => a.cliente.estado === "CONECTADO" && b.cliente.estado === "CONECTADO");

    const v = await vender(tokens["sync.a"] as string, "caja-A");
    expect(v.statusCode).toBe(201);
    await esperar(() => a.eventos.length >= 1 && b.eventos.length >= 1);
    for (const c of [a, b]) {
      expect(c.eventos[0]).toMatchObject({ modulo: "ventas", accion: "POST", ruta: "/api/ventas", cajaId: "caja-A", ids: {} });
      expect(c.eventos[0]?.usuarioId).toBeTruthy();
      expect(c.eventos[0]?.seq).toBeGreaterThan(0);
    }
    expect(a.eventos[0]?.seq).toBe(b.eventos[0]?.seq);

    // con parámetros de ruta: el evento los incluye para que la otra caja sepa qué refrescar
    await api("PATCH", `/api/productos/${producto.id}`, tokens["admin"] as string, "caja-B", { precioVenta: 11 });
    await esperar(() => a.eventos.length >= 2);
    expect(a.eventos[1]).toMatchObject({ modulo: "productos", accion: "PATCH", ruta: "/api/productos/:id", ids: { id: producto.id }, cajaId: "caja-B" });
    expect(a.eventos[1]?.seq).toBeGreaterThan(a.eventos[0]?.seq ?? 0);
  });

  it("las lecturas, los inicios de sesión y las operaciones fallidas no generan eventos", async () => {
    const a = caja("caja-A", tokens["sync.a"] as string);
    await esperar(() => a.cliente.estado === "CONECTADO");
    await api("GET", `/api/productos/${producto.id}`, tokens["sync.a"] as string, "caja-A");
    await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username: "sync.b", password: "Clave12345" } });
    const mala = await api("POST", "/api/ventas", tokens["sync.a"] as string, "caja-A", { puntoEmisionId: env.seed.puntoEmisionId, lineas: [], pagos: [] });
    expect(mala.statusCode).toBe(400);
    await pausa(150);
    expect(a.eventos).toEqual([]);
  });

  it("un comprobante que cambia de estado en segundo plano (worker del SRI) también se anuncia", async () => {
    const admin = await crearActor(env, "ADMIN", "sync.admin2");
    const p12 = generarP12Prueba({ identificacion: "9999999999001", password: "Clave-P12-1" });
    await env.servicios.certificados.guardar({ archivoBase64: p12.archivo.toString("base64"), password: p12.password }, admin);
    const cliente = await env.servicios.clientes.crear({ tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "Juan Pérez", direccion: "Calle 1", email: "j@correo.ec" });
    const a = caja("caja-A", tokens["sync.a"] as string);
    await esperar(() => a.cliente.estado === "CONECTADO");
    const v = await api("POST", "/api/ventas", tokens["sync.a"] as string, "caja-A", { puntoEmisionId: env.seed.puntoEmisionId, lineas: [{ productoId: producto.id, cantidad: 1 }], pagos: [{ formaPago: "EFECTIVO", monto: 20 }], emitirFactura: true, clienteId: cliente.id });
    const ventaId = v.json<{ id: string }>().id;
    await esperar(() => a.eventos.some((e) => e.modulo === "ventas"));
    const comprobante = await env.prisma.comprobanteElectronico.findUniqueOrThrow({ where: { ventaId } });
    expect(await env.servicios.envioSri.procesar(comprobante.id)).toBe("AUTORIZADO");
    await esperar(() => a.eventos.some((e) => e.modulo === "comprobantes"));
    expect(a.eventos.find((e) => e.modulo === "comprobantes")).toMatchObject({ accion: "ESTADO", ruta: "worker-sri", ids: { id: comprobante.id, estado: "AUTORIZADO" } });
  });
});

describe("Reconexión", () => {
  it("una caja que se cae recibe al volver, en orden, lo que se perdió, sin duplicados", async () => {
    const a = caja("caja-A", tokens["sync.a"] as string);
    const b = caja("caja-B", tokens["sync.b"] as string);
    await esperar(() => a.cliente.estado === "CONECTADO" && b.cliente.estado === "CONECTADO");
    await vender(tokens["sync.a"] as string, "caja-A");
    await esperar(() => b.eventos.length >= 1);
    const ultimo = b.cliente.ultimoSeq;
    b.cliente.desconectar();

    for (let i = 0; i < 3; i++) await vender(tokens["sync.a"] as string, "caja-A");
    await esperar(() => a.eventos.length >= 4);

    // b vuelve recordando su último evento (como lo haría tras reiniciar la aplicación)
    const vuelve = caja("caja-B", tokens["sync.b"] as string, { desdeSeq: ultimo });
    await esperar(() => vuelve.eventos.length >= 3);
    await pausa(100);
    expect(vuelve.eventos).toHaveLength(3);
    expect(vuelve.eventos.every((e) => e.reenviado === true)).toBe(true);
    expect(vuelve.eventos.map((e) => e.seq)).toEqual(a.eventos.slice(1).map((e) => e.seq));
    expect(vuelve.resyncs).toBe(0);
    expect(vuelve.cliente.ultimoSeq).toBe(a.cliente.ultimoSeq);
  });

  it("el cliente reintenta solo si el servidor corta la conexión y retoma desde el último evento", async () => {
    const a = caja("caja-A", tokens["sync.a"] as string);
    const b = caja("caja-B", tokens["sync.b"] as string, { esperasMs: [20] });
    await esperar(() => a.cliente.estado === "CONECTADO" && b.cliente.estado === "CONECTADO");
    await vender(tokens["sync.a"] as string, "caja-A");
    await esperar(() => b.eventos.length >= 1);

    // se corta la red de b (sin cierre ordenado): el servidor lo detecta por el latido
    const cortes = [...env.backend.server.websocketServer.clients].filter((c) => c.readyState === 1);
    for (const c of cortes) c.terminate();
    await esperar(() => b.cliente.estado === "DESCONECTADO" || b.cliente.estado === "CONECTANDO");
    await vender(tokens["sync.a"] as string, "caja-A"); // ocurre mientras b está caído o reconectando
    await esperar(() => b.cliente.estado === "CONECTADO" && a.cliente.estado === "CONECTADO" && b.eventos.length >= 2 && a.cliente.ultimoSeq === b.cliente.ultimoSeq);
    expect(b.eventos.map((e) => e.seq)).toEqual([...new Set(b.eventos.map((e) => e.seq))].sort((x, y) => x - y)); // sin repetidos ni desorden
    expect(b.cliente.ultimoSeq).toBe(a.cliente.ultimoSeq);
  });

  it("si la bitácora ya no alcanza para reconstruir lo perdido, el servidor pide recargar todo (resync)", async () => {
    const a = caja("caja-A", tokens["sync.a"] as string);
    await esperar(() => a.cliente.estado === "CONECTADO");
    for (let i = 0; i < 12; i++) await vender(tokens["sync.a"] as string, "caja-A"); // retención de 4 y poda cada 5 publicaciones
    await esperar(() => a.eventos.length >= 12);
    const tarde = caja("caja-Z", tokens["sync.b"] as string, { desdeSeq: 1 });
    await esperar(() => tarde.resyncs === 1);
    expect(tarde.eventos).toEqual([]);
    expect(tarde.cliente.ultimoSeq).toBe(a.cliente.ultimoSeq);
  });
});

describe("Cajas caídas y sesiones", () => {
  it("una sesión cerrada (logout) desconecta la caja en el siguiente latido y el cliente NO reintenta", async () => {
    const login = await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username: "sync.b", password: "Clave12345" } });
    const tokenTemporal = login.json<{ token: string }>().token;
    const c = caja("caja-T", tokenTemporal);
    await esperar(() => c.cliente.estado === "CONECTADO");
    await api("POST", "/api/auth/logout", tokenTemporal, null);
    env.servicios.sync.latido();
    await esperar(() => c.cierres.length === 1);
    expect(c.cierres).toEqual([CIERRE_SESION_REVOCADA]);
    await pausa(100);
    expect(c.cliente.estado).toBe("DESCONECTADO");
  });

  it("si la misma caja se conecta desde otra sesión, la anterior se cierra (sin pelearse por el lugar)", async () => {
    const primera = caja("caja-D", tokens["sync.a"] as string);
    await esperar(() => primera.cliente.estado === "CONECTADO");
    const segunda = caja("caja-D", tokens["sync.b"] as string);
    await esperar(() => primera.cierres.length === 1);
    expect(primera.cierres).toEqual([CIERRE_CAJA_DUPLICADA]);
    await esperar(() => segunda.cliente.estado === "CONECTADO");
    const cajas = (await api("GET", "/api/sync/cajas", tokens["admin"] as string, null)).json<{ cajas: unknown[] }>().cajas;
    expect(cajas).toHaveLength(1);
  });

  it("una caja que no contesta al latido se da de baja y las demás lo saben", async () => {
    const a = caja("caja-A", tokens["sync.a"] as string);
    await esperar(() => a.cliente.estado === "CONECTADO");
    // cliente «colgado»: no responde a los ping del servidor
    const colgado = new WebSocket(`${wsUrl()}/api/sync?token=${tokens["sync.b"]}&cajaId=caja-X`, { autoPong: false });
    await new Promise<void>((r) => colgado.on("open", () => r()));
    await esperar(() => a.presencia.includes("conectada:caja-X"));
    env.servicios.sync.latido(); // primer latido: queda «sin confirmar»
    await pausa(60);
    env.servicios.sync.latido(); // segundo: no hubo pong → se da de baja
    await esperar(() => a.presencia.includes("desconectada:caja-X"));
    colgado.terminate();
  });
});

describe("Permisos de la API de cajas", () => {
  it("GET /sync/cajas exige caja:leer", async () => {
    const bodega = await crearActor(env, "BODEGUERO", "sync.bodega");
    void bodega;
    const r = await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username: "sync.bodega", password: "Clave12345" } });
    const token = r.json<{ token: string }>().token;
    expect((await api("GET", "/api/sync/cajas", token, null)).statusCode).toBe(403);
    expect((await env.backend.server.inject({ method: "GET", url: "/api/sync/cajas" })).statusCode).toBe(401);
  });
});
