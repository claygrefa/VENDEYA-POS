// @vitest-environment jsdom
// ============================================================
// tests/unit/renderer/preferencias.test.ts — Tema claro/oscuro, tamaño de texto y preferencias de presentación
// ============================================================
import { readFileSync } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aplicarAlDocumento, ESCALA_TEXTO, temaEfectivo, usePreferencias } from "../../../src/renderer/store/preferencias.store";

const RAIZ = path.resolve(__dirname, "../../..");

beforeEach(() => {
  localStorage.clear();
  usePreferencias.setState({ tema: "oscuro", tamanoTexto: "normal", menuContraido: false, vistaProductos: "cuadricula" });
});
afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.fontSize = "";
});

describe("Preferencias de presentación", () => {
  it("el tema y el tamaño de texto se aplican al documento y se guardan en este equipo", () => {
    usePreferencias.getState().fijarTema("claro");
    usePreferencias.getState().fijarTamanoTexto("grande");
    aplicarAlDocumento(usePreferencias.getState().tema, usePreferencias.getState().tamanoTexto);
    expect(document.documentElement.dataset["theme"]).toBe("light");
    expect(document.documentElement.style.fontSize).toBe(`${ESCALA_TEXTO.grande}%`);
    expect(localStorage.getItem("vendeya.tema")).toBe("claro");
    expect(localStorage.getItem("vendeya.tamanoTexto")).toBe("grande");
  });

  it("«sistema» sin información del sistema usa el tema oscuro; claro y oscuro se respetan tal cual", () => {
    expect(temaEfectivo("claro")).toBe("claro");
    expect(temaEfectivo("oscuro")).toBe("oscuro");
    expect(temaEfectivo("sistema")).toBe("oscuro");
  });

  it("el menú lateral y la vista de productos recuerdan su estado", () => {
    usePreferencias.getState().alternarMenu();
    usePreferencias.getState().fijarVistaProductos("lista");
    expect(usePreferencias.getState().menuContraido).toBe(true);
    expect(localStorage.getItem("vendeya.menuContraido")).toBe("1");
    expect(localStorage.getItem("vendeya.vistaProductos")).toBe("lista");
    usePreferencias.getState().alternarMenu();
    expect(localStorage.getItem("vendeya.menuContraido")).toBe("0");
  });

  it("sin almacenamiento disponible no falla: la preferencia vale mientras la aplicación está abierta", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("bloqueado");
    };
    try {
      expect(() => usePreferencias.getState().fijarTema("claro")).not.toThrow();
      expect(usePreferencias.getState().tema).toBe("claro");
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe("Variables de color (tema.css)", () => {
  const css = readFileSync(path.join(RAIZ, "src/renderer/styles/tema.css"), "utf8");
  const bloque = (selector: string): string => {
    const i = css.indexOf(selector);
    return css.slice(i, css.indexOf("}", i));
  };
  const variables = (b: string): string[] => [...b.matchAll(/--c-[\w-]+/g)].map((m) => m[0]).sort();

  it("el tema claro define exactamente las mismas variables que el oscuro", () => {
    const oscuro = variables(bloque(':root,\n:root[data-theme="dark"]'));
    const claro = variables(bloque(':root[data-theme="light"]'));
    expect(oscuro.length).toBeGreaterThan(60);
    expect(claro).toEqual(oscuro);
  });

  it("las paletas de Tailwind usan las variables, y los botones de color conservan su tono en el tema claro", () => {
    const cfg = readFileSync(path.join(RAIZ, "tailwind.config.ts"), "utf8");
    for (const n of ["slate", "emerald", "red", "amber", "sky", "brand"]) expect(cfg).toContain(`${n}: paleta("${n}")`);
    const claro = bloque(':root[data-theme="light"]');
    const oscuro = bloque(':root,\n:root[data-theme="dark"]');
    const valor = (b: string, v: string): string | undefined => new RegExp(`${v}: ([0-9 ]+);`).exec(b)?.[1];
    for (const v of ["--c-emerald-700", "--c-brand-600", "--c-red-700"]) expect(valor(claro, v)).toBe(valor(oscuro, v));
    expect(valor(claro, "--c-slate-900")).not.toBe(valor(oscuro, "--c-slate-900"));
  });
});
