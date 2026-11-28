// ============================================================
// src/renderer/pages/AjustesRespaldos.tsx — Ajustes › Respaldos: copias locales, copia cifrada en la nube y restauración guiada
// ============================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { Boton, Campo, Casilla, Seleccion, mensajeDeError } from "../components/Gestion";
import { Aviso } from "../components/Modal";
import type { EstadoRespaldos, RespaldoLocal } from "../services/ajustes.api";
import { useAjustes } from "../services/contexto";

const CLAVE = ["ajustes", "respaldos"] as const;
type Mensaje = { tipo: "error" | "exito" | "info"; texto: string } | null;

const MOTIVO: Record<RespaldoLocal["motivo"], string> = {
  automatico: "Automático",
  manual: "Manual",
  "pre-actualizacion": "Antes de actualizar",
  "pre-migracion": "Antes de migrar",
};
const fechaHora = (iso: string): string => new Date(iso).toLocaleString("es-EC", { dateStyle: "medium", timeStyle: "short" });
const tamano = (bytes: number): string => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export function SeccionRespaldos(): React.JSX.Element {
  const a = useAjustes();
  const qc = useQueryClient();
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const q = useQuery({ queryKey: CLAVE, queryFn: () => a.respaldos(), retry: false });
  const guardar = (datos: EstadoRespaldos): void => {
    qc.setQueryData(CLAVE, datos);
  };
  const alError = (e: unknown): void => setMensaje({ tipo: "error", texto: mensajeDeError(e) });

  const ahora = useMutation({
    mutationFn: () => a.respaldarAhora(),
    onSuccess: (r) => { guardar(r); setMensaje({ tipo: "exito", texto: "Respaldo creado y verificado" }); },
    onError: alError,
  });
  const actualizarNube = (nube: EstadoRespaldos["nube"]): void => {
    if (q.data !== undefined) guardar({ ...q.data, nube });
  };
  const copiar = useMutation({
    mutationFn: () => a.copiarANube(),
    onSuccess: async (r) => { actualizarNube(r.nube); setMensaje({ tipo: "exito", texto: `Copia cifrada creada en la carpeta de la nube (${tamano(r.bytes)})` }); await qc.invalidateQueries({ queryKey: CLAVE }); },
    onError: alError,
  });

  if (q.data === undefined) return q.isError ? <Aviso tipo="error">{mensajeDeError(q.error)}</Aviso> : <p className="text-slate-400">Cargando…</p>;
  const e = q.data;
  const ultimoAuto = e.locales.find((r) => r.motivo === "automatico") ?? null;

  return (
    <div className="max-w-3xl space-y-6">
      {mensaje !== null ? <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso> : null}

      {e.restauracionPendiente !== null ? <RestauracionPendiente e={e} onEstado={guardar} onMensaje={setMensaje} /> : null}

      <section aria-label="Respaldos del equipo" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">Respaldos en este equipo</h2>
            <p className="text-sm text-slate-400">
              {ultimoAuto === null ? "Todavía no hay un respaldo automático: se crea uno al día siguiente de abrir la aplicación." : `Último respaldo automático: ${fechaHora(ultimoAuto.creado)}.`} Se hace uno cada día y otro antes de cada actualización.
            </p>
          </div>
          <Boton variante="primario" deshabilitado={ahora.isPending} onClick={() => { setMensaje(null); ahora.mutate(); }}>
            {ahora.isPending ? "Respaldando…" : "Respaldar ahora"}
          </Boton>
        </div>
        {e.locales.length === 0 ? (
          <p className="text-sm text-slate-400">Aún no hay respaldos.</p>
        ) : (
          <ul aria-label="Lista de respaldos" className="space-y-1 text-sm text-slate-200">
            {e.locales.map((r) => (
              <li key={r.archivo} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800 px-3 py-2">
                <span>{MOTIVO[r.motivo]} · {fechaHora(r.creado)}</span>
                <span className="text-slate-400">{tamano(r.bytes)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SeccionNube e={e} onEstado={guardar} onMensaje={setMensaje} copiar={() => { setMensaje(null); copiar.mutate(); }} copiando={copiar.isPending} />
      <SeccionRestaurar e={e} onEstado={guardar} onMensaje={setMensaje} />
    </div>
  );
}

interface PropsComunes {
  e: EstadoRespaldos;
  onEstado: (e: EstadoRespaldos) => void;
  onMensaje: (m: Mensaje) => void;
}

function SeccionNube({ e, onEstado, onMensaje, copiar, copiando }: PropsComunes & { copiar: () => void; copiando: boolean }): React.JSX.Element {
  const a = useAjustes();
  const nube = e.nube;
  const [carpeta, setCarpeta] = useState(nube.carpeta ?? "");
  const [frase, setFrase] = useState("");
  const [anotada, setAnotada] = useState(false);
  const guardar = useMutation({
    mutationFn: () => a.configurarNube({ carpeta: carpeta.trim(), frase }),
    onSuccess: (n) => { onEstado({ ...e, nube: n }); setFrase(""); setAnotada(false); onMensaje({ tipo: "exito", texto: "Copia en la nube configurada. Guarde la frase en un lugar seguro: sin ella no se puede restaurar." }); },
    onError: (err) => onMensaje({ tipo: "error", texto: mensajeDeError(err) }),
  });
  const quitar = useMutation({
    mutationFn: () => a.quitarNube(),
    onSuccess: (n) => { onEstado({ ...e, nube: n }); setCarpeta(""); onMensaje({ tipo: "info", texto: "Se dejó de copiar a la nube. Las copias que ya estaban en la carpeta no se borran." }); },
    onError: (err) => onMensaje({ tipo: "error", texto: mensajeDeError(err) }),
  });

  return (
    <section aria-label="Copia en la nube" className="space-y-3 rounded-xl border border-slate-700 p-4">
      <h2 className="text-base font-semibold text-ink">Copia cifrada fuera del equipo</h2>
      <p className="text-sm text-slate-400">
        Elija una carpeta que sincronice OneDrive, Google Drive o Dropbox (o un disco externo). Las copias salen <strong>cifradas con su frase</strong>: el servicio de nube no puede leerlas.
      </p>

      {nube.configurada ? (
        <div className="space-y-2 text-sm text-slate-200">
          <p>Carpeta: <span className="text-ink">{nube.carpeta}</span></p>
          <p>{nube.ultima === null ? "Todavía no hay copias en la carpeta." : `Última copia: ${fechaHora(nube.ultima.creado)} (${tamano(nube.ultima.bytes)}). Copias guardadas: ${nube.copias.length}.`}</p>
          {nube.requiereReconfigurar ? <Aviso tipo="error">La frase guardada ya no se puede leer: vuelva a escribirla abajo para seguir copiando.</Aviso> : null}
          <div className="flex gap-3">
            <Boton variante="primario" deshabilitado={copiando || nube.requiereReconfigurar} onClick={copiar}>{copiando ? "Copiando…" : "Copiar a la nube ahora"}</Boton>
            <Boton variante="peligro" deshabilitado={quitar.isPending} onClick={() => quitar.mutate()}>Dejar de copiar a la nube</Boton>
          </div>
        </div>
      ) : null}

      <form aria-label="Configurar copia en la nube" noValidate className="space-y-3" onSubmit={(ev) => { ev.preventDefault(); onMensaje(null); guardar.mutate(); }}>
        <h3 className="text-sm font-semibold text-ink">{nube.configurada ? "Cambiar carpeta o frase" : "Configurar"}</h3>
        <Campo etiqueta="Carpeta de la nube" valor={carpeta} onCambio={setCarpeta} placeholder="C:\Users\…\OneDrive\Respaldos VENDEYA" />
        <Campo etiqueta="Frase de cifrado" tipo="password" valor={frase} onCambio={setFrase} placeholder="Al menos 12 caracteres" />
        <Aviso tipo="info">Anote la frase en un lugar seguro y aparte. <strong>Sin la frase no se puede recuperar ninguna copia de la nube</strong>; nadie, ni el soporte, puede recuperarla.</Aviso>
        <Casilla etiqueta="Ya anoté la frase en un lugar seguro" marcada={anotada} onCambio={setAnotada} />
        <Boton tipo="submit" variante="primario" deshabilitado={guardar.isPending || carpeta.trim() === "" || frase.length < 12 || !anotada}>
          {guardar.isPending ? "Guardando…" : "Guardar configuración"}
        </Boton>
      </form>
    </section>
  );
}

function SeccionRestaurar({ e, onEstado, onMensaje }: PropsComunes): React.JSX.Element {
  const a = useAjustes();
  const [origen, setOrigen] = useState<"local" | "nube">("local");
  const locales = e.locales;
  const [archivo, setArchivo] = useState("");
  const [frase, setFrase] = useState("");
  const [password, setPassword] = useState("");
  const [entiendo, setEntiendo] = useState(false);
  const opciones = origen === "local" ? locales.map((r) => ({ valor: r.archivo, titulo: `${MOTIVO[r.motivo]} · ${fechaHora(r.creado)}` })) : e.nube.copias.map((c) => ({ valor: c, titulo: c }));
  const elegido = opciones.some((o) => o.valor === archivo) ? archivo : (opciones[0]?.valor ?? "");

  const preparar = useMutation({
    mutationFn: () => a.prepararRestauracion(origen === "local" ? { origen: "local", archivo: elegido, password } : { origen: "nube", archivo: elegido, frase, password }),
    onSuccess: (r) => { onEstado(r); setPassword(""); setFrase(""); setEntiendo(false); onMensaje({ tipo: "info", texto: "Restauración preparada. Cierre la aplicación por completo y vuelva a abrirla para aplicarla." }); },
    onError: (err) => onMensaje({ tipo: "error", texto: mensajeDeError(err) }),
  });
  const puede = elegido !== "" && password !== "" && entiendo && (origen === "local" || frase !== "") && e.restauracionPendiente === null;

  return (
    <section aria-label="Restaurar un respaldo" className="space-y-3 rounded-xl border border-red-500/40 p-4">
      <h2 className="text-base font-semibold text-ink">Restaurar desde un respaldo</h2>
      <Aviso tipo="info">Restaurar <strong>reemplaza todos los datos actuales</strong> por los del respaldo: las ventas hechas después de esa fecha no estarán. La base actual se conserva aparte por si necesita volver atrás.</Aviso>
      <form aria-label="Preparar restauración" noValidate className="space-y-3" onSubmit={(ev) => { ev.preventDefault(); onMensaje(null); preparar.mutate(); }}>
        <Seleccion etiqueta="Origen del respaldo" valor={origen} onCambio={(v) => { setOrigen(v as "local" | "nube"); setArchivo(""); }} opciones={[{ valor: "local", titulo: "De este equipo" }, { valor: "nube", titulo: "De la copia en la nube" }]} />
        {opciones.length === 0 ? (
          <p className="text-sm text-slate-400">{origen === "local" ? "No hay respaldos en este equipo." : e.nube.configurada ? "No hay copias en la carpeta de la nube." : "Configure primero la carpeta de la nube (arriba) con la misma frase con la que se cifraron las copias."}</p>
        ) : (
          <Seleccion etiqueta="Respaldo a restaurar" valor={elegido} onCambio={setArchivo} opciones={opciones} />
        )}
        {origen === "nube" ? <Campo etiqueta="Frase de la copia" tipo="password" valor={frase} onCambio={setFrase} /> : null}
        <Campo etiqueta="Su contraseña de administrador" tipo="password" valor={password} onCambio={setPassword} />
        <Casilla etiqueta="Entiendo que se reemplazarán todos los datos actuales" marcada={entiendo} onCambio={setEntiendo} />
        <Boton tipo="submit" variante="peligro" deshabilitado={!puede || preparar.isPending}>{preparar.isPending ? "Comprobando el respaldo…" : "Preparar restauración"}</Boton>
        <p className="text-xs text-slate-400">Este paso solo comprueba el respaldo y lo deja listo; no cambia nada todavía. Los datos se reemplazan cuando cierre y vuelva a abrir la aplicación.</p>
      </form>
    </section>
  );
}

function RestauracionPendiente({ e, onEstado, onMensaje }: PropsComunes): React.JSX.Element | null {
  const a = useAjustes();
  const cancelar = useMutation({
    mutationFn: () => a.cancelarRestauracion(),
    onSuccess: (r) => { onEstado(r); onMensaje({ tipo: "exito", texto: "Restauración cancelada: no se cambió nada." }); },
    onError: (err) => onMensaje({ tipo: "error", texto: mensajeDeError(err) }),
  });
  const p = e.restauracionPendiente;
  if (p === null) return null;
  return (
    <section aria-label="Restauración pendiente" className="space-y-2 rounded-xl border border-amber-500/60 bg-amber-950/40 p-4 text-sm text-amber-100">
      <h2 className="text-base font-semibold">Restauración lista para aplicar</h2>
      <p>Preparada el {fechaHora(p.preparada)} desde {p.origen === "nube" ? "la copia en la nube" : "un respaldo de este equipo"}. <strong>Cierre la aplicación por completo y vuelva a abrirla</strong> para reemplazar los datos.</p>
      <Boton deshabilitado={cancelar.isPending} onClick={() => cancelar.mutate()}>Cancelar restauración</Boton>
    </section>
  );
}
