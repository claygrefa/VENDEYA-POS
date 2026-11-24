// ============================================================
// src/renderer/store/sesion.store.ts — Sesión del cajero, turno abierto y punto de emisión (Zustand)
// ============================================================
import { create } from "zustand";
import type { PuntoEmisionPos, TurnoPos, UsuarioSesion } from "../services/tipos";

export interface EstadoSesion {
  token: string | null;
  usuario: UsuarioSesion | null;
  turno: TurnoPos | null;
  puntoEmision: PuntoEmisionPos | null;
  /** Modo táctil: botones grandes y teclado numérico en pantalla */
  modoTactil: boolean;
  iniciar: (token: string, usuario: UsuarioSesion) => void;
  fijarTurno: (turno: TurnoPos | null) => void;
  fijarPuntoEmision: (p: PuntoEmisionPos | null) => void;
  alternarTactil: () => void;
  cerrar: () => void;
}

const CLAVE_TACTIL = "vendeya.modoTactil";

function tactilGuardado(): boolean {
  try {
    return globalThis.localStorage?.getItem(CLAVE_TACTIL) === "1";
  } catch {
    return false;
  }
}

export const useSesion = create<EstadoSesion>()((set, get) => ({
  token: null,
  usuario: null,
  turno: null,
  puntoEmision: null,
  modoTactil: tactilGuardado(),
  iniciar: (token, usuario) => set({ token, usuario, turno: null, puntoEmision: null }),
  fijarTurno: (turno) => set({ turno }),
  fijarPuntoEmision: (puntoEmision) => set({ puntoEmision }),
  alternarTactil: () => {
    const siguiente = !get().modoTactil;
    try {
      globalThis.localStorage?.setItem(CLAVE_TACTIL, siguiente ? "1" : "0");
    } catch {
      /* sin almacenamiento: el modo vale solo para esta sesión */
    }
    set({ modoTactil: siguiente });
  },
  cerrar: () => set({ token: null, usuario: null, turno: null, puntoEmision: null }),
}));

/** ¿El usuario tiene el permiso `modulo:accion`? */
export function tienePermiso(usuario: UsuarioSesion | null, permiso: string): boolean {
  return usuario?.permisos.includes(permiso) ?? false;
}
