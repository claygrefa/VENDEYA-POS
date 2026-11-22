// ============================================================
// src/server/index.ts — Servidor Fastify embebido + arranque del backend
// ============================================================
import { mkdirSync } from "fs";
import path from "path";
import fastifyCors from "@fastify/cors";
import type { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyInstance } from "fastify";
import { crearPrismaPara } from "./config/database.config";
import { registrarRutas } from "./routes";
import { AppError, type CodigoError } from "./services/appError.util";
import { crearServicios, type Servicios } from "./services/container.factory";
import { MigrationService, type ResultadoMigracion } from "./services/migration.service";

const HTTP_POR_CODIGO: Record<CodigoError, number> = {
  VALIDACION: 400,
  CREDENCIALES_INVALIDAS: 401,
  USUARIO_INACTIVO: 403,
  NO_ENCONTRADO: 404,
  DUPLICADO: 409,
  STOCK_INSUFICIENTE: 409,
  TURNO_REQUERIDO: 409,
  ESTADO_INVALIDO: 409,
  LIMITE_CREDITO_EXCEDIDO: 409,
  SIN_PERMISO: 403,
};

/** Construye la instancia Fastify con CORS, manejo de errores y rutas. No abre el puerto. */
export async function buildServer(servicios: Servicios, logLevel = "info"): Promise<FastifyInstance> {
  const server = Fastify({ logger: logLevel === "silent" ? false : { level: logLevel } });

  server.decorateRequest("usuario", null);
  server.decorateRequest("token", null);

  await server.register(fastifyCors, {
    origin: ["http://localhost:5173", "app://.", "file://", "null"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  server.setErrorHandler((error, req, reply) => {
    if (error instanceof AppError) {
      return reply.status(HTTP_POR_CODIGO[error.codigo]).send({ error: error.codigo, mensaje: error.message });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      return reply.status(status).send({ error: "SOLICITUD_INVALIDA", mensaje: error.message });
    }
    req.log.error(error);
    return reply.status(500).send({ error: "ERROR_INTERNO", mensaje: "Error interno del servidor" });
  });

  server.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: "NO_ENCONTRADO", mensaje: "Ruta no encontrada" })
  );

  registrarRutas(server, servicios);
  return server;
}

// ─────────────────────────────────────────────────────────────

export interface BackendOptions {
  /** Archivo SQLite de la aplicación */
  dbPath: string;
  /** Carpeta de migraciones (prisma/migrations en dev, resources en el instalador) */
  migrationsDir: string;
  /** Carpeta de respaldos previos a migrar (default: <carpeta de la BD>/backups) */
  backupsDir?: string;
  /** Puerto preferido; si está ocupado se usa uno libre. 0 = libre directamente. */
  port: number;
  host?: string;
  logLevel?: string;
}

export interface BackendHandle {
  server: FastifyInstance;
  prisma: PrismaClient;
  servicios: Servicios;
  host: string;
  port: number;
  url: string;
  migraciones: ResultadoMigracion;
  /** Cierra servidor HTTP y conexión a la BD */
  close: () => Promise<void>;
}

/**
 * Arranque completo del backend local: BD → migraciones (con respaldo) → WAL → HTTP.
 * Si algo falla libera lo abierto y propaga el error.
 */
export async function iniciarBackend(opciones: BackendOptions): Promise<BackendHandle> {
  const host = opciones.host ?? "127.0.0.1";
  mkdirSync(path.dirname(opciones.dbPath), { recursive: true });
  const prisma = crearPrismaPara(opciones.dbPath);
  let server: FastifyInstance | null = null;

  try {
    const migraciones = await new MigrationService(prisma, {
      migrationsDir: opciones.migrationsDir,
      backupsDir: opciones.backupsDir ?? path.join(path.dirname(opciones.dbPath), "backups"),
      dbPath: opciones.dbPath,
    }).migrar();

    // Modo WAL (lecturas concurrentes y mejor tolerancia a cortes de energía)
    await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL");

    const servicios = crearServicios(prisma);
    server = await buildServer(servicios, opciones.logLevel ?? "info");

    try {
      await server.listen({ port: opciones.port, host });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE" || opciones.port === 0) throw e;
      await server.listen({ port: 0, host }); // puerto ocupado → uno libre
    }

    const direccion = server.server.address();
    const puerto = typeof direccion === "object" && direccion !== null ? direccion.port : opciones.port;
    const servidor = server;

    return {
      server: servidor,
      prisma,
      servicios,
      host,
      port: puerto,
      url: `http://${host}:${puerto}`,
      migraciones,
      close: async () => {
        await servidor.close();
        await prisma.$disconnect();
      },
    };
  } catch (e) {
    if (server !== null) await server.close().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    throw e;
  }
}
