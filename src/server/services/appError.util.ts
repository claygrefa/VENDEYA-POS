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
  | "ESTADO_INVALIDO"
  | "COBRO_ARCHIVADO"
  | "LIMITE_CREDITO_EXCEDIDO"
  | "SIN_PERMISO"
  | "MODULO_DESHABILITADO"
  /** Sin licencia vigente: no se pueden registrar ventas ni abrir turnos (HTTP 402) */
  | "LICENCIA_REQUERIDA"
  /** Demasiados inicios de sesión fallidos: el usuario queda bloqueado un tiempo (HTTP 429) */
  | "DEMASIADOS_INTENTOS";

export class AppError extends Error {
  public readonly codigo: CodigoError;

  constructor(codigo: CodigoError, mensaje: string) {
    super(mensaje);
    this.name = "AppError";
    this.codigo = codigo;
  }
}
