// ============================================================
// src/renderer/components/CambiarPassword.tsx — «Mi contraseña»: cada usuario cambia la suya (cualquier rol)
// ============================================================
import { useMutation } from "@tanstack/react-query";
import React, { useState } from "react";
import { useAjustes } from "../services/contexto";
import { Boton, Campo, mensajeDeError } from "./Gestion";
import { Aviso, Modal } from "./Modal";

export function CambiarPassword({ onCerrar }: { onCerrar: () => void }): React.JSX.Element {
  const a = useAjustes();
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<number | null>(null);
  const guardar = useMutation({
    mutationFn: () => {
      if (nueva !== repetida) throw new Error("Las contraseñas nuevas no coinciden");
      return a.cambiarMiPassword({ actual, nueva });
    },
    onSuccess: (r) => setListo(r.sesionesCerradas),
    onError: (e) => setError(mensajeDeError(e)),
  });

  if (listo !== null) {
    return (
      <Modal titulo="Contraseña cambiada" ancho="sm" ayuda="ESC cierra">
        <div className="space-y-3">
          <Aviso tipo="exito">Su contraseña se cambió. {listo > 0 ? `Se cerraron ${listo} sesión${listo === 1 ? "" : "es"} suya${listo === 1 ? "" : "s"} en otras cajas.` : "Esta sesión continúa abierta."}</Aviso>
          <div className="flex justify-end"><Boton variante="primario" onClick={onCerrar}>Aceptar</Boton></div>
        </div>
      </Modal>
    );
  }
  return (
    <Modal titulo="Cambiar mi contraseña" ancho="sm" ayuda="ESC cancela">
      <form onSubmit={(e) => { e.preventDefault(); setError(null); guardar.mutate(); }} className="space-y-3">
        <Campo etiqueta="Contraseña actual" tipo="password" valor={actual} onCambio={setActual} autofoco />
        <Campo etiqueta="Contraseña nueva" tipo="password" valor={nueva} onCambio={setNueva} placeholder="Mínimo 8 caracteres" />
        <Campo etiqueta="Repita la contraseña nueva" tipo="password" valor={repetida} onCambio={setRepetida} />
        {error !== null ? <Aviso tipo="error">{error}</Aviso> : null}
        <div className="flex justify-end gap-2">
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton tipo="submit" variante="primario" deshabilitado={guardar.isPending}>Cambiar contraseña</Boton>
        </div>
      </form>
    </Modal>
  );
}
