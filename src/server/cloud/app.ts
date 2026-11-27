import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyError } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { limpiarTexto, MAX_MENSAJE, MAX_PILA } from "../services/telemetria/telemetria.util";
import { Activacion, Destino, LicenciasCloud, RechazoLicencia, Token, Validacion } from "./licencia.service";

const Lote = z.object({
  instalacion: z.uuid(),
  reportes: z.array(z.object({
    id: z.uuid(), fecha: z.iso.datetime(), version: z.string().max(50), plataforma: z.string().max(50),
    origen: z.enum(["interfaz", "servidor"]), vista: z.string().max(40).nullable(),
    mensaje: z.string().max(MAX_MENSAJE + 1), pila: z.string().max(MAX_PILA + 1).nullable(),
  })).min(1).max(50),
});

/**
 * Cuotas de telemetría por día: el endpoint no tiene autenticación (la aplicación instalada no guarda ningún secreto compartido), así que el
 * límite por IP no basta para impedir que alguien llene el disco con identificadores inventados. Por instalación y en total.
 */
export const MAX_REPORTES_INSTALACION_DIA = 500;
export const MAX_REPORTES_DIA = 50_000;

export async function crearCloud(db: Pool, privada: string, proxy: false | number = false) {
  const app = Fastify({
    bodyLimit: 256 * 1024, trustProxy: proxy === false ? false : (_ip, salto) => salto < proxy,
    logger: { level: "warn" },
  });
  const licencias = new LicenciasCloud(db, privada);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  app.setErrorHandler<FastifyError>((error, _req, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: "VALIDACION" });
    if (error instanceof RechazoLicencia) return reply.code(error.estado).send({ error: error.codigo, ...error.detalle });
    if (error.statusCode && error.statusCode < 500) return reply.code(error.statusCode).send({ error: "SOLICITUD_RECHAZADA" });
    app.log.error({ code: error.code }, "Falló una solicitud del backend cloud");
    return reply.code(503).send({ error: "ERROR_SERVIDOR" });
  });

  app.get("/health", { config: { rateLimit: false } }, async () => {
    await db.query("SELECT id FROM licenses LIMIT 0");
    return { status: "ok", db: "ok" };
  });
  app.post("/v1/licencias/activar", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req) => licencias.activar(Activacion.parse(req.body)));
  app.post("/v1/licencias/validar", async (req) => licencias.validar(Validacion.parse(req.body)));
  app.post("/api/license/verify", async (req) => licencias.validar(Validacion.parse(req.body)));
  app.post("/v1/licencias/dispositivos", async (req) => licencias.dispositivos(Token.parse(req.body).token));
  app.post("/v1/licencias/desactivar", async (req, reply) => {
    await licencias.liberar(Destino.parse(req.body), true);
    return reply.code(204).send();
  });
  app.post("/v1/licencias/liberar", async (req, reply) => {
    await licencias.liberar(Destino.parse(req.body), false);
    return reply.code(204).send();
  });
  app.post("/v1/telemetria", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const lote = Lote.parse(req.body);
    const reportes = lote.reportes.map((r) => ({
      ...r, mensaje: limpiarTexto(r.mensaje, MAX_MENSAJE), pila: r.pila === null ? null : limpiarTexto(r.pila, MAX_PILA),
      vista: r.vista === null ? null : limpiarTexto(r.vista, 40),
      version: limpiarTexto(r.version, 50), plataforma: limpiarTexto(r.plataforma, 50),
    }));
    const { rows } = await db.query<{ instalacion: string; total: string }>(
      `SELECT count(*) FILTER (WHERE installation = $1::uuid) AS instalacion, count(*) AS total
         FROM telemetry_reports WHERE received_at > now() - interval '1 day'`, [lote.instalacion]);
    if (Number(rows[0]?.instalacion ?? 0) + reportes.length > MAX_REPORTES_INSTALACION_DIA) return reply.code(429).send({ error: "CUOTA_INSTALACION" });
    if (Number(rows[0]?.total ?? 0) + reportes.length > MAX_REPORTES_DIA) return reply.code(429).send({ error: "CUOTA_DIARIA" });
    await db.query(`INSERT INTO telemetry_reports (installation, id, report)
      SELECT $1::uuid, (r->>'id')::uuid, r FROM jsonb_array_elements($2::jsonb) AS r ON CONFLICT DO NOTHING`,
    [lote.instalacion, JSON.stringify(reportes)]);
    return reply.code(204).send();
  });
  return app;
}
