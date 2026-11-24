// ============================================================
// src/server/repositories/configuracion.repository.ts — Feature flags y certificado de ConfiguracionGiro
// ============================================================
import type { ConfiguracionGiro } from "@prisma/client";
import type { SecretoCifrado } from "../services/sri/firma/cifrado.util";
import type { Db } from "./kardex.repository";

/** Datos del certificado que se guardan en la configuración (la contraseña siempre cifrada). */
export interface DatosCertificado {
  rutaArchivo: string;
  secreto: SecretoCifrado;
  vencimiento: Date;
  titular: string;
  emisor: string;
  huella: string;
}

export type ConfiguracionConCertificado = ConfiguracionGiro & {
  rutaCertificadoP12: string;
  certPasswordEncriptado: string;
  certIv: string;
  certTag: string;
};

export class ConfiguracionRepository {
  porEmpresa(db: Db, empresaId: string): Promise<ConfiguracionGiro | null> {
    return db.configuracionGiro.findUnique({ where: { empresaId } });
  }

  rucDeEmpresa(db: Db, empresaId: string): Promise<{ ruc: string } | null> {
    return db.empresa.findUnique({ where: { id: empresaId }, select: { ruc: true } });
  }

  guardarCertificado(db: Db, empresaId: string, c: DatosCertificado): Promise<ConfiguracionGiro> {
    return db.configuracionGiro.update({
      where: { empresaId },
      data: {
        rutaCertificadoP12: c.rutaArchivo,
        certPasswordEncriptado: c.secreto.cifrado,
        certIv: c.secreto.iv,
        certTag: c.secreto.tag,
        certVencimiento: c.vencimiento,
        certTitular: c.titular,
        certEmisor: c.emisor,
        certHuella: c.huella,
      },
    });
  }

  quitarCertificado(db: Db, empresaId: string): Promise<ConfiguracionGiro> {
    return db.configuracionGiro.update({
      where: { empresaId },
      data: {
        rutaCertificadoP12: null,
        certPasswordEncriptado: null,
        certIv: null,
        certTag: null,
        certVencimiento: null,
        certTitular: null,
        certEmisor: null,
        certHuella: null,
      },
    });
  }

  /** Configuraciones con certificado cargado (para re-cifrar al rotar la clave maestra). */
  async conCertificado(db: Db): Promise<ConfiguracionConCertificado[]> {
    const filas = await db.configuracionGiro.findMany({
      where: { rutaCertificadoP12: { not: null }, certPasswordEncriptado: { not: null }, certIv: { not: null }, certTag: { not: null } },
    });
    return filas as ConfiguracionConCertificado[];
  }

  actualizarSecreto(db: Db, empresaId: string, s: SecretoCifrado): Promise<ConfiguracionGiro> {
    return db.configuracionGiro.update({ where: { empresaId }, data: { certPasswordEncriptado: s.cifrado, certIv: s.iv, certTag: s.tag } });
  }
}
