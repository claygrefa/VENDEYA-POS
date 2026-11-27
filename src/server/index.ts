// ============================================================
// src/server/index.ts — Servidor Fastify embebido + arranque del backend
// ============================================================
import { mkdirSync } from "fs";
import path from "path";
import fastifyCors from "@fastify/cors";
import type { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { crearPrismaPara } from "./config/database.config";
import { registrarRutas } from "./routes";
import { AppError, type CodigoError } from "./services/appError.util";
import { crearServicios, type Servicios } from "./services/container.factory";
import type { ProteccionClave } from "./services/sri/firma/claveMaestra.provider";
import { SriWorker, type OpcionesSriWorker } from "./jobs/sriWorker.job";
import type { OpcionesServicios } from "./services/container.factory";
import { registrarSync } from "./routes/sync.routes";
import { MigracionFallidaError, MigrationService, type ResultadoMigracion } from "./services/migration.service";
import { asegurarEstadisticas } from "./config/estadisticas.util";
import { restaurarRespaldo, type RespaldoService } from "./services/respaldo.service";
import { aplicarRestauracionPendiente } from "./services/restauracion.service";
import { RespaldoWorker, type OpcionesRespaldoJob } from "./jobs/respaldo.job";
import { LicenciaWorker, type OpcionesLicenciaWorker } from "./jobs/licencia.job";
import { purgarIntentosCobro } from "./services/intentoCobro.service";
import type { OpcionesLicencia } from "./services/licencia/licencia.service";

/** Caché de páginas de SQLite en KB (64 MB) */
const CACHE_SQLITE_KB = 65_536;

const HTTP_POR_CODIGO: Record<CodigoError, number> = {
  VALIDACION: 400,
  CREDENCIALES_INVALIDAS: 401,
  USUARIO_INACTIVO: 403,
  NO_ENCONTRADO: 404,
  DUPLICADO: 409,
  STOCK_INSUFICIENTE: 409,
  TURNO_REQUERIDO: 409,
  ESTADO_INVALIDO: 409,
  COBRO_ARCHIVADO: 409,
  LIMITE_CREDITO_EXCEDIDO: 409,
  SIN_PERMISO: 403,
  MODULO_DESHABILITADO: 403,
  LICENCIA_REQUERIDA: 402,
  DEMASIADOS_INTENTOS: 429,
};

/** Tamaño máximo de un cuerpo de petición (el certificado .p12 en base64 es lo más grande que se envía) */
const LIMITE_CUERPO_BYTES = 5 * 1024 * 1024;

/** El token de la sincronización LAN viaja en la URL del WebSocket: nunca debe quedar escrito en los registros. */
export function urlSinToken(url: string): string {
  return url.replace(/([?&](?:token|access_token)=)[^&#]*/gi, "$1[oculto]");
}

/** Construye la instancia Fastify con CORS, manejo de errores y rutas. No abre el puerto. */
export async function buildServer(servicios: Servicios, logLevel = "info"): Promise<FastifyInstance> {
  const server = Fastify({
    bodyLimit: LIMITE_CUERPO_BYTES,
    // Sin esto, "x-forwarded-for" falsificado haría pasar a un equipo remoto por local (asistente de configuración) o evadiría el bloqueo de intentos
    trustProxy: false,
    logger:
      logLevel === "silent"
        ? false
        : {
            level: logLevel,
            serializers: {
              req: (req: FastifyRequest) => ({ method: req.method, url: urlSinToken(req.url), hostname: req.hostname, remoteAddress: req.ip }),
            },
          },
  });

  // Cabeceras de seguridad: la API devuelve datos del negocio (nada se guarda en cachés intermedias) y JSON/PDF/CSV que no deben interpretarse como otra cosa
  server.addHook("onSend", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
  });

  server.decorateRequest("usuario", null);
  server.decorateRequest("token", null);

  await server.register(fastifyCors, {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173", "app://.", "file://", "null"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  server.setErrorHandler((error, req, reply) => {
    if (error instanceof AppError) {
      return reply.status(HTTP_POR_CODIGO[error.codigo]).send({ error: error.codigo, mensaje: error.message });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      return reply.status(status).send({ error: "SOLICITUD_INVALIDA", mensaje: error instanceof Error ? error.message : "Solicitud inválida" });
    }
    servicios.telemetria.registrarError(error); // solo guarda algo si el administrador dio su consentimiento
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
  /**
   * Respaldo automático diario (local y copia cifrada en la nube si está configurada). Desactivado por defecto: solo arranca si se
   * indica (la aplicación de escritorio lo activa; las pruebas no deben escribir respaldos por su cuenta).
   */
  respaldoAutomatico?: (OpcionesRespaldoJob & { habilitado: boolean }) | undefined;
  /** Telemetría opcional de errores (versión de la aplicación y servidor de destino, si lo hay) */
  telemetria?: OpcionesServicios["telemetria"];
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
  let respaldoWorker: RespaldoWorker | null = null;
  let purgaIntentos: NodeJS.Timeout | null = null;

  const backupsDir = opciones.backupsDir ?? path.join(path.dirname(opciones.dbPath), "backups");
  let respaldos: RespaldoService | null = null;

  try {
    // Una restauración preparada desde Ajustes se aplica ahora, con la base cerrada y antes de migrar
    const restaurada = aplicarRestauracionPendiente(opciones.dbPath);
    if (restaurada !== null) console.warn(`[backend] base restaurada desde «${restaurada.archivo}»; la anterior se conserva en ${restaurada.copiaAnterior ?? "(no había)"}`);

    // SQLite aplica synchronous por conexión. FULL sincroniza cada commit de ventas y de la cola SRI en WAL.
    await prisma.$executeRaw`PRAGMA synchronous=FULL`;
    const migraciones = await new MigrationService(prisma, {
      migrationsDir: opciones.migrationsDir,
      backupsDir,
      dbPath: opciones.dbPath,
    }).migrar();

    // Modo WAL (lecturas concurrentes y mejor tolerancia a cortes de energía)
    await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL");
    // Tolera bloqueos breves de otra conexión SQLite sin ocupar todo el plazo de cobro.
    await prisma.$queryRaw`PRAGMA busy_timeout=5000`;
    // Con una base de cientos de MB, la caché por omisión de SQLite (2 MB) obliga a leer del disco las páginas de los índices en cada
    // venta: 64 MB de caché, temporales en memoria y lectura mapeada. Con la sola conexión del pool, estos PRAGMA valen para toda la sesión.
    await prisma.$queryRawUnsafe(`PRAGMA cache_size=${-CACHE_SQLITE_KB}`);
    await prisma.$queryRawUnsafe("PRAGMA temp_store=MEMORY");
    await prisma.$queryRawUnsafe("PRAGMA mmap_size=268435456");
    // Estadísticas para el planificador: sin ellas SQLite elige mal el orden de las uniones en las consultas grandes (reportes). `optimize` solo
    // analiza lo que lo necesita (tablas nuevas o que crecieron mucho), así que en un arranque normal cuesta milisegundos.
    await prisma.$queryRawUnsafe("PRAGMA optimize");
    await asegurarEstadisticas(prisma); // una sola vez en una base grande que aún no las tiene (ver estadisticas.util.ts)

    const servicios = crearServicios(prisma, {
      directorioSecretos: opciones.directorioSecretos ?? path.join(path.dirname(opciones.dbPath), "secretos"),
      directorioRespaldos: backupsDir,
      directorioDatos: path.dirname(opciones.dbPath),
      ...(opciones.telemetria !== undefined ? { telemetria: opciones.telemetria } : {}),
      ...(opciones.proteccionClave !== undefined ? { proteccionClave: opciones.proteccionClave } : {}),
      ...(opciones.sri !== undefined ? { sri: opciones.sri } : {}),
      ...(opciones.impresion !== undefined ? { impresion: opciones.impresion } : {}),
      ...(opciones.balanza !== undefined ? { balanza: opciones.balanza } : {}),
      ...(opciones.sync !== undefined ? { sync: opciones.sync } : {}),
      ...(opciones.ride !== undefined ? { ride: opciones.ride } : {}),
      ...(opciones.licencia !== undefined ? { licencia: opciones.licencia } : {}),
    });
    respaldos = servicios.respaldos;
    respaldoWorker = opciones.respaldoAutomatico?.habilitado === true ? new RespaldoWorker(servicios.respaldos, servicios.respaldoNube, opciones.respaldoAutomatico) : null;
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
    respaldoWorker?.iniciar();
    servicios.sync.iniciar();
    // Al archivar se elimina la respuesta antigua y el UUID queda reservado.
    const purgar = (): void => void purgarIntentosCobro(prisma).catch((err: unknown) => {
      servidor.log.error({ err }, "No se pudieron archivar los intentos de cobro");
    });
    purgar();
    purgaIntentos = setInterval(purgar, 24 * 3_600_000);
    purgaIntentos.unref();

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
        if (purgaIntentos !== null) clearInterval(purgaIntentos);
        await licenciaWorker?.detener();
        await respaldoWorker?.detener();
        await worker?.detener();
        await servidor.close();
        await prisma.$queryRawUnsafe("PRAGMA optimize").catch(() => undefined); // recomendado por SQLite antes de cerrar una conexión larga
        await prisma.$disconnect();
      },
    };
  } catch (e) {
    if (purgaIntentos !== null) clearInterval(purgaIntentos);
    await worker?.detener().catch(() => undefined);
    await licenciaWorker?.detener().catch(() => undefined);
    await respaldoWorker?.detener().catch(() => undefined);
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
