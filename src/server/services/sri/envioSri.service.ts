// ============================================================
// src/server/services/sri/envioSri.service.ts — Envío y autorización de comprobantes en el SRI
//
// Flujo de un comprobante PENDIENTE de la cola:
//   1. Si no está firmado, se firma (sin certificado el comprobante sigue PENDIENTE con el motivo en `ultimoError`).
//   2. Se toma (EN_PROCESO) y se envía a Recepción:
//        RECIBIDA            → se consulta la autorización
//        DEVUELTA con 43     → la clave ya está registrada: se consulta la autorización
//        DEVUELTA con 70     → el SRI aún la procesa: se reintenta
//        DEVUELTA (otro)     → estado DEVUELTO (definitivo hasta que se corrija y se reintente a mano)
//   3. Autorización: AUTORIZADO → guarda el XML autorizado · NO AUTORIZADO → RECHAZADO · sin respuesta o
//      EN PROCESAMIENTO → se reintenta más tarde.
// Cualquier fallo de red, tiempo agotado o respuesta inesperada es REINTENTABLE (nunca un rechazo) con espera exponencial.
// No se mantiene ninguna transacción abierta durante las llamadas de red.
// ============================================================
import type { ComprobanteElectronico, PrismaClient } from "@prisma/client";
import type { ColaSriRepository, EstadoCola, ResultadoFinal } from "../../repositories/colaSri.repository";
import { AppError } from "../appError.util";
import type { ActorCaja } from "../turno.service";
import type { AmbienteSri } from "./claveAcceso.util";
import type { FirmaService } from "./firma.service";
import { SriTransporteError, type AutorizacionSri, type ClienteSri, type MensajeSri } from "./ws/sriSoap.types";

/** Estados desde los que se puede forzar un nuevo envío. */
const ESTADOS_REINTENTABLES = ["PENDIENTE", "RECHAZADO", "DEVUELTO"] as const;
/** Identificadores del SRI con significado propio (Ficha Técnica, tabla de mensajes). */
const ESTADOS_NO_AUTORIZADO = ["NO AUTORIZADO", "RECHAZADO"];
const ID_CLAVE_REGISTRADA = "43";
const ID_EN_PROCESAMIENTO = "70";

export const ESPERA_BASE_MS = 30_000;
export const ESPERA_MAXIMA_MS = 30 * 60_000;

/** Espera antes del intento n (1, 2, 3…): 30 s, 1 min, 2 min… con tope de 30 min. */
export function esperaReintentoMs(intento: number): number {
  const n = Math.max(1, Math.floor(intento));
  return Math.min(ESPERA_BASE_MS * 2 ** Math.min(n - 1, 20), ESPERA_MAXIMA_MS);
}

export type ResultadoEnvio = "AUTORIZADO" | "RECHAZADO" | "DEVUELTO" | "REINTENTO" | "OMITIDO";

export interface OpcionesEnvioSri {
  /** Reloj inyectable (pruebas) */
  ahora?: () => Date;
  /** Se invoca cuando un comprobante llega a un estado definitivo (AUTORIZADO, RECHAZADO, DEVUELTO) */
  alCambiarEstado?: (empresaId: string, comprobanteId: string, estado: string) => void;
}

const ambienteDe = (c: { ambiente: string }): AmbienteSri => (c.ambiente === "2" ? "2" : "1");
const sinSaltos = (s: string): string => s.replace(/\s+/g, " ").trim();

/** XML de autorización tal como lo entrega el SRI al contribuyente: `<autorizacion>` con el comprobante en CDATA. */
export function construirXmlAutorizado(a: AutorizacionSri, xmlComprobante: string): string {
  const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cdata = xmlComprobante.replace(/\]\]>/g, "]]]]><![CDATA[>");
  const fecha = a.fechaAutorizacion?.toISOString() ?? "";
  return (
    `<autorizacion><estado>${esc(a.estado)}</estado><numeroAutorizacion>${esc(a.numeroAutorizacion ?? "")}</numeroAutorizacion>` +
    `<fechaAutorizacion>${fecha}</fechaAutorizacion><ambiente>${esc(a.ambiente ?? "")}</ambiente>` +
    `<comprobante><![CDATA[${cdata}]]></comprobante></autorizacion>`
  );
}

const mensajesJson = (m: MensajeSri[]): string | null => (m.length > 0 ? JSON.stringify(m) : null);

export class EnvioSriService {
  private readonly ahora: () => Date;
  private readonly alCambiarEstado: ((empresaId: string, comprobanteId: string, estado: string) => void) | undefined;
  private readonly oyentes: Array<() => void> = [];

  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: ColaSriRepository,
    private readonly firma: FirmaService,
    private readonly cliente: ClienteSri,
    opciones: OpcionesEnvioSri = {}
  ) {
    this.ahora = opciones.ahora ?? (() => new Date());
    this.alCambiarEstado = opciones.alCambiarEstado;
  }

  /** El worker se suscribe para despertar cuando hay trabajo nuevo (reintento manual). */
  alHaberTrabajo(oyente: () => void): void {
    this.oyentes.push(oyente);
  }

  // ── Ciclo del worker ───────────────────────────────────────

  /** Procesa, de uno en uno y en orden cronológico, hasta `limite` comprobantes listos. Devuelve cuántos trató. */
  async procesarCola(limite: number): Promise<number> {
    const ids = await this.repo.listosParaEnviar(this.prisma, this.ahora(), limite);
    let tratados = 0;
    for (const id of ids) {
      if ((await this.procesar(id)) !== "OMITIDO") tratados += 1;
    }
    return tratados;
  }

  /** Libera lo que quedó EN_PROCESO: todo al arrancar, o solo lo más viejo que `maximoMs` durante la operación. */
  recuperarEnProceso(maximoMs: number | null): Promise<number> {
    const antesDe = maximoMs === null ? null : new Date(this.ahora().getTime() - maximoMs);
    return this.repo.recuperarEnProceso(this.prisma, antesDe);
  }

  /** Envía un comprobante y registra el resultado. Nunca lanza por fallos del SRI o de la red. */
  async procesar(comprobanteId: string): Promise<ResultadoEnvio> {
    const inicial = await this.prisma.comprobanteElectronico.findUnique({ where: { id: comprobanteId } });
    if (inicial === null || inicial.estado !== "PENDIENTE") return "OMITIDO";

    // 1) Firma (si falta). Falla sin certificado vigente: el comprobante queda PENDIENTE con el motivo
    let xmlFirmado = inicial.xmlFirmado;
    if (xmlFirmado === null) {
      try {
        await this.firma.firmarComprobante(inicial.id, { id: "sistema", empresaId: inicial.empresaId, permisos: [] }, this.ahora());
        xmlFirmado = (await this.prisma.comprobanteElectronico.findUniqueOrThrow({ where: { id: inicial.id } })).xmlFirmado;
      } catch (e) {
        // Otro proceso pudo haberlo firmado o tomado mientras tanto: no es un fallo de este intento
        const actual = await this.prisma.comprobanteElectronico.findUnique({ where: { id: inicial.id } });
        if (actual === null || actual.estado !== "PENDIENTE" || actual.xmlFirmado !== null) return "OMITIDO";
        await this.fallarAntesDeEnviar(inicial, `No se pudo firmar: ${mensajeDe(e)}`);
        return "REINTENTO";
      }
      if (xmlFirmado === null) return "OMITIDO";
    }

    // 2) Tomar el comprobante (otro proceso podría haberse adelantado)
    const tomado = await this.prisma.$transaction((tx) => this.repo.reclamar(tx, inicial.id, this.ahora()));
    if (!tomado) return "OMITIDO";

    try {
      return await this.enviarYAutorizar(inicial, xmlFirmado);
    } catch (e) {
      const intentos = (await this.prisma.colaSRI.findUnique({ where: { comprobanteId: inicial.id } }))?.intentos ?? 1;
      const etiqueta = e instanceof SriTransporteError ? "Sin respuesta del SRI" : "Error al procesar el envío";
      await this.repo.liberar(this.prisma, inicial.id, `${etiqueta}: ${mensajeDe(e)}`, new Date(this.ahora().getTime() + esperaReintentoMs(intentos)));
      return "REINTENTO";
    }
  }

  private async enviarYAutorizar(c: ComprobanteElectronico, xmlFirmado: string): Promise<ResultadoEnvio> {
    const ambiente = ambienteDe(c);
    const recepcion = await this.cliente.enviarComprobante(ambiente, xmlFirmado);

    if (recepcion.estado === "DEVUELTA") {
      const ids = new Set(recepcion.mensajes.map((m) => m.identificador));
      if (ids.has(ID_EN_PROCESAMIENTO) && !ids.has(ID_CLAVE_REGISTRADA)) {
        await this.diferir(c.id, "El SRI aún está procesando este comprobante");
        return "REINTENTO";
      }
      if (!ids.has(ID_CLAVE_REGISTRADA)) {
        await this.cerrar(c, { estado: "DEVUELTO", mensajesRespuesta: mensajesJson(recepcion.mensajes) });
        return "DEVUELTO";
      }
      // 43: ya estaba registrado (un envío anterior llegó pero no se alcanzó a leer la respuesta): se consulta la autorización
    }

    const respuesta = await this.cliente.consultarAutorizacion(ambiente, c.claveAcceso);
    // La ficha (7.2.3) ilustra el rechazo con el estado "RECHAZADO" y el servicio devuelve "NO AUTORIZADO": ambos son un rechazo
    const autorizacion = respuesta.autorizaciones.find((a) => a.estado === "AUTORIZADO") ?? respuesta.autorizaciones.find((a) => ESTADOS_NO_AUTORIZADO.includes(a.estado));
    if (autorizacion === undefined) {
      await this.diferir(c.id, "El SRI recibió el comprobante pero aún no lo autoriza");
      return "REINTENTO";
    }

    if (autorizacion.estado === "AUTORIZADO") {
      const comprobanteXml = autorizacion.comprobante ?? xmlFirmado;
      await this.cerrar(c, {
        estado: "AUTORIZADO",
        mensajesRespuesta: mensajesJson(autorizacion.mensajes),
        xmlAutorizado: construirXmlAutorizado(autorizacion, comprobanteXml),
        numeroAutorizacion: autorizacion.numeroAutorizacion ?? c.claveAcceso, // en el esquema offline coincide con la clave de acceso
        fechaAutorizacion: autorizacion.fechaAutorizacion ?? this.ahora(),
      });
      return "AUTORIZADO";
    }
    await this.cerrar(c, { estado: "RECHAZADO", mensajesRespuesta: mensajesJson(autorizacion.mensajes) });
    return "RECHAZADO";
  }

  // ── Operaciones expuestas por la API ───────────────────────

  /** Estado de la cola de la empresa del actor. */
  estadoCola(actor: ActorCaja, limite = 50): Promise<EstadoCola> {
    return this.repo.estado(this.prisma, actor.empresaId, limite);
  }

  /**
   * Fuerza un nuevo envío: deja el comprobante PENDIENTE y sin espera. Si estaba RECHAZADO o DEVUELTO se descarta
   * la firma para volver a firmar (p. ej. con un certificado nuevo).
   */
  async reintentar(id: string, actor: ActorCaja): Promise<{ id: string; estado: string }> {
    const c = await this.repo.buscar(this.prisma, id, actor.empresaId);
    if (c === null) throw new AppError("NO_ENCONTRADO", "Comprobante no encontrado");
    if (!(ESTADOS_REINTENTABLES as readonly string[]).includes(c.estado)) {
      throw new AppError("ESTADO_INVALIDO", `El comprobante está ${c.estado.toLowerCase().replace("_", " ")}: no se puede reenviar`);
    }
    if (c.xmlGenerado === null) throw new AppError("ESTADO_INVALIDO", "El comprobante no tiene XML generado");
    await this.prisma.$transaction((tx) => this.repo.reiniciar(tx, id, c.estado !== "PENDIENTE"));
    for (const oyente of this.oyentes) oyente();
    return { id, estado: "PENDIENTE" };
  }

  // ── Internos ───────────────────────────────────────────────

  private async cerrar(c: { id: string; empresaId: string }, r: ResultadoFinal): Promise<void> {
    await this.prisma.$transaction((tx) => this.repo.finalizar(tx, c.id, r));
    this.alCambiarEstado?.(c.empresaId, c.id, r.estado);
  }

  private async diferir(id: string, motivo: string): Promise<void> {
    const intentos = (await this.prisma.colaSRI.findUnique({ where: { comprobanteId: id } }))?.intentos ?? 1;
    await this.repo.liberar(this.prisma, id, motivo, new Date(this.ahora().getTime() + esperaReintentoMs(intentos)));
  }

  private async fallarAntesDeEnviar(c: ComprobanteElectronico, motivo: string): Promise<void> {
    const cola = await this.prisma.colaSRI.findUnique({ where: { comprobanteId: c.id } });
    const intento = (cola?.intentos ?? 0) + 1;
    const ahora = this.ahora();
    await this.repo.registrarFalloPrevio(this.prisma, c.id, sinSaltos(motivo), ahora, new Date(ahora.getTime() + esperaReintentoMs(intento)));
  }
}

function mensajeDe(e: unknown): string {
  return sinSaltos(e instanceof Error ? e.message : String(e)).slice(0, 300);
}
