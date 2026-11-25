// ============================================================
// src/renderer/components/BannerActualizacion.tsx — Aviso de nueva versión (descarga silenciosa, lista para instalar, error)
// No aparece si no hay nada que decir (al día, buscando, desactivado): no distrae al cajero.
// ============================================================
import React, { useState } from "react";
import type { ActualizacionVista } from "../hooks/useActualizacion";

export function BannerActualizacion({ actualizacion, ocupado }: { actualizacion: ActualizacionVista; ocupado: boolean }): React.JSX.Element | null {
  const { estado } = actualizacion;
  const [rechazo, setRechazo] = useState<string | null>(null);
  const [descartado, setDescartado] = useState<string | null>(null);
  if (estado === null) return null;

  const instalar = async (): Promise<void> => setRechazo(await actualizacion.instalar());

  if (estado.tipo === "descargando") {
    return (
      <div role="status" aria-label="Actualización" className="flex items-center justify-between gap-4 border-b border-sky-800 bg-sky-950 px-4 py-1.5 text-sm text-sky-200">
        <span>
          Descargando la versión {estado.version} en segundo plano… {estado.porcentaje}%
        </span>
      </div>
    );
  }

  if (estado.tipo === "lista") {
    return (
      <div role="status" aria-label="Actualización" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-emerald-800 bg-emerald-950 px-4 py-1.5 text-sm text-emerald-100">
        <span>
          {estado.aviso !== null
            ? estado.aviso
            : `La versión ${estado.version} está lista. Se instalará al cerrar la aplicación; sus datos ya tienen una copia de seguridad.`}
          {ocupado ? " Termine la venta en curso para poder reiniciar." : ""}
        </span>
        <span className="flex items-center gap-3">
          {rechazo !== null ? <span role="alert" className="text-amber-300">{rechazo}</span> : null}
          <button type="button" disabled={ocupado} onClick={() => void instalar()} className="rounded-lg bg-emerald-700 px-3 py-1 font-medium text-white hover:bg-emerald-600 disabled:opacity-40">
            Reiniciar e instalar
          </button>
        </span>
      </div>
    );
  }

  if (estado.tipo === "error" && descartado !== estado.mensaje) {
    return (
      <div role="alert" aria-label="Actualización" className="flex items-center justify-between gap-4 border-b border-amber-800 bg-amber-950 px-4 py-1.5 text-sm text-amber-100">
        <span>{estado.mensaje}</span>
        <span className="flex gap-3">
          <button type="button" onClick={() => void actualizacion.buscar()} className="rounded-lg border border-amber-600 px-3 py-1 hover:bg-amber-900">
            Reintentar
          </button>
          <button type="button" onClick={() => setDescartado(estado.mensaje)} className="px-2 py-1 text-amber-300 hover:text-white">
            Cerrar
          </button>
        </span>
      </div>
    );
  }
  return null;
}
