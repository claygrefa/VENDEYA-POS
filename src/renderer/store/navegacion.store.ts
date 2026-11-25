// ============================================================
// src/renderer/store/navegacion.store.ts — Vista activa y menú según los permisos del rol
// ============================================================
import { create } from "zustand";
import type { UsuarioSesion } from "../services/tipos";

export type VistaId = "venta" | "caja" | "clientes" | "inventario" | "compras" | "reportes" | "sri";

export interface ItemMenu {
  id: VistaId;
  titulo: string;
  /** Permiso `modulo:accion` que habilita la vista */
  permiso: string;
}

/**
 * Qué ve cada rol. Se usan permisos «de gestión» (no los de lectura, que tiene casi todo el mundo): el cajero ve Venta, Caja y
 * Clientes; Inventario y Compras exigen manejar inventario; Reportes y SRI, sus propios permisos de lectura.
 */
export const MENU: ReadonlyArray<ItemMenu> = [
  { id: "venta", titulo: "Venta", permiso: "ventas:crear" },
  { id: "caja", titulo: "Caja", permiso: "caja:leer" },
  { id: "clientes", titulo: "Clientes", permiso: "clientes:leer" },
  { id: "inventario", titulo: "Inventario", permiso: "inventario:actualizar" },
  { id: "compras", titulo: "Compras", permiso: "inventario:crear" },
  { id: "reportes", titulo: "Reportes", permiso: "reportes:leer" },
  { id: "sri", titulo: "Comprobantes SRI", permiso: "sri:leer" },
];

export const menuPara = (usuario: UsuarioSesion | null): ItemMenu[] => MENU.filter((m) => usuario?.permisos.includes(m.permiso) ?? false);

interface EstadoNavegacion {
  vista: VistaId | null;
  ir: (v: VistaId) => void;
  reiniciar: () => void;
}

export const useNavegacion = create<EstadoNavegacion>()((set) => ({
  vista: null,
  ir: (vista) => set({ vista }),
  reiniciar: () => set({ vista: null }),
}));
