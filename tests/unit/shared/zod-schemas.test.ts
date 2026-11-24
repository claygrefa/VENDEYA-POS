// ============================================================
// tests/unit/shared/zod-schemas.test.ts
// Prueba: Esquemas Zod validan y rechazan correctamente
// ============================================================

import { describe, it, expect } from "vitest";
import { EmpresaSchema, ProductoSchema, VentaInputSchema, PaginacionSchema } from "../../../src/shared/schemas";

describe("EmpresaSchema", () => {
  const empresaBase = {
    ruc:                  "0990123456001",
    razonSocial:          "VENDEYA S.A.",
    nombreComercial:      "VENDEYA POS",
    direccionMatriz:      "Av. 9 de Octubre 100",
    telefono:             "0999999999",
    email:                "admin@vendeya.ec",
    tipoContribuyente:    "SOCIEDAD" as const,
    regimenTributario:    "GENERAL" as const,
    obligadoContabilidad: true,
    agenteRetencion:      false,
    ambienteSRI:          "PRUEBAS" as const,
  };

  it("debe aceptar una empresa válida", () => {
    const result = EmpresaSchema.safeParse(empresaBase);
    expect(result.success).toBe(true);
  });

  it("debe rechazar RUC con longitud incorrecta", () => {
    const result = EmpresaSchema.safeParse({ ...empresaBase, ruc: "123" });
    expect(result.success).toBe(false);
  });

  it("debe rechazar email inválido", () => {
    const result = EmpresaSchema.safeParse({ ...empresaBase, email: "no-es-email" });
    expect(result.success).toBe(false);
  });
});

describe("ProductoSchema", () => {
  const productoBase = {
    codigo:         "PROD-001",
    nombre:         "Aceite Comestible 1L",
    tipo:           "BIEN" as const,
    categoriaId:    "550e8400-e29b-41d4-a716-446655440000",
    unidadMedidaId: "550e8400-e29b-41d4-a716-446655440001",
    precioCompra:   1.5,
    precioVenta:    2.0,
    stockMinimo:    5,
    aplicaIva:      true,
    codigoIvaSRI:   "4",
    tieneVencimiento: false,
    requiereLote:   false,
  };

  it("debe aceptar un producto válido", () => {
    expect(ProductoSchema.safeParse(productoBase).success).toBe(true);
  });

  it("debe rechazar precio de venta negativo", () => {
    expect(ProductoSchema.safeParse({ ...productoBase, precioVenta: -1 }).success).toBe(false);
  });

  it("debe rechazar categoriaId con UUID inválido", () => {
    expect(ProductoSchema.safeParse({ ...productoBase, categoriaId: "no-uuid" }).success).toBe(false);
  });
});

describe("VentaInputSchema", () => {
  it("debe rechazar venta sin líneas", () => {
    const result = VentaInputSchema.safeParse({
      lineas: [],
      pagos:  [{ formaPago: "EFECTIVO", monto: 10 }],
    });
    expect(result.success).toBe(false);
  });

  it("debe rechazar venta sin pagos", () => {
    const result = VentaInputSchema.safeParse({
      lineas: [{
        productoId: "550e8400-e29b-41d4-a716-446655440000",
        cantidad: 1,
        precioUnitario: 1.0,
      }],
      pagos: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("PaginacionSchema", () => {
  it("debe aplicar defaults correctos", () => {
    const result = PaginacionSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.orderDir).toBe("asc");
  });

  it("debe rechazar pageSize mayor a 200", () => {
    expect(PaginacionSchema.safeParse({ pageSize: 201 }).success).toBe(false);
  });
});
