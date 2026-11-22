// ============================================================
// src/server/services/appError.util.ts — Errores de dominio
// ============================================================

export type CodigoError =
  | "VALIDACION"
  | "NO_ENCONTRADO"
  | "DUPLICADO"
  | "CREDENCIALES_INVALIDAS"
  | "USUARIO_INACTIVO"
  | "STOCK_INSUFICIENTE"
  | "TURNO_REQUERIDO"
  | "ESTADO_INVALIDO";

export class AppError extends Error {
  public readonly codigo: CodigoError;

  constructor(codigo: CodigoError, mensaje: string) {
    super(mensaje);
    this.name = "AppError";
    this.codigo = codigo;
  }
}
