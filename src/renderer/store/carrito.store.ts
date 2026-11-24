// ============================================================
// src/renderer/store/carrito.store.ts — Carrito de la venta en curso (Zustand)
// ============================================================
import { create } from "zustand";
import type { ClientePos, PresentacionPos, ProductoPos } from "../services/tipos";
import { porcentajeIvaDe, round2, type LineaCarrito } from "../services/totales";

export interface NuevaLinea {
  producto: ProductoPos;
  presentacion?: PresentacionPos | null;
  cantidad?: number;
}

export interface EstadoCarrito {
  lineas: LineaCarrito[];
  /** null = Consumidor Final */
  cliente: ClientePos | null;
  agregar: (n: NuevaLinea) => string;
  fijarCantidad: (clave: string, cantidad: number) => void;
  fijarDescuento: (clave: string, descuento: number, tipo: "PORCENTAJE" | "VALOR") => void;
  quitar: (clave: string) => void;
  fijarCliente: (c: ClientePos | null) => void;
  vaciar: () => void;
}

let contador = 0;
const nuevaClave = (): string => `l${Date.now().toString(36)}${(contador += 1).toString(36)}`;

/** Precio mostrado: el de la presentación si lo tiene, o el del producto por su factor. */
function precioDe(p: ProductoPos, pr: PresentacionPos | null | undefined): number {
  if (pr === null || pr === undefined) return p.precioVenta;
  return round2(pr.precioVenta ?? p.precioVenta * pr.factor);
}

export const useCarrito = create<EstadoCarrito>()((set, get) => ({
  lineas: [],
  cliente: null,

  agregar: ({ producto, presentacion = null, cantidad = 1 }) => {
    const existente = get().lineas.find((l) => l.productoId === producto.id && l.presentacionId === (presentacion?.id ?? null) && l.descuento === 0);
    if (existente !== undefined) {
      set({ lineas: get().lineas.map((l) => (l.clave === existente.clave ? { ...l, cantidad: Math.round((l.cantidad + cantidad) * 1000) / 1000 } : l)) });
      return existente.clave;
    }
    const linea: LineaCarrito = {
      clave: nuevaClave(),
      productoId: producto.id,
      presentacionId: presentacion?.id ?? null,
      codigo: producto.codigo,
      nombre: presentacion === null || presentacion === undefined ? producto.nombre : `${producto.nombre} — ${presentacion.nombre}`,
      unidad: presentacion === null || presentacion === undefined ? producto.unidadMedida.codigo : "UN",
      permiteDecimales: (presentacion === null || presentacion === undefined) && producto.unidadMedida.permiteDecimales,
      cantidad,
      precioUnitario: precioDe(producto, presentacion),
      porcentajeIva: porcentajeIvaDe(producto),
      descuento: 0,
      tipoDescuento: "VALOR",
    };
    set({ lineas: [...get().lineas, linea] });
    return linea.clave;
  },

  fijarCantidad: (clave, cantidad) => {
    if (!(cantidad > 0)) {
      set({ lineas: get().lineas.filter((l) => l.clave !== clave) });
      return;
    }
    set({ lineas: get().lineas.map((l) => (l.clave === clave ? { ...l, cantidad: Math.round(cantidad * 1000) / 1000 } : l)) });
  },

  fijarDescuento: (clave, descuento, tipo) => set({ lineas: get().lineas.map((l) => (l.clave === clave ? { ...l, descuento: Math.max(0, descuento), tipoDescuento: tipo } : l)) }),

  quitar: (clave) => set({ lineas: get().lineas.filter((l) => l.clave !== clave) }),

  fijarCliente: (cliente) => set({ cliente }),

  vaciar: () => set({ lineas: [], cliente: null }),
}));
