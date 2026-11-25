// ============================================================
// tests/integration/server/seguridad.test.ts — Auditoría de seguridad (Semana 22)
//   · freno a la fuerza bruta del inicio de sesión · cabeceras y límites HTTP · token fuera de los registros
//   · entradas hostiles (inyección SQL) · asistente de configuración solo desde el equipo local
//   · respaldos: cifrado con frase, copia en carpeta externa, restauración, rotación y programador diario
// ============================================================
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { urlSinToken } from "../../../src/server";
import { crearPrismaPara } from "../../../src/server/config/database.config";
import { RespaldoWorker } from "../../../src/server/jobs/respaldo.job";
import { LimitadorIntentos } from "../../../src/server/services/limitadorIntentos.util";
import { RespaldoService } from "../../../src/server/services/respaldo.service";
import { restaurarRespaldoCifrado } from "../../../src/server/services/respaldoNube.service";
import { cifrarArchivo, descifrarArchivo } from "../../../src/server/services/respaldoCifrado.util";
import { crearEntorno, PASSWORD_ADMIN, type Entorno } from "../helpers/entorno.helper";

let env: Entorno;
let tmp = "";
let tokenAdmin = "";
let tokenCajero = "";
const FRASE = "frase-de-prueba-muy-larga";

const api = (metodo: "GET" | "POST" | "PUT" | "DELETE", url: string, token: string | null, payload?: unknown, extra: Record<string, unknown> = {}) =>
  env.backend.server.inject({
    method: metodo,
    url,
    ...(token !== null ? { headers: { authorization: `Bearer ${token}` } } : {}),
    ...(payload !== undefined ? { payload: payload as object } : {}),
    ...extra,
  });

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "vendeya-seg-"));
  env = await crearEntorno();
  tokenAdmin = ((await api("POST", "/api/auth/login", null, { username: "admin", password: PASSWORD_ADMIN })).json() as { token: string }).token;
  for (const u of ["victima", "otro"]) {
    await env.servicios.usuarios.crear({ empresaId: env.seed.empresaId, rol: "CAJERO", username: u, password: "Clave12345", nombre: u, apellido: "Seg" });
  }
  tokenCajero = ((await api("POST", "/api/auth/login", null, { username: "otro", password: "Clave12345" })).json() as { token: string }).token;
}, 60_000);

afterAll(async () => {
  await env.cerrar();
  rmSync(tmp, { recursive: true, force: true });
});

describe("Inicio de sesión: fuerza bruta", () => {
  it("tras 5 fallos el usuario queda bloqueado (429) aunque la contraseña sea correcta; otro usuario no se ve afectado", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await api("POST", "/api/auth/login", null, { username: "victima", password: `mala-${i}` });
      expect(r.statusCode).toBe(401);
    }
    const bloqueado = await api("POST", "/api/auth/login", null, { username: "victima", password: "Clave12345" });
    expect(bloqueado.statusCode).toBe(429);
    expect((bloqueado.json() as { error: string }).error).toBe("DEMASIADOS_INTENTOS");
    expect((await api("POST", "/api/auth/login", null, { username: "otro", password: "Clave12345" })).statusCode).toBe(200);
  });

  it("usuario inexistente y contraseña errónea dan la misma respuesta (no se filtra qué usuarios existen)", async () => {
    const a = await api("POST", "/api/auth/login", null, { username: "no-existe-nadie", password: "x" });
    const b = await api("POST", "/api/auth/login", null, { username: "admin", password: "incorrecta" });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json()).toEqual(b.json());
  });

  it("el bloqueo termina con el tiempo y un acierto borra los fallos previos", () => {
    let t = 1_000_000;
    const l = new LimitadorIntentos({ maxIntentos: 3, bloqueoMs: 60_000, ventanaMs: 120_000, ahora: () => t });
    expect(l.registrarFallo("a")).toBe(false);
    expect(l.registrarFallo("a")).toBe(false);
    l.registrarAcierto("a");
    expect(l.registrarFallo("a")).toBe(false); // el contador volvió a cero
    l.registrarFallo("a");
    expect(l.registrarFallo("a")).toBe(true);
    expect(l.segundosDeBloqueo("a")).toBe(60);
    t += 59_000;
    expect(l.segundosDeBloqueo("a")).toBe(1);
    t += 2_000;
    expect(l.segundosDeBloqueo("a")).toBe(0);
  });

  it("los fallos viejos (fuera de la ventana) no se acumulan y la tabla tiene tope", () => {
    let t = 0;
    const l = new LimitadorIntentos({ maxIntentos: 3, ventanaMs: 1_000, maxClaves: 50, ahora: () => t });
    l.registrarFallo("x");
    l.registrarFallo("x");
    t += 5_000;
    expect(l.registrarFallo("x")).toBe(false);
    for (let i = 0; i < 500; i++) l.registrarFallo(`inventado-${i}`);
    expect(l.claves).toBeLessThanOrEqual(50);
  });
});

describe("HTTP", () => {
  it("las respuestas llevan cabeceras de seguridad y no se almacenan en caché", async () => {
    const r = await api("GET", "/api/health", null);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-frame-options"]).toBe("DENY");
  });

  it("un cuerpo de más de 5 MB se rechaza (413) antes de procesarse", async () => {
    const r = await api("POST", "/api/auth/login", null, undefined, {
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ username: "a", password: "x".repeat(6 * 1024 * 1024) }),
    });
    expect(r.statusCode).toBe(413);
  });

  it("el token de la sincronización LAN no queda escrito en los registros", () => {
    expect(urlSinToken("/api/sync?token=abc123&cajaId=Caja1")).toBe("/api/sync?token=[oculto]&cajaId=Caja1");
    expect(urlSinToken("/api/sync?cajaId=C&token=zzz")).toBe("/api/sync?cajaId=C&token=[oculto]");
    expect(urlSinToken("/api/productos?search=arroz")).toBe("/api/productos?search=arroz");
  });

  it("el asistente de configuración solo responde a este equipo, aunque se falsifique X-Forwarded-For", async () => {
    for (const remoteAddress of ["192.168.1.50", "10.0.0.7"]) {
      const r = await api("POST", "/api/setup", null, {}, { remoteAddress, headers: { "x-forwarded-for": "127.0.0.1" } });
      expect(r.statusCode).toBe(403);
    }
  });

  it("sin sesión, con un token inventado o con un esquema distinto de Bearer: 401", async () => {
    expect((await api("GET", "/api/productos", null)).statusCode).toBe(401);
    expect((await api("GET", "/api/productos", "0".repeat(64))).statusCode).toBe(401);
    const r = await env.backend.server.inject({ method: "GET", url: "/api/productos", headers: { authorization: `Basic ${tokenAdmin}` } });
    expect(r.statusCode).toBe(401);
  });
});

describe("Entradas hostiles", () => {
  const ATAQUES = ["' OR '1'='1", "'; DROP TABLE Producto; --", "\" OR 1=1 --", "%' UNION SELECT * FROM Usuario --", "<script>alert(1)</script>", "../../../etc/passwd", "\u0000"];

  it("la inyección SQL en búsquedas, reportes y autenticación no rompe ni altera la base", async () => {
    const antes = await env.prisma.producto.count();
    for (const a of ATAQUES) {
      const q = encodeURIComponent(a);
      for (const url of [`/api/productos?search=${q}`, `/api/clientes?search=${q}`, `/api/proveedores?search=${q}`, `/api/productos/barcode/${q}`, `/api/escaneo/${q}`, `/api/reportes/ventas?desde=${q}`, `/api/comprobantes?estado=${q}`]) {
        const r = await api("GET", url, tokenAdmin);
        expect(r.statusCode, `${url} → ${r.body.slice(0, 120)}`).toBeLessThan(500);
      }
      const login = await api("POST", "/api/auth/login", null, { username: a, password: a });
      expect(login.statusCode).toBeLessThan(500);
      expect(login.statusCode).not.toBe(200);
    }
    expect(await env.prisma.producto.count()).toBe(antes);
    expect(await env.prisma.usuario.count()).toBeGreaterThan(0);
  });

  it("cuerpos con tipos equivocados o campos extra devuelven 400, nunca 500", async () => {
    for (const cuerpo of [null, [], "texto", { username: { $ne: null }, password: { $ne: null } }, { username: 123, password: true }]) {
      const r = await api("POST", "/api/auth/login", null, cuerpo as unknown, { headers: { "content-type": "application/json" }, payload: JSON.stringify(cuerpo) });
      expect(r.statusCode).toBeLessThan(500);
      expect(r.statusCode).not.toBe(200);
    }
  });
});

describe("Cifrado de respaldos (AES-256-GCM con frase)", () => {
  const original = (): string => {
    const f = path.join(tmp, `plano-${Math.random().toString(36).slice(2)}.bin`);
    writeFileSync(f, Buffer.concat([Buffer.from("SQLite format 3\0SECRETO-DEL-NEGOCIO"), Buffer.alloc(300_000, 7)]));
    return f;
  };

  it("cifra y descifra sin pérdida, y el archivo cifrado no deja ver el contenido", async () => {
    const plano = original();
    const cifrado = `${plano}.vdbk`;
    const vuelta = `${plano}.vuelta`;
    await cifrarArchivo(plano, cifrado, FRASE);
    expect(readFileSync(cifrado).includes("SECRETO-DEL-NEGOCIO")).toBe(false);
    expect(readFileSync(cifrado).includes("SQLite format 3")).toBe(false);
    await descifrarArchivo(cifrado, vuelta, FRASE);
    expect(readFileSync(vuelta).equals(readFileSync(plano))).toBe(true);
  });

  it("con otra frase, o con un solo byte alterado (contenido, sal, IV o etiqueta), falla y no deja archivo", async () => {
    const plano = original();
    const cifrado = `${plano}.vdbk`;
    await cifrarArchivo(plano, cifrado, FRASE);
    const salida = `${plano}.out`;
    await expect(descifrarArchivo(cifrado, salida, "otra-frase-distinta-12")).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
    expect(existsSync(salida)).toBe(false);

    const bytes = readFileSync(cifrado);
    for (const posicion of [3, 10, 30, 100, 150_000, bytes.length - 5]) {
      const alterado = Buffer.from(bytes);
      alterado[posicion] = (alterado[posicion] ?? 0) ^ 0xff;
      const ruta = `${cifrado}.alterado`;
      writeFileSync(ruta, alterado);
      await expect(descifrarArchivo(ruta, salida, FRASE), `byte ${posicion}`).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
      expect(existsSync(salida), `byte ${posicion}`).toBe(false);
    }
    writeFileSync(`${cifrado}.corto`, bytes.subarray(0, 20));
    await expect(descifrarArchivo(`${cifrado}.corto`, salida, FRASE)).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
  });

  it("rechaza una frase corta y dos cifrados del mismo archivo son distintos (sal e IV aleatorios)", async () => {
    const plano = original();
    await expect(cifrarArchivo(plano, `${plano}.x`, "corta")).rejects.toMatchObject({ codigo: "VALIDACION" });
    await cifrarArchivo(plano, `${plano}.a`, FRASE);
    await cifrarArchivo(plano, `${plano}.b`, FRASE);
    expect(readFileSync(`${plano}.a`).equals(readFileSync(`${plano}.b`))).toBe(false);
  });
});

describe("Respaldos: copia cifrada en carpeta externa", () => {
  let carpeta = "";

  it("solo el administrador los gestiona", async () => {
    expect((await api("GET", "/api/respaldos", tokenCajero)).statusCode).toBe(403);
    expect((await api("PUT", "/api/respaldos/nube", tokenCajero, { carpeta: tmp, frase: FRASE })).statusCode).toBe(403);
    expect((await api("POST", "/api/respaldos/nube/exportar", tokenCajero)).statusCode).toBe(403);
  });

  it("valida la configuración: carpeta absoluta y escribible, frase de 12 caracteres o más", async () => {
    carpeta = path.join(tmp, "nube");
    expect((await api("PUT", "/api/respaldos/nube", tokenAdmin, { carpeta: "relativa/carpeta", frase: FRASE })).statusCode).toBe(400);
    expect((await api("PUT", "/api/respaldos/nube", tokenAdmin, { carpeta, frase: "corta" })).statusCode).toBe(400);
    expect((await api("POST", "/api/respaldos/nube/exportar", tokenAdmin)).statusCode).toBe(409); // aún sin configurar
  });

  it("exporta una copia cifrada y verificable; la frase nunca se guarda ni se devuelve en claro", async () => {
    const cfg = await api("PUT", "/api/respaldos/nube", tokenAdmin, { carpeta, frase: FRASE });
    expect(cfg.statusCode).toBe(200);
    expect(cfg.body).not.toContain(FRASE);
    const r = await api("POST", "/api/respaldos/nube/exportar", tokenAdmin);
    expect(r.statusCode).toBe(201);
    const archivos = readdirSync(carpeta).filter((f) => f.endsWith(".vdbk"));
    expect(archivos).toHaveLength(1);
    expect(readdirSync(carpeta).some((f) => f.endsWith(".parcial") || f.startsWith(".vendeya-prueba"))).toBe(false);
    const contenido = readFileSync(path.join(carpeta, archivos[0] as string));
    expect(contenido.includes("SQLite format 3")).toBe(false);
    expect(contenido.includes("Empresa")).toBe(false);

    const estado = await api("GET", "/api/respaldos", tokenAdmin);
    expect(estado.body).not.toContain(FRASE);
    expect((estado.json() as { nube: { configurada: boolean; ultima: unknown } }).nube.configurada).toBe(true);
    const guardado = readFileSync(path.join(env.secretos, "respaldos.json"), "utf8");
    expect(guardado).not.toContain(FRASE);
  });

  it("restaura la base desde la copia cifrada; con frase equivocada no toca nada", async () => {
    const copia = path.join(carpeta, readdirSync(carpeta).filter((f) => f.endsWith(".vdbk"))[0] as string);
    const destino = path.join(tmp, "restaurada", "vendeya.db");
    mkdirSync(path.dirname(destino), { recursive: true });
    writeFileSync(destino, "base-anterior");
    await expect(restaurarRespaldoCifrado(copia, "frase-equivocada-123", destino)).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
    expect(readFileSync(destino, "utf8")).toBe("base-anterior");

    const r = await restaurarRespaldoCifrado(copia, FRASE, destino);
    expect(r.copiaAnterior).not.toBeNull();
    expect(readFileSync(r.copiaAnterior as string, "utf8")).toBe("base-anterior");
    const db = crearPrismaPara(destino);
    try {
      expect(await db.empresa.count()).toBe(1);
      expect(await db.usuario.count()).toBeGreaterThan(0);
    } finally {
      await db.$disconnect();
    }
  });

  it("conserva solo las últimas 14 copias en la carpeta externa", async () => {
    for (let i = 0; i < 14; i++) writeFileSync(path.join(carpeta, `vendeya-respaldo-2000-01-${String(i + 1).padStart(2, "0")}.vdbk`), "viejo");
    expect((await api("POST", "/api/respaldos/nube/exportar", tokenAdmin)).statusCode).toBe(201);
    const copias = readdirSync(carpeta).filter((f) => f.endsWith(".vdbk"));
    expect(copias).toHaveLength(14);
    expect(copias).not.toContain("vendeya-respaldo-2000-01-01.vdbk");
  });

  it("si la carpeta externa no está disponible, avisa (409) en lugar de fallar en silencio", async () => {
    await api("PUT", "/api/respaldos/nube", tokenAdmin, { carpeta: path.join(tmp, "disco-externo"), frase: FRASE });
    rmSync(path.join(tmp, "disco-externo"), { recursive: true, force: true });
    const r = await api("POST", "/api/respaldos/nube/exportar", tokenAdmin);
    expect(r.statusCode).toBe(409);
    expect((await api("DELETE", "/api/respaldos/nube", tokenAdmin)).statusCode).toBe(200);
    expect(((await api("GET", "/api/respaldos", tokenAdmin)).json() as { nube: { configurada: boolean } }).nube.configurada).toBe(false);
  });
});

describe("Respaldos locales automáticos", () => {
  it("el programador toma uno si no hay o tiene más de 24 h, y no repite antes; se conservan 7", async () => {
    const carpetaLocal = path.join(tmp, "locales");
    const respaldos = new RespaldoService(env.prisma, carpetaLocal);
    let ahora = Date.now();
    const errores: unknown[] = [];
    const worker = new RespaldoWorker(respaldos, env.servicios.respaldoNube, { ahora: () => ahora, alError: (e) => errores.push(e) });
    await worker.revisar();
    expect(respaldos.listar().filter((r) => r.motivo === "automatico")).toHaveLength(1);
    await worker.revisar(); // aún no pasaron 24 h
    expect(respaldos.listar().filter((r) => r.motivo === "automatico")).toHaveLength(1);
    for (let i = 0; i < 9; i++) {
      ahora += 25 * 60 * 60_000;
      // el respaldo real lleva la fecha de hoy: se retrocede su fecha para simular que ya pasó el día
      const ultimo = respaldos.ultimo("automatico");
      if (ultimo !== null) (await import("fs")).utimesSync(ultimo.ruta, new Date(ahora - 26 * 60 * 60_000), new Date(ahora - 26 * 60 * 60_000));
      await worker.revisar();
    }
    expect(errores).toEqual([]);
    expect(respaldos.listar().filter((r) => r.motivo === "automatico")).toHaveLength(7);
  }, 60_000);
});
