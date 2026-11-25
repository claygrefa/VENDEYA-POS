// ============================================================
// src/renderer/store/navegacion.store.ts — Vista activa y menú según los permisos del rol
// ============================================================
import { create } from "zustand";
import type { UsuarioSesion } from "../services/tipos";

export type VistaId = "venta" | "caja" | "clientes" | "inventario" | "compras" | "reportes" | "sri" | "ajustes" | "ayuda";

/** Permiso especial: la vista la ve cualquier usuario con sesión */
export const PARA_TODOS = "*";

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
  { id: "ajustes", titulo: "Ajustes", permiso: "configuracion:actualizar" },
  // La ayuda es para todos los roles: va al final para no mover los atajos Ctrl+número de las demás vistas
  { id: "ayuda", titulo: "Ayuda", permiso: PARA_TODOS },
];

export const menuPara = (usuario: UsuarioSesion | null): ItemMenu[] => MENU.filter((m) => usuario !== null && (m.permiso === PARA_TODOS || usuario.permisos.includes(m.permiso)));

interface EstadoNavegacion {
  vista: VistaId | null;
  /** Pestaña de Ajustes que se debe abrir al llegar (la pide, por ejemplo, el aviso de licencia); Ajustes la consume */
  seccionAjustes: string | null;
  ir: (v: VistaId) => void;
  irAjustes: (seccion: string) => void;
  consumirSeccionAjustes: () => void;
  reiniciar: () => void;
}

export const useNavegacion = create<EstadoNavegacion>()((set) => ({
  vista: null,
  seccionAjustes: null,
  ir: (vista) => set({ vista }),
  irAjustes: (seccionAjustes) => set({ vista: "ajustes", seccionAjustes }),
  consumirSeccionAjustes: () => set({ seccionAjustes: null }),
  reiniciar: () => set({ vista: null, seccionAjustes: null }),
}));
