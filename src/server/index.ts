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
import type { ProteccionClave } from "./services/sri/firma/claveMaestra.provider";
import { SriWorker, type OpcionesSriWorker } from "./jobs/sriWorker.job";
import type { OpcionesServicios } from "./services/container.factory";
import { registrarSync } from "./routes/sync.routes";
import { MigracionFallidaError, MigrationService, type ResultadoMigracion } from "./services/migration.service";
import { RespaldoService, restaurarRespaldo } from "./services/respaldo.service";
import { LicenciaWorker, type OpcionesLicenciaWorker } from "./jobs/licencia.job";
import type { OpcionesLicencia } from "./services/licencia/licencia.service";

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
  MODULO_DESHABILITADO: 403,
  LICENCIA_REQUERIDA: 402,
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

  // La sincronización va antes de las rutas: su gancho debe conocerlas para anunciar los cambios
  await registrarSync(server, servicios);
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
  /** Carpeta de secretos locales: clave maestra y certificados .p12 (default: <carpeta de la BD>/secretos) */
  directorioSecretos?: string;
  /** Protección de la clave maestra con el sistema operativo (Electron safeStorage); sin ella queda en el archivo */
  proteccionClave?: ProteccionClave;
  /** Balanza serial y sincronización LAN (pruebas: puerto simulado, latido corto) */
  balanza?: OpcionesServicios["balanza"];
  sync?: OpcionesServicios["sync"];
  /**
   * Escuchar en toda la red local (0.0.0.0) para que otras cajas se conecten. Desactivado por defecto: el servidor solo
   * atiende a este equipo (127.0.0.1). Aun activado, las cajas deben tener la sincronización LAN habilitada en el giro.
   */
  redLocal?: boolean;
  /** Impresora térmica y RIDE (en pruebas se sustituye el transporte de la impresora) */
  impresion?: OpcionesServicios["impresion"];
  ride?: OpcionesServicios["ride"];
  /** Conexión con el SRI (cliente SOAP, endpoints y espera de cada llamada); por defecto los Web Services oficiales */
  sri?: OpcionesServicios["sri"];
  /**
   * Worker en segundo plano que envía la cola al SRI. Desactivado por defecto: solo arranca si se indica
   * (la aplicación de escritorio lo activa; las pruebas no deben llamar al SRI).
   */
  sriWorker?: (OpcionesSriWorker & { habilitado: boolean }) | undefined;
  /**
   * Licenciamiento (aplicación instalada). Sin esta opción no se exige licencia. `trabajo` ajusta la validación periódica en línea.
   */
  licencia?: (OpcionesLicencia & { trabajo?: OpcionesLicenciaWorker }) | undefined;
  /** Puerto preferido; si está ocupado se usa uno libre. 0 = libre directamente. */
  port: number;
  host?: string;
  logLevel?: string;
}

export interface BackendHandle {
  server: FastifyInstance;
  prisma: PrismaClient;
  servicios: Servicios;
  /** Worker de la cola del SRI (null si no está habilitado) */
  worker: SriWorker | null;
  host: string;
  port: number;
  url: string;
  migraciones: ResultadoMigracion;
  /** Respaldos de la base de datos (previos a migrar y a actualizar la aplicación) */
  respaldos: RespaldoService;
  /** Cierra servidor HTTP y conexión a la BD */
  close: () => Promise<void>;
}

/**
 * Arranque completo del backend local: BD → migraciones (con respaldo) → WAL → HTTP.
 * Si algo falla libera lo abierto y propaga el error.
 */
export async function iniciarBackend(opciones: BackendOptions): Promise<BackendHandle> {
  const host = opciones.host ?? (opciones.redLocal === true ? "0.0.0.0" : "127.0.0.1");
  mkdirSync(path.dirname(opciones.dbPath), { recursive: true });
  const prisma = crearPrismaPara(opciones.dbPath);
  let server: FastifyInstance | null = null;
  let worker: SriWorker | null = null;
  let licenciaWorker: LicenciaWorker | null = null;

  const backupsDir = opciones.backupsDir ?? path.join(path.dirname(opciones.dbPath), "backups");
  const respaldos = new RespaldoService(prisma, backupsDir);

  try {
    const migraciones = await new MigrationService(prisma, {
      migrationsDir: opciones.migrationsDir,
      backupsDir,
      dbPath: opciones.dbPath,
    }).migrar();

    // Modo WAL (lecturas concurrentes y mejor tolerancia a cortes de energía)
    await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL");

    const servicios = crearServicios(prisma, {
      directorioSecretos: opciones.directorioSecretos ?? path.join(path.dirname(opciones.dbPath), "secretos"),
      ...(opciones.proteccionClave !== undefined ? { proteccionClave: opciones.proteccionClave } : {}),
      ...(opciones.sri !== undefined ? { sri: opciones.sri } : {}),
      ...(opciones.impresion !== undefined ? { impresion: opciones.impresion } : {}),
      ...(opciones.balanza !== undefined ? { balanza: opciones.balanza } : {}),
      ...(opciones.sync !== undefined ? { sync: opciones.sync } : {}),
      ...(opciones.ride !== undefined ? { ride: opciones.ride } : {}),
      ...(opciones.licencia !== undefined ? { licencia: opciones.licencia } : {}),
    });
    worker = opciones.sriWorker?.habilitado === true ? new SriWorker(servicios.envioSri, opciones.sriWorker) : null;
    licenciaWorker = new LicenciaWorker(servicios.licencia, opciones.licencia?.trabajo);
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
    await worker?.iniciar();
    licenciaWorker.iniciar();
    servicios.sync.iniciar();

    return {
      server: servidor,
      prisma,
      servicios,
      worker,
      host,
      port: puerto,
      url: `http://${host}:${puerto}`,
      migraciones,
      respaldos,
      close: async () => {
        await licenciaWorker?.detener();
        await worker?.detener();
        await servidor.close();
        await prisma.$disconnect();
      },
    };
  } catch (e) {
    await worker?.detener().catch(() => undefined);
    await licenciaWorker?.detener().catch(() => undefined);
    if (server !== null) await server.close().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    // Una migración que falla a mitad puede dejar la base a medio cambiar: se vuelve a la copia tomada justo antes de migrar
    if (e instanceof MigracionFallidaError && e.respaldo !== null) {
      restaurarRespaldo(opciones.dbPath, e.respaldo);
      e.restaurado = true;
    }
    throw e;
  }
}
