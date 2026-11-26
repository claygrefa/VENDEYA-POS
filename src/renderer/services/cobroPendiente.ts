import { CobroPendienteSchema, type CobroPendiente } from "../../shared/schemas/venta.schema";
import type { UsuarioSesion } from "./tipos";

type Operacion =
  | { tipo: "leer" }
  | { tipo: "guardar"; cobro: CobroPendiente }
  | { tipo: "retirar"; intentoId: string };

export async function operarCobroPendiente(usuario: UsuarioSesion, operacion: Operacion): Promise<CobroPendiente | null> {
  const { empresaId, id: cajeroId } = usuario;
  if (window.vendeya !== undefined) {
    return window.vendeya.invoke<CobroPendiente | null>("app:cobro-pendiente", { ...operacion, actor: { empresaId, cajeroId } });
  }
  const clave = `vendeya.cobro.${empresaId}.${cajeroId}`;
  const dato = localStorage.getItem(clave);
  const previo = dato === null ? null : CobroPendienteSchema.parse(JSON.parse(dato));
  if (operacion.tipo === "leer") return previo;
  if (operacion.tipo === "guardar") {
    if (previo !== null) throw new Error("Ya existe un cobro pendiente de recuperar");
    localStorage.setItem(clave, JSON.stringify(operacion.cobro));
    return operacion.cobro;
  }
  if (previo?.intentoId === operacion.intentoId) localStorage.removeItem(clave);
  return null;
}
