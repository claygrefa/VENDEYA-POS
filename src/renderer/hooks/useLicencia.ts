// ============================================================
// src/renderer/hooks/useLicencia.ts — Estado de la licencia (se consulta al entrar y cada 5 minutos)
// ============================================================
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { EstadoLicencia } from "../../shared/types/licencia.types";
import { useAjustes } from "../services/contexto";

export const CLAVE_LICENCIA = ["licencia"] as const;

/**
 * Si el servidor no responde (o es una versión sin licenciamiento) la consulta falla y simplemente no se muestra nada: el aviso nunca
 * debe estorbar la venta por sí mismo; quien bloquea es el servidor con el 402.
 */
export function useLicencia(habilitada = true): UseQueryResult<EstadoLicencia> {
  const ajustes = useAjustes();
  return useQuery({ queryKey: CLAVE_LICENCIA, queryFn: () => ajustes.licencia(), refetchInterval: 5 * 60_000, staleTime: 60_000, retry: false, enabled: habilitada });
}
