// ============================================================
// src/server/controllers/health.controller.ts
// ============================================================
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Servicios } from "../services/container.factory";

export function crearHealthController(servicios: Servicios) {
  return {
    estado: async (_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      let db: "ok" | "error" = "ok";
      try {
        await servicios.prisma.$queryRawUnsafe("SELECT 1");
      } catch {
        db = "error";
      }
      return reply.status(db === "ok" ? 200 : 503).send({
        status: db === "ok" ? "ok" : "degraded",
        db,
        version: process.env["npm_package_version"] ?? "1.0.0",
        uptime: process.uptime(),
        ts: new Date().toISOString(),
      });
    },
  };
}
