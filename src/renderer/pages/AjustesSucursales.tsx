// ============================================================
// src/renderer/pages/AjustesSucursales.tsx — Ajustes › Sucursales: establecimientos y puntos de emisión (cajas)
// El código (001, 002…) lo asigna el sistema y no cambia: es parte de la serie de los comprobantes del SRI.
// ============================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { Boton, Campo, mensajeDeError } from "../components/Gestion";
import { Aviso, Modal } from "../components/Modal";
import type { PuntoEmisionGestion, SucursalGestion } from "../services/ajustes.api";
import { useAjustes } from "../services/contexto";

const CLAVE = ["ajustes", "sucursales"] as const;

type Accion =
  | { tipo: "nueva" }
  | { tipo: "editar"; sucursal: SucursalGestion }
  | { tipo: "estado"; sucursal: SucursalGestion }
  | { tipo: "nuevaCaja"; sucursal: SucursalGestion }
  | { tipo: "editarCaja"; sucursal: SucursalGestion; punto: PuntoEmisionGestion };

export function SeccionSucursales(): React.JSX.Element {
  const a = useAjustes();
  const [accion, setAccion] = useState<Accion | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const q = useQuery({ queryKey: CLAVE, queryFn: () => a.sucursales() });
  const abrir = (x: Accion): void => { setExito(null); setAccion(x); };
  const cerrar = (mensaje?: string): void => { setAccion(null); if (mensaje !== undefined) setExito(mensaje); };

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-slate-400">
          Cada sucursal tiene su código (001, 002…) y sus cajas, que son los puntos de emisión de las facturas. Los códigos los asigna el sistema y no cambian ni se reutilizan.
        </p>
        <Boton variante="primario" onClick={() => abrir({ tipo: "nueva" })}>Nueva sucursal</Boton>
      </div>
      <Aviso tipo="info">Antes de facturar con una sucursal nueva, el establecimiento debe estar registrado en el SRI (en el RUC de la empresa); si no, los comprobantes serán rechazados.</Aviso>
      {exito !== null ? <Aviso tipo="exito">{exito}</Aviso> : null}
      {q.isError ? <Aviso tipo="error">{mensajeDeError(q.error)}</Aviso> : null}
      {q.isPending ? <p className="text-slate-400">Cargando…</p> : null}
      <ul aria-label="Sucursales" className="space-y-3">
        {(q.data?.items ?? []).map((s) => (
          <li key={s.id} aria-label={`Sucursal ${s.codigo}`} className="space-y-3 rounded-xl border border-slate-700 bg-slate-800/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-ink">
                  {s.codigo} · {s.nombre} {s.estado === "INACTIVO" ? <span className="ml-2 rounded bg-slate-700 px-2 py-0.5 text-xs font-normal text-slate-300">Inactiva</span> : null}
                </h2>
                <p className="text-sm text-slate-400">{s.direccion} · Tel. {s.telefono}</p>
                {s.turnosAbiertos > 0 ? <p className="text-xs text-emerald-300">{s.turnosAbiertos} turno{s.turnosAbiertos === 1 ? "" : "s"} de caja abierto{s.turnosAbiertos === 1 ? "" : "s"}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Boton onClick={() => abrir({ tipo: "editar", sucursal: s })}>{`Editar ${s.nombre}`}</Boton>
                <Boton variante={s.estado === "ACTIVO" ? "peligro" : "normal"} onClick={() => abrir({ tipo: "estado", sucursal: s })}>{`${s.estado === "ACTIVO" ? "Desactivar" : "Activar"} ${s.nombre}`}</Boton>
              </div>
            </div>
            <ul aria-label={`Cajas de ${s.nombre}`} className="space-y-1 text-sm">
              {s.puntosEmision.map((p) => (
                <li key={p.id} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2">
                  <span className={p.estado === "ACTIVO" ? "text-slate-200" : "text-slate-500"}>{s.codigo}-{p.codigo} · {p.descripcion}{p.estado === "INACTIVO" ? " (inactiva)" : ""}</span>
                  <Boton onClick={() => abrir({ tipo: "editarCaja", sucursal: s, punto: p })}>{`Editar caja ${s.codigo}-${p.codigo}`}</Boton>
                </li>
              ))}
            </ul>
            <Boton onClick={() => abrir({ tipo: "nuevaCaja", sucursal: s })}>{`Agregar caja a ${s.nombre}`}</Boton>
          </li>
        ))}
      </ul>
      {accion?.tipo === "nueva" ? <FormularioSucursal sucursal={null} onCerrar={cerrar} /> : null}
      {accion?.tipo === "editar" ? <FormularioSucursal sucursal={accion.sucursal} onCerrar={cerrar} /> : null}
      {accion?.tipo === "estado" ? <ConfirmarEstado sucursal={accion.sucursal} onCerrar={cerrar} /> : null}
      {accion?.tipo === "nuevaCaja" ? <FormularioCaja sucursal={accion.sucursal} punto={null} onCerrar={cerrar} /> : null}
      {accion?.tipo === "editarCaja" ? <FormularioCaja sucursal={accion.sucursal} punto={accion.punto} onCerrar={cerrar} /> : null}
    </div>
  );
}

/** Lo que usa el POS (turnos, ventas) debe verse de inmediato tras cambiar sucursales o cajas. */
function useRefrescar(): () => Promise<void> {
  const qc = useQueryClient();
  return async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: CLAVE }), qc.invalidateQueries({ queryKey: ["puntosEmision"] })]);
  };
}

function FormularioSucursal({ sucursal, onCerrar }: { sucursal: SucursalGestion | null; onCerrar: (mensaje?: string) => void }): React.JSX.Element {
  const a = useAjustes();
  const refrescar = useRefrescar();
  const [f, setF] = useState({ nombre: sucursal?.nombre ?? "", direccion: sucursal?.direccion ?? "", telefono: sucursal?.telefono ?? "" });
  const [error, setError] = useState<string | null>(null);
  const poner = (k: keyof typeof f) => (v: string): void => setF((x) => ({ ...x, [k]: v }));
  const guardar = useMutation({
    mutationFn: () => {
      const datos = { nombre: f.nombre.trim(), direccion: f.direccion.trim(), telefono: f.telefono.trim() };
      return sucursal === null ? a.crearSucursal(datos) : a.actualizarSucursal(sucursal.id, datos);
    },
    onSuccess: async (s) => { await refrescar(); onCerrar(sucursal === null ? `Sucursal ${s.codigo} creada con su caja ${s.codigo}-001` : `Datos de la sucursal ${s.codigo} guardados`); },
    onError: (e) => setError(mensajeDeError(e)),
  });
  return (
    <Modal titulo={sucursal === null ? "Nueva sucursal" : `Editar ${sucursal.nombre}`} ancho="md" ayuda="ESC cancela">
      <form onSubmit={(e) => { e.preventDefault(); setError(null); guardar.mutate(); }} className="space-y-3">
        {sucursal !== null ? <p className="text-sm text-slate-400">Código {sucursal.codigo} (no se puede cambiar)</p> : <p className="text-sm text-slate-400">El sistema le asigna el siguiente código y crea su «Caja principal».</p>}
        <Campo etiqueta="Nombre" valor={f.nombre} onCambio={poner("nombre")} autofoco />
        <Campo etiqueta="Dirección" valor={f.direccion} onCambio={poner("direccion")} />
        <Campo etiqueta="Teléfono" valor={f.telefono} onCambio={poner("telefono")} />
        {error !== null ? <Aviso tipo="error">{error}</Aviso> : null}
        <div className="flex justify-end gap-2">
          <Boton onClick={() => onCerrar()}>Cancelar</Boton>
          <Boton tipo="submit" variante="primario" deshabilitado={guardar.isPending}>{sucursal === null ? "Crear sucursal" : "Guardar"}</Boton>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmarEstado({ sucursal, onCerrar }: { sucursal: SucursalGestion; onCerrar: (mensaje?: string) => void }): React.JSX.Element {
  const a = useAjustes();
  const refrescar = useRefrescar();
  const [error, setError] = useState<string | null>(null);
  const desactivar = sucursal.estado === "ACTIVO";
  const cambiar = useMutation({
    mutationFn: () => a.estadoSucursal(sucursal.id, desactivar ? "INACTIVO" : "ACTIVO"),
    onSuccess: async () => { await refrescar(); onCerrar(`Sucursal ${sucursal.codigo} ${desactivar ? "desactivada" : "activada"}`); },
    onError: (e) => setError(mensajeDeError(e)),
  });
  return (
    <Modal titulo={`${desactivar ? "Desactivar" : "Activar"} ${sucursal.nombre}`} ancho="sm" ayuda="ESC cancela">
      <div className="space-y-3">
        <p className="text-sm text-slate-300">
          {desactivar
            ? "Dejará de ofrecerse para abrir turnos y vender. Su historial (ventas, comprobantes) se conserva. Se rechaza si tiene turnos de caja o cuentas de mesa abiertos."
            : "Volverá a ofrecerse para abrir turnos y vender."}
        </p>
        {error !== null ? <Aviso tipo="error">{error}</Aviso> : null}
        <div className="flex justify-end gap-2">
          <Boton onClick={() => onCerrar()}>Cancelar</Boton>
          <Boton variante={desactivar ? "peligro" : "primario"} deshabilitado={cambiar.isPending} onClick={() => { setError(null); cambiar.mutate(); }}>{desactivar ? "Sí, desactivar" : "Sí, activar"}</Boton>
        </div>
      </div>
    </Modal>
  );
}

function FormularioCaja({ sucursal, punto, onCerrar }: { sucursal: SucursalGestion; punto: PuntoEmisionGestion | null; onCerrar: (mensaje?: string) => void }): React.JSX.Element {
  const a = useAjustes();
  const refrescar = useRefrescar();
  const [descripcion, setDescripcion] = useState(punto?.descripcion ?? "");
  const [activa, setActiva] = useState(punto?.estado !== "INACTIVO");
  const [error, setError] = useState<string | null>(null);
  const guardar = useMutation({
    mutationFn: () => (punto === null ? a.crearPuntoEmision(sucursal.id, descripcion.trim()) : a.actualizarPuntoEmision(punto.id, { descripcion: descripcion.trim(), estado: activa ? "ACTIVO" : "INACTIVO" })),
    onSuccess: async () => { await refrescar(); onCerrar(punto === null ? `Caja agregada a ${sucursal.nombre}` : `Caja ${sucursal.codigo}-${punto.codigo} guardada`); },
    onError: (e) => setError(mensajeDeError(e)),
  });
  return (
    <Modal titulo={punto === null ? `Nueva caja en ${sucursal.nombre}` : `Caja ${sucursal.codigo}-${punto.codigo}`} ancho="sm" ayuda="ESC cancela">
      <form onSubmit={(e) => { e.preventDefault(); setError(null); guardar.mutate(); }} className="space-y-3">
        <Campo etiqueta="Descripción de la caja" valor={descripcion} onCambio={setDescripcion} autofoco placeholder="p. ej. Caja 2" />
        {punto !== null ? (
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" aria-label="Caja activa" checked={activa} onChange={(e) => setActiva(e.target.checked)} className="h-4 w-4" />
            Caja activa (se ofrece para abrir turno y vender)
          </label>
        ) : <p className="text-xs text-slate-400">El sistema le asigna el siguiente código de la sucursal. Cada caja lleva su propia numeración de comprobantes.</p>}
        {error !== null ? <Aviso tipo="error">{error}</Aviso> : null}
        <div className="flex justify-end gap-2">
          <Boton onClick={() => onCerrar()}>Cancelar</Boton>
          <Boton tipo="submit" variante="primario" deshabilitado={guardar.isPending}>{punto === null ? "Agregar caja" : "Guardar"}</Boton>
        </div>
      </form>
    </Modal>
  );
}
