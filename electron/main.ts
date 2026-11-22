// ============================================================
// electron/main.ts — Proceso Principal de Electron (VENDEYA POS)
// STUB de Semana 1: Arranca ventana BrowserWindow básica.
// La integración completa con Fastify y auto-updater se implementa en Semana 4.
// ============================================================

import { app, BrowserWindow, shell } from "electron";
import path from "path";

const isDev = process.env.NODE_ENV === "development";

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
    show: false, // Se muestra en el evento ready-to-show para evitar flash blanco
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
    void win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  return win;
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
