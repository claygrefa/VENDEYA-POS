// ============================================================
// src/renderer/hooks/consultas.ts — Consultas de TanStack Query del POS
// ============================================================
import { useQuery } from "@tanstack/react-query";
import { usePos } from "../services/contexto";

export function useProductos(busqueda: string) {
  const { api } = usePos();
  return useQuery({ queryKey: ["productos", busqueda.trim()], queryFn: () => api.productos(busqueda), staleTime: 15_000, placeholderData: (previo) => previo });
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
