// ============================================================
// electron/ipc/updater.ipc.ts — Canales de la auto-actualización
//   updater:check · updater:get-status · updater:install · updater:set-busy   (y el evento updater:status hacia la interfaz)
// Deben coincidir con la allowlist de preload.ts.
// ============================================================
import { ipcMain } from "electron";
import type { EstadoActualizacion, ResultadoInstalacion } from "../../src/shared/types/actualizacion.types";
import type { ActualizadorApp } from "../updater/updater.service";

export const CANALES_IPC_UPDATER = ["updater:check", "updater:get-status", "updater:install", "updater:set-busy"] as const;

/** Lo que se usa de `ipcMain` (se sustituye en las pruebas). */
export interface IpcMainLike {
  handle: (canal: string, escucha: (evento: unknown, ...args: unknown[]) => unknown) => void;
  removeHandler: (canal: string) => void;
}

export function registrarIpcUpdater(actualizador: ActualizadorApp, ipc: IpcMainLike = ipcMain as unknown as IpcMainLike): void {
  ipc.handle("updater:check", (): Promise<EstadoActualizacion> => actualizador.buscar());
  ipc.handle("updater:get-status", (): EstadoActualizacion => actualizador.estado());
  ipc.handle("updater:install", (): Promise<ResultadoInstalacion> => actualizador.instalar());
  ipc.handle("updater:set-busy", (_evento, ocupado): void => {
    // Un valor inesperado cuenta como «ocupado»: ante la duda no se reinicia
    actualizador.fijarOcupado(ocupado !== false);
  });
}

export function liberarIpcUpdater(ipc: IpcMainLike = ipcMain as unknown as IpcMainLike): void {
  for (const canal of CANALES_IPC_UPDATER) ipc.removeHandler(canal);
}
