// ============================================================
// src/server/index.ts — Servidor Fastify embebido (STUB Semana 1)
// La inicialización completa de Prisma y rutas se implementa en Semanas 2–3.
// ============================================================

import Fastify, { FastifyInstance } from "fastify";
import fastifyCors                  from "@fastify/cors";

export async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  // ── CORS (permitir peticiones del renderer Electron) ──────
  await server.register(fastifyCors, {
    origin:  ["http://localhost:5173", "app://.", "file://"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // ── Health-check ──────────────────────────────────────────
  server.get("/api/health", async () => ({
    status:  "ok",
    version: process.env.npm_package_version ?? "0.1.0",
    uptime:  process.uptime(),
    ts:      new Date().toISOString(),
  }));

  return server;
}

/** Arranca el servidor en el puerto especificado */
export async function startServer(port = 3001): Promise<FastifyInstance> {
  const server = await buildServer();
  await server.listen({ port, host: "127.0.0.1" });
  return server;
}
