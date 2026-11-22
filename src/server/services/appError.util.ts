// ============================================================
// src/server/services/appError.util.ts — Errores de dominio
// ============================================================

export type CodigoError =
  | "VALIDACION"
  | "NO_ENCONTRADO"
  | "DUPLICADO"
  | "CREDENCIALES_INVALIDAS"
  | "USUARIO_INACTIVO";

export class AppError extends Error {
  public readonly codigo: CodigoError;

  constructor(codigo: CodigoError, mensaje: string) {
    super(mensaje);
    this.name = "AppError";
    this.codigo = codigo;
  }
}
