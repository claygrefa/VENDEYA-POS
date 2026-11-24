// ============================================================
// electron/main.ts — Proceso Principal de Electron (VENDEYA POS)
// Orden de arranque: instancia única → backend (BD + migraciones con respaldo
// + Fastify) → IPC → ventana. Apagado limpio del backend al salir.
// ============================================================

import path from "path";
import { app, BrowserWindow, dialog, safeStorage, shell } from "electron";
import { iniciarBackend, type BackendHandle } from "../src/server";
import { liberarIpcApp, registrarIpcApp, type RutasApp } from "./ipc/app.ipc";

const isDev = process.env["NODE_ENV"] === "development";
const PUERTO_PREFERIDO = parseInt(process.env["SERVER_PORT"] ?? "3001", 10);

let backend: BackendHandle | null = null;
let cerrando = false;

function calcularRutas(): RutasApp {
  const userData = app.getPath("userData");
  const dbEnv = process.env["DB_PATH"];
  const db = dbEnv !== undefined && dbEnv !== "" ? path.resolve(dbEnv) : path.join(userData, "data", "vendeya.db");
  return {
    userData,
    db,
    backups: path.join(path.dirname(db), "backups"),
    // Empaquetado: extraResources → <resources>/prisma/migrations; desarrollo: raíz del proyecto
    migraciones: app.isPackaged
      ? path.join(process.resourcesPath, "prisma", "migrations")
      : path.join(app.getAppPath(), "prisma", "migrations"),
  };
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    title: "VENDEYA POS",
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
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  if (isDev) {
    void win.loadURL("http://localhost:5173");
    win.webContents.openDevTools();
  } else {
    void win.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  return win;
}

async function arrancar(): Promise<void> {
  const rutas = calcularRutas();

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
    port: PUERTO_PREFERIDO,
    logLevel: process.env["LOG_LEVEL"] ?? (isDev ? "info" : "warn"),
  });
  console.log(`[backend] ${backend.url} | migraciones aplicadas: ${backend.migraciones.aplicadas.length}`);
  if (backend.migraciones.respaldo !== null) {
    console.log(`[backend] respaldo previo: ${backend.migraciones.respaldo}`);
  }

  registrarIpcApp({
    version: app.getVersion(),
    rutas,
    obtenerBackend: () => backend,
  });

  createWindow();
}

// ── Instancia única: dos procesos sobre la misma BD SQLite corromperían el flujo de caja ──
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [ventana] = BrowserWindow.getAllWindows();
    if (ventana !== undefined) {
      if (ventana.isMinimized()) ventana.restore();
      ventana.focus();
    }
  });

  app
    .whenReady()
    .then(arrancar)
    .catch((error: unknown) => {
      const mensaje = error instanceof Error ? error.message : String(error);
      console.error("[backend] fallo de arranque:", error);
      dialog.showErrorBox("VENDEYA POS no pudo iniciar", mensaje);
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
    const actual = backend;
    backend = null;
    actual
      .close()
      .catch((e: unknown) => console.error("[backend] error al cerrar:", e))
      .finally(() => {
        console.log("[backend] cerrado");
        app.quit();
      });
  });
}
