// ============================================================
// tests/integration/server/licencia.test.ts
// Licenciamiento contra el backend REAL (SQLite + HTTP) con un servidor de licencias simulado y un reloj controlado:
// activación, validación, gracia offline, vencimiento, revocación, reloj atrasado, dispositivos y trabajo periódico.
// Regla central: sin licencia vigente NO se vende ni se abre turno, pero SIEMPRE se puede cerrar el turno, reportar y respaldar.
// ============================================================
import type { Producto } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DispositivosLicencia, EstadoLicencia } from "../../../src/shared/types/licencia.types";
import { dispositivoDePrueba, generarClavesLicencia, ServidorLicenciasSimulado } from "../../helpers/licencias.helper";
import { crearEntorno, crearProducto, PASSWORD_ADMIN, type Entorno } from "../helpers/entorno.helper";

const DIA = 86_400_000;
const claves = generarClavesLicencia();
let ahora = new Date("2026-12-01T12:00:00.000Z");
const servidor = new ServidorLicenciasSimulado(claves, () => ahora);
const CLAVE = "ABCD-1234-5678-WXYZ";

let env: Entorno;
let producto: Producto;
let ruc = "";
/** Sesiones por backend: el mismo usuario («admin») existe en cada uno con su propio token */
const tokens = new WeakMap<Entorno, Record<string, string>>();

const opcionesLicencia = (id: string, reloj: () => Date = () => ahora, trabajo?: { primeraMs: number; intervaloMs: number }) => ({
  requerida: true, cliente: servidor, clavePublica: claves.publica, dispositivo: dispositivoDePrueba(id, `CAJA-${id}`), ahora: reloj, ...(trabajo !== undefined ? { trabajo } : {}),
});

const api = (e: Entorno, method: "GET" | "POST" | "DELETE", url: string, quien?: string, payload?: unknown) =>
  e.backend.server.inject({ method, url, ...(quien !== undefined ? { headers: { authorization: `Bearer ${tokens.get(e)?.[quien]}` } } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });

async function login(e: Entorno, username: string, password: string): Promise<void> {
  const r = await e.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  tokens.set(e, { ...tokens.get(e), [username]: (r.json() as { token: string }).token });
}

async function usuarioNuevo(e: Entorno, rol: string, username: string): Promise<void> {
  await e.servicios.usuarios.crear({ empresaId: e.seed.empresaId, rol, username, password: "Clave12345", nombre: username, apellido: "Lic" });
  await login(e, username, "Clave12345");
}

const estado = async (quien = "admin", e = env): Promise<EstadoLicencia> => (await api(e, "GET", "/api/licencia", quien)).json() as EstadoLicencia;
const validar = async (e = env): Promise<{ estado: EstadoLicencia; error: string | null }> => (await api(e, "POST", "/api/licencia/validar", "admin", {})).json();
const vender = (quien: string, e = env) =>
  api(e, "POST", "/api/ventas", quien, { puntoEmisionId: e.seed.puntoEmisionId, lineas: [{ productoId: producto.id, cantidad: 1, precioUnitario: 10 }], pagos: [{ formaPago: "EFECTIVO", monto: 11.5 }] });
const abrirTurno = (quien: string, e = env) => api(e, "POST", "/api/turnos/abrir", quien, { sucursalId: e.seed.sucursalId, montoApertura: 50 });
const cuerpo = (r: { json: () => unknown }): { error?: string; mensaje?: string } => r.json() as { error?: string; mensaje?: string };

beforeAll(async () => {
  env = await crearEntorno({ licencia: opcionesLicencia("equipo-1") });
  producto = await crearProducto(env, { codigo: "LIC1", precioVenta: 10, stock: 500, costo: 4 });
  ruc = (await env.prisma.empresa.findFirstOrThrow()).ruc;
  servidor.alta(CLAVE, { ruc, plan: "PRO", maxDispositivos: 1, vence: new Date(ahora.getTime() + 365 * DIA) });
  await login(env, "admin", PASSWORD_ADMIN);
  await usuarioNuevo(env, "CAJERO", "cajera");
  await usuarioNuevo(env, "CAJERO", "cajerb");
}, 90_000);

afterAll(async () => {
  await env.cerrar();
});

describe("Sin licencia activada", () => {
  it("todos los usuarios ven el estado (para avisar al cajero), con el motivo", async () => {
    expect(await estado("cajera")).toMatchObject({ tipo: "SIN_LICENCIA", permiteOperar: false, mensaje: expect.stringContaining("Active su licencia") });
    expect((await api(env, "GET", "/api/licencia")).statusCode).toBe(401);
  });

  it("no se registran ventas, ni se abren turnos, ni se cobran cuentas de mesa: 402 LICENCIA_REQUERIDA", async () => {
    for (const r of [await abrirTurno("cajera"), await vender("cajera"), await api(env, "POST", "/api/comandas/no-importa/cobrar", "admin", {})]) {
      expect(r.statusCode).toBe(402);
      expect(cuerpo(r)).toMatchObject({ error: "LICENCIA_REQUERIDA", mensaje: expect.stringContaining("Active su licencia") });
    }
    expect((await abrirTurno("cajera", env)).statusCode).toBe(402);
  });

  it("consultar, reportar y respaldar siguen funcionando: los datos del cliente no quedan retenidos", async () => {
    expect((await api(env, "GET", "/api/productos", "cajera")).statusCode).toBe(200);
    expect((await api(env, "GET", "/api/reportes/ventas?agrupar=dia", "admin")).statusCode).toBe(200);
    expect((await api(env, "GET", "/api/reportes/ventas?agrupar=dia&formato=csv", "admin")).statusCode).toBe(200);
    await expect(env.backend.respaldos.crear("pre-actualizacion", "sin-licencia")).resolves.toContain("vendeya-pre-actualizacion-");
  });
});

describe("Activación", () => {
  it("solo el administrador (configuracion:actualizar) activa; los datos se validan antes de llamar al servidor", async () => {
    expect((await api(env, "POST", "/api/licencia/activar", undefined, { clave: CLAVE })).statusCode).toBe(401);
    expect((await api(env, "POST", "/api/licencia/activar", "cajera", { clave: CLAVE })).statusCode).toBe(403);
    const antes = servidor.llamadas.length;
    for (const clave of ["", "corta", "con espacios y símbolos !!", "x".repeat(70)]) expect((await api(env, "POST", "/api/licencia/activar", "admin", { clave })).statusCode).toBe(400);
    expect(servidor.llamadas.length).toBe(antes);
  });

  it("clave inexistente, de otra empresa o sin conexión: se explica y no queda nada guardado", async () => {
    const inexistente = await api(env, "POST", "/api/licencia/activar", "admin", { clave: "NADA-0000-0000-0000" });
    expect(inexistente.statusCode).toBe(400);
    expect(cuerpo(inexistente).mensaje).toContain("no existe");

    servidor.alta("AJENA-1111-2222", { ruc: "0992345678001", vence: new Date(ahora.getTime() + 365 * DIA) });
    const ajena = await api(env, "POST", "/api/licencia/activar", "admin", { clave: "AJENA-1111-2222" });
    expect(ajena.statusCode).toBe(400);
    expect(cuerpo(ajena).mensaje).toContain("otra empresa");

    servidor.caido = true;
    const sinRed = await api(env, "POST", "/api/licencia/activar", "admin", { clave: CLAVE });
    expect(sinRed.statusCode).toBe(409);
    expect(cuerpo(sinRed).mensaje).toContain("No se pudo comunicar");
    servidor.caido = false;

    expect(await env.prisma.licencia.count()).toBe(0);
    expect((await estado()).tipo).toBe("SIN_LICENCIA");
  });

  it("la activación guarda la licencia firmada y habilita las ventas", async () => {
    const r = await api(env, "POST", "/api/licencia/activar", "admin", { clave: CLAVE });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ tipo: "ACTIVA", permiteOperar: true, plan: "PRO", maxDispositivos: 1, claveEnmascarada: "ABCD-••••-••••-WXYZ", dispositivoId: expect.any(String) });
    const fila = await env.prisma.licencia.findFirstOrThrow();
    expect(fila.token.split(".")).toHaveLength(2);
    expect(JSON.stringify(await estado("cajera"))).not.toContain("1234-5678"); // la clave completa no sale por la API

    expect((await abrirTurno("cajera")).statusCode).toBe(201);
    expect((await vender("cajera")).statusCode).toBe(201);
  });

  it("una licencia manipulada en la base de datos (otra suscripción, copiada de otro equipo) deja de valer", async () => {
    const fila = await env.prisma.licencia.findFirstOrThrow();
    const [cuerpoToken, firma] = fila.token.split(".") as [string, string];
    const alterado = JSON.parse(Buffer.from(cuerpoToken, "base64url").toString("utf8")) as Record<string, unknown>;
    alterado["vence"] = "2099-12-31T00:00:00.000Z";
    await env.prisma.licencia.update({ where: { id: fila.id }, data: { token: `${Buffer.from(JSON.stringify(alterado)).toString("base64url")}.${firma}` } });
    expect(await estado()).toMatchObject({ tipo: "INVALIDA", permiteOperar: false, mensaje: expect.stringContaining("no es auténtica") });
    expect((await vender("cajera")).statusCode).toBe(402);

    await env.prisma.licencia.update({ where: { id: fila.id }, data: { token: fila.token, dispositivoId: "otro-equipo" } });
    expect(await estado()).toMatchObject({ tipo: "INVALIDA", mensaje: expect.stringContaining("otro equipo") });
    await env.prisma.licencia.update({ where: { id: fila.id }, data: { dispositivoId: fila.dispositivoId } });
    expect((await estado()).tipo).toBe("ACTIVA");
  });
});

describe("Período de gracia offline (15 días)", () => {
  it("sin conexión corre la gracia: se sigue vendiendo con aviso, y al día 16 se bloquean las ventas pero NO el cierre ni los reportes", async () => {
    servidor.caido = true;
    ahora = new Date(ahora.getTime() + 1 * DIA);
    const intento = await validar();
    expect(intento.error).toContain("No se pudo comunicar");
    expect(intento.estado.tipo).toBe("ACTIVA"); // 1 día sin validar es normal

    ahora = new Date(ahora.getTime() + 2 * DIA); // 3 días desde la última validación
    expect(await estado("cajera")).toMatchObject({ tipo: "GRACIA", permiteOperar: true, diasGraciaRestantes: 12 });
    expect((await vender("cajera")).statusCode).toBe(201);

    ahora = new Date(ahora.getTime() + 13.5 * DIA); // 16.5 días
    expect(await estado("cajera")).toMatchObject({ tipo: "BLOQUEADA_OFFLINE", permiteOperar: false, mensaje: expect.stringContaining("Conecte este equipo a internet") });
    const venta = await vender("cajera");
    expect(venta.statusCode).toBe(402);
    expect(cuerpo(venta).error).toBe("LICENCIA_REQUERIDA");
    expect((await abrirTurno("cajerb")).statusCode).toBe(402);

    // Lo que nunca se bloquea
    const turno = (await api(env, "GET", "/api/turnos/actual", "cajera")).json() as { id: string };
    expect((await api(env, "GET", `/api/turnos/${turno.id}/reporte`, "cajera")).statusCode).toBe(200);
    const cierre = await api(env, "POST", `/api/turnos/${turno.id}/cerrar`, "cajera", { efectivoContado: 50 });
    expect(cierre.statusCode).toBe(200);
    expect((await api(env, "GET", "/api/reportes/ventas?agrupar=dia", "admin")).statusCode).toBe(200);
    await expect(env.backend.respaldos.crear("pre-actualizacion", "bloqueada")).resolves.toBeTruthy();
  });

  it("al volver la conexión se valida, se renueva la licencia y se puede vender de nuevo", async () => {
    servidor.caido = false;
    const r = await validar();
    expect(r.error).toBeNull();
    expect(r.estado).toMatchObject({ tipo: "ACTIVA", permiteOperar: true });
    expect((await env.prisma.licencia.findFirstOrThrow()).ultimaValidacion.toISOString()).toBe(ahora.toISOString());
    expect((await abrirTurno("cajera")).statusCode).toBe(201);
    expect((await vender("cajera")).statusCode).toBe(201);
  });
});

describe("Suscripción", () => {
  it("avisa cuando quedan pocos días, bloquea al vencer sin conexión y se reactiva al renovar", async () => {
    servidor.renovar(CLAVE, new Date(ahora.getTime() + 5 * DIA));
    expect((await validar()).estado).toMatchObject({ tipo: "POR_VENCER", permiteOperar: true, diasParaVencer: 5 });
    expect((await vender("cajera")).statusCode).toBe(201);

    servidor.caido = true;
    ahora = new Date(ahora.getTime() + 6 * DIA);
    expect(await estado("cajera")).toMatchObject({ tipo: "VENCIDA", permiteOperar: false, mensaje: expect.stringContaining("Renuévela") });
    expect((await vender("cajera")).statusCode).toBe(402);

    servidor.caido = false;
    servidor.renovar(CLAVE, new Date(ahora.getTime() + 365 * DIA));
    expect((await validar()).estado).toMatchObject({ tipo: "ACTIVA", permiteOperar: true });
    expect((await vender("cajera")).statusCode).toBe(201);
  });

  it("si el servidor responde «suscripción vencida» se bloquea aunque la licencia guardada aún no venza, y se limpia al renovar", async () => {
    servidor.renovar(CLAVE, new Date(ahora.getTime() - 3600_000));
    const r = await validar();
    expect(r.error).toBeNull(); // el servidor respondió: no es un fallo de red
    expect(r.estado).toMatchObject({ tipo: "VENCIDA", permiteOperar: false });
    expect((await vender("cajera")).statusCode).toBe(402);
    expect((await env.prisma.licencia.findFirstOrThrow()).bloqueoServidor).toBe("SUSCRIPCION_VENCIDA");

    servidor.renovar(CLAVE, new Date(ahora.getTime() + 30 * DIA));
    expect((await validar()).estado.tipo).toBe("ACTIVA");
    expect((await env.prisma.licencia.findFirstOrThrow()).bloqueoServidor).toBeNull();
  });

  it("una licencia revocada se bloquea con el motivo que dio el proveedor", async () => {
    servidor.revocar(CLAVE, "contracargo de la suscripción");
    const r = await validar();
    expect(r.estado).toMatchObject({ tipo: "REVOCADA", permiteOperar: false, mensaje: expect.stringContaining("contracargo de la suscripción") });
    const venta = await vender("cajera");
    expect(venta.statusCode).toBe(402);
    expect(cuerpo(venta).mensaje).toContain("revocada");

    const licencia = servidor.licencias.get(CLAVE);
    if (licencia !== undefined) delete licencia.revocada; // el proveedor la reinstala
    expect((await validar()).estado.tipo).toBe("ACTIVA");
  });
});

describe("Reloj del equipo", () => {
  it("atrasar la fecha para alargar la gracia o la suscripción se detecta y bloquea hasta corregirla", async () => {
    await validar();
    ahora = new Date(ahora.getTime() + 1 * DIA);
    expect((await estado()).tipo).toBe("ACTIVA"); // registra el reloj más alto visto
    const real = ahora;

    ahora = new Date(real.getTime() - 2 * DIA);
    expect(await estado("cajera")).toMatchObject({ tipo: "INVALIDA", permiteOperar: false, mensaje: expect.stringContaining("fecha de este equipo es anterior") });
    expect((await vender("cajera")).statusCode).toBe(402);
    // Mientras el reloj está atrasado NO se «normaliza» el valor guardado
    expect((await env.prisma.licencia.findFirstOrThrow()).ultimoRelojVisto.getTime()).toBeGreaterThanOrEqual(real.getTime() - 5 * 60_000);

    ahora = real;
    expect((await estado()).tipo).toBe("ACTIVA");
    expect((await vender("cajera")).statusCode).toBe(201);
  });
});

describe("Dispositivos", () => {
  let env2: Entorno;
  const CLAVE2 = "DUOS-2222-3333-4444";

  beforeAll(async () => {
    env2 = await crearEntorno({ licencia: opcionesLicencia("equipo-2") });
    await login(env2, "admin", PASSWORD_ADMIN);
    servidor.alta(CLAVE2, { ruc, plan: "PRO", maxDispositivos: 2, vence: new Date(ahora.getTime() + 365 * DIA) });
  }, 60_000);

  afterAll(async () => {
    await env2.cerrar();
  });

  it("el plan limita los equipos: el segundo no activa y se le dice qué equipos ocupan las plazas", async () => {
    const r = await api(env2, "POST", "/api/licencia/activar", "admin", { clave: CLAVE });
    expect(r.statusCode).toBe(409);
    expect(cuerpo(r).mensaje).toContain("CAJA-equipo-1");
    expect(cuerpo(r).mensaje).toContain("Libere");
    expect((await estado("admin", env2)).tipo).toBe("SIN_LICENCIA");
  });

  it("con un plan de 2 equipos activan los dos y el administrador ve la lista (marcando cuál es este)", async () => {
    expect((await api(env, "POST", "/api/licencia/activar", "admin", { clave: CLAVE2 })).statusCode).toBe(200); // cambia de plan: la plaza del plan anterior queda en el servidor
    expect((await api(env2, "POST", "/api/licencia/activar", "admin", { clave: CLAVE2 })).statusCode).toBe(200);
    const lista = (await api(env, "GET", "/api/licencia/dispositivos", "admin")).json() as DispositivosLicencia;
    expect(lista.maximo).toBe(2);
    expect(lista.dispositivos.map((d) => [d.id === dispositivoDePrueba("equipo-1").id ? "equipo-1" : d.id, d.nombre, d.esEste])).toEqual([["equipo-1", "CAJA-equipo-1", true], [dispositivoDePrueba("equipo-2").id, "CAJA-equipo-2", false]]);
    expect((await api(env, "GET", "/api/licencia/dispositivos", "cajera")).statusCode).toBe(403);
  });

  it("liberar otro equipo le quita la plaza: en su próxima validación queda inválido hasta que se active de nuevo", async () => {
    const propio = dispositivoDePrueba("equipo-1").id;
    const mismo = await api(env, "POST", `/api/licencia/dispositivos/${propio}/liberar`, "admin", {});
    expect(mismo.statusCode).toBe(400);
    expect(cuerpo(mismo).mensaje).toContain("Desactivar este equipo");

    const otro = dispositivoDePrueba("equipo-2").id;
    expect((await api(env, "POST", `/api/licencia/dispositivos/${otro}/liberar`, "admin", {})).json()).toMatchObject({ dispositivos: [{ esEste: true }] });
    expect((await api(env, "POST", "/api/licencia/dispositivos/no-existe/liberar", "admin", {})).statusCode).toBe(409);

    const r = await validar(env2);
    expect(r.estado).toMatchObject({ tipo: "INVALIDA", permiteOperar: false, mensaje: expect.stringContaining("liberado") });
    expect((await api(env2, "POST", "/api/ventas", "admin", {})).statusCode).toBe(402);

    expect((await api(env2, "POST", "/api/licencia/activar", "admin", { clave: CLAVE2 })).json()).toMatchObject({ tipo: "ACTIVA" });
  });

  it("desactivar este equipo libera la plaza en el servidor y borra la licencia local; sin conexión no se pierde nada", async () => {
    servidor.caido = true;
    const sinRed = await api(env2, "DELETE", "/api/licencia", "admin");
    expect(sinRed.statusCode).toBe(409);
    expect(cuerpo(sinRed).mensaje).toContain("No se pudo comunicar");
    expect(await env2.prisma.licencia.count()).toBe(1);
    servidor.caido = false;

    const ocupadas = servidor.licencias.get(CLAVE2)?.dispositivos.size;
    const r = await api(env2, "DELETE", "/api/licencia", "admin");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ tipo: "SIN_LICENCIA" });
    expect(servidor.licencias.get(CLAVE2)?.dispositivos.size).toBe((ocupadas ?? 0) - 1);
    expect((await api(env2, "DELETE", "/api/licencia", "admin")).statusCode).toBe(404);
  });
});

describe("Validación periódica en segundo plano", () => {
  it("valida sola, renueva la licencia y, al cerrar el backend, deja de llamar al servidor", async () => {
    let reloj = new Date(ahora.getTime());
    const e = await crearEntorno({ licencia: opcionesLicencia("equipo-3", () => reloj, { primeraMs: 20, intervaloMs: 40 }) });
    try {
      await login(e, "admin", PASSWORD_ADMIN);
      servidor.alta("PERIODICA-0001", { ruc, plan: "PRO", maxDispositivos: 1, vence: new Date(ahora.getTime() + 365 * DIA) });
      expect((await api(e, "POST", "/api/licencia/activar", "admin", { clave: "PERIODICA-0001" })).statusCode).toBe(200);

      // Con el servidor caído el trabajo periódico no puede renovar: así la comprobación de «gracia» no depende de la carrera entre
      // el intervalo real (40 ms) y la lectura del estado, que con la máquina cargada daba «ACTIVA» a destiempo.
      servidor.caido = true;
      reloj = new Date(reloj.getTime() + 4 * DIA); // 4 días sin validar → gracia
      expect((await estado("admin", e)).tipo).toBe("GRACIA");
      await new Promise((r) => setTimeout(r, 120)); // varios intervalos del trabajo con el servidor caído: sigue en gracia
      expect((await estado("admin", e)).tipo).toBe("GRACIA");
      servidor.caido = false;
      const esperar = async (cond: () => boolean | Promise<boolean>, ms = 4000): Promise<void> => {
        const limite = Date.now() + ms;
        while (!(await cond())) {
          if (Date.now() > limite) throw new Error("No ocurrió a tiempo");
          await new Promise((r) => setTimeout(r, 20));
        }
      };
      await esperar(async () => (await estado("admin", e)).tipo === "ACTIVA"); // el trabajo validó por su cuenta
      expect((await e.prisma.licencia.findFirstOrThrow()).ultimaValidacion.toISOString()).toBe(reloj.toISOString());

      await e.backend.close();
      const llamadas = servidor.llamadas.length;
      await new Promise((r) => setTimeout(r, 150));
      expect(servidor.llamadas.length).toBe(llamadas);
    } finally {
      await e.cerrar().catch(() => undefined);
    }
  }, 60_000);
});

describe("Sin licenciamiento configurado", () => {
  it("si se pide licencia pero falta el servidor o su clave pública, no se bloquea la caja y se avisa", async () => {
    const e = await crearEntorno({ licencia: { requerida: true, cliente: null, clavePublica: null, dispositivo: dispositivoDePrueba("equipo-4") } });
    try {
      await login(e, "admin", PASSWORD_ADMIN);
      expect(await estado("admin", e)).toMatchObject({ tipo: "NO_REQUERIDA", permiteOperar: true, mensaje: expect.stringContaining("no está configurado") });
      expect((await abrirTurno("admin", e)).statusCode).toBe(201);
      expect((await api(e, "POST", "/api/licencia/activar", "admin", { clave: CLAVE })).statusCode).toBe(409);
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it("en desarrollo y pruebas (sin la opción) no se exige nada y no se toca la base por la licencia", async () => {
    const e = await crearEntorno();
    try {
      await login(e, "admin", PASSWORD_ADMIN);
      expect(await estado("admin", e)).toMatchObject({ tipo: "NO_REQUERIDA", permiteOperar: true });
      expect((await abrirTurno("admin", e)).statusCode).toBe(201);
      expect(await e.prisma.licencia.count()).toBe(0);
    } finally {
      await e.cerrar();
    }
  }, 60_000);
});
