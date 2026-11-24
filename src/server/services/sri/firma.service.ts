// ============================================================
// src/server/services/sri/firma.service.ts — Firma electrónica de comprobantes
//
// Toma el XML generado (sin firmar), lo firma con el certificado de la empresa, comprueba localmente la firma y que el
// documento firmado siga cumpliendo el XSD, y lo guarda en `xmlFirmado`. El estado NO cambia (sigue PENDIENTE):
// el envío al SRI y la autorización son responsabilidad del worker de la Semana 11.
// ============================================================
import type { PrismaClient } from "@prisma/client";
import type { ComprobanteRepository } from "../../repositories/comprobante.repository";
import { AppError } from "../appError.util";
import type { ActorCaja } from "../turno.service";
import type { CertificadoService } from "./certificado.service";
import { firmarXmlXades, verificarFirmaXades } from "./firma/xades.firma";
import type { TipoXsd, XsdValidatorService } from "./xsdValidator.service";

/** Estados en los que se puede (re)firmar: aún no están en poder del SRI. */
export const ESTADOS_FIRMABLES = ["PENDIENTE", "RECHAZADO", "DEVUELTO"] as const;

const TIPO_XSD: Record<string, TipoXsd> = { "01": "factura", "04": "notaCredito" };

export interface ResultadoFirma {
  id: string;
  claveAcceso: string;
  estado: string;
  /** SigningTime de la firma (hora de Ecuador) */
  firmadoEn: string;
  /** SHA-1 (hex) del certificado con el que se firmó */
  huellaCertificado: string;
  /** true si ya existía una firma anterior que fue reemplazada */
  refirmado: boolean;
}

export class FirmaService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: ComprobanteRepository,
    private readonly certificados: CertificadoService,
    private readonly xsd: XsdValidatorService
  ) {}

  /** Firma (o vuelve a firmar) un comprobante de la empresa del actor. */
  async firmarComprobante(id: string, actor: ActorCaja, ahora: Date = new Date()): Promise<ResultadoFirma> {
    const comprobante = await this.repo.buscarPorId(this.prisma, id, actor.empresaId);
    if (comprobante === null) throw new AppError("NO_ENCONTRADO", "Comprobante no encontrado");
    if (!(ESTADOS_FIRMABLES as readonly string[]).includes(comprobante.estado)) {
      throw new AppError("ESTADO_INVALIDO", `El comprobante está ${comprobante.estado.toLowerCase().replace("_", " ")}: ya no se puede firmar`);
    }
    const tipo = TIPO_XSD[comprobante.tipoComprobante];
    if (comprobante.xmlGenerado === null || tipo === undefined) {
      throw new AppError("ESTADO_INVALIDO", "El comprobante no tiene XML generado para firmar");
    }

    const material = await this.certificados.obtenerMaterial(actor.empresaId, ahora);
    const xmlFirmado = firmarXmlXades(comprobante.xmlGenerado, material, { ahora });

    // Autoverificación: nunca se guarda una firma que no pase la comprobación local
    const verificacion = verificarFirmaXades(xmlFirmado);
    if (!verificacion.valida) {
      throw new AppError("ESTADO_INVALIDO", `La firma generada no superó la verificación local: ${verificacion.errores.slice(0, 3).join(" | ")}`);
    }
    const esquema = await this.xsd.validar(tipo, xmlFirmado);
    if (!esquema.valido) {
      const detalle = esquema.errores.slice(0, 5).map((e) => e.mensaje).join(" | ");
      throw new AppError("VALIDACION", `El comprobante firmado no cumple el esquema XSD del SRI: ${detalle}`);
    }

    if (!(await this.repo.guardarXmlFirmado(this.prisma, id, xmlFirmado, ESTADOS_FIRMABLES))) {
      throw new AppError("ESTADO_INVALIDO", "El estado del comprobante cambió mientras se firmaba: reintente");
    }
    return {
      id,
      claveAcceso: comprobante.claveAcceso,
      estado: comprobante.estado,
      firmadoEn: verificacion.firmadoEn ?? "",
      huellaCertificado: material.info.huella,
      refirmado: comprobante.xmlFirmado !== null,
    };
  }
}
