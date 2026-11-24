// ============================================================
// electron/ipc/printer.ipc.ts — Impresoras instaladas en el sistema (para elegir la térmica en la configuración)
// Canal (ya permitido en la allowlist de preload.ts): printer:list
// ============================================================
import { BrowserWindow, ipcMain } from "electron";

export interface ImpresoraSistema {
  nombre: string;
  descripcion: string;
  esPredeterminada: boolean;
}

export const CANAL_IPC_IMPRESORAS = "printer:list" as const;

export function registrarIpcImpresoras(): void {
  ipcMain.handle(CANAL_IPC_IMPRESORAS, async (): Promise<ImpresoraSistema[]> => {
    const ventana = BrowserWindow.getAllWindows()[0];
    if (ventana === undefined) return [];
    const impresoras = await ventana.webContents.getPrintersAsync();
    return impresoras.map((p) => ({ nombre: p.name, descripcion: p.description, esPredeterminada: p.isDefault }));
  });
}

export function liberarIpcImpresoras(): void {
  ipcMain.removeHandler(CANAL_IPC_IMPRESORAS);
}
