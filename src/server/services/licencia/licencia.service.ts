// ============================================================
// src/server/services/licencia/licencia.service.ts — Licenciamiento y suscripciones
//
// Activación online con clave → el servidor devuelve una licencia FIRMADA que se guarda en la base de datos. Cada 24 h (y al arrancar)
// se valida en línea; sin conexión se sigue operando hasta `graciaDias` (15) desde la última validación correcta. La licencia solo
// sirve en el equipo y la empresa para los que se emitió, y el reloj atrasado se detecta. Sin licencia vigente se bloquean las
// ventas y la apertura de turnos, NUNCA el cierre de turno, los reportes ni los respaldos: los datos del cliente no se retienen.
// ============================================================
import type { Licencia, PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { DispositivosLicencia, EstadoLicencia } from "../../../shared/types/licencia.types";
import { AppError } from "../appError.util";
import type { ActorCaja } from "../turno.service";
import { parsear } from "../validation.util";
import { ErrorLicencias, type ClienteLicencias, type DatosDispositivo } from "./licencia.cliente";
import { evaluarLicencia, type LicenciaGuardada } from "./licencia.estado";
import { verificarLicencia } from "./licencia.token";
import type { Db } from "../../repositories/kardex.repository";

export interface OpcionesLicencia {
  /** Se exige licencia (aplicación instalada). Con false (desarrollo, pruebas) se opera sin restricciones. */
  requerida: boolean;
  /** Servidor de licencias; null = no configurado */
  cliente: ClienteLicencias | null;
  /** Clave pública (PEM) con la que el servidor firma las licencias; null = no configurada */
  clavePublica: string | null;
  /** Este equipo */
  dispositivo: DatosDispositivo;
  ahora?: () => Date;
  /** Días de gracia offline desde la última validación correcta (default 15) */
  graciaDias?: number;
  /** Días sin validar a partir de los cuales se avisa (default 2) */
  avisoGraciaDias?: number;
  /** Días para vencer a partir de los cuales se avisa (default 7) */
  avisoVencimientoDias?: number;
}

const ClaveSchema = z.object({ clave: z.string().trim().regex(/^[A-Za-z0-9-]{8,64}$/, "La clave de activación son 8 a 64 letras, números o guiones") });
/** Se escribe el reloj visto como máximo cada 5 minutos: no añade una escritura a cada venta */
const REFRESCO_RELOJ_MS = 5 * 60_000;

export class LicenciaService {
  private readonly ahora: () => Date;
  private readonly enCurso = new Map<string, Promise<ResultadoValidacion>>();

  constructor(private readonly prisma: PrismaClient, private readonly o: OpcionesLicencia) {
    this.ahora = o.ahora ?? (() => new Date());
  }

  /** ¿Hay licenciamiento activo? (requerido y con servidor y clave pública configurados) */
  get habilitada(): boolean {
    return this.o.requerida && this.o.cliente !== null && this.o.clavePublica !== null;
  }

  get dispositivo(): DatosDispositivo {
    return this.o.dispositivo;
  }

  async estado(empresaId: string, db: Db = this.prisma): Promise<EstadoLicencia> {
    const ahora = this.ahora();
    if (!this.habilitada) {
      const e = evaluarLicencia(this.entrada(null, "", ahora));
      return this.o.requerida ? { ...e, mensaje: "El licenciamiento no está configurado en esta instalación (falta el servidor de licencias o su clave pública)" } : e;
    }
    const empresa = await db.empresa.findUnique({ where: { id: empresaId }, select: { ruc: true } });
    if (empresa === null) throw new AppError("NO_ENCONTRADO", "La empresa no está configurada");
    const fila = await db.licencia.findUnique({ where: { empresaId } });
    const estado = evaluarLicencia(this.entrada(fila === null ? null : aGuardada(fila), empresa.ruc, ahora));
    // Se recuerda el reloj más alto visto, salvo que justo ahora esté atrasado (no se «normaliza» un reloj manipulado)
    if (fila !== null && estado.tipo !== "INVALIDA" && ahora.getTime() >= fila.ultimoRelojVisto.getTime() + REFRESCO_RELOJ_MS) {
      await db.licencia.update({ where: { empresaId }, data: { ultimoRelojVisto: ahora } });
    }
    return estado;
  }

  /** Lanza LICENCIA_REQUERIDA (402) si no se puede operar. Sin licenciamiento activo no hace nada ni toca la base. */
  async exigirVigente(empresaId: string, db: Db = this.prisma): Promise<void> {
    if (!this.habilitada) return;
    const e = await this.estado(empresaId, db);
    if (!e.permiteOperar) throw new AppError("LICENCIA_REQUERIDA", e.mensaje);
  }

  async activar(entrada: unknown, actor: ActorCaja): Promise<EstadoLicencia> {
    const { clave } = parsear(ClaveSchema, entrada);
    const cliente = this.exigirCliente();
    const empresa = await this.prisma.empresa.findUnique({ where: { id: actor.empresaId }, select: { ruc: true } });
    if (empresa === null) throw new AppError("NO_ENCONTRADO", "La empresa no está configurada");

    let token: string;
    try {
      token = (await cliente.activar({ clave, ruc: empresa.ruc, dispositivo: this.o.dispositivo })).token;
    } catch (e) {
      throw aAppError(e);
    }
    try {
      this.comprobarEmitida(token, empresa.ruc);
    } catch (e) {
      throw aAppError(e);
    }

    const ahora = this.ahora();
    const datos = { clave, token, dispositivoId: this.o.dispositivo.id, ultimaValidacion: ahora, ultimoRelojVisto: ahora, bloqueoServidor: null, motivoBloqueo: null };
    await this.prisma.licencia.upsert({ where: { empresaId: actor.empresaId }, create: { empresaId: actor.empresaId, ...datos }, update: datos });
    return this.estado(actor.empresaId);
  }

  /** Valida en línea y renueva la licencia. Con falla de red no cambia nada (corre el período de gracia). */
  validarEnLinea(empresaId: string): Promise<ResultadoValidacion> {
    const previa = this.enCurso.get(empresaId);
    if (previa !== undefined) return previa;
    const p = this.validar(empresaId).finally(() => this.enCurso.delete(empresaId));
    this.enCurso.set(empresaId, p);
    return p;
  }

  /** Valida todas las licencias guardadas (la usa el trabajo periódico). Nunca lanza. */
  async validarTodas(): Promise<void> {
    if (!this.habilitada) return;
    for (const { empresaId } of await this.prisma.licencia.findMany({ select: { empresaId: true } })) {
      await this.validarEnLinea(empresaId).catch(() => undefined);
    }
  }

  /** Libera la plaza de ESTE equipo en el servidor y borra la licencia local (para pasar la plaza a otro equipo). */
  async desactivar(actor: ActorCaja): Promise<EstadoLicencia> {
    const cliente = this.exigirCliente();
    const fila = await this.exigirFila(actor.empresaId);
    try {
      await cliente.desactivar({ token: fila.token, dispositivoId: this.o.dispositivo.id });
    } catch (e) {
      // Si el servidor ya no reconoce este equipo/licencia, liberar no tiene sentido y se limpia lo local; ante una falla pasajera no se
      // borra nada (la plaza seguiría ocupada en el servidor sin que el usuario lo sepa)
      if (!(e instanceof ErrorLicencias) || e.transitorio) throw aAppError(e);
    }
    await this.prisma.licencia.delete({ where: { empresaId: actor.empresaId } });
    return this.estado(actor.empresaId);
  }

  async dispositivos(actor: ActorCaja): Promise<DispositivosLicencia> {
    const cliente = this.exigirCliente();
    const fila = await this.exigirFila(actor.empresaId);
    try {
      const r = await cliente.dispositivos({ token: fila.token });
      return { maximo: r.maximo, dispositivos: r.dispositivos.map((d) => ({ ...d, esEste: d.id === this.o.dispositivo.id })) };
    } catch (e) {
      throw aAppError(e);
    }
  }

  /** Libera la plaza de OTRO equipo (el actual se libera con `desactivar`). */
  async liberar(dispositivoId: string, actor: ActorCaja): Promise<DispositivosLicencia> {
    if (dispositivoId === this.o.dispositivo.id) throw new AppError("VALIDACION", "Para liberar este equipo use «Desactivar este equipo»");
    const cliente = this.exigirCliente();
    const fila = await this.exigirFila(actor.empresaId);
    try {
      await cliente.liberar({ token: fila.token, dispositivoId });
    } catch (e) {
      throw aAppError(e);
    }
    return this.dispositivos(actor);
  }

  // ── Interno ──────────────────────────────────────────────

  private async validar(empresaId: string): Promise<ResultadoValidacion> {
    if (!this.habilitada) return { estado: await this.estado(empresaId), error: null };
    const fila = await this.prisma.licencia.findUnique({ where: { empresaId } });
    const empresa = await this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { ruc: true } });
    if (fila === null || empresa === null) return { estado: await this.estado(empresaId), error: null };

    const ahora = this.ahora();
    try {
      const { token } = await this.exigirCliente().validar({ token: fila.token, dispositivo: this.o.dispositivo });
      this.comprobarEmitida(token, empresa.ruc);
      await this.prisma.licencia.update({ where: { empresaId }, data: { token, ultimaValidacion: ahora, bloqueoServidor: null, motivoBloqueo: null } });
    } catch (e) {
      if (!(e instanceof ErrorLicencias)) return { estado: await this.estado(empresaId), error: e instanceof Error ? e.message : "La validación de la licencia falló" };
      if (e.transitorio) return { estado: await this.estado(empresaId), error: e.message };
      const bloqueo = bloqueoDe(e);
      // El servidor SÍ respondió: cuenta como validación (no corre la gracia offline) aunque la respuesta sea un bloqueo
      await this.prisma.licencia.update({ where: { empresaId }, data: { ultimaValidacion: ahora, bloqueoServidor: bloqueo, motivoBloqueo: motivoDe(e) } });
    }
    return { estado: await this.estado(empresaId), error: null };
  }

  /** La licencia devuelta por el servidor debe ser auténtica y de esta empresa y este equipo. */
  private comprobarEmitida(token: string, ruc: string): void {
    const v = verificarLicencia(token, this.o.clavePublica as string);
    if (!v.valida) throw new ErrorLicencias("RESPUESTA_INVALIDA", `El servidor de licencias devolvió una licencia inválida: ${v.motivo}`);
    if (v.payload.ruc !== ruc) throw new ErrorLicencias("RUC_NO_COINCIDE");
    if (v.payload.dispositivoId !== this.o.dispositivo.id) throw new ErrorLicencias("RESPUESTA_INVALIDA", "El servidor de licencias devolvió una licencia de otro equipo");
  }

  private entrada(licencia: LicenciaGuardada | null, ruc: string, ahora: Date) {
    return {
      requerida: this.habilitada,
      licencia,
      clavePublica: this.o.clavePublica,
      ruc,
      dispositivoId: this.o.dispositivo.id,
      ahora,
      graciaDias: this.o.graciaDias ?? 15,
      avisoGraciaDias: this.o.avisoGraciaDias ?? 2,
      avisoVencimientoDias: this.o.avisoVencimientoDias ?? 7,
    };
  }

  private exigirCliente(): ClienteLicencias {
    if (!this.habilitada || this.o.cliente === null) throw new AppError("ESTADO_INVALIDO", "El licenciamiento no está configurado en esta instalación");
    return this.o.cliente;
  }

  private async exigirFila(empresaId: string): Promise<Licencia> {
    const fila = await this.prisma.licencia.findUnique({ where: { empresaId } });
    if (fila === null) throw new AppError("NO_ENCONTRADO", "Este equipo no tiene una licencia activada");
    return fila;
  }
}

export interface ResultadoValidacion {
  estado: EstadoLicencia;
  /** Por qué no se pudo validar (sin conexión, servidor caído…); null si se validó o no hacía falta */
  error: string | null;
}

function aGuardada(f: Licencia): LicenciaGuardada {
  return { clave: f.clave, token: f.token, dispositivoId: f.dispositivoId, ultimaValidacion: f.ultimaValidacion, ultimoRelojVisto: f.ultimoRelojVisto, bloqueoServidor: f.bloqueoServidor, motivoBloqueo: f.motivoBloqueo };
}

function bloqueoDe(e: ErrorLicencias): string {
  if (e.codigo === "SUSCRIPCION_VENCIDA") return "SUSCRIPCION_VENCIDA";
  if (e.codigo === "DISPOSITIVO_NO_REGISTRADO") return "DISPOSITIVO";
  return "REVOCADA"; // REVOCADA, CLAVE_INVALIDA, RUC_NO_COINCIDE: el servidor ya no acepta esta licencia
}

function motivoDe(e: ErrorLicencias): string | null {
  const m = (e.detalle as { motivo?: unknown } | null | undefined)?.motivo;
  return typeof m === "string" && m !== "" ? m.slice(0, 200) : e.codigo === "CLAVE_INVALIDA" ? "la clave ya no existe" : null;
}

/** Errores del servidor de licencias → errores de dominio con un mensaje que el usuario pueda atender. */
function aAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (!(e instanceof ErrorLicencias)) return new AppError("ESTADO_INVALIDO", e instanceof Error ? e.message : "Falló la comunicación con el servidor de licencias");
  if (e.codigo === "CLAVE_INVALIDA" || e.codigo === "RUC_NO_COINCIDE") return new AppError("VALIDACION", e.message);
  if (e.codigo === "LIMITE_DISPOSITIVOS") {
    const lista = (e.detalle as { dispositivos?: Array<{ nombre?: unknown }> } | null | undefined)?.dispositivos;
    const nombres = Array.isArray(lista) ? lista.map((d) => (typeof d.nombre === "string" ? d.nombre : "")).filter((n) => n !== "") : [];
    return new AppError("ESTADO_INVALIDO", nombres.length === 0 ? e.message : `${e.message} Equipos registrados: ${nombres.join(", ")}.`);
  }
  return new AppError("ESTADO_INVALIDO", e.message);
}
