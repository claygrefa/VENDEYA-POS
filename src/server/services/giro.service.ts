// ============================================================
// src/server/services/giro.service.ts — Feature flags multi-giro por empresa
// ============================================================
import type { ConfiguracionRepository } from "../repositories/configuracion.repository";
import type { Db } from "../repositories/kardex.repository";
import { AppError } from "./appError.util";

export type ModuloFlag = "moduloLotes" | "moduloVencimientos" | "moduloListasPrecios" | "moduloMesas" | "moduloComandasCocina" | "emitirFacturas" | "emitirRetenciones" | "emitirGuiasRemision" | "emitirLiquidaciones";

const ETIQUETA: Record<ModuloFlag, string> = {
  moduloLotes: "Control de lotes",
  moduloVencimientos: "Control de vencimientos",
  moduloListasPrecios: "Listas de precios",
  moduloMesas: "Mesas y cuentas abiertas",
  moduloComandasCocina: "Comandas a cocina/barra",
  emitirFacturas: "Emisión de facturas electrónicas",
  emitirRetenciones: "Emisión de comprobantes de retención",
  emitirGuiasRemision: "Emisión de guías de remisión",
  emitirLiquidaciones: "Emisión de liquidaciones de compra",
};

export class GiroService {
  constructor(private readonly repo: ConfiguracionRepository) {}

  /** Sin configuración registrada, todos los módulos opcionales están deshabilitados. */
  async habilitado(db: Db, empresaId: string, modulo: ModuloFlag): Promise<boolean> {
    const cfg = await this.repo.porEmpresa(db, empresaId);
    return cfg !== null && cfg[modulo];
  }

  /** Lanza MODULO_DESHABILITADO si el giro de la empresa no tiene activo el módulo. */
  async exigir(db: Db, empresaId: string, modulo: ModuloFlag): Promise<void> {
    if (!(await this.habilitado(db, empresaId, modulo))) {
      throw new AppError("MODULO_DESHABILITADO", `${ETIQUETA[modulo]} no está habilitado para el giro de este negocio`);
    }
  }
}
