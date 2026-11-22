// ============================================================
// tests/unit/server/utils.test.ts — password, omitUndefined, validación, cédula
// ============================================================
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../../../src/server/services/password.util";
import { omitUndefined } from "../../../src/server/services/object.util";
import { parsear } from "../../../src/server/services/validation.util";
import { AppError } from "../../../src/server/services/appError.util";
import { ClienteSchema, validarCedulaEcuatoriana } from "../../../src/shared/schemas/cliente.schema";
import { UsuarioSchema } from "../../../src/shared/schemas/usuario.schema";

describe("password.util", () => {
  it("hashea con formato scrypt y verifica la contraseña correcta", async () => {
    const hash = await hashPassword("Secreta123!");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("Secreta123!", hash)).toBe(true);
  });

  it("rechaza contraseña incorrecta", async () => {
    const hash = await hashPassword("Secreta123!");
    expect(await verifyPassword("otra", hash)).toBe(false);
  });

  it("genera hashes distintos para la misma contraseña (salt aleatorio)", async () => {
    expect(await hashPassword("abc12345")).not.toBe(await hashPassword("abc12345"));
  });

  it("rechaza hashes con formato inválido", async () => {
    expect(await verifyPassword("x", "texto-plano")).toBe(false);
    expect(await verifyPassword("x", "scrypt$aa$bb")).toBe(false);
  });
});

describe("omitUndefined", () => {
  it("elimina claves undefined y conserva null/falsy", () => {
    expect(omitUndefined({ a: 1, b: undefined, c: null, d: 0, e: "" })).toEqual({ a: 1, c: null, d: 0, e: "" });
  });
});

describe("parsear", () => {
  it("lanza AppError VALIDACION con el detalle de los campos", () => {
    try {
      parsear(UsuarioSchema, { username: "a" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).codigo).toBe("VALIDACION");
      expect((e as AppError).message).toContain("username");
    }
  });
});

describe("validarCedulaEcuatoriana", () => {
  it("acepta cédulas válidas", () => {
    expect(validarCedulaEcuatoriana("1710034065")).toBe(true);
    expect(validarCedulaEcuatoriana("0926687856")).toBe(true);
  });

  it("rechaza dígito verificador, provincia, tercer dígito y longitud inválidos", () => {
    expect(validarCedulaEcuatoriana("1710034066")).toBe(false);
    expect(validarCedulaEcuatoriana("9910034065")).toBe(false);
    expect(validarCedulaEcuatoriana("1760034065")).toBe(false);
    expect(validarCedulaEcuatoriana("171003406")).toBe(false);
    expect(validarCedulaEcuatoriana("abcdefghij")).toBe(false);
  });
});

describe("ClienteSchema", () => {
  const base = { razonSocial: "Cliente Prueba" };

  it("valida RUC (13 dígitos terminando en 001)", () => {
    expect(ClienteSchema.safeParse({ ...base, tipoIdentificacion: "04", identificacion: "1710034065001" }).success).toBe(true);
    expect(ClienteSchema.safeParse({ ...base, tipoIdentificacion: "04", identificacion: "1710034065002" }).success).toBe(false);
  });

  it("valida cédula con Módulo 10", () => {
    expect(ClienteSchema.safeParse({ ...base, tipoIdentificacion: "05", identificacion: "1710034065" }).success).toBe(true);
    expect(ClienteSchema.safeParse({ ...base, tipoIdentificacion: "05", identificacion: "1710034060" }).success).toBe(false);
  });

  it("Consumidor Final solo admite 9999999999999", () => {
    expect(ClienteSchema.safeParse({ ...base, tipoIdentificacion: "07", identificacion: "9999999999999" }).success).toBe(true);
    expect(ClienteSchema.safeParse({ ...base, tipoIdentificacion: "07", identificacion: "123" }).success).toBe(false);
  });
});
