// ============================================================
// tests/integration/server/rbac-matriz.test.ts
// Regresión del RBAC: matriz ruta × rol sobre TODAS las rutas registradas.
//  1) La tabla de rutas debe coincidir exactamente con las rutas reales (nadie queda sin cubrir).
//  2) Los permisos de cada rol están fijados explícitamente (un cambio en el seed rompe la prueba).
//  3) Cada ruta responde 401 sin sesión, 403 SIN_PERMISO sin el permiso requerido y nunca 5xx.
// ============================================================
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registrarRutas } from "../../../src/server/routes";
import { configurarGiro, crearEntorno, PASSWORD_ADMIN, type Entorno } from "../helpers/entorno.helper";

type Metodo = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
/** "publica" | "sesion" (cualquier usuario autenticado) | "modulo:accion" */
type Requisito = string;

const RUTAS: ReadonlyArray<readonly [Metodo, string, Requisito]> = [
  // ── Públicas y de sesión ──
  ["GET", "/api/health", "publica"],
  ["POST", "/api/auth/login", "publica"],
  ["GET", "/api/setup/estado", "publica"],
  ["POST", "/api/setup", "publica"],
  ["POST", "/api/setup/certificado", "publica"],
  ["GET", "/api/configuracion", "configuracion:leer"],
  ["PATCH", "/api/configuracion/empresa", "configuracion:actualizar"],
  ["PATCH", "/api/configuracion/modulos", "configuracion:actualizar"],
  ["POST", "/api/configuracion/giro", "configuracion:actualizar"],
  ["POST", "/api/auth/logout", "sesion"],
  ["GET", "/api/auth/me", "sesion"],
  // ── Catálogo e inventario ──
  ["GET", "/api/productos", "inventario:leer"],
  ["GET", "/api/productos/barcode/:codigo", "inventario:leer"],
  ["GET", "/api/productos/:id", "inventario:leer"],
  ["GET", "/api/productos/:id/presentaciones", "inventario:leer"],
  ["GET", "/api/listas-precio", "inventario:leer"],
  ["GET", "/api/listas-precio/:id/precios", "inventario:leer"],
  ["GET", "/api/inventario/lotes", "inventario:leer"],
  ["GET", "/api/inventario/lotes/:id", "inventario:leer"],
  ["GET", "/api/inventario/productos/:id/kardex", "inventario:leer"],
  ["GET", "/api/inventario/alertas-vencimiento", "inventario:leer"],
  ["GET", "/api/inventario/alertas-stock", "inventario:leer"],
  ["GET", "/api/compras/:id", "inventario:leer"],
  ["POST", "/api/productos", "inventario:crear"],
  ["POST", "/api/productos/:id/presentaciones", "inventario:crear"],
  ["POST", "/api/listas-precio", "inventario:crear"],
  ["POST", "/api/inventario/lotes", "inventario:crear"],
  ["POST", "/api/compras", "inventario:crear"],
  ["PATCH", "/api/productos/:id", "inventario:actualizar"],
  ["PATCH", "/api/presentaciones/:id", "inventario:actualizar"],
  ["PATCH", "/api/listas-precio/:id", "inventario:actualizar"],
  ["PUT", "/api/listas-precio/:id/precios", "inventario:actualizar"],
  ["DELETE", "/api/listas-precio/:id/precios/:precioId", "inventario:actualizar"],
  ["PATCH", "/api/inventario/lotes/:id", "inventario:actualizar"],
  ["POST", "/api/inventario/ajustes", "inventario:actualizar"],
  // ── Clientes y cartera ──
  ["GET", "/api/clientes", "clientes:leer"],
  ["GET", "/api/clientes/consumidor-final", "clientes:leer"],
  ["GET", "/api/clientes/:id", "clientes:leer"],
  ["GET", "/api/cuentas-por-cobrar", "clientes:leer"],
  ["GET", "/api/cuentas-por-cobrar/:id", "clientes:leer"],
  ["PUT", "/api/clientes/:id/lista-precio", "clientes:actualizar"],
  ["POST", "/api/cuentas-por-cobrar/:id/abonos", "caja:crear"],
  ["GET", "/api/cuentas-por-pagar", "proveedores:leer"],
  ["GET", "/api/cuentas-por-pagar/:id", "proveedores:leer"],
  ["POST", "/api/cuentas-por-pagar/:id/pagos", "proveedores:actualizar"],
  // ── Ventas y caja ──
  ["POST", "/api/ventas", "ventas:crear"],
  ["POST", "/api/ventas/:id/anular", "ventas:anular"],
  ["GET", "/api/ventas/:id", "ventas:leer"],
  ["POST", "/api/turnos/abrir", "caja:crear"],
  ["POST", "/api/turnos/:id/movimientos", "caja:crear"],
  ["POST", "/api/turnos/:id/cerrar", "caja:crear"],
  ["GET", "/api/turnos/actual", "caja:leer"],
  ["GET", "/api/turnos/:id/reporte", "caja:leer"],
  // ── Restaurante ──
  ["POST", "/api/mesas", "configuracion:actualizar"],
  ["PATCH", "/api/mesas/:id", "configuracion:actualizar"],
  ["GET", "/api/mesas", "restaurante:leer"],
  ["GET", "/api/comandas", "restaurante:leer"],
  ["GET", "/api/comandas/:id", "restaurante:leer"],
  ["GET", "/api/comandas/:id/pre-cuenta", "restaurante:leer"],
  ["GET", "/api/cocina/pendientes", "restaurante:leer"],
  ["POST", "/api/comandas", "restaurante:crear"],
  ["POST", "/api/comandas/:id/items", "restaurante:crear"],
  ["POST", "/api/mesas/:id/estado", "restaurante:actualizar"],
  ["POST", "/api/comandas/:id/items/:itemId/cancelar", "restaurante:actualizar"],
  ["POST", "/api/comandas/:id/items/:itemId/estado", "restaurante:actualizar"],
  ["POST", "/api/comandas/:id/enviar", "restaurante:actualizar"],
  ["POST", "/api/comandas/:id/mover", "restaurante:actualizar"],
  ["POST", "/api/comandas/:id/unir", "restaurante:actualizar"],
  ["POST", "/api/comandas/:id/cobrar", "ventas:crear"], // además el servicio exige restaurante:actualizar
  ["POST", "/api/comandas/:id/anular", "restaurante:anular"],
  // ── Comprobantes electrónicos SRI ──
  ["GET", "/api/comprobantes", "sri:leer"],
  ["GET", "/api/comprobantes/:id", "sri:leer"],
  ["POST", "/api/ventas/:id/comprobante", "sri:crear"],
  ["POST", "/api/comprobantes/:id/firmar", "sri:crear"],
  ["POST", "/api/compras/:id/retencion", "sri:crear"],
  ["POST", "/api/compras/:id/liquidacion", "sri:crear"],
  ["POST", "/api/guias-remision", "sri:crear"],
  ["GET", "/api/reportes/ats", "reportes:exportar"],
  ["GET", "/api/comprobantes/:id/ride", "sri:leer"],
  ["GET", "/api/impresora", "caja:leer"],
  ["PUT", "/api/impresora", "configuracion:actualizar"],
  ["POST", "/api/impresora/probar", "caja:crear"],
  ["POST", "/api/impresora/gaveta", "caja:crear"],
  ["POST", "/api/ventas/:id/imprimir", "caja:crear"],
  ["POST", "/api/turnos/:id/imprimir", "caja:crear"],
  ["GET", "/api/escaneo/:codigo", "ventas:crear"],
  ["GET", "/api/balanza", "caja:leer"],
  ["PUT", "/api/balanza", "configuracion:actualizar"],
  ["GET", "/api/balanza/peso", "ventas:crear"],
  ["GET", "/api/sync/cajas", "caja:leer"],
  ["GET", "/api/puntos-emision", "caja:leer"],
  ["POST", "/api/clientes", "clientes:crear"],
  ["PATCH", "/api/clientes/:id", "clientes:actualizar"],
  ["GET", "/api/proveedores", "proveedores:leer"],
  ["POST", "/api/proveedores", "proveedores:crear"],
  ["PATCH", "/api/proveedores/:id", "proveedores:actualizar"],
  ["GET", "/api/ventas", "ventas:leer"],
  ["GET", "/api/compras", "inventario:leer"],
  ["GET", "/api/catalogos", "inventario:leer"],
  ["GET", "/api/reportes/:tipo", "reportes:leer"],
  ["GET", "/api/sri/cola", "sri:leer"],
  ["POST", "/api/comprobantes/:id/reintentar", "sri:crear"],
  // ── Certificado digital de firma (.p12) ──
  ["GET", "/api/configuracion/certificado", "configuracion:leer"],
  ["PUT", "/api/configuracion/certificado", "configuracion:actualizar"],
  ["DELETE", "/api/configuracion/certificado", "configuracion:actualizar"],
  ["POST", "/api/configuracion/certificado/rotar-clave", "configuracion:actualizar"],
];

/** Permisos esperados por rol (fijados a mano: un cambio en el seed debe ser una decisión consciente). */
const PERMISOS_ROL: Record<string, string[]> = {
  CAJERO: ["caja:crear", "caja:leer", "clientes:crear", "clientes:leer", "inventario:leer", "restaurante:actualizar", "restaurante:crear", "restaurante:leer", "ventas:crear", "ventas:leer"],
  MESERO: ["clientes:leer", "inventario:leer", "restaurante:actualizar", "restaurante:crear", "restaurante:leer"],
  COCINA: ["restaurante:actualizar", "restaurante:leer"],
  CONTADOR: ["reportes:actualizar", "reportes:anular", "reportes:crear", "reportes:eliminar", "reportes:exportar", "reportes:leer", "sri:exportar", "sri:leer", "ventas:exportar", "ventas:leer"],
  BODEGUERO: ["inventario:actualizar", "inventario:anular", "inventario:crear", "inventario:eliminar", "inventario:exportar", "inventario:leer", "proveedores:actualizar", "proveedores:anular", "proveedores:crear", "proveedores:exportar", "proveedores:leer"],
};

const ROLES = ["ADMIN", "SUPERVISOR", "CAJERO", "BODEGUERO", "CONTADOR", "MESERO", "COCINA"] as const;

let env: Entorno;
const tokens: Record<string, string> = {};
const permisos: Record<string, string[]> = {};

const concreta = (patron: string): string => patron.replace(/:[A-Za-z]+/g, "x");

/** Error de dominio del cuerpo de la respuesta (algunas rutas responden 204 sin cuerpo). */
const errorDe = (cuerpo: string): string | undefined => {
  try {
    return (JSON.parse(cuerpo) as { error?: string }).error;
  } catch {
    return undefined;
  }
};

/** `logout` revoca la sesión: se prueba aparte para no invalidar el token en medio de los recorridos. */
const RUTAS_RECORRIDO = RUTAS.filter(([, url]) => url !== "/api/auth/logout");

beforeAll(async () => {
  env = await crearEntorno();
  // Todos los módulos activos: así un 403 solo puede venir del RBAC, nunca de un feature flag
  await configurarGiro(env, { moduloLotes: true, moduloVencimientos: true, moduloListasPrecios: true, moduloMesas: true, moduloComandasCocina: true });

  const login = async (username: string, password: string, rol: string): Promise<void> => {
    const r = await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
    const cuerpo = r.json() as { token: string; usuario: { permisos: string[]; rol: string } };
    expect(cuerpo.usuario.rol).toBe(rol);
    tokens[rol] = cuerpo.token;
    permisos[rol] = [...cuerpo.usuario.permisos].sort();
  };
  await login("admin", PASSWORD_ADMIN, "ADMIN");
  for (const rol of ROLES.filter((r) => r !== "ADMIN")) {
    await env.servicios.usuarios.crear({
      empresaId: env.seed.empresaId, rol, username: `rbac.${rol.toLowerCase()}`, password: "Clave12345", nombre: rol, apellido: "Rbac",
    });
    await login(`rbac.${rol.toLowerCase()}`, "Clave12345", rol);
  }
}, 60_000);

afterAll(async () => {
  await env.cerrar();
});

describe("Cobertura de la matriz", () => {
  it("la tabla contiene exactamente las rutas registradas en el servidor (ni una más, ni una menos)", async () => {
    const f = Fastify();
    f.decorateRequest("usuario", null);
    f.decorateRequest("token", null);
    const registradas = new Set<string>();
    f.addHook("onRoute", (r) => {
      for (const m of Array.isArray(r.method) ? r.method : [r.method]) {
        if (m !== "HEAD" && m !== "OPTIONS") registradas.add(`${m} ${r.url}`);
      }
    });
    registrarRutas(f, env.servicios);
    await f.ready();
    await f.close();

    const tabla = new Set(RUTAS.map(([m, u]) => `${m} ${u}`));
    expect([...registradas].filter((r) => !tabla.has(r)).sort(), "rutas registradas sin cobertura RBAC").toEqual([]);
    expect([...tabla].filter((r) => !registradas.has(r)).sort(), "rutas de la tabla que ya no existen").toEqual([]);
    expect(tabla.size).toBe(RUTAS.length); // sin duplicados
  });

  it("todo requisito de la tabla es un permiso que existe en el sistema", async () => {
    const existentes = new Set((await env.prisma.permiso.findMany()).map((p) => `${p.modulo}:${p.accion}`));
    for (const [, url, req] of RUTAS) {
      if (req === "publica" || req === "sesion") continue;
      expect(existentes.has(req), `${url} exige el permiso inexistente ${req}`).toBe(true);
    }
  });
});

describe("Permisos por rol (fijados explícitamente)", () => {
  for (const [rol, esperados] of Object.entries(PERMISOS_ROL)) {
    it(`${rol} tiene exactamente sus ${esperados.length} permisos`, () => {
      expect(permisos[rol]).toEqual([...esperados].sort());
    });
  }

  it("ADMIN lo tiene todo (60 permisos)", () => {
    expect(permisos["ADMIN"]).toHaveLength(60);
  });

  it("SUPERVISOR: opera y anula, pero no administra usuarios ni configuración y no elimina", () => {
    const p = permisos["SUPERVISOR"] as string[];
    expect(p.some((x) => x.startsWith("usuarios:") || x.startsWith("configuracion:") || x.endsWith(":eliminar"))).toBe(false);
    for (const necesario of ["ventas:anular", "restaurante:anular", "caja:actualizar", "ventas:actualizar", "inventario:actualizar"]) expect(p).toContain(necesario);
  });

  it("privilegios sensibles: solo el supervisor/administrador anula, ajusta precios o cierra turnos ajenos", () => {
    const quienTiene = (permiso: string): string[] => ROLES.filter((r) => (permisos[r] as string[]).includes(permiso));
    expect(quienTiene("ventas:anular")).toEqual(["ADMIN", "SUPERVISOR"]);
    expect(quienTiene("ventas:actualizar")).toEqual(["ADMIN", "SUPERVISOR"]); // modificar precios
    expect(quienTiene("caja:actualizar")).toEqual(["ADMIN", "SUPERVISOR"]); // ver/cerrar turnos ajenos
    expect(quienTiene("restaurante:anular")).toEqual(["ADMIN", "SUPERVISOR"]); // cancelar ítems enviados / anular cuentas
    expect(quienTiene("configuracion:actualizar")).toEqual(["ADMIN"]); // plano de mesas, ajustes
    expect(quienTiene("usuarios:crear")).toEqual(["ADMIN"]);
  });
});

describe("Matriz ruta × rol", () => {
  it("sin sesión, o con un token inválido, toda ruta protegida responde 401", async () => {
    for (const [metodo, patron, req] of RUTAS) {
      if (req === "publica") continue;
      for (const headers of [undefined, { authorization: "Bearer token-falso" }, { authorization: "Basic abc" }]) {
        const r = await env.backend.server.inject({ method: metodo, url: concreta(patron), ...(headers !== undefined ? { headers } : {}), ...(metodo !== "GET" && metodo !== "DELETE" ? { payload: {} } : {}) });
        expect(r.statusCode, `${metodo} ${patron} sin credenciales válidas`).toBe(401);
      }
    }
  });

  it("las rutas públicas no exigen sesión", async () => {
    expect((await env.backend.server.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    expect((await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: {} })).statusCode).toBe(400);
  });

  for (const rol of ROLES) {
    it(`${rol}: 403 SIN_PERMISO exactamente donde falta el permiso; nunca 401 ni 5xx`, async () => {
      const tiene = new Set(permisos[rol]);
      const fallos: string[] = [];
      let denegadas = 0;
      let permitidas = 0;

      for (const [metodo, patron, req] of RUTAS_RECORRIDO) {
        const r = await env.backend.server.inject({
          method: metodo,
          url: concreta(patron),
          headers: { authorization: `Bearer ${tokens[rol]}` },
          ...(metodo !== "GET" && metodo !== "DELETE" ? { payload: {} } : {}),
        });
        const error = errorDe(r.body);
        const debeDenegar = req !== "publica" && req !== "sesion" && !tiene.has(req);

        if (debeDenegar) {
          denegadas += 1;
          if (r.statusCode !== 403 || error !== "SIN_PERMISO") fallos.push(`${metodo} ${patron}: debía ser 403 SIN_PERMISO y fue ${r.statusCode} ${error ?? ""}`);
        } else {
          permitidas += 1;
          if (r.statusCode === 401) fallos.push(`${metodo} ${patron}: 401 con sesión válida`);
          if (error === "SIN_PERMISO") fallos.push(`${metodo} ${patron}: SIN_PERMISO pese a tener ${req}`);
          if (error === "MODULO_DESHABILITADO") fallos.push(`${metodo} ${patron}: módulo deshabilitado (la prueba activa todos)`);
          if (r.statusCode >= 500) fallos.push(`${metodo} ${patron}: error interno ${r.statusCode}`);
        }
      }
      expect(fallos).toEqual([]);
      expect(denegadas + permitidas).toBe(RUTAS_RECORRIDO.length);
      // el rol sin privilegios totales debe tener algo denegado, y todos algo permitido
      if (rol !== "ADMIN") expect(denegadas).toBeGreaterThan(0);
      expect(permitidas).toBeGreaterThan(0);
    });
  }

  it("logout revoca la sesión: el mismo token deja de funcionar", async () => {
    const login = await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username: "rbac.cajero", password: "Clave12345" } });
    const token = (login.json() as { token: string }).token;
    const con = { authorization: `Bearer ${token}` };
    expect((await env.backend.server.inject({ method: "GET", url: "/api/auth/me", headers: con })).statusCode).toBe(200);
    expect((await env.backend.server.inject({ method: "POST", url: "/api/auth/logout", headers: con })).statusCode).toBe(204);
    expect((await env.backend.server.inject({ method: "GET", url: "/api/auth/me", headers: con })).statusCode).toBe(401);
  });

  it("el ADMIN accede a todas las rutas protegidas (ninguna 403)", async () => {
    for (const [metodo, patron] of RUTAS_RECORRIDO) {
      const r = await env.backend.server.inject({
        method: metodo, url: concreta(patron), headers: { authorization: `Bearer ${tokens["ADMIN"]}` },
        ...(metodo !== "GET" && metodo !== "DELETE" ? { payload: {} } : {}),
      });
      expect(r.statusCode, `${metodo} ${patron}`).not.toBe(403);
    }
  });
});

describe("Permisos a nivel de servicio (más allá de la ruta)", () => {
  it("cobrar una cuenta exige además restaurante:actualizar, aunque se tenga ventas:crear", async () => {
    // Un rol hipotético con ventas:crear pero sin restaurante:actualizar → el servicio lo rechaza
    const actor = { id: env.seed.adminId, empresaId: env.seed.empresaId, permisos: ["ventas:crear"] };
    await expect(
      env.servicios.comandas.cobrar("x", { puntoEmisionId: env.seed.puntoEmisionId, pagos: [{ formaPago: "EFECTIVO", monto: 1 }] }, actor)
    ).rejects.toMatchObject({ codigo: "SIN_PERMISO" });
  });

  it("cancelar un ítem enviado y anular cuentas exigen restaurante:anular", async () => {
    const actor = { id: env.seed.adminId, empresaId: env.seed.empresaId, permisos: ["restaurante:actualizar"] };
    await expect(env.servicios.comandas.anular("x", { motivo: "Sin autorización" }, actor)).rejects.toMatchObject({ codigo: "SIN_PERMISO" });
  });
});
