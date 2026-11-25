// ============================================================
// src/server/services/setup/setup.service.ts — Alta inicial del negocio (asistente de configuración)
//
// Solo funciona MIENTRAS NO EXISTA ninguna empresa: después queda cerrado y los cambios se hacen con la sesión del
// administrador (ajustes). La comprobación va dentro de la misma transacción que el alta, de modo que dos intentos
// simultáneos no pueden crear dos empresas.
// ============================================================
import type { PrismaClient } from "@prisma/client";
import { SetupSchema, ValidarCertificadoSetupSchema, validarRucEcuatoriano } from "../../../shared/schemas/setup.schema";
import { AppError } from "../appError.util";
import { leerPkcs12, validarCertificadoParaEmisor } from "../sri/firma/pkcs12.util";
import { parsear } from "../validation.util";
import { crearInstalacion, sembrarBase, type ResultadoInstalacion } from "./instalacion.util";

export interface EstadoSetup {
  /** true si ya hay una empresa configurada: el asistente no debe mostrarse */
  configurado: boolean;
}

export interface CertificadoValidado {
  titular: string;
  emisor: string;
  vigenteHasta: Date;
  diasRestantes: number;
  advertencias: string[];
}

const DIA_MS = 86_400_000;

export class SetupService {
  constructor(private readonly prisma: PrismaClient) {}

  async estado(): Promise<EstadoSetup> {
    return { configurado: (await this.prisma.empresa.count()) > 0 };
  }

  async inicializar(entrada: unknown): Promise<ResultadoInstalacion> {
    const d = parsear(SetupSchema, entrada);
    if (!d.confirmarRuc && !validarRucEcuatoriano(d.empresa.ruc)) {
      throw new AppError("VALIDACION", "El RUC no pasa la verificación del dígito verificador: revíselo o confírmelo si es correcto");
    }
    return this.prisma.$transaction(async (tx) => {
      if ((await tx.empresa.count()) > 0) throw new AppError("ESTADO_INVALIDO", "El sistema ya está configurado");
      const roles = await sembrarBase(tx);
      return crearInstalacion(tx, roles, {
        empresa: { ...d.empresa },
        sucursal: d.sucursal,
        giro: d.giro,
        admin: d.admin,
      });
    });
  }

  /** Comprueba el `.p12` antes de crear nada (contraseña, vigencia, 2048 bits y titular); no guarda el archivo. */
  async validarCertificado(entrada: unknown, ahora: Date = new Date()): Promise<CertificadoValidado> {
    const d = parsear(ValidarCertificadoSetupSchema, entrada);
    if ((await this.estado()).configurado) throw new AppError("ESTADO_INVALIDO", "El sistema ya está configurado: use Ajustes para cambiar el certificado");
    const archivo = Buffer.from(d.archivoBase64, "base64");
    if (archivo.length === 0 || archivo.length > 256 * 1024) throw new AppError("VALIDACION", "El archivo del certificado no es válido");
    const m = leerPkcs12(archivo, d.password);
    const advertencias = validarCertificadoParaEmisor(m.info, { ruc: d.ruc, ahora, ...(d.confirmarTitular !== undefined ? { confirmarTitular: d.confirmarTitular } : {}) });
    return {
      titular: m.info.titular,
      emisor: m.info.emisor,
      vigenteHasta: m.info.vigenteHasta,
      diasRestantes: Math.floor((m.info.vigenteHasta.getTime() - ahora.getTime()) / DIA_MS),
      advertencias,
    };
  }
}
