// ============================================================
// tests/integration/server/telemetria.test.ts — Telemetría opcional de errores (Semana 23)
//   · desactivada por defecto: sin consentimiento no se guarda ni se envía nada
//   · todo dato personal se elimina antes de guardar · envío a un servidor simulado real · revocar borra la cola
// ============================================================
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LoteTelemetria } from "../../../src/shared/types/telemetria.types";
import { limpiarTexto, MAX_MENSAJE } from "../../../src/server/services/telemetria/telemetria.util";
import { TelemetriaService, TransporteHttp, MAX_COLA } from "../../../src/server/services/telemetria/telemetria.service";
import { crearEntorno, PASSWORD_ADMIN, type Entorno } from "../helpers/entorno.helper";

describe("Limpieza de datos personales", () => {
  const casos: Array<[string, string, RegExp[]]> = [
    ["RUC, cédula y clave de acceso", "Falla con 1790016919001, cédula 1712345678 y clave 0112202601179001691900110010010000000011234567811", [/179001/, /171234/, /\d{9}/]],
    ["rutas con el usuario de Windows", "Error en C:\\Users\\Elder Gómez\\AppData\\Roaming\\vendeya-pos\\data\\vendeya.db y C:/Users/maria/Desktop/x.ts", [/Elder/, /maria/]],
    ["rutas de macOS y Linux", "falló /Users/pedro/Library/app.db y /home/lucia/.config/x", [/pedro/, /lucia/]],
    ["correos", "No se pudo enviar a cliente.privado@empresa.com.ec", [/cliente\.privado/, /empresa\.com/]],
    ["tokens y claves", "Authorization: Bearer abcdef0123456789abcdef0123456789abcdef0123456789 password=MiClaveSecreta1 token: 0123456789abcdef0123456789abcdef", [/abcdef0123/, /MiClaveSecreta/, /0123456789abcdef0123456789abcdef/]],
    ["direcciones y URL con parámetros", "GET http://192.168.1.45:3001/api/sync?token=zzz999&cajaId=C1 falló", [/192\.168/, /zzz999/, /api\/sync/]],
  ];
  for (const [nombre, entrada, prohibidos] of casos) {
    it(`elimina ${nombre}`, () => {
      const limpio = limpiarTexto(entrada, 1000);
      for (const p of prohibidos) expect(limpio, limpio).not.toMatch(p);
      expect(limpio.length).toBeGreaterThan(0);
    });
  }

  it("conserva lo útil para diagnosticar y recorta el tamaño", () => {
    expect(limpiarTexto("TypeError: Cannot read properties of undefined (reading 'total')", 300)).toBe("TypeError: Cannot read properties of undefined (reading 'total')");
    expect(limpiarTexto("x".repeat(5_000), MAX_MENSAJE).length).toBeLessThanOrEqual(MAX_MENSAJE + 1);
  });
});

describe("Servicio de telemetría", () => {
  let dir = "";
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "vendeya-tel-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const nuevo = (sub: string, extra: Partial<ConstructorParameters<typeof TelemetriaService>[0]> = {}): TelemetriaService =>
    new TelemetriaService({ directorio: path.join(dir, sub), version: "1.2.3", plataforma: "win32-x64", ...extra });

  it("está desactivada por defecto: no guarda nada y no crea archivos con datos", () => {
    const t = nuevo("a");
    expect(t.estado()).toMatchObject({ consentimiento: false, pendientes: 0, destinoConfigurado: false });
    expect(t.registrar({ origen: "interfaz", mensaje: "error cualquiera" })).toBe(false);
    expect(t.pendientes()).toEqual([]);
    expect(() => readdirSync(path.join(dir, "a"))).toThrow(); // ni siquiera se creó la carpeta
  });

  it("con consentimiento guarda solo el reporte limpio: sin datos del negocio ni del usuario", () => {
    const t = nuevo("b");
    expect(t.configurar({ consentimiento: true }).consentimiento).toBe(true);
    expect(t.registrar({
      origen: "interfaz",
      vista: "venta/../x",
      mensaje: "Cliente Juan Pérez RUC 1712345678001 correo juan@correo.ec",
      pila: "Error: fallo\n    at cobrar (file:///C:/Users/elder/AppData/app.asar/dist/assets/index-abc.js:1:2)\n    at C:\\Users\\elder\\x.js:3:4",
    })).toBe(true);
    const [r] = t.pendientes();
    expect(r).toBeDefined();
    const texto = JSON.stringify(r);
    for (const p of [/1712345678001/, /juan@correo/, /elder/i, /C:\\Users/]) expect(texto).not.toMatch(p);
    expect(r).toMatchObject({ version: "1.2.3", plataforma: "win32-x64", origen: "interfaz", vista: "ventax" });
    expect(Object.keys(r as object).sort()).toEqual(["fecha", "id", "mensaje", "origen", "pila", "plataforma", "version", "vista"]);
  });

  it("el origen «servidor» no se puede falsificar desde la interfaz y las entradas inválidas no rompen nada", () => {
    const t = nuevo("c");
    t.configurar({ consentimiento: true });
    expect(t.registrar({ origen: "otro", mensaje: "x" })).toBe(false);
    expect(t.registrar(null)).toBe(false);
    expect(t.registrar({ mensaje: "" })).toBe(false);
    t.registrarError(new Error("fallo interno RUC 1790016919001"));
    expect(t.pendientes()).toHaveLength(1);
    expect(t.pendientes()[0]).toMatchObject({ origen: "servidor" });
    expect(JSON.stringify(t.pendientes())).not.toContain("1790016919001");
  });

  it("la cola tiene tope y las ráfagas del mismo error no la llenan", () => {
    const t = nuevo("d");
    t.configurar({ consentimiento: true });
    for (let i = 0; i < 20; i++) t.registrar({ origen: "interfaz", mensaje: "mismo error", pila: null });
    expect(t.pendientes()).toHaveLength(1);
    for (let i = 0; i < MAX_COLA + 20; i++) t.registrar({ origen: "interfaz", mensaje: `error distinto ${String.fromCharCode(97 + (i % 26))}${i}` });
    expect(t.pendientes().length).toBeLessThanOrEqual(MAX_COLA);
  });

  it("retirar el consentimiento borra lo acumulado", () => {
    const t = nuevo("e");
    t.configurar({ consentimiento: true });
    t.registrar({ origen: "interfaz", mensaje: "uno" });
    expect(t.pendientes()).toHaveLength(1);
    t.configurar({ consentimiento: false });
    expect(t.pendientes()).toEqual([]);
    expect(t.registrar({ origen: "interfaz", mensaje: "dos" })).toBe(false);
  });

  it("sin destino configurado el envío se rechaza y los reportes se conservan para revisarlos", async () => {
    const t = nuevo("f");
    t.configurar({ consentimiento: true });
    t.registrar({ origen: "interfaz", mensaje: "uno" });
    await expect(t.enviar()).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
    expect(t.pendientes()).toHaveLength(1);
  });

  describe("envío a un servidor (simulado)", () => {
    let servidor: Server;
    let url = "";
    let estado = 200;
    const recibidos: Array<{ cabeceras: Record<string, unknown>; lote: LoteTelemetria }> = [];

    beforeAll(async () => {
      servidor = createServer((req, res) => {
        const trozos: Buffer[] = [];
        req.on("data", (c: Buffer) => trozos.push(c));
        req.on("end", () => {
          if (estado === 200) recibidos.push({ cabeceras: req.headers, lote: JSON.parse(Buffer.concat(trozos).toString("utf8")) as LoteTelemetria });
          res.statusCode = estado;
          res.end("{}");
        });
      });
      await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
      url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/telemetria`;
    });
    afterAll(() => new Promise<void>((r) => servidor.close(() => r())));

    it("envía el lote con el id anónimo de la instalación; lo enviado sale de la cola; un fallo lo conserva", async () => {
      const t = nuevo("g", { transporte: new TransporteHttp(url), autoEnviar: false });
      t.configurar({ consentimiento: true });
      t.registrar({ origen: "interfaz", mensaje: "error A" });
      t.registrar({ origen: "interfaz", mensaje: "error B" });

      estado = 503;
      await expect(t.enviar()).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
      expect(t.pendientes()).toHaveLength(2);

      estado = 200;
      expect(await t.enviar()).toBe(2);
      expect(t.pendientes()).toEqual([]);
      expect(t.estado().ultimoEnvio).not.toBeNull();
      expect(recibidos).toHaveLength(1);
      const { lote, cabeceras } = recibidos[0] as (typeof recibidos)[number];
      expect(cabeceras["content-type"]).toBe("application/json");
      expect(lote.instalacion).toBe(t.estado().instalacion);
      expect(lote.reportes.map((r) => r.mensaje)).toEqual(["error A", "error B"]);
      expect(await t.enviar()).toBe(0); // nada pendiente
    });

    it("con autoEnviar los errores salen solos; el id de instalación es estable y no se deriva del equipo", async () => {
      recibidos.length = 0;
      const t = nuevo("h", { transporte: new TransporteHttp(url) });
      t.configurar({ consentimiento: true });
      const id1 = t.estado().instalacion;
      t.registrar({ origen: "interfaz", mensaje: "error automático" });
      for (let i = 0; i < 50 && recibidos.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
      expect(recibidos).toHaveLength(1);
      expect(nuevo("h").estado().instalacion).toBe(id1); // se recuerda tras reiniciar
      expect(id1).toMatch(/^[0-9a-f-]{36}$/);
      const guardado = readFileSync(path.join(dir, "h", "telemetria.json"), "utf8");
      expect(guardado).not.toMatch(/ruc|empresa|usuario/i);
    });

    it("el destino debe ser https (o este mismo equipo)", () => {
      expect(() => new TransporteHttp("http://servidor-remoto.example/t")).toThrow();
      expect(() => new TransporteHttp("ftp://x/y")).toThrow();
      expect(() => new TransporteHttp("https://telemetria.example/t")).not.toThrow();
    });
  });
});

describe("API de telemetría", () => {
  let env: Entorno;
  let admin = "";
  let cajero = "";
  const api = (metodo: "GET" | "POST" | "PUT" | "DELETE", url: string, token: string, payload?: unknown) =>
    env.backend.server.inject({ method: metodo, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });

  beforeAll(async () => {
    env = await crearEntorno();
    admin = ((await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: PASSWORD_ADMIN } })).json() as { token: string }).token;
    await env.servicios.usuarios.crear({ empresaId: env.seed.empresaId, rol: "CAJERO", username: "cajera.tel", password: "Clave12345", nombre: "C", apellido: "T" });
    cajero = ((await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username: "cajera.tel", password: "Clave12345" } })).json() as { token: string }).token;
  }, 60_000);
  afterAll(async () => env.cerrar());

  it("por defecto está apagada: los errores que informa la interfaz se descartan", async () => {
    expect(((await api("GET", "/api/telemetria", cajero)).json() as { consentimiento: boolean }).consentimiento).toBe(false);
    expect((await api("POST", "/api/telemetria/errores", cajero, { origen: "interfaz", mensaje: "falla" })).statusCode).toBe(204);
    expect(((await api("GET", "/api/telemetria/pendientes", admin)).json() as { reportes: unknown[] }).reportes).toEqual([]);
  });

  it("solo el administrador la activa; luego cualquier usuario informa errores y el administrador los ve antes de enviarlos", async () => {
    expect((await api("PUT", "/api/telemetria", cajero, { consentimiento: true })).statusCode).toBe(403);
    expect((await api("GET", "/api/telemetria/pendientes", cajero)).statusCode).toBe(403);
    expect((await api("PUT", "/api/telemetria", admin, { consentimiento: true })).statusCode).toBe(200);
    expect((await api("POST", "/api/telemetria/errores", cajero, { origen: "interfaz", vista: "venta", mensaje: "Cliente 1712345678 falló", pila: "at x (C:\\Users\\caja\\a.js:1:1)" })).statusCode).toBe(204);
    const vista = (await api("GET", "/api/telemetria/pendientes", admin)).json() as { reportes: Array<{ mensaje: string; pila: string }>; estado: { pendientes: number } };
    expect(vista.estado.pendientes).toBe(1);
    expect(JSON.stringify(vista.reportes)).not.toMatch(/1712345678|caja\\/);
    expect((await api("POST", "/api/telemetria/enviar", admin)).statusCode).toBe(409); // sin servidor de destino
    expect(((await api("DELETE", "/api/telemetria/pendientes", admin)).json() as { descartados: number }).descartados).toBe(1);
  });

  it("un error interno del servidor (500) se registra limpio cuando hay consentimiento", async () => {
    const antes = env.servicios.telemetria.pendientes().length;
    const original = env.servicios.usuarios.tienePermiso;
    env.servicios.usuarios.tienePermiso = () => {
      throw new Error("explotó con la clave 0123456789abcdef0123456789abcdef");
    };
    try {
      expect((await api("GET", "/api/productos", admin)).statusCode).toBe(500);
    } finally {
      env.servicios.usuarios.tienePermiso = original;
    }
    const despues = env.servicios.telemetria.pendientes();
    expect(despues.length).toBe(antes + 1);
    expect(despues.at(-1)).toMatchObject({ origen: "servidor" });
    expect(JSON.stringify(despues)).not.toContain("0123456789abcdef0123456789abcdef");
  });
});
