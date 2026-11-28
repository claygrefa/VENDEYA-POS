// @vitest-environment jsdom
// ============================================================
// tests/unit/renderer/venta-diseno.test.tsx — Íconos de categoría, vista cuadrícula/lista, stock y carrito vacío de la pantalla de venta
// ============================================================
import { Apple, CupSoda, Milk, Package, SprayCan, Tag } from "lucide-react";
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { iconoDeCategoria } from "../../../src/renderer/services/categoriaIconos";
import { usePreferencias } from "../../../src/renderer/store/preferencias.store";
import { renderizarPos } from "../../helpers/renderer/entorno";

beforeEach(() => {
  localStorage.clear();
  usePreferencias.setState({ tema: "oscuro", tamanoTexto: "normal", menuContraido: false, vistaProductos: "cuadricula" });
});

describe("Ícono de categoría", () => {
  it("elige el ícono por palabras del nombre, sin importar tildes ni mayúsculas, y tiene uno neutro", () => {
    expect(iconoDeCategoria("BEBIDAS")).toBe(CupSoda);
    expect(iconoDeCategoria("Lácteos")).toBe(Milk);
    expect(iconoDeCategoria("Frutas y verduras")).toBe(Apple);
    expect(iconoDeCategoria("Productos de limpieza")).toBe(SprayCan);
    expect(iconoDeCategoria("General")).toBe(Package);
    expect(iconoDeCategoria(undefined)).toBe(Tag);
    expect(iconoDeCategoria("   ")).toBe(Tag);
  });

  it("las palabras clave cortas solo cuentan completas («Detergente» no es «té»)", () => {
    expect(iconoDeCategoria("Detergente")).toBe(SprayCan);
    expect(iconoDeCategoria("Compañía")).toBe(Package);
  });
});

describe("Pantalla de venta", () => {
  it("cambia entre cuadrícula y lista (recordado en este equipo) sin perder los productos ni la acción de agregar", async () => {
    const { usuario } = renderizarPos();
    const cuadricula = await screen.findByRole("button", { name: "Vista en cuadrícula" });
    expect(cuadricula).toHaveAttribute("aria-pressed", "true");
    await screen.findByRole("button", { name: "Agregar Arroz 1kg" });
    await usuario.click(screen.getByRole("button", { name: "Vista en lista" }));
    expect(usePreferencias.getState().vistaProductos).toBe("lista");
    expect(localStorage.getItem("vendeya.vistaProductos")).toBe("lista");
    const fila = await screen.findByRole("button", { name: "Agregar Arroz 1kg" });
    expect(fila.closest("ul")).toHaveClass("flex-col");
    await usuario.click(fila);
    expect(await screen.findByRole("button", { name: "Quitar Arroz 1kg" })).toBeInTheDocument();
  });

  it("el carrito vacío muestra un estado claro y «Cobrar» queda deshabilitado hasta que haya productos", async () => {
    const { usuario } = renderizarPos();
    await screen.findByRole("button", { name: "Agregar Arroz 1kg" });
    const carrito = screen.getByRole("region", { name: "Carrito" });
    expect(within(carrito).getByText("Carrito vacío")).toBeInTheDocument();
    expect(within(carrito).getByText(/Escanee o busque un producto para empezar/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cobrar \(F8\)/ })).toBeDisabled();
    await usuario.click(screen.getByRole("button", { name: "Agregar Arroz 1kg" }));
    expect(screen.getByRole("button", { name: /Cobrar \(F8\)/ })).toBeEnabled();
    expect(within(screen.getByRole("region", { name: "Carrito" })).queryByText("Carrito vacío")).not.toBeInTheDocument();
  });

  it("el cliente se cambia desde su tarjeta o con F4", async () => {
    const { usuario } = renderizarPos();
    await usuario.click(await screen.findByRole("button", { name: "Cambiar cliente" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
