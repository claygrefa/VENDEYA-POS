// ============================================================
// src/renderer/components/Shell.tsx — Marco de la aplicación: barra de estado, menú por permisos y la vista activa
// ============================================================
import { Archive, BadgeHelp, ChartNoAxesColumn, FileCheck2, PanelLeftClose, PanelLeftOpen, Settings, ShoppingBag, ShoppingCart, Users, Wallet, type LucideIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
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
import { usePreferencias } from "../store/preferencias.store";
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
  const contraido = usePreferencias((s) => s.menuContraido);
  const alternarMenu = usePreferencias((s) => s.alternarMenu);
  // Si la vista guardada ya no corresponde (otro usuario, permisos distintos) se vuelve a la primera permitida
  // Sin licencia que permita operar, lo primero es poder activarla: se abre Ajustes (si el usuario tiene acceso)
  const sinLicencia = useLicencia().data?.permiteOperar === false;
  const inicial: VistaId | null = sinLicencia && menu.some((m) => m.id === "ajustes") ? "ajustes" : (menu[0]?.id ?? null);
  const activa: VistaId | null = vista !== null && menu.some((m) => m.id === vista) ? vista : inicial;

  // Ctrl+1…8 cambia de vista sin soltar el teclado
  useEffect(() => {
    const manejar = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        alternarMenu();
        return;
      }
      const n = Number(e.key);
      const destino = Number.isInteger(n) && n >= 1 ? menu[n - 1] : undefined;
      if (destino === undefined) return;
      e.preventDefault();
      ir(destino.id);
    };
    window.addEventListener("keydown", manejar);
    return () => window.removeEventListener("keydown", manejar);
  }, [menu, ir, alternarMenu]);

  // Versión instalada (solo existe dentro de Electron; en el navegador no se muestra)
  const version = useQuery({
    queryKey: ["ajustes", "version"],
    queryFn: () => (window as Partial<Window>).vendeya?.invoke<string>("app:get-version") ?? Promise.resolve(null),
    staleTime: Infinity,
    retry: false,
  });

  return (
    <div className="flex h-screen flex-col bg-slate-900 text-ink">
      <BannerLicencia />
      <BannerActualizacion actualizacion={actualizacion} ocupado={ventaEnCurso} />
      <BarraEstado sync={sync} onSalir={onSalir} />
      <div className="flex min-h-0 flex-1">
        <div className={`flex shrink-0 flex-col border-r border-slate-700 bg-slate-800/60 transition-[width] duration-150 ${contraido ? "w-[4.5rem]" : "w-52"}`}>
        <nav aria-label="Menú principal" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
          <div className={`mb-2 flex items-center gap-3 border-b border-slate-700 pb-3 pt-1 ${contraido ? "justify-center px-0" : "px-2"}`} data-testid="marca">
            <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-lg font-black text-white shadow-lg">
              V
            </span>
            {contraido ? <span className="sr-only">VendeYa POS</span> : (
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-base font-bold tracking-tight text-ink">VendeYa <span className="text-brand-300">POS</span></span>
                {version.data ? <span className="block text-xs tabular-nums text-slate-400">v{version.data}</span> : null}
              </span>
            )}
          </div>
          {menu.map((m, i) => {
            const Icono = ICONOS[m.id];
            return (
              <button key={m.id} type="button" onClick={() => ir(m.id)} aria-current={m.id === activa ? "page" : undefined} aria-label={m.titulo} title={contraido ? `${m.titulo} (Ctrl+${i + 1})` : `Ctrl+${i + 1}`} className={`flex items-center rounded-lg border-l-4 py-3 text-left text-sm font-medium transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 ${contraido ? "justify-center px-0" : "gap-2.5 px-3"} ${m.id === activa ? "border-brand-400 bg-brand-500/15 text-ink" : "border-transparent text-slate-300 hover:bg-slate-700/70 hover:text-ink"}`}>
                <Icono className={`h-[1.125rem] w-[1.125rem] shrink-0 ${m.id === activa ? "text-brand-300" : ""}`} aria-hidden="true" />
                {contraido ? null : m.titulo}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-slate-700 p-2">
          <button type="button" onClick={alternarMenu} aria-expanded={!contraido} aria-label={contraido ? "Expandir menú" : "Contraer menú"} title="Ctrl+B" className={`flex w-full items-center rounded-lg py-2.5 text-sm text-slate-400 hover:bg-slate-700/70 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 ${contraido ? "justify-center px-0" : "gap-2.5 px-3"}`}>
            {contraido ? <PanelLeftOpen className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" /> : <><PanelLeftClose className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" /> Contraer</>}
          </button>
        </div>
        </div>
        <main className={`min-w-0 flex-1 ${activa === "venta" ? "" : "overflow-y-auto p-5"}`}>{activa === null ? <p className="p-6 text-slate-400">Su rol no tiene vistas disponibles.</p> : <LimiteErrores clave={activa} alError={informarError}><Vista id={activa} /></LimiteErrores>}</main>
      </div>
    </div>
  );
}
