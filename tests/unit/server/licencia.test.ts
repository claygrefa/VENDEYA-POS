// ============================================================
// tests/unit/server/licencia.test.ts — Licencia firmada, estados de la suscripción, identificación del equipo y cliente HTTP
// ============================================================
import { mkdtempSync, readFileSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { identificarDispositivo, leerIdMaquina } from "../../../src/server/services/licencia/dispositivo.util";
import { ClienteLicenciasHttp, ErrorLicencias } from "../../../src/server/services/licencia/licencia.cliente";
import { DIA_MS, enmascararClave, evaluarLicencia, type EntradaEvaluacion, type LicenciaGuardada } from "../../../src/server/services/licencia/licencia.estado";
import { firmarLicencia, verificarLicencia, type LicenciaPayload } from "../../../src/server/services/licencia/licencia.token";
import { generarClavesLicencia } from "../../helpers/licencias.helper";

const claves = generarClavesLicencia();
const otras = generarClavesLicencia();
const AHORA = new Date("2026-12-01T12:00:00.000Z");
const RUC = "1790016919001";
const EQUIPO = "equipo-1";
const dias = (n: number): number => n * DIA_MS;

const payload = (c: Partial<LicenciaPayload> = {}): LicenciaPayload => ({
  v: 1, licenciaId: "ABCD-1234-5678-WXYZ", ruc: RUC, plan: "PRO", maxDispositivos: 2, dispositivoId: EQUIPO,
  emitida: AHORA.toISOString(), vence: new Date(AHORA.getTime() + dias(365)).toISOString(), ...c,
});

function guardada(c: Partial<LicenciaGuardada> & { payload?: Partial<LicenciaPayload>; firmaCon?: string } = {}): LicenciaGuardada {
  return {
    clave: "ABCD-1234-5678-WXYZ", token: firmarLicencia(payload(c.payload), c.firmaCon ?? claves.privada), dispositivoId: EQUIPO,
    ultimaValidacion: AHORA, ultimoRelojVisto: AHORA, bloqueoServidor: null, motivoBloqueo: null, ...("token" in c ? { token: c.token as string } : {}),
    ...(c.dispositivoId !== undefined ? { dispositivoId: c.dispositivoId } : {}), ...(c.ultimaValidacion !== undefined ? { ultimaValidacion: c.ultimaValidacion } : {}),
    ...(c.ultimoRelojVisto !== undefined ? { ultimoRelojVisto: c.ultimoRelojVisto } : {}), ...(c.bloqueoServidor !== undefined ? { bloqueoServidor: c.bloqueoServidor } : {}),
    ...(c.motivoBloqueo !== undefined ? { motivoBloqueo: c.motivoBloqueo } : {}),
  };
}

const evaluar = (licencia: LicenciaGuardada | null, c: Partial<EntradaEvaluacion> = {}) =>
  evaluarLicencia({ requerida: true, licencia, clavePublica: claves.publica, ruc: RUC, dispositivoId: EQUIPO, ahora: AHORA, graciaDias: 15, avisoGraciaDias: 2, avisoVencimientoDias: 7, ...c });

describe("Licencia firmada", () => {
  it("se firma y se verifica con la clave pública; el contenido se conserva", () => {
    const token = firmarLicencia(payload(), claves.privada);
    expect(token.split(".")).toHaveLength(2);
    expect(verificarLicencia(token, claves.publica)).toEqual({ valida: true, payload: payload() });
  });

  it("rechaza firma de otra clave, contenido alterado, formato inválido y contenido sin los campos requeridos", () => {
    const token = firmarLicencia(payload(), claves.privada);
    expect(verificarLicencia(token, otras.publica)).toMatchObject({ valida: false, motivo: expect.stringContaining("firma inválida") });

    const [cuerpo, firma] = token.split(".") as [string, string];
    const alterado = { ...payload(), vence: "2099-01-01T00:00:00.000Z" };
    const falso = `${Buffer.from(JSON.stringify(alterado)).toString("base64url")}.${firma}`;
    expect(verificarLicencia(falso, claves.publica)).toMatchObject({ valida: false });
    expect(verificarLicencia(`${cuerpo}.${firma.slice(0, -4)}AAAA`, claves.publica)).toMatchObject({ valida: false });

    for (const basura of ["", "x", "a.b", "a.b.c", ".", "esto no es base64 .firma"]) expect(verificarLicencia(basura, claves.publica)).toMatchObject({ valida: false });
    expect(verificarLicencia(token, "no es una clave")).toMatchObject({ valida: false });

    // Firma válida pero contenido que no cumple el formato de licencia
    const incompleto = firmarLicencia({ v: 1, ruc: RUC } as unknown as LicenciaPayload, claves.privada);
    expect(verificarLicencia(incompleto, claves.publica)).toMatchObject({ valida: false, motivo: expect.stringContaining("contenido inválido") });
  });
});

describe("Estado de la licencia", () => {
  it("sin licenciamiento (desarrollo, pruebas) se opera sin restricciones", () => {
    expect(evaluar(null, { requerida: false })).toMatchObject({ tipo: "NO_REQUERIDA", permiteOperar: true });
  });

  it("sin licencia guardada no se puede operar y se explica", () => {
    expect(evaluar(null)).toMatchObject({ tipo: "SIN_LICENCIA", permiteOperar: false, mensaje: expect.stringContaining("Active su licencia") });
  });

  it("activa: muestra plan, vencimiento, clave enmascarada y última validación", () => {
    const e = evaluar(guardada());
    expect(e).toMatchObject({ tipo: "ACTIVA", permiteOperar: true, plan: "PRO", maxDispositivos: 2, diasParaVencer: 365, claveEnmascarada: "ABCD-••••-••••-WXYZ", dispositivoId: EQUIPO, diasGraciaRestantes: null });
    expect(e.mensaje).toContain("01/12/2027");
    expect(e.ultimaValidacion).toBe(AHORA.toISOString());
  });

  it("avisa desde 7 días antes de vencer y sigue operando", () => {
    const vence = (d: number): LicenciaGuardada => guardada({ payload: { vence: new Date(AHORA.getTime() + dias(d)).toISOString() } });
    expect(evaluar(vence(8)).tipo).toBe("ACTIVA");
    expect(evaluar(vence(7))).toMatchObject({ tipo: "POR_VENCER", permiteOperar: true, diasParaVencer: 7 });
    expect(evaluar(vence(1))).toMatchObject({ tipo: "POR_VENCER", permiteOperar: true, mensaje: expect.stringContaining("hoy o mañana") });
  });

  it("vencida: no se puede operar pero el mensaje recuerda que los datos siguen disponibles", () => {
    const l = guardada({ payload: { vence: new Date(AHORA.getTime() - 1000).toISOString() } });
    expect(evaluar(l)).toMatchObject({ tipo: "VENCIDA", permiteOperar: false, mensaje: expect.stringContaining("datos y reportes siguen disponibles") });
  });

  it("gracia offline: hasta 2 días sin validar es normal; luego avisa con los días que quedan y a los 15 bloquea", () => {
    const sinValidar = (d: number): LicenciaGuardada => guardada({ ultimaValidacion: new Date(AHORA.getTime() - dias(d)) });
    expect(evaluar(sinValidar(2)).tipo).toBe("ACTIVA");
    expect(evaluar(sinValidar(3))).toMatchObject({ tipo: "GRACIA", permiteOperar: true, diasGraciaRestantes: 12 });
    expect(evaluar(sinValidar(14.5))).toMatchObject({ tipo: "GRACIA", diasGraciaRestantes: 1 });
    expect(evaluar(sinValidar(15))).toMatchObject({ tipo: "GRACIA", diasGraciaRestantes: 1 }); // el día 15 todavía se opera
    expect(evaluar(sinValidar(15.01))).toMatchObject({ tipo: "BLOQUEADA_OFFLINE", permiteOperar: false, diasGraciaRestantes: 0, mensaje: expect.stringContaining("15 días") });
    expect(evaluar(sinValidar(40)).tipo).toBe("BLOQUEADA_OFFLINE");
  });

  it("la gracia es configurable", () => {
    const l = guardada({ ultimaValidacion: new Date(AHORA.getTime() - dias(5)) });
    expect(evaluar(l, { graciaDias: 3 }).tipo).toBe("BLOQUEADA_OFFLINE");
    expect(evaluar(l, { graciaDias: 30 })).toMatchObject({ tipo: "GRACIA", diasGraciaRestantes: 25 });
  });

  it("lo que dijo el servidor manda: revocada (con motivo), suscripción vencida y equipo liberado", () => {
    expect(evaluar(guardada({ bloqueoServidor: "REVOCADA", motivoBloqueo: "falta de pago" }))).toMatchObject({ tipo: "REVOCADA", permiteOperar: false, mensaje: expect.stringContaining("falta de pago") });
    expect(evaluar(guardada({ bloqueoServidor: "SUSCRIPCION_VENCIDA" }))).toMatchObject({ tipo: "VENCIDA", permiteOperar: false });
    expect(evaluar(guardada({ bloqueoServidor: "DISPOSITIVO" }))).toMatchObject({ tipo: "INVALIDA", permiteOperar: false, mensaje: expect.stringContaining("liberado") });
  });

  it("inválida: firma de otro servidor, token alterado, otra empresa, otro equipo y sin clave pública", () => {
    expect(evaluar(guardada({ firmaCon: otras.privada }))).toMatchObject({ tipo: "INVALIDA", permiteOperar: false, mensaje: expect.stringContaining("no es auténtica") });
    expect(evaluar(guardada({ token: "basura.basura" })).tipo).toBe("INVALIDA");
    expect(evaluar(guardada({ payload: { ruc: "0992345678001" } }))).toMatchObject({ tipo: "INVALIDA", mensaje: expect.stringContaining("otra empresa") });
    expect(evaluar(guardada({ payload: { dispositivoId: "otro-equipo" } }))).toMatchObject({ tipo: "INVALIDA", mensaje: expect.stringContaining("otro equipo") });
    expect(evaluar(guardada({ dispositivoId: "otro-equipo" }))).toMatchObject({ tipo: "INVALIDA", mensaje: expect.stringContaining("otro equipo") });
    expect(evaluar(guardada(), { clavePublica: null })).toMatchObject({ tipo: "INVALIDA" });
  });

  it("detecta el reloj atrasado, con tolerancia para ajustes automáticos de hora", () => {
    const visto = new Date(AHORA.getTime() + dias(2));
    expect(evaluar(guardada({ ultimoRelojVisto: visto }))).toMatchObject({ tipo: "INVALIDA", permiteOperar: false, mensaje: expect.stringContaining("fecha de este equipo es anterior") });
    expect(evaluar(guardada({ ultimoRelojVisto: new Date(AHORA.getTime() + 5 * 60_000) })).tipo).toBe("ACTIVA"); // 5 min de diferencia: tolerado
    expect(evaluar(guardada({ ultimoRelojVisto: new Date(AHORA.getTime() + 11 * 60_000) })).tipo).toBe("INVALIDA");
  });

  it("el reloj atrasado no permite «revivir» una suscripción vencida ni saltarse la gracia", () => {
    const vencida = guardada({ payload: { vence: new Date(AHORA.getTime() - dias(1)).toISOString() }, ultimoRelojVisto: AHORA });
    expect(evaluar(vencida, { ahora: new Date(AHORA.getTime() - dias(30)) }).tipo).toBe("INVALIDA");
  });

  it("enmascara la clave", () => {
    expect(enmascararClave("ABCD-1234-5678-WXYZ")).toBe("ABCD-••••-••••-WXYZ");
    expect(enmascararClave("ABCDEFGHIJKL")).toBe("ABCD••••IJKL");
    expect(enmascararClave("CORTA")).toBe("•••••");
  });
});

describe("Identificación del equipo", () => {
  const dirs: string[] = [];
  const temporal = (): string => {
    const d = mkdtempSync(path.join(os.tmpdir(), "vendeya-disp-"));
    dirs.push(d);
    return d;
  };
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  it("es estable para el mismo equipo, distinto entre equipos y no revela el identificador original", () => {
    const a1 = identificarDispositivo({ directorioSecretos: temporal(), version: "1.0.0", leerIdMaquina: () => "AAAA-BBBB-CCCC-DDDD-1111" });
    const a2 = identificarDispositivo({ directorioSecretos: temporal(), version: "1.1.0", leerIdMaquina: () => "aaaa-bbbb-cccc-dddd-1111" }); // mismo equipo, otra versión
    const b = identificarDispositivo({ directorioSecretos: temporal(), version: "1.0.0", leerIdMaquina: () => "ZZZZ-0000-1111-2222-3333" });
    expect(a1.id).toMatch(/^[0-9a-f]{32}$/);
    expect(a2.id).toBe(a1.id);
    expect(b.id).not.toBe(a1.id);
    expect(a1.id).not.toContain("aaaa");
    expect(a1).toMatchObject({ nombre: os.hostname(), plataforma: process.platform, version: "1.0.0" });
  });

  it("si el sistema no da un identificador, genera uno aleatorio, lo guarda y lo reutiliza", () => {
    const dir = temporal();
    const sin = (): null => null;
    const primero = identificarDispositivo({ directorioSecretos: dir, version: "1", leerIdMaquina: sin });
    const guardado = readFileSync(path.join(dir, "dispositivo.id"), "utf8").trim();
    expect(guardado).toMatch(/^[0-9a-f-]{36}$/);
    expect(identificarDispositivo({ directorioSecretos: dir, version: "1", leerIdMaquina: sin }).id).toBe(primero.id);
    expect(identificarDispositivo({ directorioSecretos: temporal(), version: "1", leerIdMaquina: sin }).id).not.toBe(primero.id);
  });

  it("lee el identificador de máquina del sistema actual (o null si no se puede) sin lanzar", () => {
    const id = leerIdMaquina();
    expect(id === null || id.length >= 16).toBe(true);
    expect(leerIdMaquina("aix" as NodeJS.Platform)).toBeNull();
  });
});

describe("Cliente HTTP del servidor de licencias", () => {
  interface Llamada { url: string; init: RequestInit }
  function conRespuesta(respuesta: () => Response | Promise<Response>): { cliente: ClienteLicenciasHttp; llamadas: Llamada[] } {
    const llamadas: Llamada[] = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      llamadas.push({ url: String(url), init: init ?? {} });
      return respuesta();
    }) as typeof fetch;
    return { cliente: new ClienteLicenciasHttp("https://licencias.ejemplo.test/", { fetchFn, timeoutMs: 200 }), llamadas };
  }
  const json = (status: number, cuerpo: unknown): Response => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
  const dispositivo = { id: "d1", nombre: "CAJA-1", plataforma: "win32", version: "1.0.0" };

  it("activar y validar hacen POST con JSON a /v1/licencias/<operación> y devuelven la licencia", async () => {
    const { cliente, llamadas } = conRespuesta(() => json(200, { token: "t.f" }));
    expect(await cliente.activar({ clave: "ABCD-1234", ruc: RUC, dispositivo })).toEqual({ token: "t.f" });
    expect(await cliente.validar({ token: "t.f", dispositivo })).toEqual({ token: "t.f" });
    expect(llamadas.map((l) => l.url)).toEqual(["https://licencias.ejemplo.test/v1/licencias/activar", "https://licencias.ejemplo.test/v1/licencias/validar"]);
    expect(llamadas[0]?.init.method).toBe("POST");
    expect(JSON.parse(llamadas[0]?.init.body as string)).toEqual({ clave: "ABCD-1234", ruc: RUC, dispositivo });
  });

  it("desactivar y liberar aceptan 204; dispositivos valida el contenido y completa el último uso", async () => {
    const sinCuerpo = conRespuesta(() => new Response(null, { status: 204 }));
    await expect(sinCuerpo.cliente.desactivar({ token: "t", dispositivoId: "d1" })).resolves.toBeUndefined();
    await expect(sinCuerpo.cliente.liberar({ token: "t", dispositivoId: "d2" })).resolves.toBeUndefined();
    const lista = conRespuesta(() => json(200, { maximo: 2, dispositivos: [{ id: "d1", nombre: "CAJA-1", plataforma: "win32" }] }));
    expect(await lista.cliente.dispositivos({ token: "t" })).toEqual({ maximo: 2, dispositivos: [{ id: "d1", nombre: "CAJA-1", plataforma: "win32", ultimoUso: null }] });
  });

  it("traduce los errores del servidor a códigos con su mensaje; los desconocidos y los 5xx son «error del servidor»", async () => {
    const caso = async (status: number, cuerpo: unknown): Promise<ErrorLicencias> => {
      const { cliente } = conRespuesta(() => json(status, cuerpo));
      return (await cliente.activar({ clave: "ABCD-1234", ruc: RUC, dispositivo }).catch((e: unknown) => e)) as ErrorLicencias;
    };
    for (const codigo of ["CLAVE_INVALIDA", "RUC_NO_COINCIDE", "REVOCADA", "SUSCRIPCION_VENCIDA", "LIMITE_DISPOSITIVOS", "DISPOSITIVO_NO_REGISTRADO"]) {
      const e = await caso(409, { error: codigo });
      expect(e).toBeInstanceOf(ErrorLicencias);
      expect(e.codigo).toBe(codigo);
      expect(e.transitorio).toBe(false);
      expect(e.message.length).toBeGreaterThan(10);
    }
    const propio = await caso(402, { error: "SUSCRIPCION_VENCIDA", mensaje: "Venció el 30/11" });
    expect(propio.message).toBe("Venció el 30/11");
    const limite = await caso(409, { error: "LIMITE_DISPOSITIVOS", maximo: 1, dispositivos: [{ id: "x", nombre: "OTRA-PC" }] });
    expect(limite.detalle).toMatchObject({ dispositivos: [{ nombre: "OTRA-PC" }] });
    for (const [status, cuerpo] of [[500, { error: "BOOM" }], [503, null], [404, { error: "ALGO_RARO" }]] as const) {
      const e = await caso(status, cuerpo);
      expect(e).toMatchObject({ codigo: "ERROR_SERVIDOR", transitorio: true });
    }
  });

  it("sin red, sin respuesta a tiempo o con una respuesta mal formada son fallos pasajeros (no cambian el estado)", async () => {
    const caida = new ClienteLicenciasHttp("https://x.test", { fetchFn: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
    expect(await caida.validar({ token: "t", dispositivo }).catch((e: unknown) => e)).toMatchObject({ codigo: "SIN_CONEXION", transitorio: true });

    const conTimeout = new ClienteLicenciasHttp("https://x.test", {
      timeoutMs: 20,
      fetchFn: ((_u: string, init?: RequestInit) => new Promise((_r, rechazar) => init?.signal?.addEventListener("abort", () => rechazar(new DOMException("tiempo agotado", "TimeoutError"))))) as typeof fetch,
    });
    // el servidor nunca responde: el fetch real corta con el timeout
    expect(await conTimeout.activar({ clave: "ABCD-1234", ruc: RUC, dispositivo }).catch((e: unknown) => e)).toMatchObject({ codigo: "SIN_CONEXION" });

    for (const cuerpo of [{}, { token: "" }, { otra: 1 }]) {
      const { cliente } = conRespuesta(() => json(200, cuerpo));
      expect(await cliente.validar({ token: "t", dispositivo }).catch((e: unknown) => e)).toMatchObject({ codigo: "RESPUESTA_INVALIDA", transitorio: true });
    }
    const noJson = conRespuesta(() => new Response("<html>", { status: 200 }));
    expect(await noJson.cliente.validar({ token: "t", dispositivo }).catch((e: unknown) => e)).toMatchObject({ codigo: "RESPUESTA_INVALIDA" });
  });
});
