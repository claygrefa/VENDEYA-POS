// ============================================================
// src/renderer/App.tsx — Raíz de la aplicación: conexión con el backend y flujo Ingreso → Turno → Venta
// ============================================================
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useEffect, useMemo, useState } from "react";
import { AperturaTurnoPage } from "./pages/AperturaTurnoPage";
import { LoginPage } from "./pages/LoginPage";
import { PosScreen } from "./pages/PosScreen";
import { ProveedorPos, useContextoReal, usePos } from "./services/contexto";
import { useCarrito } from "./store/carrito.store";
import { useSesion } from "./store/sesion.store";

/** URL del backend: la que informa Electron (puerto libre o servidor de la red local); en desarrollo, la del entorno. */
export async function resolverBaseUrl(): Promise<string> {
  const puente = (window as Partial<Window>).vendeya;
  if (puente !== undefined) {
    try {
      const info = await puente.invoke<{ url: string } | null>("backend:get-info");
      if (info !== null && info !== undefined) return info.url;
    } catch {
      /* se usa la URL de respaldo */
    }
  }
  return import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3001";
}

/** Nombre de esta caja en la red local (se genera una vez y se recuerda). */
export function cajaIdLocal(): string {
  const clave = "vendeya.cajaId";
  try {
    const guardado = globalThis.localStorage?.getItem(clave);
    if (guardado !== null && guardado !== undefined && guardado !== "") return guardado;
    const nuevo = `caja-${Math.random().toString(36).slice(2, 6)}`;
    globalThis.localStorage?.setItem(clave, nuevo);
    return nuevo;
  } catch {
    return `caja-${Math.random().toString(36).slice(2, 6)}`;
  }
}

export function crearQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, gcTime: 300_000, retry: false, refetchOnWindowFocus: false } } });
}

/** Flujo de pantallas (sin lógica de conexión): se prueba inyectando el contexto. */
export function AplicacionPos({ baseUrl }: { baseUrl: string }): React.JSX.Element {
  const { api } = usePos();
  const token = useSesion((s) => s.token);
  const turno = useSesion((s) => s.turno);

  const salir = (): void => {
    void api.logout().catch(() => undefined);
    useCarrito.getState().vaciar();
    useSesion.getState().cerrar();
  };

  if (token === null) return <LoginPage />;
  if (turno === null) return <AperturaTurnoPage onSalir={salir} />;
  return <PosScreen baseUrl={baseUrl} onSalir={salir} />;
}

export default function App(): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const queryClient = useMemo(() => crearQueryClient(), []);
  const cajaId = useMemo(() => cajaIdLocal(), []);

  useEffect(() => {
    void resolverBaseUrl().then(setBaseUrl);
  }, []);

  if (baseUrl === null) return <p className="p-8 text-center text-slate-300">Conectando con el servidor…</p>;
  return (
    <QueryClientProvider client={queryClient}>
      <ConContexto baseUrl={baseUrl} cajaId={cajaId} />
    </QueryClientProvider>
  );
}

function ConContexto({ baseUrl, cajaId }: { baseUrl: string; cajaId: string }): React.JSX.Element {
  const valor = useContextoReal(baseUrl, cajaId);
  return (
    <ProveedorPos valor={valor}>
      <AplicacionPos baseUrl={baseUrl} />
    </ProveedorPos>
  );
}
