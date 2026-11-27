// ============================================================
// src/renderer/components/Shell.tsx — Marco de la aplicación: barra de estado, menú por permisos y la vista activa
// ============================================================
import { Archive, BadgeHelp, ChartNoAxesColumn, FileCheck2, Settings, ShoppingBag, ShoppingCart, Users, Wallet, type LucideIcon } from "lucide-react";
import React, { useEffect } from "react";
import { useActualizacion } from "../hooks/useActualizacion";
import { useLicencia } from "../hooks/useLicencia";
import { useReporteErrores } from "../hooks/useReporteErrores";
import { useSincronizacion } from "../hooks/useSincronizacion";
import { AjustesPage } from "../pages/AjustesPage";
import { AyudaPage } from "../pages/AyudaPage";
import { CajaPage } from "../pages/CajaPage";
import { ClientesPage } from "../pages/ClientesPage";
import { ComprasPage } from "../pages/ComprasPage";
import { InventarioPage } from "../pages/InventarioPage";
import { PosScreen } from "../pages/PosScreen";
import { ReportesPage } from "../pages/ReportesPage";
import { SriMonitorPage } from "../pages/SriMonitorPage";
import { useCarrito } from "../store/carrito.store";
import { menuPara, useNavegacion, type VistaId } from "../store/navegacion.store";
import { useSesion } from "../store/sesion.store";
import { BannerActualizacion } from "./BannerActualizacion";
import { BannerLicencia } from "./BannerLicencia";
import { BarraEstado } from "./BarraEstado";
import { LimiteErrores } from "./LimiteErrores";

const ICONOS: Record<VistaId, LucideIcon> = {
  venta: ShoppingCart, caja: Wallet, clientes: Users, inventario: Archive, compras: ShoppingBag,
  reportes: ChartNoAxesColumn, sri: FileCheck2, ajustes: Settings, ayuda: BadgeHelp,
};

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
    case "ayuda":
      return <AyudaPage />;
  }
}

export function Shell({ baseUrl, onSalir }: { baseUrl: string; onSalir: () => void }): React.JSX.Element {
  const usuario = useSesion((s) => s.usuario);
  const sync = useSincronizacion(baseUrl);
  const informarError = useReporteErrores(true);
  // Con líneas en el carrito hay una venta en curso (o un cobro abierto): no se reinicia para instalar una actualización
  const ventaEnCurso = useCarrito((s) => s.lineas.length > 0);
  const actualizacion = useActualizacion(ventaEnCurso);
  const vista = useNavegacion((s) => s.vista);
  const ir = useNavegacion((s) => s.ir);
  const menu = menuPara(usuario);
  // Si la vista guardada ya no corresponde (otro usuario, permisos distintos) se vuelve a la primera permitida
  // Sin licencia que permita operar, lo primero es poder activarla: se abre Ajustes (si el usuario tiene acceso)
  const sinLicencia = useLicencia().data?.permiteOperar === false;
  const inicial: VistaId | null = sinLicencia && menu.some((m) => m.id === "ajustes") ? "ajustes" : (menu[0]?.id ?? null);
  const activa: VistaId | null = vista !== null && menu.some((m) => m.id === vista) ? vista : inicial;

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
      <BannerLicencia />
      <BannerActualizacion actualizacion={actualizacion} ocupado={ventaEnCurso} />
      <BarraEstado sync={sync} onSalir={onSalir} />
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Menú principal" className="flex w-48 shrink-0 flex-col gap-1 overflow-y-auto border-r border-slate-700 bg-slate-800/60 p-2">
          {menu.map((m, i) => {
            const Icono = ICONOS[m.id];
            return (
              <button key={m.id} type="button" onClick={() => ir(m.id)} aria-current={m.id === activa ? "page" : undefined} title={`Ctrl+${i + 1}`} className={`flex items-center gap-2.5 rounded-lg px-3 py-3 text-left text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 ${m.id === activa ? "bg-brand-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}>
                <Icono className="h-[1.125rem] w-[1.125rem] shrink-0" aria-hidden="true" />
                {m.titulo}
              </button>
            );
          })}
        </nav>
        <main className={`min-w-0 flex-1 ${activa === "venta" ? "" : "overflow-y-auto p-5"}`}>{activa === null ? <p className="p-6 text-slate-400">Su rol no tiene vistas disponibles.</p> : <LimiteErrores clave={activa} alError={informarError}><Vista id={activa} /></LimiteErrores>}</main>
      </div>
    </div>
  );
}
