// ============================================================
// src/renderer/App.tsx — Componente raíz de la aplicación
// ============================================================

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:            60_000,
      gcTime:               300_000,
      retry:                2,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-surface-900 text-white flex flex-col items-center justify-center select-none">
        <div className="text-center space-y-4 p-8">
          {/* Logo / wordmark */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="w-14 h-14 rounded-2xl bg-brand-600 flex items-center justify-center shadow-lg shadow-brand-900/50">
              <span className="text-2xl font-bold text-white tracking-tighter">VP</span>
            </div>
            <div className="text-left">
              <h1 className="text-3xl font-bold text-white tracking-tight">VENDEYA</h1>
              <p className="text-brand-400 text-sm font-medium tracking-widest uppercase">Point of Sale</p>
            </div>
          </div>

          {/* Estado del sistema */}
          <div className="bg-surface-800 border border-surface-700 rounded-xl p-6 max-w-md w-full text-left space-y-3">
            <h2 className="text-surface-200 font-semibold text-sm uppercase tracking-wider mb-4">Estado del Sistema</h2>
            <StatusRow label="Motor POS"           status="ok"      text="Listo"              />
            <StatusRow label="Base de Datos"        status="pending" text="Por inicializar (S2)" />
            <StatusRow label="Servidor Fastify"     status="pending" text="Por integrar (S4)"    />
            <StatusRow label="Facturación SRI"      status="pending" text="Por implementar (S9)"  />
          </div>

          {/* Footer versión */}
          <p className="text-surface-600 text-xs mt-8">
            VENDEYA POS v0.1.0 · Semana 1 de 24 · Offline-First · SRI Ecuador
          </p>
        </div>
      </div>
    </QueryClientProvider>
  );
}

interface StatusRowProps {
  label:  string;
  status: "ok" | "pending" | "error";
  text:   string;
}

function StatusRow({ label, status, text }: StatusRowProps): React.JSX.Element {
  const dot: Record<StatusRowProps["status"], string> = {
    ok:      "bg-success-500",
    pending: "bg-warning-500",
    error:   "bg-danger-500",
  };
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-surface-400 text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dot[status]}`} />
        <span className="text-surface-300 text-sm font-mono">{text}</span>
      </div>
    </div>
  );
}
