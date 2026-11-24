// ============================================================
// electron/ipc/app.ipc.ts — Handlers IPC de aplicación y base de datos
// Canales (deben coincidir con la allowlist de preload.ts):
//   app:get-version, app:get-paths, db:health-check, backend:get-info
// ============================================================
import { ipcMain } from "electron";
import type { BackendHandle } from "../../src/server";

export interface RutasApp {
  userData: string;
  db: string;
  backups: string;
  migraciones: string;
}

export interface IpcAppContexto {
  version: string;
  rutas: RutasApp;
  /** Devuelve el backend activo o null si aún no arrancó / ya se cerró */
  obtenerBackend: () => BackendHandle | null;
  /** Caja secundaria de la red local: URL del servidor (este equipo no tiene backend propio) */
  urlServidor?: string;
}

export interface BackendInfo {
  url: string;
  port: number;
  migracionesAplicadas: string[];
}

export interface DbHealth {
  ok: boolean;
  error?: string;
}

export const CANALES_IPC_APP = [
  "app:get-version",
  "app:get-paths",
  "db:health-check",
  "backend:get-info",
] as const;

export function registrarIpcApp(ctx: IpcAppContexto): void {
  ipcMain.handle("app:get-version", (): string => ctx.version);

  ipcMain.handle("app:get-paths", (): RutasApp => ctx.rutas);

  ipcMain.handle("backend:get-info", (): BackendInfo | null => {
    if (ctx.urlServidor !== undefined) {
      const u = new URL(ctx.urlServidor);
      return { url: ctx.urlServidor, port: Number(u.port || 80), migracionesAplicadas: [] };
    }
    const b = ctx.obtenerBackend();
    return b === null ? null : { url: b.url, port: b.port, migracionesAplicadas: b.migraciones.aplicadas };
  });

  ipcMain.handle("db:health-check", async (): Promise<DbHealth> => {
    const b = ctx.obtenerBackend();
    if (b === null) return { ok: false, error: "Backend no iniciado" };
    try {
      await b.prisma.$queryRawUnsafe("SELECT 1");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

export function liberarIpcApp(): void {
  for (const canal of CANALES_IPC_APP) ipcMain.removeHandler(canal);
}
