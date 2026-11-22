// ============================================================
// electron/preload.ts — Bridge seguro entre Renderer y Main
// Semana 1: Define el API mínimo que el renderer puede invocar.
// Se ampliará con IPC handlers en Semana 4.
// ============================================================

import { contextBridge, ipcRenderer } from "electron";

/** Versión de la aplicación expuesta al renderer */
const appVersion: string = process.env.npm_package_version ?? "0.1.0";

/** API expuesta al renderer a través de contextBridge */
export interface VendeyaAPI {
  /** Versión del paquete */
  readonly version: string;
  /** Plataforma del sistema operativo */
  readonly platform: NodeJS.Platform;
  /**
   * Envía un evento IPC al proceso principal y espera la respuesta.
   * @param channel - Nombre del canal IPC (debe estar en allowedChannels)
   * @param args    - Argumentos serializables pasados al handler
   */
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;
  /**
   * Escucha eventos emitidos desde el proceso principal.
   * @returns Función para remover el listener (cleanup)
   */
  on: (channel: string, listener: (...args: unknown[]) => void) => () => void;
}

/** Canales IPC permitidos (allowlist de seguridad) */
const allowedInvokeChannels = [
  "app:get-version",
  "app:get-paths",
  "db:health-check",
  "sri:check-connectivity",
  "printer:list",
  "updater:check",
] as const;

const allowedListenChannels = [
  "updater:status",
  "db:migration-progress",
  "sri:queue-status",
] as const;

type AllowedInvokeChannel = (typeof allowedInvokeChannels)[number];
type AllowedListenChannel = (typeof allowedListenChannels)[number];

function isAllowedInvoke(channel: string): channel is AllowedInvokeChannel {
  return (allowedInvokeChannels as readonly string[]).includes(channel);
}

function isAllowedListen(channel: string): channel is AllowedListenChannel {
  return (allowedListenChannels as readonly string[]).includes(channel);
}

const vendeyaAPI: VendeyaAPI = {
  version: appVersion,
  platform: process.platform,

  invoke: async <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => {
    if (!isAllowedInvoke(channel)) {
      throw new Error(`Canal IPC no permitido: "${channel}"`);
    }
    return ipcRenderer.invoke(channel, ...args) as Promise<T>;
  },

  on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
    if (!isAllowedListen(channel)) {
      throw new Error(`Canal IPC de escucha no permitido: "${channel}"`);
    }
    const wrappedListener = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => {
      listener(...args);
    };
    ipcRenderer.on(channel, wrappedListener);
    return () => {
      ipcRenderer.removeListener(channel, wrappedListener);
    };
  },
};

contextBridge.exposeInMainWorld("vendeya", vendeyaAPI);
