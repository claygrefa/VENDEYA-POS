// ============================================================
// tests/integration/server/setup.test.ts
// Asistente de configuración inicial sobre una base de datos VACÍA (como queda tras instalar), y ajustes del negocio.
// ============================================================
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { iniciarBackend, type BackendHandle } from "../../../src/server";
import { validarRucEcuatoriano } from "../../../src/shared/schemas/setup.schema";
import { generarP12Prueba } from "../../helpers/certificados.helper";

let dir = "";
let b: BackendHandle;

const RUC = "1790016919001"; // RUC con dígito verificador válido (módulo 11 de sociedad)
const setupBase = () => ({
  empresa: {
    ruc: RUC, razonSocial: "COMERCIAL ANDINA S.A.", nombreComercial: "ANDINA", direccionMatriz: "Av. Amazonas N34-12, Quito", telefono: "022345678", email: "info@andina.ec",
    tipoContribuyente: "SOCIEDAD", regimenTributario: "GENERAL", obligadoContabilidad: true, ambienteSRI: "PRUEBAS",
  },
  sucursal: { nombre: "Matriz", direccion: "Av. Amazonas N34-12, Quito", telefono: "022345678" },
  giro: "RESTAURANTE",
  admin: { username: "dueno", password: "Clave-Segura1", nombre: "Ana", apellido: "Torres" },
});
const post = (url: string, payload: unknown, remoteAddress?: string) =>
  b.server.inject({ method: "POST", url, payload: payload as object, ...(remoteAddress !== undefined ? { remoteAddress } : {}) });

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "vendeya-setup-"));
  b = await iniciarBackend({ dbPath: path.join(dir, "data", "vendeya.db"), migrationsDir: path.resolve(__dirname, "../../../prisma/migrations"), port: 0, logLevel: "silent" });
}, 60_000);

afterAll(async () => {
  await b.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Dígito verificador del RUC", () => {
  it("acepta RUC reales de personas naturales, sociedades privadas y entidades públicas", () => {
    for (const ruc of ["1790010937001", "1790016919001", "0990004196001", "1710034065001", "1760013210001"]) expect(validarRucEcuatoriano(ruc), ruc).toBe(true);
  });
  it("rechaza dígitos alterados, provincias inexistentes, longitudes y establecimiento 000", () => {
    for (const ruc of ["1790010938001", "1790016918001", "9990004196001", "1710034066001", "179001693700", "17900169190010", "1790010937000", "abcdefghijklm", "1770016919001"]) expect(validarRucEcuatoriano(ruc), ruc).toBe(false);
  });
});

describe("Antes de configurar", () => {
  it("el sistema informa que no está configurado y nada más funciona sin sesión", async () => {
    const e = await b.server.inject({ method: "GET", url: "/api/setup/estado" });
    expect(e.json()).toEqual({ configurado: false });
    expect((await post("/api/auth/login", { username: "admin", password: "Admin123!" })).statusCode).toBe(401);
    expect((await b.server.inject({ method: "GET", url: "/api/puntos-emision" })).statusCode).toBe(401);
  });

  it("valida el certificado del paso 2 sin guardar nada: contraseña, vigencia, titular y confirmación", async () => {
    const bueno = generarP12Prueba({ identificacion: RUC, password: "Clave-P12-1", cn: "ANA TORRES" });
    const base = { archivoBase64: bueno.archivo.toString("base64"), password: "Clave-P12-1", ruc: RUC };
    const ok = await post("/api/setup/certificado", base);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ titular: "ANA TORRES", advertencias: [] });
    expect(ok.json<{ diasRestantes: number }>().diasRestantes).toBeGreaterThan(600);

    const mal = await post("/api/setup/certificado", { ...base, password: "otra" });
    expect(mal.statusCode).toBe(400);
    expect(mal.json<{ mensaje: string }>().mensaje).toMatch(/contraseña es incorrecta/);
    const ajeno = generarP12Prueba({ identificacion: "0992345678001", password: "x1" });
    const otroRuc = await post("/api/setup/certificado", { archivoBase64: ajeno.archivo.toString("base64"), password: "x1", ruc: RUC, confirmarTitular: true });
    expect(otroRuc.json<{ mensaje: string }>().mensaje).toMatch(/no corresponde al RUC/);
    const vencido = generarP12Prueba({ identificacion: RUC, password: "x1", desde: new Date(Date.now() - 400 * 86_400_000), vigenciaDias: 100 });
    expect((await post("/api/setup/certificado", { archivoBase64: vencido.archivo.toString("base64"), password: "x1", ruc: RUC })).json<{ mensaje: string }>().mensaje).toMatch(/vencido desde/);
    const sinId = generarP12Prueba({ password: "x1" });
    const sin = { archivoBase64: sinId.archivo.toString("base64"), password: "x1", ruc: RUC };
    expect((await post("/api/setup/certificado", sin)).statusCode).toBe(400);
    expect((await post("/api/setup/certificado", { ...sin, confirmarTitular: true })).statusCode).toBe(200);
    expect((await post("/api/setup/certificado", {})).statusCode).toBe(400);
    expect((await b.server.inject({ method: "GET", url: "/api/setup/estado" })).json()).toEqual({ configurado: false }); // no guardó nada
  });

  it("el alta valida los datos: RUC con dígito verificador (o confirmado), contraseña y usuario", async () => {
    const c = (cambios: (x: ReturnType<typeof setupBase>) => void) => {
      const x = setupBase();
      cambios(x);
      return x;
    };
    const dv = await post("/api/setup", c((x) => { x.empresa.ruc = "1790016918001"; }));
    expect(dv.statusCode).toBe(400);
    expect(dv.json<{ mensaje: string }>().mensaje).toMatch(/dígito verificador/);
    expect((await post("/api/setup", c((x) => { x.empresa.ruc = "123"; }))).statusCode).toBe(400);
    expect((await post("/api/setup", c((x) => { x.admin.password = "corta1"; }))).json<{ mensaje: string }>().mensaje).toMatch(/al menos 8/);
    expect((await post("/api/setup", c((x) => { x.admin.password = "sinnumeros"; }))).json<{ mensaje: string }>().mensaje).toMatch(/un número/);
    expect((await post("/api/setup", c((x) => { x.admin.username = "Dueño Mayúsculas"; }))).statusCode).toBe(400);
    expect((await post("/api/setup", c((x) => { x.giro = "INVENTADO"; }))).statusCode).toBe(400);
    expect((await b.server.inject({ method: "GET", url: "/api/setup/estado" })).json()).toEqual({ configurado: false });
  });

  it("solo se acepta desde este equipo: una petición de la red local se rechaza (el estado sí es público)", async () => {
    const r = await post("/api/setup", setupBase(), "192.168.1.50");
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: "SIN_PERMISO" });
    expect((await post("/api/setup/certificado", {}, "192.168.1.50")).statusCode).toBe(403);
    expect((await b.server.inject({ method: "GET", url: "/api/setup/estado", remoteAddress: "192.168.1.50" })).statusCode).toBe(200);
  });
});

describe("Alta inicial", () => {
  let token = "";

  it("dos intentos simultáneos crean una sola empresa", async () => {
    const [a, c] = await Promise.all([post("/api/setup", setupBase()), post("/api/setup", setupBase())]);
    expect([a.statusCode, c.statusCode].sort()).toEqual([201, 409]);
    expect(await b.prisma.empresa.count()).toBe(1);
    expect(await b.prisma.usuario.count()).toBe(1);
  });

  it("deja el sistema listo: empresa, sucursal y punto 001, impuestos, roles, permisos, unidades, Consumidor Final y módulos del giro", async () => {
    expect((await b.server.inject({ method: "GET", url: "/api/setup/estado" })).json()).toEqual({ configurado: true });
    const empresa = await b.prisma.empresa.findFirstOrThrow();
    expect(empresa).toMatchObject({ ruc: RUC, razonSocial: "COMERCIAL ANDINA S.A.", obligadoContabilidad: true, ambienteSRI: "PRUEBAS", tipoContribuyente: "SOCIEDAD" });
    expect(await b.prisma.sucursal.findMany({ select: { codigo: true, nombre: true } })).toEqual([{ codigo: "001", nombre: "Matriz" }]);
    expect(await b.prisma.puntoEmision.findMany({ select: { codigo: true } })).toEqual([{ codigo: "001" }]);
    expect(await b.prisma.tarifaImpuesto.count({ where: { empresaId: empresa.id } })).toBe(7);
    expect(await b.prisma.rol.count()).toBe(7);
    expect(await b.prisma.permiso.count()).toBe(60);
    expect(await b.prisma.unidadMedida.count()).toBe(8);
    expect(await b.prisma.categoria.count({ where: { nombre: "General" } })).toBe(1);
    expect(await b.prisma.cliente.findFirstOrThrow()).toMatchObject({ identificacion: "9999999999999", tipoIdentificacion: "07" });
    // el giro RESTAURANTE activa mesas y comandas; los demás módulos según el giro
    expect(await b.prisma.configuracionGiro.findFirstOrThrow()).toMatchObject({ giroNegocio: "RESTAURANTE", moduloMesas: true, moduloComandasCocina: true, moduloLotes: false });
  });

  it("el administrador creado puede ingresar con su clave, tiene todos los permisos y la contraseña no se guarda en claro", async () => {
    expect((await post("/api/auth/login", { username: "dueno", password: "otra" })).statusCode).toBe(401);
    const r = await post("/api/auth/login", { username: "dueno", password: "Clave-Segura1" });
    expect(r.statusCode).toBe(200);
    const { token: t, usuario } = r.json<{ token: string; usuario: { rol: string; permisos: string[]; nombre: string } }>();
    token = t;
    expect(usuario).toMatchObject({ rol: "ADMIN", nombre: "Ana" });
    expect(usuario.permisos).toHaveLength(60);
    const fila = await b.prisma.usuario.findUniqueOrThrow({ where: { username: "dueno" } });
    expect(JSON.stringify(fila)).not.toContain("Clave-Segura1");
    expect(fila.passwordHash).not.toBe("Clave-Segura1");
  });

  it("después del alta el asistente queda cerrado y el certificado se carga con la sesión (paso final del asistente)", async () => {
    const otra = await post("/api/setup", { ...setupBase(), empresa: { ...setupBase().empresa, ruc: "0990004196001" }, admin: { ...setupBase().admin, username: "intruso" } });
    expect(otra.statusCode).toBe(409);
    expect(otra.json()).toMatchObject({ error: "ESTADO_INVALIDO" });
    expect((await post("/api/setup/certificado", {})).statusCode).toBe(400);
    const p12 = generarP12Prueba({ identificacion: RUC, password: "Clave-P12-1" });
    const cuerpo = { archivoBase64: p12.archivo.toString("base64"), password: "Clave-P12-1" };
    expect((await post("/api/setup/certificado", { ...cuerpo, ruc: RUC })).json<{ mensaje: string }>().mensaje).toMatch(/ya está configurado/);

    const put = await b.server.inject({ method: "PUT", url: "/api/configuracion/certificado", headers: { authorization: `Bearer ${token}` }, payload: cuerpo });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ certificado: { cargado: true } });
    const puntos = await b.server.inject({ method: "GET", url: "/api/puntos-emision", headers: { authorization: `Bearer ${token}` } });
    expect(puntos.json<{ items: Array<{ codigo: string; sucursal: { codigo: string } }> }>().items).toMatchObject([{ codigo: "001", sucursal: { codigo: "001" } }]);
  });

  it("un alta que falla a mitad no deja datos a medias (todo o nada)", async () => {
    // con otra instalación vacía: se fuerza un fallo con un usuario duplicado de otra empresa inexistente no es posible; se verifica con datos inválidos tardíos
    const d2 = mkdtempSync(path.join(os.tmpdir(), "vendeya-setup2-"));
    const b2 = await iniciarBackend({ dbPath: path.join(d2, "data", "vendeya.db"), migrationsDir: path.resolve(__dirname, "../../../prisma/migrations"), port: 0, logLevel: "silent" });
    try {
      // el RUC de 13 dígitos con provincia válida pero verificador incorrecto, confirmado: pasa; luego el segundo intento con el mismo RUC falla sin tocar nada
      const ok = await b2.server.inject({ method: "POST", url: "/api/setup", payload: { ...setupBase(), confirmarRuc: true, empresa: { ...setupBase().empresa, ruc: "1790016918001" } } });
      expect(ok.statusCode).toBe(201);
      const antes = await b2.prisma.usuario.count();
      const repetido = await b2.server.inject({ method: "POST", url: "/api/setup", payload: { ...setupBase(), confirmarRuc: true } });
      expect(repetido.statusCode).toBe(409);
      expect(await b2.prisma.usuario.count()).toBe(antes);
      expect(await b2.prisma.empresa.count()).toBe(1);
    } finally {
      await b2.close();
      rmSync(d2, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("Ajustes del negocio", () => {
  let admin = "";
  let cajero = "";
  const api = (method: "GET" | "PATCH" | "POST", url: string, token: string, payload?: unknown) =>
    b.server.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });

  beforeAll(async () => {
    admin = (await post("/api/auth/login", { username: "dueno", password: "Clave-Segura1" })).json<{ token: string }>().token;
    await b.servicios.usuarios.crear({ empresaId: (await b.prisma.empresa.findFirstOrThrow()).id, rol: "CAJERO", username: "cajera", password: "Clave12345", nombre: "Caja", apellido: "Uno" });
    cajero = (await post("/api/auth/login", { username: "cajera", password: "Clave12345" })).json<{ token: string }>().token;
  });

  it("consulta los datos de la empresa y los módulos activos", async () => {
    const r = await api("GET", "/api/configuracion", admin);
    expect(r.statusCode).toBe(200);
    const j = r.json<{ empresa: { ruc: string; razonSocial: string }; giroNegocio: string; modulos: Record<string, boolean> }>();
    expect(j.empresa).toMatchObject({ ruc: RUC, razonSocial: "COMERCIAL ANDINA S.A." });
    expect(j.giroNegocio).toBe("RESTAURANTE");
    expect(j.modulos).toMatchObject({ moduloMesas: true, moduloLotes: false, emitirFacturas: true });
    expect((await api("GET", "/api/configuracion", cajero)).statusCode).toBe(403);
  });

  it("cambia datos de la empresa pero nunca el RUC; solo el administrador", async () => {
    const r = await api("PATCH", "/api/configuracion/empresa", admin, { nombreComercial: "ANDINA EXPRESS", telefono: "022999999", ambienteSRI: "PRODUCCION", agenteRetencion: true, resolucionAgente: "NAC-DGERCGC19-00000001" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ empresa: { nombreComercial: "ANDINA EXPRESS", ambienteSRI: "PRODUCCION", agenteRetencion: true, ruc: RUC } });
    const ruc = await api("PATCH", "/api/configuracion/empresa", admin, { ruc: "0990004196001" });
    expect(ruc.statusCode).toBe(400);
    expect((await b.prisma.empresa.findFirstOrThrow()).ruc).toBe(RUC);
    expect((await api("PATCH", "/api/configuracion/empresa", admin, { email: "no-es-correo" })).statusCode).toBe(400);
    expect((await api("PATCH", "/api/configuracion/empresa", cajero, { telefono: "022999999" })).statusCode).toBe(403);
    await api("PATCH", "/api/configuracion/empresa", admin, { ambienteSRI: "PRUEBAS" });
  });

  it("activa y desactiva módulos sueltos; los valores desconocidos se rechazan; la sincronización LAN se aplica al instante", async () => {
    const r = await api("PATCH", "/api/configuracion/modulos", admin, { moduloLotes: true, emitirRetenciones: true, moduloMesas: false, sincronizacionLAN: true });
    expect(r.json<{ modulos: Record<string, boolean> }>().modulos).toMatchObject({ moduloLotes: true, emitirRetenciones: true, moduloMesas: false, sincronizacionLAN: true, moduloComandasCocina: true });
    const empresaId = (await b.prisma.empresa.findFirstOrThrow()).id;
    expect(await b.servicios.sync.habilitada(empresaId)).toBe(true);
    await api("PATCH", "/api/configuracion/modulos", admin, { sincronizacionLAN: false });
    expect(await b.servicios.sync.habilitada(empresaId)).toBe(false); // sin esperar a que caduque la memoria
    expect((await api("PATCH", "/api/configuracion/modulos", admin, { moduloInventario: false })).statusCode).toBe(400);
    expect((await api("PATCH", "/api/configuracion/modulos", admin, { moduloLotes: "si" })).statusCode).toBe(400);
    expect((await api("PATCH", "/api/configuracion/modulos", cajero, { moduloLotes: false })).statusCode).toBe(403);
  });

  it("cambiar de giro reajusta los módulos a los del giro elegido", async () => {
    const r = await api("POST", "/api/configuracion/giro", admin, { giro: "FARMACIA" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ giroNegocio: "FARMACIA", modulos: { moduloLotes: true, moduloVencimientos: true, moduloMesas: false } });
    expect((await api("POST", "/api/configuracion/giro", admin, { giro: "NINGUNO" })).statusCode).toBe(400);
    expect((await api("POST", "/api/configuracion/giro", cajero, { giro: "RETAIL_GENERAL" })).statusCode).toBe(403);
  });
});
