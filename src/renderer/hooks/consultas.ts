// ============================================================
// src/renderer/hooks/consultas.ts — Consultas de TanStack Query del POS
// ============================================================
import { useQuery } from "@tanstack/react-query";
import { usePos } from "../services/contexto";
import { RETRASO_BUSQUEDA_MS, useDiferido } from "./useDiferido";

export const claveProductos = (texto: string, categoriaId?: string): string[] =>
  categoriaId === undefined ? ["productos", texto] : ["productos", texto, categoriaId];

export function useProductos(busqueda: string, categoriaId?: string) {
  const { api } = usePos();
  // Se consulta cuando el cajero hace una pausa al teclear: con un catálogo grande, una consulta por tecla es desperdicio
  const texto = useDiferido(busqueda.trim(), RETRASO_BUSQUEDA_MS);
  return useQuery({
    queryKey: claveProductos(texto, categoriaId),
    queryFn: () => api.productos(texto, undefined, categoriaId),
    staleTime: 15_000,
    placeholderData: (previo, consulta) => consulta?.queryKey[2] === categoriaId ? previo : undefined,
  });
}

export function useClientes(busqueda: string, activo: boolean) {
  const { api } = usePos();
  return useQuery({ queryKey: ["clientes", busqueda.trim()], queryFn: () => api.clientes(busqueda), enabled: activo && busqueda.trim().length >= 2, staleTime: 15_000 });
}

export function usePuntosEmision() {
  const { api } = usePos();
  return useQuery({ queryKey: ["puntosEmision"], queryFn: () => api.puntosEmision(), staleTime: 300_000 });
}

export function useBalanza() {
  const { api } = usePos();
  return useQuery({ queryKey: ["balanza"], queryFn: () => api.balanza(), staleTime: 300_000, retry: false });
}

export function useImpresora() {
  const { api } = usePos();
  return useQuery({ queryKey: ["impresora"], queryFn: () => api.impresora(), staleTime: 300_000, retry: false });
}

export function useColaSri() {
  const { api } = usePos();
  return useQuery({ queryKey: ["colaSri"], queryFn: () => api.colaSri(), refetchInterval: 30_000, retry: false });
}
