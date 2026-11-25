// ============================================================
// src/renderer/services/contexto.tsx — Dependencias de la pantalla (API, WebSocket) inyectables para pruebas
// ============================================================
import React, { createContext, useContext, useMemo } from "react";
import type { WebSocketLike } from "../../server/services/sync/syncCliente";
import { AjustesApi } from "./ajustes.api";
import { ApiCliente } from "./api";
import { GestionApi } from "./gestion.api";
import { PosApi } from "./pos.api";
import { useSesion } from "../store/sesion.store";

export interface ContextoPos {
  api: PosApi;
  /** Crea el WebSocket de la sincronización LAN (en pruebas se sustituye) */
  crearSocket: (url: string) => WebSocketLike;
  /** Id de esta caja en la red local */
  cajaId: string;
}

const Contexto = createContext<ContextoPos | null>(null);

export function ProveedorPos({ valor, children }: { valor: ContextoPos; children: React.ReactNode }): React.JSX.Element {
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function usePos(): ContextoPos {
  const c = useContext(Contexto);
  if (c === null) throw new Error("Falta el ProveedorPos");
  return c;
}

/** API de las vistas de gestión, sobre el mismo cliente HTTP. */
export function useGestion(): GestionApi {
  const { api } = usePos();
  return useMemo(() => new GestionApi(api.http), [api]);
}

/** API del asistente de configuración y de Ajustes. */
export function useAjustes(): AjustesApi {
  const { api } = usePos();
  return useMemo(() => new AjustesApi(api.http), [api]);
}

/** Contexto real: cliente HTTP con el token de la sesión y WebSocket del navegador. */
export function useContextoReal(baseUrl: string, cajaId: string): ContextoPos {
  return useMemo(
    () => ({
      api: new PosApi(
        new ApiCliente({
          baseUrl,
          cajaId,
          obtenerToken: () => useSesion.getState().token,
          // La sesión caducó o la cerraron en otra parte: se vuelve a pedir el acceso
          alNoAutenticado: () => useSesion.getState().cerrar(),
        })
      ),
      crearSocket: (url) => new WebSocket(url) as unknown as WebSocketLike,
      cajaId,
    }),
    [baseUrl, cajaId]
  );
}
