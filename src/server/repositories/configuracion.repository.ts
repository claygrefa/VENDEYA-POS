// ============================================================
// src/server/repositories/configuracion.repository.ts — Feature flags de ConfiguracionGiro
// ============================================================
import type { ConfiguracionGiro } from "@prisma/client";
import type { Db } from "./kardex.repository";

export class ConfiguracionRepository {
  porEmpresa(db: Db, empresaId: string): Promise<ConfiguracionGiro | null> {
    return db.configuracionGiro.findUnique({ where: { empresaId } });
  }
}
