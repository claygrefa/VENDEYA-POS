// ============================================================
// tests/integration/server/envio-sri.test.ts
// Envío de comprobantes al SRI (recepción + autorización) y worker de la cola, contra un SRI SIMULADO local.
// Cubre cada estado de respuesta, fallos de red con reintento, recuperación tras un cierre, idempotencia y la API.
// ============================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Cliente, Producto } from "@prisma/client";
import { SriWorker } from "../../../src/server/jobs/sriWorker.job";
import { ColaSriRepository } from "../../../src/server/repositories/colaSri.repository";
import { EnvioSriService, esperaReintentoMs } from "../../../src/server/services/sri/envioSri.service";
import { SriSoapClient } from "../../../src/server/services/sri/ws/sriSoap.client";
import { verificarFirmaXades } from "../../../src/server/services/sri/firma/xades.firma";
import type { ActorCaja } from "../../../src/server/services/turno.service";
import { generarP12Prueba } from "../../helpers/certificados.helper";
import { iniciarSriSimulado, respuestaAutorizacion, respuestaRecepcion, soapFault, type SriSimulado } from "../../helpers/sriSimulado.helper";
import { abrirTurno, codigoError, crearActor, crearEntorno, crearProducto, PASSWORD_ADMIN, type Entorno } from "../helpers/entorno.helper";
import { verificarInvariantes } from "../helpers/invariantes.helper";

const RUC = "9999999999001";
const BASE = Date.now();
let desfaseMs = 0;
const reloj = (): Date => new Date(BASE + desfaseMs);
const avanzar = (ms: number): void => {
  desfaseMs += ms;
};

let env: Entorno;
let sri: SriSimulado;
let admin: ActorCaja;
let supervisor: ActorCaja;
let cajero: ActorCaja;
let producto: Producto;
let cliente: Cliente;

const nuevaFactura = async (): Promise<string> => {
  const v = await env.servicios.ventas.crear(
    { puntoEmisionId: env.seed.puntoEmisionId, lineas: [{ productoId: producto.id, cantidad: 1 }], pagos: [{ formaPago: "EFECTIVO", monto: 12 }], emitirFactura: true, clienteId: cliente.id },
    cajero
  );
  return (await env.prisma.comprobanteElectronico.findUniqueOrThrow({ where: { ventaId: v.id } })).id;
};
const leer = (id: string) => env.prisma.comprobanteElectronico.findUniqueOrThrow({ where: { id }, include: { colaSRI: true } });
const cargarCertificado = () => {
  const p12 = generarP12Prueba({ identificacion: RUC, password: "Clave-P12-1" });
  return env.servicios.certificados.guardar({ archivoBase64: p12.archivo.toString("base64"), password: p12.password }, admin);
};
/** Deja la cola vacía (para pruebas que cuentan lo que se envía). */
const vaciarCola = async (): Promise<void> => {
  await env.prisma.colaSRI.deleteMany({});
  await env.prisma.comprobanteElectronico.updateMany({ where: { estado: { in: ["PENDIENTE", "EN_PROCESO"] } }, data: { estado: "ANULADO", proximoIntento: null } });
};
const esperar = async (cond: () => Promise<boolean>, ms = 10_000): Promise<void> => {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("Condición no cumplida a tiempo");
};

beforeAll(async () => {
  sri = await iniciarSriSimulado();
  env = await crearEntorno({ sri: { soap: { timeoutMs: 400, endpoints: { "1": sri.endpoints, "2": sri.endpoints } }, envio: { ahora: reloj } } });
  admin = await crearActor(env, "ADMIN", "sri.admin");
  supervisor = await crearActor(env, "SUPERVISOR", "sri.super");
  cajero = await crearActor(env, "CAJERO", "sri.caja");
  await abrirTurno(env, cajero.id);
  producto = await crearProducto(env, { codigo: "SRI1", precioVenta: 10, stock: 2000, costo: 4 });
  cliente = await env.servicios.clientes.crear({ tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "Juan Pérez", direccion: "Calle 1", email: "juan@correo.ec" });
  await cargarCertificado();
}, 60_000);

afterAll(async () => {
  await env.cerrar();
  await sri.cerrar();
});

beforeEach(() => sri.reiniciar());

describe("Estados de respuesta del SRI", () => {
  it("RECIBIDA + AUTORIZADO: firma sola, envía el XML firmado, guarda la autorización y saca el comprobante de la cola", async () => {
    const id = await nuevaFactura();
    const antes = await leer(id);
    expect(antes.xmlFirmado).toBeNull();
    expect(await env.servicios.envioSri.procesar(id)).toBe("AUTORIZADO");

    const c = await leer(id);
    expect(c).toMatchObject({ estado: "AUTORIZADO", numeroAutorizacion: c.claveAcceso, proximoIntento: null, colaSRI: null });
    expect(c.fechaAutorizacion?.toISOString()).toBe("2024-05-10T20:30:00.000Z");
    // lo enviado es exactamente el XML firmado guardado, con firma válida
    expect(sri.recepciones).toEqual([c.xmlFirmado]);
    expect(verificarFirmaXades(c.xmlFirmado as string).valida).toBe(true);
    expect(sri.consultas).toEqual([c.claveAcceso]);
    expect(c.xmlAutorizado).toMatch(/^<autorizacion><estado>AUTORIZADO<\/estado><numeroAutorizacion>\d{49}<\/numeroAutorizacion>/);
    expect(c.xmlAutorizado).toContain("<comprobante><![CDATA[");
    expect(c.xmlAutorizado).toContain(`<claveAcceso>${c.claveAcceso}</claveAcceso>`);
    expect(await verificarInvariantes(env)).toEqual([]);
  });

  it("si el SRI devuelve el comprobante autorizado, ese XML (el del SRI) es el que se guarda", async () => {
    const id = await nuevaFactura();
    sri.porDefectoAutorizacion = (clave) => respuestaAutorizacion(clave, [{ estado: "AUTORIZADO", numeroAutorizacion: "2005202401179001234500110010010000000019999999918", fechaAutorizacion: "2024-05-10T15:30:00-05:00", comprobante: "<factura>del SRI</factura>", mensajes: [{ identificador: "60", mensaje: "ADVERTENCIA", tipo: "ADVERTENCIA" }] }]);
    expect(await env.servicios.envioSri.procesar(id)).toBe("AUTORIZADO");
    const c = await leer(id);
    expect(c.numeroAutorizacion).toBe("2005202401179001234500110010010000000019999999918");
    expect(c.xmlAutorizado).toContain("<![CDATA[<factura>del SRI</factura>]]>");
    expect(JSON.parse(c.mensajesRespuesta as string)).toEqual([{ identificador: "60", mensaje: "ADVERTENCIA", informacionAdicional: null, tipo: "ADVERTENCIA" }]);
  });

  it("idempotencia: un comprobante autorizado no se vuelve a enviar ni consultar", async () => {
    const id = await nuevaFactura();
    await env.servicios.envioSri.procesar(id);
    sri.reiniciar();
    expect(await env.servicios.envioSri.procesar(id)).toBe("OMITIDO");
    expect(await env.servicios.envioSri.procesarCola(50)).toBeGreaterThanOrEqual(0);
    expect(sri.consultas).not.toContain((await leer(id)).claveAcceso);
    expect(await codigoError(env.servicios.envioSri.reintentar(id, supervisor))).toBe("ESTADO_INVALIDO");
  });

  it("DEVUELTA (error de estructura): queda DEVUELTO con sus mensajes, sin consultar; se puede corregir y reintentar", async () => {
    const id = await nuevaFactura();
    sri.colaRecepcion.push(respuestaRecepcion("DEVUELTA", [{ identificador: "35", mensaje: "ARCHIVO NO CUMPLE ESTRUCTURA XML", informacionAdicional: "detalle", tipo: "ERROR" }]));
    expect(await env.servicios.envioSri.procesar(id)).toBe("DEVUELTO");
    const c = await leer(id);
    expect(c).toMatchObject({ estado: "DEVUELTO", colaSRI: null, numeroAutorizacion: null, xmlAutorizado: null });
    expect(JSON.parse(c.mensajesRespuesta as string)).toEqual([{ identificador: "35", mensaje: "ARCHIVO NO CUMPLE ESTRUCTURA XML", informacionAdicional: "detalle", tipo: "ERROR" }]);
    expect(sri.consultas).toEqual([]);
    // un comprobante fuera de la cola no se reenvía solo
    expect(await env.servicios.envioSri.procesar(id)).toBe("OMITIDO");

    const r = await env.servicios.envioSri.reintentar(id, supervisor);
    expect(r).toEqual({ id, estado: "PENDIENTE" });
    const reiniciado = await leer(id);
    expect(reiniciado).toMatchObject({ estado: "PENDIENTE", xmlFirmado: null, proximoIntento: null });
    expect(reiniciado.colaSRI).toMatchObject({ intentos: 0, ultimoError: null });
    expect(await env.servicios.envioSri.procesar(id)).toBe("AUTORIZADO");
  });

  it("DEVUELTA con 43 (clave ya registrada): no es un rechazo, se consulta la autorización", async () => {
    const id = await nuevaFactura();
    sri.colaRecepcion.push(respuestaRecepcion("DEVUELTA", [{ identificador: "43", mensaje: "CLAVE ACCESO REGISTRADA", tipo: "ERROR" }]));
    expect(await env.servicios.envioSri.procesar(id)).toBe("AUTORIZADO");
    expect(sri.consultas).toHaveLength(1);
  });

  it("DEVUELTA con 70 (en procesamiento): se reintenta más tarde y sigue PENDIENTE", async () => {
    const id = await nuevaFactura();
    sri.colaRecepcion.push(respuestaRecepcion("DEVUELTA", [{ identificador: "70", mensaje: "CLAVE DE ACCESO EN PROCESAMIENTO", tipo: "ERROR" }]));
    expect(await env.servicios.envioSri.procesar(id)).toBe("REINTENTO");
    const c = await leer(id);
    expect(c.estado).toBe("PENDIENTE");
    expect(c.proximoIntento?.getTime()).toBe(reloj().getTime() + 30_000);
    expect(c.colaSRI).toMatchObject({ procesandoDesde: null, intentos: 1 });
    expect(c.colaSRI?.ultimoError).toMatch(/aún está procesando/);
    expect(sri.consultas).toEqual([]);
    avanzar(31_000);
    expect(await env.servicios.envioSri.procesar(id)).toBe("AUTORIZADO");
  });

  it("NO AUTORIZADO: queda RECHAZADO con los motivos; reintentar lo devuelve a la cola", async () => {
    const id = await nuevaFactura();
    sri.colaAutorizacion.push(respuestaAutorizacion("x", [{ estado: "NO AUTORIZADO", mensajes: [{ identificador: "39", mensaje: "FIRMA INVALIDA", informacionAdicional: "motivo", tipo: "ERROR" }] }]));
    expect(await env.servicios.envioSri.procesar(id)).toBe("RECHAZADO");
    const c = await leer(id);
    expect(c).toMatchObject({ estado: "RECHAZADO", colaSRI: null, numeroAutorizacion: null, xmlAutorizado: null });
    expect(JSON.parse(c.mensajesRespuesta as string)[0]).toMatchObject({ identificador: "39", mensaje: "FIRMA INVALIDA" });
    await env.servicios.envioSri.reintentar(id, supervisor);
    expect(await env.servicios.envioSri.procesar(id)).toBe("AUTORIZADO");
  });

  it("RECIBIDA pero aún sin autorización (lista vacía o EN PROCESAMIENTO): se reintenta; al volver, la clave ya está registrada", async () => {
    const id = await nuevaFactura();
    sri.colaAutorizacion.push(respuestaAutorizacion("x", []));
    expect(await env.servicios.envioSri.procesar(id)).toBe("REINTENTO");
    expect((await leer(id)).colaSRI?.ultimoError).toMatch(/aún no lo autoriza/);
    avanzar(31_000);
    sri.colaRecepcion.push(respuestaRecepcion("DEVUELTA", [{ identificador: "43", mensaje: "CLAVE ACCESO REGISTRADA" }]));
    sri.colaAutorizacion.push(respuestaAutorizacion("x", [{ estado: "EN PROCESAMIENTO" }]));
    expect(await env.servicios.envioSri.procesar(id)).toBe("REINTENTO");
    avanzar(61_000);
    sri.colaRecepcion.push(respuestaRecepcion("DEVUELTA", [{ identificador: "43", mensaje: "CLAVE ACCESO REGISTRADA" }]));
    expect(await env.servicios.envioSri.procesar(id)).toBe("AUTORIZADO");
    expect((await leer(id)).colaSRI).toBeNull();
  });
});

describe("Fallos de red: reintentos con espera exponencial, nunca un rechazo", () => {
  it("tiempo agotado, conexión cortada, SOAP Fault y HTTP 503 dejan el comprobante PENDIENTE con el motivo", async () => {
    for (const fallo of [{ tipo: "colgar" as const }, { tipo: "cortar" as const }, soapFault("Error interno"), { tipo: "xml" as const, status: 503, cuerpo: "<x/>" }]) {
      const id = await nuevaFactura();
      sri.colaRecepcion.push(fallo);
      expect(await env.servicios.envioSri.procesar(id)).toBe("REINTENTO");
      const c = await leer(id);
      expect(c.estado).toBe("PENDIENTE");
      expect(c.intentosEnvio).toBe(1);
      expect(c.colaSRI?.ultimoError).toMatch(/^Sin respuesta del SRI/);
      expect(c.colaSRI?.procesandoDesde).toBeNull();
      expect(c.mensajesRespuesta).toBeNull();
      expect(c.xmlFirmado).not.toBeNull(); // la firma se conserva: el reintento no vuelve a firmar
    }
  });

  it("la espera se duplica en cada intento y hasta que vence no se vuelve a enviar", async () => {
    await vaciarCola();
    const id = await nuevaFactura();
    sri.porDefectoRecepcion = { tipo: "cortar" };
    for (const [intento, espera] of [[1, 30_000], [2, 60_000], [3, 120_000]] as const) {
      expect(await env.servicios.envioSri.procesarCola(10), `intento ${intento}`).toBe(1);
      const c = await leer(id);
      expect(c.intentosEnvio).toBe(intento);
      expect(c.proximoIntento?.getTime()).toBe(reloj().getTime() + espera);
      expect(esperaReintentoMs(intento)).toBe(espera);
      // todavía no toca: la cola no lo toma
      expect(await env.servicios.envioSri.procesarCola(10)).toBe(0);
      avanzar(espera - 1);
      expect(await env.servicios.envioSri.procesarCola(10)).toBe(0);
      avanzar(2);
    }
    expect(sri.recepciones).toHaveLength(3);
    sri.porDefectoRecepcion = respuestaRecepcion("RECIBIDA");
    expect(await env.servicios.envioSri.procesarCola(10)).toBe(1);
    expect((await leer(id)).estado).toBe("AUTORIZADO");
  });

  it("un fallo al consultar la autorización también es reintentable y no repite lo ya recibido de forma incorrecta", async () => {
    const id = await nuevaFactura();
    sri.colaAutorizacion.push({ tipo: "cortar" });
    expect(await env.servicios.envioSri.procesar(id)).toBe("REINTENTO");
    expect((await leer(id)).estado).toBe("PENDIENTE");
    avanzar(31_000);
    // al reenviar, el SRI responde que la clave ya está registrada y entonces se consulta
    sri.colaRecepcion.push(respuestaRecepcion("DEVUELTA", [{ identificador: "43", mensaje: "CLAVE ACCESO REGISTRADA" }]));
    expect(await env.servicios.envioSri.procesar(id)).toBe("AUTORIZADO");
  });
});

describe("Certificado ausente o vencido", () => {
  it("sin certificado el comprobante queda PENDIENTE con un mensaje claro y no se llama al SRI; al cargarlo se envía", async () => {
    await vaciarCola();
    const id = await nuevaFactura();
    await env.servicios.certificados.eliminar(admin);
    expect(await env.servicios.envioSri.procesar(id)).toBe("REINTENTO");
    const c = await leer(id);
    expect(c).toMatchObject({ estado: "PENDIENTE", xmlFirmado: null, intentosEnvio: 1 });
    expect(c.colaSRI?.ultimoError).toMatch(/No se pudo firmar: La empresa no tiene un certificado de firma cargado/);
    expect(c.proximoIntento?.getTime()).toBe(reloj().getTime() + 30_000);
    expect(sri.recepciones).toEqual([]);

    await cargarCertificado();
    await env.servicios.envioSri.reintentar(id, supervisor); // sin esperar el backoff
    expect(await env.servicios.envioSri.procesar(id)).toBe("AUTORIZADO");
  });

  it("con el certificado vencido (el reloj avanza más allá de su vigencia) no se firma ni se envía", async () => {
    const id = await nuevaFactura();
    avanzar(5 * 365 * 86_400_000);
    try {
      expect(await env.servicios.envioSri.procesar(id)).toBe("REINTENTO");
      expect((await leer(id)).colaSRI?.ultimoError).toMatch(/No se pudo firmar: El certificado venció el/);
      expect(sri.recepciones).toEqual([]);
    } finally {
      avanzar(-5 * 365 * 86_400_000);
    }
  });
});

describe("Recuperación tras un cierre y concurrencia", () => {
  it("un comprobante EN_PROCESO que quedó a medias se libera al arrancar el worker y se envía", async () => {
    await vaciarCola();
    const id = await nuevaFactura();
    // el cierre ocurrió justo después de tomar el comprobante, antes de enviarlo
    await env.prisma.$transaction((tx) => new ColaSriRepository().reclamar(tx, id, reloj()));
    expect((await leer(id)).estado).toBe("EN_PROCESO");
    expect(await env.servicios.envioSri.procesar(id)).toBe("OMITIDO"); // mientras tanto nadie más lo toma
    expect(await env.servicios.envioSri.procesarCola(10)).toBe(0);

    const worker = new SriWorker(env.servicios.envioSri, { intervaloMs: 30 });
    await worker.iniciar();
    try {
      await esperar(async () => (await leer(id)).estado === "AUTORIZADO");
    } finally {
      await worker.detener();
    }
    expect(sri.recepciones).toHaveLength(1);
  });

  it("durante la operación solo se liberan los envíos abandonados (más viejos que el umbral), no los recientes", async () => {
    await vaciarCola();
    const fresco = await nuevaFactura();
    await env.prisma.$transaction((tx) => new ColaSriRepository().reclamar(tx, fresco, reloj()));
    expect(await env.servicios.envioSri.recuperarEnProceso(10 * 60_000)).toBe(0);
    expect((await leer(fresco)).estado).toBe("EN_PROCESO");
    avanzar(11 * 60_000);
    expect(await env.servicios.envioSri.recuperarEnProceso(10 * 60_000)).toBe(1);
    expect(await leer(fresco)).toMatchObject({ estado: "PENDIENTE" });
    expect(await env.servicios.envioSri.procesar(fresco)).toBe("AUTORIZADO");
  });

  it("dos procesos sobre el mismo comprobante: solo uno lo envía", async () => {
    const id = await nuevaFactura();
    const [a, b] = await Promise.all([env.servicios.envioSri.procesar(id), env.servicios.envioSri.procesar(id)]);
    expect([a, b].sort()).toEqual(["AUTORIZADO", "OMITIDO"]);
    expect(sri.recepciones).toHaveLength(1);
  });

  it("se envía en orden cronológico por fecha de emisión", async () => {
    await vaciarCola();
    const ids = [await nuevaFactura(), await nuevaFactura(), await nuevaFactura()];
    const fechas = [new Date(BASE - 1_000), new Date(BASE - 3_000), new Date(BASE - 2_000)];
    for (const [i, id] of ids.entries()) await env.prisma.comprobanteElectronico.update({ where: { id }, data: { fechaEmision: fechas[i] as Date } });
    expect(await env.servicios.envioSri.procesarCola(10)).toBe(3);
    const claves = await Promise.all(ids.map(async (id) => (await leer(id)).claveAcceso));
    // consultas en el orden de las fechas: el 2.º creado (más antiguo), luego el 3.º y por último el 1.º
    expect(sri.consultas).toEqual([claves[1], claves[2], claves[0]]);
  });
});

describe("Worker en segundo plano", () => {
  it("no está activo si no se pide, y procesa la cola sin intervención cuando se activa", async () => {
    expect(env.backend.worker).toBeNull();
    await vaciarCola();
    const worker = new SriWorker(env.servicios.envioSri, { intervaloMs: 30 });
    await worker.iniciar();
    expect(worker.corriendo).toBe(true);
    try {
      const id = await nuevaFactura();
      await esperar(async () => (await leer(id)).estado === "AUTORIZADO");
      // un reintento manual despierta al worker
      sri.colaAutorizacion.push(respuestaAutorizacion("x", [{ estado: "NO AUTORIZADO", mensajes: [{ identificador: "39", mensaje: "X" }] }]));
      const otro = await nuevaFactura();
      await esperar(async () => (await leer(otro)).estado === "RECHAZADO");
      await env.servicios.envioSri.reintentar(otro, supervisor);
      await esperar(async () => (await leer(otro)).estado === "AUTORIZADO");
    } finally {
      await worker.detener();
    }
    expect(worker.corriendo).toBe(false);
    const llamadas = sri.recepciones.length;
    await nuevaFactura();
    await new Promise((r) => setTimeout(r, 150));
    expect(sri.recepciones).toHaveLength(llamadas); // detenido: no envía más
  });

  it("un SRI que no responde NO retrasa las ventas ni la emisión de facturas", async () => {
    await vaciarCola();
    sri.porDefectoRecepcion = { tipo: "colgar" };
    // Worker con una espera larga (8 s): mientras espera al SRI, las ventas siguen su curso
    const lento = new EnvioSriService(env.prisma, new ColaSriRepository(), env.servicios.firma, new SriSoapClient({ timeoutMs: 8_000, endpoints: { "1": sri.endpoints } }), { ahora: reloj });
    const worker = new SriWorker(lento, { intervaloMs: 20 });
    await worker.iniciar();
    try {
      const primera = await nuevaFactura();
      await esperar(async () => sri.recepciones.length >= 1);
      expect((await leer(primera)).estado).toBe("EN_PROCESO"); // el worker sigue esperando al SRI
      const t0 = Date.now();
      const id = await nuevaFactura();
      expect(Date.now() - t0).toBeLessThan(6_000);
      expect((await leer(id)).estado).toBe("PENDIENTE");
      expect((await leer(primera)).estado).toBe("EN_PROCESO"); // la venta terminó antes de que el SRI respondiera
    } finally {
      await worker.detener();
    }
  });

  it("un error inesperado en un ciclo se informa y el worker sigue vivo", async () => {
    let ciclos = 0;
    const errores: unknown[] = [];
    const falso = {
      alHaberTrabajo: () => undefined,
      recuperarEnProceso: async () => 0,
      procesarCola: async () => {
        ciclos += 1;
        throw new Error("fallo inesperado");
      },
    } as unknown as EnvioSriService;
    const worker = new SriWorker(falso, { intervaloMs: 10, alError: (e) => errores.push(e) });
    await worker.iniciar();
    await esperar(async () => ciclos >= 3);
    await worker.detener();
    expect(errores.length).toBeGreaterThanOrEqual(3);
    expect((errores[0] as Error).message).toBe("fallo inesperado");
  });
});

describe("API de la cola del SRI", () => {
  const tokens: Record<string, string> = {};
  const api = (method: "GET" | "POST", url: string, quien: string) =>
    env.backend.server.inject({ method, url, headers: { authorization: `Bearer ${tokens[quien]}` }, ...(method === "POST" ? { payload: {} } : {}) });

  beforeAll(async () => {
    const login = async (username: string, password: string): Promise<void> => {
      const r = await env.backend.server.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
      tokens[username] = (r.json() as { token: string }).token;
    };
    await login("admin", PASSWORD_ADMIN);
    for (const [rol, username] of [["SUPERVISOR", "cola.super"], ["CONTADOR", "cola.conta"], ["CAJERO", "cola.caja"]] as const) {
      await env.servicios.usuarios.crear({ empresaId: env.seed.empresaId, rol, username, password: "Clave12345", nombre: username, apellido: "Api" });
      await login(username, "Clave12345");
    }
  });

  it("GET /sri/cola: contador y supervisor ven el estado; el cajero no", async () => {
    await vaciarCola();
    const id = await nuevaFactura();
    sri.porDefectoRecepcion = { tipo: "cortar" };
    await env.servicios.envioSri.procesar(id);
    for (const quien of ["cola.conta", "cola.super"]) {
      const r = await api("GET", "/api/sri/cola", quien);
      expect(r.statusCode).toBe(200);
      const cuerpo = r.json<{ porEstado: Record<string, number>; pendientes: Array<{ id: string; intentos: number; ultimoError: string; estado: string; proximoIntento: string }> }>();
      expect(cuerpo.porEstado["AUTORIZADO"]).toBeGreaterThan(0);
      expect(cuerpo.pendientes).toHaveLength(1);
      expect(cuerpo.pendientes[0]).toMatchObject({ id, intentos: 1, estado: "PENDIENTE" });
      expect(cuerpo.pendientes[0]?.ultimoError).toMatch(/Sin respuesta del SRI/);
      expect(r.body).not.toContain("<factura"); // sin XML
    }
    expect((await api("GET", "/api/sri/cola", "cola.caja")).statusCode).toBe(403);
  });

  it("POST /comprobantes/:id/reintentar: supervisor sí; contador y cajero no; 404 y 409 con sus códigos", async () => {
    const id = await nuevaFactura();
    sri.colaRecepcion.push(respuestaRecepcion("DEVUELTA", [{ identificador: "35", mensaje: "ESTRUCTURA" }]));
    await env.servicios.envioSri.procesar(id);
    expect((await leer(id)).estado).toBe("DEVUELTO");

    for (const quien of ["cola.conta", "cola.caja"]) expect((await api("POST", `/api/comprobantes/${id}/reintentar`, quien)).statusCode).toBe(403);
    const ok = await api("POST", `/api/comprobantes/${id}/reintentar`, "cola.super");
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ id, estado: "PENDIENTE" });
    expect((await leer(id)).colaSRI).not.toBeNull();

    expect((await api("POST", "/api/comprobantes/no-existe/reintentar", "cola.super")).statusCode).toBe(404);
    await env.servicios.envioSri.procesar(id);
    expect((await leer(id)).estado).toBe("AUTORIZADO");
    const conflicto = await api("POST", `/api/comprobantes/${id}/reintentar`, "cola.super");
    expect(conflicto.statusCode).toBe(409);
    expect(conflicto.json()).toMatchObject({ error: "ESTADO_INVALIDO" });
  });
});
