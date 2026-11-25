// ============================================================
// src/renderer/components/Shell.tsx — Marco de la aplicación: barra de estado, menú por permisos y la vista activa
// ============================================================
import React, { useEffect } from "react";
import { useSincronizacion } from "../hooks/useSincronizacion";
import { AjustesPage } from "../pages/AjustesPage";
import { CajaPage } from "../pages/CajaPage";
import { ClientesPage } from "../pages/ClientesPage";
import { ComprasPage } from "../pages/ComprasPage";
import { InventarioPage } from "../pages/InventarioPage";
import { PosScreen } from "../pages/PosScreen";
import { ReportesPage } from "../pages/ReportesPage";
import { SriMonitorPage } from "../pages/SriMonitorPage";
import { menuPara, useNavegacion, type VistaId } from "../store/navegacion.store";
import { useSesion } from "../store/sesion.store";
import { BarraEstado } from "./BarraEstado";

function Vista({ id }: { id: VistaId }): React.JSX.Element {
  switch (id) {
    case "venta":
      return <PosScreen />;
    case "caja":
      return <CajaPage />;
    case "clientes":
      return <ClientesPage />;
    case "inventario":
      return <InventarioPage />;
    case "compras":
      return <ComprasPage />;
    case "reportes":
      return <ReportesPage />;
    case "sri":
      return <SriMonitorPage />;
    case "ajustes":
      return <AjustesPage />;
  }
}

export function Shell({ baseUrl, onSalir }: { baseUrl: string; onSalir: () => void }): React.JSX.Element {
  const usuario = useSesion((s) => s.usuario);
  const sync = useSincronizacion(baseUrl);
  const vista = useNavegacion((s) => s.vista);
  const ir = useNavegacion((s) => s.ir);
  const menu = menuPara(usuario);
  // Si la vista guardada ya no corresponde (otro usuario, permisos distintos) se vuelve a la primera permitida
  const activa: VistaId | null = vista !== null && menu.some((m) => m.id === vista) ? vista : (menu[0]?.id ?? null);

  // Ctrl+1…8 cambia de vista sin soltar el teclado
  useEffect(() => {
    const manejar = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const n = Number(e.key);
      const destino = Number.isInteger(n) && n >= 1 ? menu[n - 1] : undefined;
      if (destino === undefined) return;
      e.preventDefault();
      ir(destino.id);
    };
    window.addEventListener("keydown", manejar);
    return () => window.removeEventListener("keydown", manejar);
  }, [menu, ir]);

  return (
    <div className="flex h-screen flex-col bg-slate-900 text-white">
      <BarraEstado sync={sync} onSalir={onSalir} />
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Menú principal" className="flex w-44 shrink-0 flex-col gap-1 border-r border-slate-700 bg-slate-800/60 p-2">
          {menu.map((m, i) => (
            <button key={m.id} type="button" onClick={() => ir(m.id)} aria-current={m.id === activa ? "page" : undefined} title={`Ctrl+${i + 1}`} className={`rounded-lg px-3 py-3 text-left text-sm font-medium ${m.id === activa ? "bg-brand-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}>
              {m.titulo}
            </button>
          ))}
        </nav>
        <main className={`min-w-0 flex-1 ${activa === "venta" ? "" : "overflow-y-auto p-5"}`}>{activa === null ? <p className="p-6 text-slate-400">Su rol no tiene vistas disponibles.</p> : <Vista id={activa} />}</main>
      </div>
    </div>
  );
}
