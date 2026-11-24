// ============================================================
// tests/integration/server/impresion.test.ts
// Impresora térmica (ticket, gaveta, arqueo) y RIDE en PDF sobre ventas y comprobantes reales. El transporte de la
// impresora se sustituye por uno en memoria: nunca se toca un dispositivo ni la red.
// ============================================================
import iconv from "iconv-lite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Cliente, Producto } from "@prisma/client";
import { construirXmlAutorizado } from "../../../src/server/services/sri/envioSri.service";
import { ImpresoraError, type TransporteImpresora } from "../../../src/server/services/hardware/transporteImpresora";
import type { ConfiguracionImpresora } from "../../../src/server/services/hardware/impresion.service";
import type { ActorCaja } from "../../../src/server/services/turno.service";
import { textoDePdf, textoPlanoDePdf } from "../../helpers/pdf.helper";
import { abrirTurno, codigoError, crearActor, crearEntorno, crearProducto, PASSWORD_ADMIN, type Entorno } from "../helpers/entorno.helper";

const PULSO = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);

let env: Entorno;
let admin: ActorCaja;
let cajero: ActorCaja;
let supervisor: ActorCaja;
let turnoId: string;
let producto: Producto;
let cliente: Cliente;

/** Lo que "recibió" la impresora y cómo se comporta. */
const impresora = {
  enviados: [] as Buffer[],
  modo: "ok" as "ok" | "falla" | "colgada",
  configuraciones: [] as ConfiguracionImpresora[],
  errores: [] as unknown[],
};
const transporte = (cfg: ConfiguracionImpresora): TransporteImpresora => {
  impresora.configuraciones.push(cfg);
  return {
    enviar: (datos) => {
      if (impresora.modo === "falla") return Promise.reject(new ImpresoraError("Impresora sin papel"));
      if (impresora.modo === "colgada") return new Promise<void>(() => undefined);
      impresora.enviados.push(datos);
      return Promise.resolve();
    },
  };
};
const texto = (b: Buffer): string => iconv.decode(b, "cp858");
const esperar = async (cond: () => boolean, ms = 5_000): Promise<void> => {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("Condición no cumplida a tiempo");
};
const configurarGiro = (datos: Record<string, unknown>) => env.prisma.configuracionGiro.update({ where: { empresaId: env.seed.empresaId }, data: datos });
const vender = (pagos: unknown[], extra: Record<string, unknown> = {}) =>
  env.servicios.ventas.crear({ puntoEmisionId: env.seed.puntoEmisionId, lineas: [{ productoId: producto.id, cantidad: 2 }], pagos, ...extra }, cajero);

beforeAll(async () => {
  env = await crearEntorno({ impresion: { fabricaTransporte: transporte, alError: (e) => impresora.errores.push(e) }, ride: { comprimir: false } });
  admin = await crearActor(env, "ADMIN", "imp.admin");
  cajero = await crearActor(env, "CAJERO", "imp.caja");
  supervisor = await crearActor(env, "SUPERVISOR", "imp.super");
  turnoId = (await abrirTurno(env, cajero.id)).id;
  producto = await crearProducto(env, { codigo: "TK1", precioVenta: 10, stock: 1000, costo: 4 });
  cliente = await env.servicios.clientes.crear({ tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "Juan Pérez", direccion: "Calle 1", email: "juan@correo.ec" });
}, 60_000);

afterAll(async () => {
  await env.cerrar();
});

beforeEach(() => {
  impresora.enviados.length = 0;
  impresora.configuraciones.length = 0;
  impresora.errores.length = 0;
  impresora.modo = "ok";
});

describe("Configuración", () => {
  it("por defecto no hay impresora: una venta no imprime y las acciones manuales avisan", async () => {
    expect(await env.servicios.impresion.obtenerConfiguracion(admin)).toMatchObject({ conexion: "NINGUNA", direccion: null, puerto: 9100, ancho: 80, impresionTermica: true, aperturaGaveta: true });
    const v = await vender([{ formaPago: "EFECTIVO", monto: 30 }]);
    expect(await env.servicios.impresion.alCobrar(v.id, cajero)).toBe(false);
    expect(impresora.enviados).toEqual([]);
    expect(await codigoError(env.servicios.impresion.probar(cajero))).toBe("ESTADO_INVALIDO");
    expect(await codigoError(env.servicios.impresion.reimprimirVenta(v.id, cajero))).toBe("ESTADO_INVALIDO");
  });

  it("se valida: sin dirección no se acepta RED/SISTEMA, ancho solo 58 u 80, puerto válido", async () => {
    expect(await codigoError(env.servicios.impresion.configurar({ conexion: "RED" }, admin))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.impresion.configurar({ conexion: "SISTEMA" }, admin))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.impresion.configurar({ conexion: "RED", direccion: "192.168.1.50", ancho: 70 }, admin))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.impresion.configurar({ conexion: "RED", direccion: "192.168.1.50", puerto: 70000 }, admin))).toBe("VALIDACION");
    expect(await codigoError(env.servicios.impresion.configurar({ conexion: "USB", direccion: "x" }, admin))).toBe("VALIDACION");
    expect((await env.servicios.impresion.obtenerConfiguracion(admin)).conexion).toBe("NINGUNA");
  });

  it("guarda la configuración y la devuelve; NINGUNA borra la dirección", async () => {
    const c = await env.servicios.impresion.configurar({ conexion: "RED", direccion: "192.168.1.50", puerto: 9100, ancho: 58 }, admin);
    expect(c).toMatchObject({ conexion: "RED", direccion: "192.168.1.50", puerto: 9100, ancho: 58 });
    const apagada = await env.servicios.impresion.configurar({ conexion: "NINGUNA", direccion: "se descarta" }, admin);
    expect(apagada).toMatchObject({ conexion: "NINGUNA", direccion: null });
    await env.servicios.impresion.configurar({ conexion: "RED", direccion: "192.168.1.50", ancho: 80 }, admin);
  });
});

describe("Al cobrar", () => {
  it("una venta en efectivo imprime el ticket y abre la gaveta", async () => {
    const v = await vender([{ formaPago: "EFECTIVO", monto: 30 }], { clienteId: cliente.id });
    expect(await env.servicios.impresion.alCobrar(v.id, cajero)).toBe(true);
    expect(impresora.enviados).toHaveLength(1);
    const bytes = impresora.enviados[0] as Buffer;
    const t = texto(bytes);
    expect(t).toContain(`Venta: ${v.numero}`);
    expect(t).toContain("Cliente: Juan Pérez");
    expect(t).toContain(`$ ${v.total.toFixed(2)}`);
    expect(t).toContain("Efectivo");
    expect(t).toContain("Cambio");
    expect(bytes.subarray(bytes.length - PULSO.length).equals(PULSO)).toBe(true);
    expect(impresora.configuraciones[0]).toMatchObject({ conexion: "RED", ancho: 80 });
  });

  it("pago solo con tarjeta: imprime pero NO abre la gaveta", async () => {
    const v = await vender([{ formaPago: "TARJETA_CREDITO", monto: 23 }]);
    expect(await env.servicios.impresion.alCobrar(v.id, cajero)).toBe(true);
    expect((impresora.enviados[0] as Buffer).includes(PULSO)).toBe(false);
  });

  it("pago mixto con efectivo abre la gaveta; con la apertura desactivada o sin impresión térmica no", async () => {
    const v = await vender([{ formaPago: "TARJETA_DEBITO", monto: 10 }, { formaPago: "EFECTIVO", monto: 13 }]);
    await env.servicios.impresion.alCobrar(v.id, cajero);
    expect((impresora.enviados[0] as Buffer).includes(PULSO)).toBe(true);

    await configurarGiro({ aperturaGaveta: false });
    await env.servicios.impresion.alCobrar(v.id, cajero);
    expect((impresora.enviados[1] as Buffer).includes(PULSO)).toBe(false);

    await configurarGiro({ aperturaGaveta: true, impresionTermica: false });
    expect(await env.servicios.impresion.alCobrar(v.id, cajero)).toBe(false);
    expect(impresora.enviados).toHaveLength(2);
    await configurarGiro({ impresionTermica: true });
  });

  it("papel de 58 mm: el ticket se arma a 32 columnas", async () => {
    await env.servicios.impresion.configurar({ conexion: "RED", direccion: "192.168.1.50", ancho: 58 }, admin);
    const v = await vender([{ formaPago: "EFECTIVO", monto: 30 }]);
    await env.servicios.impresion.alCobrar(v.id, cajero);
    const lineas = texto(impresora.enviados[0] as Buffer).split("\n").map((l) => l.replace(/[\u0000-\u001f\u007f]+[@a-zA-Z0-9!]?/g, ""));
    expect(lineas.some((l) => l === "-".repeat(32))).toBe(true);
    expect(lineas.some((l) => l.length > 32)).toBe(false);
    await env.servicios.impresion.configurar({ conexion: "RED", direccion: "192.168.1.50", ancho: 80 }, admin);
  });

  it("la factura electrónica de la venta sale con su clave de acceso y su QR", async () => {
    const v = await vender([{ formaPago: "EFECTIVO", monto: 30 }], { clienteId: cliente.id, emitirFactura: true });
    const factura = await env.prisma.comprobanteElectronico.findUniqueOrThrow({ where: { ventaId: v.id } });
    await env.servicios.impresion.alCobrar(v.id, cajero);
    const bytes = impresora.enviados[0] as Buffer;
    expect(texto(bytes)).toContain(factura.claveAcceso);
    expect(texto(bytes)).toContain("FACTURA ELECTRONICA");
    expect(texto(bytes)).toContain("Pendiente de autorizacion del SRI");
    expect(bytes.includes(Buffer.from([0x1d, 0x28, 0x6b]))).toBe(true); // QR
  });

  it("una impresora que falla NUNCA hace fallar la venta: se informa el error y la venta queda registrada", async () => {
    impresora.modo = "falla";
    const v = await vender([{ formaPago: "EFECTIVO", monto: 30 }]);
    expect(await env.servicios.impresion.alCobrar(v.id, cajero)).toBe(false);
    expect(impresora.errores).toHaveLength(1);
    expect((impresora.errores[0] as Error).message).toBe("Impresora sin papel");
    expect((await env.prisma.venta.findUniqueOrThrow({ where: { id: v.id } })).estado).toBe("COMPLETADA");
  });
});

describe("API", () => {
  const tokens: Record<string, string> = {};
  const api = (method: "GET" | "POST" | "PUT", url: string, quien: string, payload?: unknown) =>
    env.backend.server.inject({ method, url, headers: { authorization: `Bearer ${tokens[quien]}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });

  beforeAll(async () => {
    const login = async (username: string, password: string): Promise<void> => {
      const r = await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
      tokens[username] = (r.json() as { token: string }).token;
    };
    await login("admin", PASSWORD_ADMIN);
    for (const [rol, username] of [["CAJERO", "imp.api.caja"], ["CONTADOR", "imp.api.conta"]] as const) {
      await env.servicios.usuarios.crear({ empresaId: env.seed.empresaId, rol, username, password: "Clave12345", nombre: username, apellido: "Api" });
      await login(username, "Clave12345");
    }
    const id = (await env.prisma.usuario.findUniqueOrThrow({ where: { username: "imp.api.caja" } })).id;
    await abrirTurno(env, id);
  });

  it("solo el administrador cambia la impresora; el cajero la consulta", async () => {
    expect((await api("PUT", "/api/impresora", "imp.api.caja", { conexion: "NINGUNA" })).statusCode).toBe(403);
    const ok = await api("PUT", "/api/impresora", "admin", { conexion: "RED", direccion: "10.0.0.9", ancho: 80 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ conexion: "RED", direccion: "10.0.0.9" });
    expect((await api("PUT", "/api/impresora", "admin", { conexion: "RED" })).statusCode).toBe(400);
    expect((await api("GET", "/api/impresora", "imp.api.caja")).json()).toMatchObject({ conexion: "RED", direccion: "10.0.0.9", ancho: 80 });
    expect((await api("GET", "/api/impresora", "imp.api.conta")).statusCode).toBe(403);
  });

  it("POST /ventas imprime aparte: responde 201 sin esperar a la impresora (aunque esté colgada)", async () => {
    impresora.modo = "colgada";
    const t0 = Date.now();
    const r = await api("POST", "/api/ventas", "imp.api.caja", { puntoEmisionId: env.seed.puntoEmisionId, lineas: [{ productoId: producto.id, cantidad: 1 }], pagos: [{ formaPago: "EFECTIVO", monto: 20 }] });
    expect(r.statusCode).toBe(201);
    expect(Date.now() - t0).toBeLessThan(3_000);
    await esperar(() => impresora.configuraciones.length >= 1); // sí se intentó imprimir
    expect(impresora.enviados).toEqual([]);

    impresora.modo = "ok";
    const v = await api("POST", "/api/ventas", "imp.api.caja", { puntoEmisionId: env.seed.puntoEmisionId, lineas: [{ productoId: producto.id, cantidad: 1 }], pagos: [{ formaPago: "EFECTIVO", monto: 20 }] });
    await esperar(() => impresora.enviados.length >= 1);
    expect(texto(impresora.enviados[0] as Buffer)).toContain(`Venta: ${v.json<{ numero: string }>().numero}`);
  });

  it("reimprimir: marca REIMPRESION, no abre la gaveta y avisa si la impresora falla", async () => {
    const v = await vender([{ formaPago: "EFECTIVO", monto: 30 }]);
    expect((await api("POST", `/api/ventas/${v.id}/imprimir`, "imp.api.conta")).statusCode).toBe(403);
    const ok = await api("POST", `/api/ventas/${v.id}/imprimir`, "imp.api.caja");
    expect(ok.statusCode).toBe(204);
    const bytes = impresora.enviados[0] as Buffer;
    expect(texto(bytes)).toContain("*** REIMPRESION ***");
    expect(bytes.includes(PULSO)).toBe(false);

    impresora.modo = "falla";
    const falla = await api("POST", `/api/ventas/${v.id}/imprimir`, "imp.api.caja");
    expect(falla.statusCode).toBe(409);
    expect(falla.json<{ mensaje: string }>().mensaje).toBe("Impresora sin papel");
    expect((await api("POST", "/api/ventas/no-existe/imprimir", "imp.api.caja")).statusCode).toBe(404);
  });

  it("abrir la gaveta envía solo el pulso; con la apertura desactivada responde 403", async () => {
    const r = await api("POST", "/api/impresora/gaveta", "imp.api.caja");
    expect(r.statusCode).toBe(204);
    expect(impresora.enviados[0]?.includes(PULSO)).toBe(true);
    expect(impresora.enviados[0]?.length).toBeLessThan(20);
    await configurarGiro({ aperturaGaveta: false });
    expect((await api("POST", "/api/impresora/gaveta", "imp.api.caja")).statusCode).toBe(403);
    await configurarGiro({ aperturaGaveta: true });
  });

  it("página de prueba y arqueo del turno", async () => {
    expect((await api("POST", "/api/impresora/probar", "imp.api.caja")).statusCode).toBe(204);
    expect(texto(impresora.enviados[0] as Buffer)).toContain("Prueba de impresion");
    expect(texto(impresora.enviados[0] as Buffer)).toContain("áéíóú");

    expect((await api("POST", `/api/turnos/${turnoId}/imprimir`, "imp.api.conta")).statusCode).toBe(403);
    // el turno es de otro cajero: solo un supervisor puede imprimir su arqueo
    expect((await api("POST", `/api/turnos/${turnoId}/imprimir`, "imp.api.caja")).statusCode).toBe(403);
    await env.servicios.impresion.imprimirArqueo(turnoId, cajero);
    const t = texto(impresora.enviados.at(-1) as Buffer);
    expect(t).toContain("ARQUEO DE CAJA");
    expect(t).toContain("Cajero: ");
    expect(t).not.toContain("Efectivo esperado"); // cierre ciego: el cajero no ve el esperado de su turno abierto
    await env.servicios.impresion.imprimirArqueo(turnoId, supervisor);
    expect(impresora.enviados).toHaveLength(3);
    expect(texto(impresora.enviados.at(-1) as Buffer)).toContain("Efectivo esperado"); // el supervisor sí
  });
});

describe("RIDE en PDF", () => {
  let comprobanteId = "";
  let clave = "";

  beforeAll(async () => {
    const v = await vender([{ formaPago: "EFECTIVO", monto: 30 }], { clienteId: cliente.id, emitirFactura: true });
    const c = await env.prisma.comprobanteElectronico.findUniqueOrThrow({ where: { ventaId: v.id } });
    comprobanteId = c.id;
    clave = c.claveAcceso;
    const login = await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username: "imp.api.conta", password: "Clave12345" } });
    tokenConta = (login.json() as { token: string }).token;
    const l2 = await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username: "imp.api.caja", password: "Clave12345" } });
    tokenCaja = (l2.json() as { token: string }).token;
  });
  let tokenConta = "";
  let tokenCaja = "";
  const get = (url: string, token: string) => env.backend.server.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });

  it("sin autorización: PDF con marca «sin valor tributario»", async () => {
    const r = await get(`/api/comprobantes/${comprobanteId}/ride`, tokenConta);
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("application/pdf");
    expect(r.headers["x-comprobante-autorizado"]).toBe("NO");
    expect(String(r.headers["content-disposition"])).toMatch(/^inline; filename="factura-001-001-\d{9}\.pdf"$/);
    const pdf = r.rawPayload;
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(textoPlanoDePdf(pdf)).toContain("SIN VALOR TRIBUTARIO");
    expect(textoDePdf(pdf)).toContain(clave);
  });

  it("autorizado: usa el XML autorizado, sin marca de agua, y permite descargarlo", async () => {
    const c = await env.prisma.comprobanteElectronico.findUniqueOrThrow({ where: { id: comprobanteId } });
    const autorizado = construirXmlAutorizado({ estado: "AUTORIZADO", numeroAutorizacion: clave, fechaAutorizacion: new Date("2024-05-10T20:30:15Z"), ambiente: "PRUEBAS", comprobante: null, mensajes: [] }, c.xmlGenerado as string);
    await env.prisma.comprobanteElectronico.update({ where: { id: comprobanteId }, data: { estado: "AUTORIZADO", xmlAutorizado: autorizado, numeroAutorizacion: clave } });
    const r = await get(`/api/comprobantes/${comprobanteId}/ride?descargar=1`, tokenConta);
    expect(r.headers["x-comprobante-autorizado"]).toBe("SI");
    expect(String(r.headers["content-disposition"])).toMatch(/^attachment;/);
    const t = textoPlanoDePdf(r.rawPayload);
    expect(t).not.toContain("SIN VALOR TRIBUTARIO");
    expect(t).toContain("10/05/2024 15:30:15");
    expect(textoDePdf(r.rawPayload)).toContain(clave);
  });

  it("permisos y errores: el cajero no (sin sri:leer), 404 si no existe", async () => {
    expect((await get(`/api/comprobantes/${comprobanteId}/ride`, tokenCaja)).statusCode).toBe(403);
    const r = await get("/api/comprobantes/no-existe/ride", tokenConta);
    expect(r.statusCode).toBe(404);
  });
});
