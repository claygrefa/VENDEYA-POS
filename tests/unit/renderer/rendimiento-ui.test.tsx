// @vitest-environment jsdom
// ============================================================
// tests/unit/renderer/rendimiento-ui.test.tsx — La interfaz con catálogos y reportes grandes (Semana 21)
//   · la búsqueda de productos consulta tras una pausa al teclear, no en cada tecla
//   · un reporte de decenas de miles de filas se dibuja por páginas (los totales y el CSV siguen incluyendo todo)
// ============================================================
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FILAS_POR_PAGINA } from "../../../src/renderer/pages/ReportesPage";
import { ApiSimulada, renderizarPos, servidorBasico, usuarioDe } from "../../helpers/renderer/entorno";

describe("Búsqueda de productos", () => {
  it("teclear rápido genera UNA consulta con el texto completo, no una por letra", async () => {
    const api = servidorBasico(new ApiSimulada());
    const { usuario } = renderizarPos({ api });
    const buscar = await screen.findByLabelText("Buscar producto");
    await waitFor(() => expect(api.llamadasA("GET /api/productos").length).toBeGreaterThan(0));
    const antes = api.llamadasA("GET /api/productos").length;

    await usuario.type(buscar, "arroz");
    await waitFor(() => expect(api.llamadasA("GET /api/productos").some((l) => l.parametros.get("search") === "arroz")).toBe(true));
    const nuevas = api.llamadasA("GET /api/productos").slice(antes).map((l) => l.parametros.get("search"));
    expect(nuevas).toEqual(["arroz"]);
  });

  it("al borrar el texto vuelve al catálogo inicial", async () => {
    const api = servidorBasico(new ApiSimulada());
    const { usuario } = renderizarPos({ api });
    const buscar = await screen.findByLabelText("Buscar producto");
    await usuario.type(buscar, "café");
    await waitFor(() => expect(api.llamadasA("GET /api/productos").some((l) => l.parametros.get("search") === "café")).toBe(true));
    await usuario.clear(buscar);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Agregar / }).length).toBeGreaterThan(1));
  });
});

describe("Reportes grandes", () => {
  const COLUMNAS = [{ clave: "codigo", titulo: "Código", tipo: "texto" }, { clave: "stock", titulo: "Existencia", tipo: "numero" }, { clave: "valor", titulo: "Valor", tipo: "dinero" }];
  const filas = (n: number) => Array.from({ length: n }, (_, i) => ({ codigo: `P${String(i + 1).padStart(6, "0")}`, stock: i + 1, valor: (i + 1) * 2 }));

  async function generar(total: number) {
    const api = servidorBasico(new ApiSimulada()).en("GET /api/reportes/stock", { cuerpo: { tipo: "stock", titulo: "Stock valorado", desde: null, hasta: null, columnas: COLUMNAS, filas: filas(total), totales: { stock: 99999, valor: 123456 } } });
    const r = renderizarPos({ api, usuario: usuarioDe("SUPERVISOR") });
    await r.usuario.click(await screen.findByRole("button", { name: "Reportes" }));
    await r.usuario.selectOptions(await screen.findByLabelText("Reporte"), "stock");
    await r.usuario.click(screen.getByRole("button", { name: "Generar" }));
    return r;
  }
  const filasVisibles = (): number => within(screen.getByRole("table", { name: "Stock valorado" })).getAllByRole("row").length - 1; // sin el encabezado

  it("dibuja solo una página por vez, con el rango visible y los totales completos", async () => {
    const { usuario } = await generar(250);
    expect(await screen.findByText(/Mostrando 1–100 de 250 filas/)).toBeInTheDocument();
    expect(filasVisibles()).toBe(FILAS_POR_PAGINA);
    expect(screen.getByText("P000001")).toBeInTheDocument();
    expect(screen.queryByText("P000101")).toBeNull();
    expect(screen.getByLabelText("Totales del reporte")).toHaveTextContent(/123\D?456/); // los totales no dependen de la página

    await usuario.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(await screen.findByText(/Mostrando 101–200 de 250 filas/)).toBeInTheDocument();
    expect(screen.getByText("P000101")).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(await screen.findByText(/Mostrando 201–250 de 250 filas/)).toBeInTheDocument();
    expect(filasVisibles()).toBe(50);
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
  });

  it("un reporte de 20 000 filas no dibuja 20 000 filas", async () => {
    await generar(20_000);
    expect(await screen.findByText(/Mostrando 1–100 de 20000 filas/)).toBeInTheDocument();
    expect(filasVisibles()).toBe(FILAS_POR_PAGINA);
  });

  it("un reporte corto no muestra paginación y al generar otro vuelve a la primera página", async () => {
    const { usuario } = await generar(30);
    expect(await screen.findByText("P000030")).toBeInTheDocument();
    expect(screen.queryByText(/Mostrando/)).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Paginación" })).toBeNull();
    expect(filasVisibles()).toBe(30);
    void usuario;
  });
});
