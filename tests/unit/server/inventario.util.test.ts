// ============================================================
// tests/unit/server/inventario.util.test.ts
// Conversión de unidades, precio por lista/presentación, FEFO y prorrateo
// ============================================================
import { describe, expect, it } from "vitest";
import { AppError } from "../../../src/server/services/appError.util";
import {
  aUnidadesBase,
  asignarFefo,
  diasHastaVencimiento,
  estaVencido,
  repartirProporcional,
  resolverPrecioUnitario,
  validarCantidadVenta,
  type EntradaPrecio,
  type LoteDisponible,
} from "../../../src/server/services/inventario.util";

describe("aUnidadesBase", () => {
  it("multiplica por el factor de la presentación", () => {
    expect(aUnidadesBase(2, 12)).toBe(24);
    expect(aUnidadesBase(1, 1)).toBe(1);
  });
  it("conserva fracciones y redondea a 4 decimales", () => {
    expect(aUnidadesBase(0.5, 12)).toBe(6);
    expect(aUnidadesBase(1 / 3, 3)).toBe(1);
    expect(aUnidadesBase(0.1, 3)).toBe(0.3);
  });
});

describe("validarCantidadVenta", () => {
  const base = { nombre: "Arroz", permiteDecimales: false, esPresentacion: false };

  it("unidad fraccionable (KG) admite decimales hasta 4 posiciones", () => {
    expect(() => validarCantidadVenta({ ...base, permiteDecimales: true, cantidad: 2.35 })).not.toThrow();
    expect(() => validarCantidadVenta({ ...base, permiteDecimales: true, cantidad: 0.0001 })).not.toThrow();
    expect(() => validarCantidadVenta({ ...base, permiteDecimales: true, cantidad: 1.23456 })).toThrow(/4 decimales/);
  });

  it("unidad no fraccionable exige cantidad entera", () => {
    expect(() => validarCantidadVenta({ ...base, cantidad: 3 })).not.toThrow();
    expect(() => validarCantidadVenta({ ...base, cantidad: 1.5 })).toThrow(AppError);
    expect(() => validarCantidadVenta({ ...base, cantidad: 1.5 })).toThrow(/fraccionadas/);
  });

  it("las presentaciones siempre se venden completas, aunque la unidad base sea fraccionable", () => {
    expect(() => validarCantidadVenta({ ...base, permiteDecimales: true, esPresentacion: true, cantidad: 2 })).not.toThrow();
    expect(() => validarCantidadVenta({ ...base, permiteDecimales: true, esPresentacion: true, cantidad: 0.5 })).toThrow(/presentaciones completas/);
  });
});

describe("resolverPrecioUnitario", () => {
  const base: EntradaPrecio = {
    precioProducto: 1,
    factor: 1,
    esPresentacion: false,
    precioPresentacion: null,
    precioListaBase: null,
    precioListaPresentacion: null,
  };
  const caja: EntradaPrecio = { ...base, factor: 24, esPresentacion: true };

  it("unidad base: catálogo, o lista si existe", () => {
    expect(resolverPrecioUnitario(base)).toBe(1);
    expect(resolverPrecioUnitario({ ...base, precioListaBase: 0.8 })).toBe(0.8);
  });

  it("presentación sin precios propios: precio base × factor", () => {
    expect(resolverPrecioUnitario(caja)).toBe(24);
  });

  it("presentación con precio propio en el catálogo", () => {
    expect(resolverPrecioUnitario({ ...caja, precioPresentacion: 22 })).toBe(22);
  });

  it("lista: precio específico de la presentación > base de la lista × factor > catálogo", () => {
    expect(resolverPrecioUnitario({ ...caja, precioPresentacion: 22, precioListaBase: 0.8, precioListaPresentacion: 18 })).toBe(18);
    expect(resolverPrecioUnitario({ ...caja, precioPresentacion: 22, precioListaBase: 0.8 })).toBe(19.2);
    expect(resolverPrecioUnitario({ ...caja, precioPresentacion: 22 })).toBe(22);
  });

  it("la lista de la unidad base no aplica a otra presentación del catálogo cuando no hay precio de lista", () => {
    expect(resolverPrecioUnitario({ ...base, precioListaPresentacion: 99 })).toBe(1);
  });

  it("redondea a 2 decimales", () => {
    expect(resolverPrecioUnitario({ ...caja, factor: 3, precioProducto: 0.333 })).toBe(1);
  });
});

describe("asignarFefo", () => {
  const dia = 86_400_000;
  const t0 = new Date("2026-01-01T00:00:00Z");
  const lote = (id: string, cantidadActual: number, venceEnDias: number, creadoEnDias = 0): LoteDisponible => ({
    id,
    cantidadActual,
    fechaVencimiento: new Date(t0.getTime() + venceEnDias * dia),
    createdAt: new Date(t0.getTime() + creadoEnDias * dia),
  });

  it("consume primero el lote que vence antes, sin importar el orden de entrada", () => {
    const r = asignarFefo([lote("B", 20, 40), lote("A", 5, 10)], 3);
    expect(r).toEqual({ asignaciones: [{ loteId: "A", cantidad: 3 }], faltante: 0 });
  });

  it("reparte entre varios lotes cuando uno no alcanza", () => {
    const r = asignarFefo([lote("B", 20, 40), lote("A", 5, 10), lote("C", 3, 5)], 10);
    expect(r.asignaciones).toEqual([
      { loteId: "C", cantidad: 3 },
      { loteId: "A", cantidad: 5 },
      { loteId: "B", cantidad: 2 },
    ]);
    expect(r.faltante).toBe(0);
  });

  it("empate de vencimiento: el lote más antiguo primero", () => {
    const r = asignarFefo([lote("nuevo", 5, 10, 5), lote("viejo", 5, 10, 1)], 6);
    expect(r.asignaciones.map((a) => a.loteId)).toEqual(["viejo", "nuevo"]);
  });

  it("informa el faltante si no hay existencias suficientes", () => {
    const r = asignarFefo([lote("A", 2, 10), lote("B", 3, 20)], 7);
    expect(r.asignaciones).toEqual([
      { loteId: "A", cantidad: 2 },
      { loteId: "B", cantidad: 3 },
    ]);
    expect(r.faltante).toBe(2);
  });

  it("ignora lotes sin existencia y no modifica el arreglo de entrada", () => {
    const entrada = [lote("vacio", 0, 1), lote("A", 4, 10)];
    const copia = [...entrada];
    expect(asignarFefo(entrada, 2).asignaciones).toEqual([{ loteId: "A", cantidad: 2 }]);
    expect(entrada).toEqual(copia);
  });

  it("maneja cantidades decimales sin errores de redondeo", () => {
    const r = asignarFefo([lote("A", 0.3, 1), lote("B", 1, 2)], 0.5);
    expect(r.asignaciones).toEqual([
      { loteId: "A", cantidad: 0.3 },
      { loteId: "B", cantidad: 0.2 },
    ]);
    expect(r.faltante).toBe(0);
  });
});

describe("repartirProporcional", () => {
  it("la suma de las partes es exacta (el último absorbe el redondeo)", () => {
    const partes = repartirProporcional(1.01, [3, 3]);
    expect(partes).toEqual([0.51, 0.5]);
    expect(partes.reduce((a, b) => a + b, 0)).toBeCloseTo(1.01, 10);
  });

  it("reparte según el peso de cada parte", () => {
    expect(repartirProporcional(10, [1, 3])).toEqual([2.5, 7.5]);
  });

  it("una sola parte recibe todo", () => {
    expect(repartirProporcional(7.77, [5])).toEqual([7.77]);
  });

  it("totales con muchos decimales siguen sumando exacto", () => {
    const partes = repartirProporcional(100, [1, 1, 1]);
    expect(Math.round(partes.reduce((a, b) => a + b, 0) * 100) / 100).toBe(100);
  });
});

describe("vencimientos", () => {
  const ahora = new Date("2026-06-01T12:00:00Z");

  it("estaVencido compara contra el instante dado", () => {
    expect(estaVencido(new Date("2026-05-31T12:00:00Z"), ahora)).toBe(true);
    expect(estaVencido(new Date("2026-06-01T12:00:01Z"), ahora)).toBe(false);
  });

  it("diasHastaVencimiento redondea hacia arriba; negativo si ya venció", () => {
    expect(diasHastaVencimiento(new Date("2026-06-11T12:00:00Z"), ahora)).toBe(10);
    expect(diasHastaVencimiento(new Date("2026-06-01T18:00:00Z"), ahora)).toBe(1);
    expect(diasHastaVencimiento(new Date("2026-05-30T12:00:00Z"), ahora)).toBe(-2);
  });
});
