// ============================================================
// src/renderer/store/preferencias.store.ts — Preferencias de presentación de ESTE equipo (Zustand + localStorage)
// Tema (claro/oscuro/sistema), tamaño del texto, menú lateral contraído y vista de productos. No afectan a ningún dato del negocio.
// ============================================================
import { create } from "zustand";

export type Tema = "oscuro" | "claro" | "sistema";
export type TamanoTexto = "normal" | "grande" | "extra";
export type VistaProductos = "cuadricula" | "lista";

/** Porcentaje del tamaño base (16 px) para cada opción: todo el diseño usa rem, así que escala completo */
export const ESCALA_TEXTO: Record<TamanoTexto, number> = { normal: 100, grande: 112.5, extra: 125 };

interface PreferenciasEstado {
  tema: Tema;
  tamanoTexto: TamanoTexto;
  menuContraido: boolean;
  vistaProductos: VistaProductos;
  fijarTema: (tema: Tema) => void;
  fijarTamanoTexto: (tamano: TamanoTexto) => void;
  alternarMenu: () => void;
  fijarVistaProductos: (vista: VistaProductos) => void;
}

const CLAVES = {
  tema: "vendeya.tema",
  tamanoTexto: "vendeya.tamanoTexto",
  menuContraido: "vendeya.menuContraido",
  vistaProductos: "vendeya.vistaProductos",
} as const;

function leer(clave: string): string | null {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function guardar(clave: string, valor: string): void {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    /* sin almacenamiento (ventana privada o bloqueado): la preferencia vale solo mientras la aplicación está abierta */
  }
}

function elegir<T extends string>(clave: string, validos: readonly T[], porDefecto: T): T {
  const guardado = leer(clave);
  return validos.find((v) => v === guardado) ?? porDefecto;
}

export const usePreferencias = create<PreferenciasEstado>((set) => ({
  tema: elegir<Tema>(CLAVES.tema, ["oscuro", "claro", "sistema"], "oscuro"),
  tamanoTexto: elegir<TamanoTexto>(CLAVES.tamanoTexto, ["normal", "grande", "extra"], "normal"),
  menuContraido: leer(CLAVES.menuContraido) === "1",
  vistaProductos: elegir<VistaProductos>(CLAVES.vistaProductos, ["cuadricula", "lista"], "cuadricula"),
  fijarTema: (tema) => {
    guardar(CLAVES.tema, tema);
    set({ tema });
  },
  fijarTamanoTexto: (tamanoTexto) => {
    guardar(CLAVES.tamanoTexto, tamanoTexto);
    set({ tamanoTexto });
  },
  alternarMenu: () =>
    set((s) => {
      guardar(CLAVES.menuContraido, s.menuContraido ? "0" : "1");
      return { menuContraido: !s.menuContraido };
    }),
  fijarVistaProductos: (vistaProductos) => {
    guardar(CLAVES.vistaProductos, vistaProductos);
    set({ vistaProductos });
  },
}));

const consultaClara = (): MediaQueryList | null => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: light)") : null);

/** Tema efectivo (claro u oscuro) de una preferencia; «sistema» sigue la configuración de Windows */
export function temaEfectivo(tema: Tema): "claro" | "oscuro" {
  if (tema !== "sistema") return tema;
  return consultaClara()?.matches === true ? "claro" : "oscuro";
}

/** Aplica el tema y el tamaño de texto al documento (atributo data-theme y tamaño base del html) */
export function aplicarAlDocumento(tema: Tema, tamano: TamanoTexto): void {
  const raiz = document.documentElement;
  raiz.dataset["theme"] = temaEfectivo(tema) === "claro" ? "light" : "dark";
  raiz.style.fontSize = `${ESCALA_TEXTO[tamano]}%`;
}

/** Aplica las preferencias guardadas ya al arrancar (antes de dibujar, sin parpadeo) y las mantiene al cambiarlas. Devuelve cómo dejar de escuchar. */
export function iniciarPreferencias(): () => void {
  const aplicar = (): void => aplicarAlDocumento(usePreferencias.getState().tema, usePreferencias.getState().tamanoTexto);
  aplicar();
  const baja = usePreferencias.subscribe(aplicar);
  const consulta = consultaClara();
  consulta?.addEventListener("change", aplicar);
  return () => {
    baja();
    consulta?.removeEventListener("change", aplicar);
  };
}
