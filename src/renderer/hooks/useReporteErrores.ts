// ============================================================
// src/renderer/hooks/useReporteErrores.ts — La interfaz informa sus errores técnicos (solo si el administrador lo autorizó)
//
// Escucha los errores no capturados de la ventana y los que atrapa el límite de errores de React. Consulta el consentimiento y, si está
// desactivado, no envía ni la petición. El servidor limpia el texto otra vez (la interfaz no es de confiar). Nunca lanza.
// ============================================================
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { useAjustes } from "../services/contexto";
import { useNavegacion } from "../store/navegacion.store";

export const CLAVE_TELEMETRIA = ["telemetria"] as const;

export function textoDeError(e: unknown): { mensaje: string; pila: string | null } {
  if (e instanceof Error) return { mensaje: e.message === "" ? e.name : `${e.name}: ${e.message}`, pila: e.stack ?? null };
  if (typeof e === "string" && e !== "") return { mensaje: e, pila: null };
  return { mensaje: "Error desconocido", pila: null };
}

/** Devuelve la función para informar un error y deja instalados los oyentes globales mientras `activo`. */
export function useReporteErrores(activo: boolean): (e: unknown) => void {
  const a = useAjustes();
  const consentimiento = useQuery({ queryKey: CLAVE_TELEMETRIA, queryFn: () => a.telemetria(), enabled: activo, retry: false, staleTime: 5 * 60_000 }).data?.consentimiento === true;
  const vista = useNavegacion((s) => s.vista);
  const ultimo = useRef({ a, consentimiento, vista });
  ultimo.current = { a, consentimiento, vista };

  const informar = useCallback((e: unknown): void => {
    const { a: api, consentimiento: autorizado, vista: donde } = ultimo.current;
    if (!autorizado) return;
    const { mensaje, pila } = textoDeError(e);
    void api.reportarError({ mensaje, pila, vista: donde }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!activo) return;
    const alError = (ev: ErrorEvent): void => informar(ev.error ?? ev.message);
    const alRechazo = (ev: PromiseRejectionEvent): void => informar(ev.reason);
    window.addEventListener("error", alError);
    window.addEventListener("unhandledrejection", alRechazo);
    return () => {
      window.removeEventListener("error", alError);
      window.removeEventListener("unhandledrejection", alRechazo);
    };
  }, [activo, informar]);

  return informar;
}
