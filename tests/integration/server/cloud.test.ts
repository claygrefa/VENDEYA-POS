import { generateKeyPairSync, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { expect, it } from "vitest";
import { crearCloud, MAX_REPORTES_DIA, MAX_REPORTES_INSTALACION_DIA } from "../../../src/server/cloud/app";
import { migrar } from "../../../src/server/cloud/database";
import { hashClave } from "../../../src/server/cloud/licencia.service";
import { verificarLicencia } from "../../../src/server/services/licencia/licencia.token";

it("migra PostgreSQL y gestiona plazas, revocación y telemetría idempotente", async () => {
  const db = new PGlite();
  const query = (sql: string, args?: unknown[]) =>
    sql.includes("CREATE TABLE") ? db.exec(sql) : db.query(sql, args);
  const pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Pool;
  const par = generateKeyPairSync("ed25519");
  const publica = par.publicKey.export({ type: "spki", format: "pem" }).toString();
  const app = await crearCloud(pool, par.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  try {
    expect((await app.inject("/health")).statusCode).toBe(503);
    await migrar(pool);
    await migrar(pool);
    expect((await app.inject("/health")).json()).toEqual({ status: "ok", db: "ok" });
    const id = randomUUID();
    const clave = "ALTA-PRUEBA";
    const ruc = "1790012345001";
    await db.query("INSERT INTO licenses (id,key_hash,ruc,expires_at,max_devices) VALUES ($1,$2,$3,now()+interval '1 day',1)", [id, hashClave(clave), ruc]);
    const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload });
    const dispositivo = { id: "caja-1", nombre: "Caja", plataforma: "win32", version: "1.0.0" };
    const activacion = await post("/v1/licencias/activar", { clave, ruc, dispositivo });
    expect(activacion.statusCode).toBe(200);
    const { token } = activacion.json<{ token: string }>();
    expect(verificarLicencia(token, publica)).toMatchObject({ valida: true, payload: { licenciaId: id } });
    expect((await post("/v1/licencias/activar", { clave, ruc, dispositivo: { ...dispositivo, id: "caja-2" } })).json().error).toBe("LIMITE_DISPOSITIVOS");
    expect((await post("/api/license/verify", { token, dispositivo })).statusCode).toBe(200);
    expect((await post("/api/license/verify", { token: "falso", dispositivo })).statusCode).toBe(401);
    await db.query("UPDATE licenses SET revoked_at=now() WHERE id=$1", [id]);
    expect((await post("/v1/licencias/validar", { token, dispositivo })).json().error).toBe("REVOCADA");

    const reporte = { id: randomUUID(), fecha: new Date().toISOString(), version: "1.0.0", plataforma: "win32", origen: "interfaz",
      vista: null, mensaje: "token=secreto", pila: null };
    const lote = { instalacion: randomUUID(), reportes: [reporte] };
    expect((await post("/v1/telemetria", lote)).statusCode).toBe(204);
    expect((await post("/v1/telemetria", lote)).statusCode).toBe(204);
    const guardados = await db.query<{ report: { mensaje: string } }>("SELECT report FROM telemetry_reports");
    expect(guardados.rows.map((r) => r.report.mensaje)).toEqual(["token=<oculto>"]);
  } finally {
    await app.close();
    await db.close();
  }
}, 30_000);

it("limita la telemetría por instalación y en total cada día (el endpoint no tiene autenticación)", async () => {
  const db = new PGlite();
  const query = (sql: string, args?: unknown[]) =>
    sql.includes("CREATE TABLE") ? db.exec(sql) : db.query(sql, args);
  const pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Pool;
  const par = generateKeyPairSync("ed25519");
  const app = await crearCloud(pool, par.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  try {
    await migrar(pool);
    const reporte = () => ({ id: randomUUID(), fecha: new Date().toISOString(), version: "1.0.0", plataforma: "win32", origen: "interfaz", vista: null, mensaje: "error de prueba", pila: null });
    const enviar = (instalacion: string, cuantos = 1) =>
      app.inject({ method: "POST", url: "/v1/telemetria", payload: { instalacion, reportes: Array.from({ length: cuantos }, reporte) } });

    // una instalación llega a su tope diario: el siguiente lote se rechaza, las demás siguen enviando
    const voraz = randomUUID();
    await db.query(
      "INSERT INTO telemetry_reports (installation, id, report) SELECT $1::uuid, gen_random_uuid(), '{}'::jsonb FROM generate_series(1, $2)",
      [voraz, MAX_REPORTES_INSTALACION_DIA - 1]);
    expect((await enviar(voraz)).statusCode).toBe(204); // el 500.º
    const rechazado = await enviar(voraz);
    expect(rechazado.statusCode).toBe(429);
    expect(rechazado.json()).toEqual({ error: "CUOTA_INSTALACION" });
    expect((await enviar(randomUUID())).statusCode).toBe(204);

    // tope global del día: ninguna instalación nueva puede seguir llenando la tabla
    await db.query(
      "INSERT INTO telemetry_reports (installation, id, report) SELECT gen_random_uuid(), gen_random_uuid(), '{}'::jsonb FROM generate_series(1, $1)",
      [MAX_REPORTES_DIA]);
    const lleno = await enviar(randomUUID());
    expect(lleno.statusCode).toBe(429);
    expect(lleno.json()).toEqual({ error: "CUOTA_DIARIA" });

    // lo de hace más de un día no cuenta
    await db.query("UPDATE telemetry_reports SET received_at = now() - interval '2 days'");
    expect((await enviar(voraz)).statusCode).toBe(204);
  } finally {
    await app.close();
    await db.close();
  }
}, 60_000);
