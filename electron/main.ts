// ============================================================
// electron/main.ts — Proceso Principal de Electron (VENDEYA POS)
// Orden de arranque: instancia única → backend (BD + migraciones con respaldo
// + Fastify) → IPC → ventana. Apagado limpio del backend al salir.
// ============================================================

import path from "path";
import { app, BrowserWindow, dialog, Menu, safeStorage, shell } from "electron";

function devLog(msg: string): void {
  if (isDev) console.log(`[main] ${msg}`);
}
import { autoUpdater } from "electron-updater";
import { iniciarBackend, type BackendHandle } from "../src/server";
import { liberarIpcApp, registrarIpcApp, type RutasApp } from "./ipc/app.ipc";
import { liberarIpcImpresoras, registrarIpcImpresoras } from "./ipc/printer.ipc";
import { liberarIpcUpdater, registrarIpcUpdater } from "./ipc/updater.ipc";
import { MigracionFallidaError } from "../src/server/services/migration.service";
import { ActualizadorApp, type AutoUpdaterLike } from "./updater/updater.service";
import { esEstadoActualizacion } from "../src/shared/types/actualizacion.types";
import { cargarConfigLicencia, cargarDestinoTelemetria, esCompilacionDePrueba } from "./licencia.config";
import { ClienteLicenciasHttp } from "../src/server/services/licencia/licencia.cliente";
import { TransporteHttp } from "../src/server/services/telemetria/telemetria.service";
import { esEnlaceExternoSeguro, esNavegacionPermitida } from "./navegacion.seguridad";
import { identificarDispositivo } from "../src/server/services/licencia/dispositivo.util";

const isDev = process.env["NODE_ENV"] === "development";
const PUERTO_PREFERIDO = parseInt(process.env["SERVER_PORT"] ?? "3001", 10);

// En terminales POS y entornos virtuales/remotos, la aceleración por hardware puede provocar caídas del proceso GPU (STATUS_BREAKPOINT)
app.disableHardwareAcceleration();

let backend: BackendHandle | null = null;
let actualizador: ActualizadorApp | null = null;
let cerrando = false;

/**
 * Auto-actualización: solo en la aplicación instalada (en desarrollo no hay a dónde buscar) y apagable con VENDEYA_UPDATES=off.
 * El respaldo previo usa la base local; una caja secundaria de la red no tiene base propia y no respalda nada.
 */
function iniciarActualizador(): void {
  const apagado = process.env["VENDEYA_UPDATES"] === "off";
  const habilitado = app.isPackaged && !apagado;
  actualizador = new ActualizadorApp({
    updater: autoUpdater as unknown as AutoUpdaterLike,
    publicar: (estado) => {
      if (!esEstadoActualizacion(estado)) return; // nunca se envían errores de comprobación a la pantalla
      for (const ventana of BrowserWindow.getAllWindows()) {
        if (!ventana.isDestroyed()) ventana.webContents.send("updater:status", estado);
      }
    },
    respaldar: async (version) => (backend === null ? null : backend.respaldos.crear("pre-actualizacion", version)),
    habilitado,
    canal: process.env["VENDEYA_CANAL"],
    motivoDeshabilitado: apagado ? "Desactivadas con VENDEYA_UPDATES=off" : "Solo se buscan actualizaciones en la aplicación instalada",
    registrar: (mensaje, error) => console.warn(`[updater] ${mensaje}`, error ?? ""),
  });
  registrarIpcUpdater(actualizador);
  actualizador.iniciar();
}

function calcularRutas(): RutasApp {
  const userData = app.getPath("userData");
  const dbEnv = process.env["DB_PATH"];
  const db =
    dbEnv !== undefined && dbEnv !== ""
      ? path.resolve(dbEnv)
      : isDev
        ? path.join(app.getAppPath(), "prisma", "dev.db")
        : path.join(userData, "data", "vendeya.db");
  return {
    userData: isDev ? path.join(app.getAppPath(), ".userData") : userData,
    db,
    backups: path.join(path.dirname(db), "backups"),
    // Empaquetado: extraResources → <resources>/prisma/migrations; desarrollo: raíz del proyecto
    migraciones: app.isPackaged
      ? path.join(process.resourcesPath, "prisma", "migrations")
      : path.join(app.getAppPath(), "prisma", "migrations"),
  };
}

/**
 * La app instalada SIEMPRE verifica la licencia: ninguna variable de entorno la desactiva (VENDEYA_LICENCIA=on solo la habilita en
 * desarrollo). Instalada, la URL y la clave pública salen únicamente de la configuración incrustada en los recursos; en desarrollo
 * también se aceptan variables de entorno.
 */
function configuracionServicios() {
  return {
    rutas: [path.join(process.resourcesPath ?? "", "licencia.config.json"), path.join(app.getAppPath(), "electron", "licencia.config.json")],
    env: process.env,
    empaquetada: app.isPackaged,
    registrar: (m: string) => console.warn(`[servicios cloud] ${m}`),
  };
}

function opcionesLicencia(rutas: RutasApp): NonNullable<Parameters<typeof iniciarBackend>[0]["licencia"]> {
  const servicios = configuracionServicios();
  const config = cargarConfigLicencia(servicios);
  // Solo un paquete de prueba (marca `modoPrueba` incrustada al compilar) puede ir sin licencia; nunca por variables de entorno
  const pruebaSinLicencia = app.isPackaged && esCompilacionDePrueba(servicios);
  return {
    requerida: (app.isPackaged && !pruebaSinLicencia) || process.env["VENDEYA_LICENCIA"] === "on",
    cliente: config === null ? null : new ClienteLicenciasHttp(config.servidorUrl),
    clavePublica: config?.clavePublica ?? null,
    dispositivo: identificarDispositivo({ directorioSecretos: path.join(rutas.userData, "secretos"), version: app.getVersion() }),
  };
}

/** Destino de la telemetría (https) si se configuró; una URL inválida se ignora en lugar de impedir el arranque */
function transporteTelemetria(): TransporteHttp | null {
  const url = cargarDestinoTelemetria(configuracionServicios());
  if (url === undefined || url === "") return null;
  try {
    return new TransporteHttp(url);
  } catch (e) {
    console.warn(`[telemetria] destino ignorado: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

function createWindow(): BrowserWindow {
  Menu.setApplicationMenu(null); // sin la barra nativa (File, Edit, View, Window)
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    title: "VendeYa POS",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false, // Se muestra en ready-to-show para evitar flash blanco
    backgroundColor: "#0f172a",
  });

  // Abrir enlaces externos en el navegador del sistema, no en Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (esEnlaceExternoSeguro(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // La ventana no sale de la interfaz de la aplicación, no incrusta otras páginas y no pide cámara, micrófono, ubicación ni notificaciones
  // La dirección viene en el propio evento (`evento.url`): los argumentos sueltos (url, isInPlace…) están obsoletos en Electron
  win.webContents.on("will-navigate", (evento) => {
    if (!esNavegacionPermitida(evento.url, isDev)) evento.preventDefault();
  });
  win.webContents.on("will-attach-webview", (evento) => evento.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contenido, _permiso, responder) => responder(false));

  win.once("ready-to-show", () => {
    win.show();
  });

  if (isDev) {
    const cargarDev = async (intentos = 30): Promise<void> => {
      try {
        await win.loadURL("http://localhost:5173");
        win.webContents.openDevTools();
      } catch {
        if (intentos > 0 && !win.isDestroyed()) {
          setTimeout(() => void cargarDev(intentos - 1), 500);
        }
      }
    };
    void cargarDev();
  } else {
    void win.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  return win;
}

/**
 * Caja secundaria de la red local: con VENDEYA_SERVIDOR_URL=http://192.168.1.10:3001 esta instalación NO abre base de datos
 * ni servidor propios; la interfaz usa el servidor de la caja principal (la sincronización avisa de los cambios por WebSocket).
 */
function urlDelServidor(): string | undefined {
  const v = process.env["VENDEYA_SERVIDOR_URL"];
  if (v === undefined || v === "") return undefined;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : undefined;
  } catch {
    return undefined;
  }
}

async function arrancar(): Promise<void> {
  devLog("arrancar(): calculando rutas...");
  const rutas = calcularRutas();
  devLog(`arrancar(): db=${rutas.db}, userData=${rutas.userData}, migraciones=${rutas.migraciones}`);
  const servidor = urlDelServidor();
  if (servidor !== undefined) {
    devLog(`arrancar(): modo caja secundaria con servidor ${servidor}`);
    console.log(`[caja secundaria] servidor: ${servidor}`);
    registrarIpcImpresoras();
    registrarIpcApp({ version: app.getVersion(), rutas, obtenerBackend: () => null, urlServidor: servidor });
    iniciarActualizador();
    createWindow();
    return;
  }

  devLog("arrancar(): iniciando backend...");
  backend = await iniciarBackend({
    dbPath: rutas.db,
    migrationsDir: rutas.migraciones,
    backupsDir: rutas.backups,
    // Clave maestra y certificados .p12: fuera de la BD; la clave se envuelve con DPAPI/Keychain si el sistema lo permite
    directorioSecretos: path.join(rutas.userData, "secretos"),
    ...(safeStorage.isEncryptionAvailable()
      ? {
          proteccionClave: {
            proteger: (clave: string) => safeStorage.encryptString(clave).toString("base64"),
            desproteger: (protegido: string) => safeStorage.decryptString(Buffer.from(protegido, "base64")),
          },
        }
      : {}),
    sriWorker: { habilitado: process.env["SRI_WORKER"] !== "off" },
    // Respaldo diario automático (y copia cifrada en la nube si el administrador la configuró)
    // Telemetría de errores: desactivada hasta que el administrador la active.
    telemetria: { version: app.getVersion(), transporte: transporteTelemetria() },
    respaldoAutomatico: { habilitado: process.env["RESPALDO_AUTOMATICO"] !== "off" },
    licencia: opcionesLicencia(rutas),
    // Servidor de la red local: escucha a las demás cajas solo si se pide (VENDEYA_LAN=1)
    redLocal: process.env["VENDEYA_LAN"] === "1",
    port: PUERTO_PREFERIDO,
    logLevel: process.env["LOG_LEVEL"] ?? (isDev ? "info" : "warn"),
  });
  devLog(`arrancar(): backend iniciado en ${backend.url}`);
  console.log(`[backend] ${backend.url} | migraciones aplicadas: ${backend.migraciones.aplicadas.length}`);
  if (backend.migraciones.respaldo !== null) {
    console.log(`[backend] respaldo previo: ${backend.migraciones.respaldo}`);
  }

  registrarIpcImpresoras();
  registrarIpcApp({
    version: app.getVersion(),
    rutas,
    obtenerBackend: () => backend,
  });
  iniciarActualizador();

  devLog("arrancar(): llamando a createWindow()...");
  createWindow();
  devLog("arrancar(): createWindow() completado.");
}

// ── Instancia única: dos procesos sobre la misma BD SQLite corromperían el flujo de caja ──
devLog("Verificando instancia única...");
if (!app.requestSingleInstanceLock()) {
  devLog("Bloqueo de instancia denegado (otra instancia ya corre). Saliendo.");
  app.quit();
} else {
  devLog("Instancia única adquirida. Esperando app.whenReady()...");
  app.on("second-instance", () => {
    const [ventana] = BrowserWindow.getAllWindows();
    if (ventana !== undefined) {
      if (ventana.isMinimized()) ventana.restore();
      ventana.focus();
    }
  });

  app
    .whenReady()
    .then(async () => {
      devLog("app.whenReady() resuelto. Iniciando arrancar()...");
      await arrancar();
      devLog("arrancar() completado con éxito.");
    })
    .catch((error: unknown) => {
      const mensaje = error instanceof Error ? error.message : String(error);
      devLog(`Fallo en arranque: ${mensaje} - ${String(error)}`);
      console.error("[backend] fallo de arranque:", error);
      if (error instanceof MigracionFallidaError) {
        const estado = error.restaurado
          ? "Sus datos están intactos: se volvió a la copia de seguridad tomada justo antes de actualizar."
          : error.respaldo !== null
            ? `Se conserva una copia de seguridad en ${error.respaldo}.`
            : "";
        dialog.showErrorBox("VENDEYA POS no pudo actualizar su base de datos", `${mensaje}

${estado}
Instale de nuevo la versión anterior o contacte a soporte.`);
      } else {
        dialog.showErrorBox("VENDEYA POS no pudo iniciar", mensaje);
      }
      app.exit(1);
    });

  app.on("activate", () => {
    if (backend !== null && BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  // Apagado limpio: cierra Fastify y Prisma antes de terminar el proceso
  app.on("before-quit", (evento) => {
    if (backend === null || cerrando) return;
    evento.preventDefault();
    cerrando = true;
    liberarIpcApp();
    liberarIpcImpresoras();
    liberarIpcUpdater();
    const actual = backend;
    // Si hay una actualización lista se respalda la base de datos ANTES de cerrarla (el instalador corre al terminar el proceso)
    const previo = actualizador === null ? Promise.resolve() : actualizador.antesDeCerrar().catch(() => undefined);
    actualizador?.detener();
    backend = null;
    previo
      .then(() => actual.close())
      .catch((e: unknown) => console.error("[backend] error al cerrar:", e))
      .finally(() => {
        console.log("[backend] cerrado");
        app.quit();
      });
  });
}
