// ============================================================
// src/server/services/configuracion.service.ts — Ajustes del negocio: datos de la empresa, giro y módulos
// (la impresora, la balanza y el certificado tienen sus propios servicios)
// ============================================================
import type { ConfiguracionGiro, Empresa, PrismaClient } from "@prisma/client";
import { AplicarGiroSchema, EmpresaActualizarSchema, MODULOS_AJUSTABLES, ModulosSchema } from "../../shared/schemas/setup.schema";
import { AppError } from "./appError.util";
import { omitUndefined } from "./object.util";
import { banderasDeGiro } from "./setup/instalacion.util";
import type { SyncService } from "./sync/sync.service";
import type { ActorCaja } from "./turno.service";
import { parsear } from "./validation.util";

export interface AjustesNegocio {
  empresa: Pick<Empresa, "ruc" | "razonSocial" | "nombreComercial" | "direccionMatriz" | "telefono" | "email" | "tipoContribuyente" | "regimenTributario" | "obligadoContabilidad" | "agenteRetencion" | "resolucionAgente" | "contribuyenteEspecial" | "ambienteSRI">;
  giroNegocio: string;
  modulos: Record<(typeof MODULOS_AJUSTABLES)[number], boolean>;
}

export class ConfiguracionService {
  constructor(private readonly prisma: PrismaClient, private readonly sync: SyncService) {}

  async obtener(actor: ActorCaja): Promise<AjustesNegocio> {
    const empresa = await this.prisma.empresa.findUnique({ where: { id: actor.empresaId } });
    const cfg = await this.prisma.configuracionGiro.findUnique({ where: { empresaId: actor.empresaId } });
    if (empresa === null || cfg === null) throw new AppError("NO_ENCONTRADO", "La empresa no está configurada");
    return this.aAjustes(empresa, cfg);
  }

  async actualizarEmpresa(entrada: unknown, actor: ActorCaja): Promise<AjustesNegocio> {
    const d = parsear(EmpresaActualizarSchema, entrada);
    await this.prisma.empresa.update({ where: { id: actor.empresaId }, data: omitUndefined(d) });
    return this.obtener(actor);
  }

  async actualizarModulos(entrada: unknown, actor: ActorCaja): Promise<AjustesNegocio> {
    const d = parsear(ModulosSchema, entrada);
    await this.exigirConfiguracion(actor);
    await this.prisma.configuracionGiro.update({ where: { empresaId: actor.empresaId }, data: omitUndefined(d) });
    this.sync.olvidarConfiguracion();
    return this.obtener(actor);
  }

  /** Cambia el giro y deja los módulos como los define ese giro (se pierden los ajustes manuales de módulos). */
  async aplicarGiro(entrada: unknown, actor: ActorCaja): Promise<AjustesNegocio> {
    const { giro } = parsear(AplicarGiroSchema, entrada);
    await this.exigirConfiguracion(actor);
    await this.prisma.configuracionGiro.update({ where: { empresaId: actor.empresaId }, data: { giroNegocio: giro, ...banderasDeGiro(giro) } });
    this.sync.olvidarConfiguracion();
    return this.obtener(actor);
  }

  private async exigirConfiguracion(actor: ActorCaja): Promise<void> {
    if ((await this.prisma.configuracionGiro.count({ where: { empresaId: actor.empresaId } })) === 0) throw new AppError("NO_ENCONTRADO", "La empresa no está configurada");
  }

  private aAjustes(e: Empresa, c: ConfiguracionGiro): AjustesNegocio {
    const modulos = Object.fromEntries(MODULOS_AJUSTABLES.map((m) => [m, c[m]])) as AjustesNegocio["modulos"];
    return {
      empresa: {
        ruc: e.ruc, razonSocial: e.razonSocial, nombreComercial: e.nombreComercial, direccionMatriz: e.direccionMatriz, telefono: e.telefono, email: e.email,
        tipoContribuyente: e.tipoContribuyente, regimenTributario: e.regimenTributario, obligadoContabilidad: e.obligadoContabilidad, agenteRetencion: e.agenteRetencion,
        resolucionAgente: e.resolucionAgente, contribuyenteEspecial: e.contribuyenteEspecial, ambienteSRI: e.ambienteSRI,
      },
      giroNegocio: c.giroNegocio,
      modulos,
    };
  }
}
