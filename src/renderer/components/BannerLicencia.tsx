// ============================================================
// src/renderer/components/BannerLicencia.tsx — Aviso cuando la licencia está por vencer, en gracia o no permite vender
// No aparece con licencia activa ni cuando el licenciamiento no es requerido.
// ============================================================
import React from "react";
import type { TipoEstadoLicencia } from "../../shared/types/licencia.types";
import { useLicencia } from "../hooks/useLicencia";
import { useNavegacion } from "../store/navegacion.store";
import { tienePermiso, useSesion } from "../store/sesion.store";

const AVISO: ReadonlySet<TipoEstadoLicencia> = new Set<TipoEstadoLicencia>(["POR_VENCER", "GRACIA"]);
const BLOQUEO: ReadonlySet<TipoEstadoLicencia> = new Set<TipoEstadoLicencia>(["SIN_LICENCIA", "VENCIDA", "BLOQUEADA_OFFLINE", "REVOCADA", "INVALIDA"]);

export function BannerLicencia(): React.JSX.Element | null {
  const licencia = useLicencia();
  const usuario = useSesion((s) => s.usuario);
  const irAjustes = useNavegacion((s) => s.irAjustes);
  const e = licencia.data;
  if (e === undefined || (!AVISO.has(e.tipo) && !BLOQUEO.has(e.tipo))) return null;

  const bloquea = BLOQUEO.has(e.tipo);
  const administra = tienePermiso(usuario, "configuracion:actualizar");
  return (
    <div
      role={bloquea ? "alert" : "status"}
      aria-label="Licencia"
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-4 py-1.5 text-sm ${bloquea ? "border-red-800 bg-red-950 text-red-100" : "border-amber-800 bg-amber-950 text-amber-100"}`}
    >
      <span>
        {bloquea ? <strong>No se puede vender. </strong> : null}
        {e.mensaje}
        {administra ? "" : " Avise al administrador."}
      </span>
      {administra ? (
        <button type="button" onClick={() => irAjustes("licencia")} className="rounded-lg border border-current px-3 py-1 font-medium hover:bg-white/10">
          Abrir Ajustes › Licencia
        </button>
      ) : null}
    </div>
  );
}
