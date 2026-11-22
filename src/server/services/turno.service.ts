// ============================================================
// src/server/services/turno.service.ts — Turnos de caja, movimientos, cierre ciego y reporte
// ============================================================
import type { MovimientoCaja, PrismaClient, TurnoCaja } from "@prisma/client";
import { AbrirTurnoSchema, CerrarTurnoSchema, MovimientoCajaSchema } from "../../shared/schemas/turno.schema";
import type { Db } from "../repositories/kardex.repository";
import type { PagoPorForma, ResumenVentasTurno, TurnoConCajero, TurnoRepository } from "../repositories/turno.repository";
import { AppError } from "./appError.util";
import { calcularDiferencia } from "./cuadreCaja.util";
import { parsear } from "./validation.util";
import { round2 } from "./ventaCalculo.util";

/** Permiso que identifica a un supervisor: opera y ve los turnos de otros cajeros. */
export const PERMISO_SUPERVISION = "caja:actualizar";

export interface ActorCaja {
  id: string;
  empresaId: string;
  permisos: readonly string[];
}

export function esSupervisor(actor: ActorCaja): boolean {
  return actor.permisos.includes(PERMISO_SUPERVISION);
}

export interface ReporteTurno {
  turno: {
    id: string;
    sucursalId: string;
    sucursal: string;
    cajeroId: string;
    cajero: string;
    estado: string;
    fechaApertura: Date;
    fechaCierre: Date | null;
    montoApertura: number;
    observaciones: string | null;
  };
  ventas: ResumenVentasTurno["completadas"] & { anuladas: ResumenVentasTurno["anuladas"] };
  porFormaPago: Array<PagoPorForma & { neto: number }>;
  movimientos: { ingresos: number; egresos: number; detalle: MovimientoCaja[] };
  /**
   * Arqueo. `null` mientras el turno está abierto y quien consulta es el propio cajero
   * (cierre ciego); un supervisor ve el esperado en vivo con `contado`/`diferencia` en null.
   */
  efectivo: { esperado: number; contado: number | null; diferencia: number | null } | null;
}

export class TurnoService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: TurnoRepository
  ) {}

  async abrir(entrada: unknown, actor: ActorCaja): Promise<TurnoCaja> {
    const datos = parsear(AbrirTurnoSchema, entrada);
    return this.prisma.$transaction(async (tx) => {
      const sucursal = await this.repo.sucursal(tx, datos.sucursalId);
      if (sucursal === null || sucursal.empresaId !== actor.empresaId) {
        throw new AppError("NO_ENCONTRADO", "Sucursal no encontrada");
      }
      if (sucursal.status !== "ACTIVO") throw new AppError("VALIDACION", "La sucursal está inactiva");
      if ((await this.repo.turnoAbierto(tx, actor.id, sucursal.id)) !== null) {
        throw new AppError("ESTADO_INVALIDO", "Ya tiene un turno abierto en esta sucursal");
      }
      return this.repo.crear(tx, { sucursalId: sucursal.id, cajeroId: actor.id, montoApertura: round2(datos.montoApertura) });
    });
  }

  /** Turno abierto del usuario; con varias sucursales abiertas exige indicar `sucursalId`. */
  async actual(actor: ActorCaja, sucursalId?: string): Promise<TurnoConCajero> {
    const abiertos = await this.repo.turnosAbiertosDe(this.prisma, actor.id, actor.empresaId);
    const candidatos = sucursalId !== undefined ? abiertos.filter((t) => t.sucursalId === sucursalId) : abiertos;
    if (candidatos.length === 0) throw new AppError("NO_ENCONTRADO", "No hay un turno abierto");
    if (candidatos.length > 1) throw new AppError("VALIDACION", "Hay turnos abiertos en varias sucursales: indique sucursalId");
    return candidatos[0] as TurnoConCajero;
  }

  async registrarMovimiento(turnoId: string, entrada: unknown, actor: ActorCaja): Promise<MovimientoCaja> {
    const datos = parsear(MovimientoCajaSchema, entrada);
    return this.prisma.$transaction(async (tx) => {
      const turno = await this.cargarOperable(tx, turnoId, actor);
      if (datos.tipo === "EGRESO") {
        const { esperado } = await this.repo.detalleEfectivo(tx, turno);
        if (datos.monto > esperado) {
          throw new AppError("VALIDACION", `Saldo de caja insuficiente: hay ${esperado.toFixed(2)} y se intenta retirar ${datos.monto.toFixed(2)}`);
        }
      }
      return this.repo.crearMovimiento(tx, {
        turnoId: turno.id,
        tipo: datos.tipo,
        concepto: datos.concepto,
        monto: round2(datos.monto),
        referencia: datos.referencia ?? null,
        categoria: "MANUAL",
        usuarioId: actor.id,
      });
    });
  }

  /**
   * Cierre ciego: el cajero declara el efectivo contado sin conocer el esperado;
   * el sistema calcula esperado y diferencia y los devuelve en el reporte ya cerrado.
   */
  async cerrar(turnoId: string, entrada: unknown, actor: ActorCaja): Promise<ReporteTurno> {
    const datos = parsear(CerrarTurnoSchema, entrada);
    return this.prisma.$transaction(async (tx) => {
      const turno = await this.cargarOperable(tx, turnoId, actor);
      const { esperado } = await this.repo.detalleEfectivo(tx, turno);
      const filas = await this.repo.cerrarSiAbierto(tx, turno.id, {
        contado: round2(datos.efectivoContado),
        esperado,
        diferencia: calcularDiferencia(datos.efectivoContado, esperado),
        observaciones: datos.observaciones ?? null,
        fecha: new Date(),
      });
      if (filas === 0) throw new AppError("ESTADO_INVALIDO", "El turno ya está cerrado");
      return this.construirReporte(tx, turno.id, actor);
    });
  }

  async reporte(turnoId: string, actor: ActorCaja): Promise<ReporteTurno> {
    return this.construirReporte(this.prisma, turnoId, actor);
  }

  // ── Internos ───────────────────────────────────────────────

  /** Turno ABIERTO sobre el que el actor puede operar (dueño o supervisor). */
  private async cargarOperable(db: Db, turnoId: string, actor: ActorCaja): Promise<TurnoConCajero> {
    const turno = await this.repo.buscarPorId(db, turnoId, actor.empresaId);
    if (turno === null) throw new AppError("NO_ENCONTRADO", "Turno no encontrado");
    if (turno.cajeroId !== actor.id && !esSupervisor(actor)) {
      throw new AppError("SIN_PERMISO", "El turno pertenece a otro cajero");
    }
    if (turno.estado !== "ABIERTO") throw new AppError("ESTADO_INVALIDO", "El turno ya está cerrado");
    return turno;
  }

  private async construirReporte(db: Db, turnoId: string, actor: ActorCaja): Promise<ReporteTurno> {
    const turno = await this.repo.buscarPorId(db, turnoId, actor.empresaId);
    if (turno === null) throw new AppError("NO_ENCONTRADO", "Turno no encontrado");
    const supervisor = esSupervisor(actor);
    if (turno.cajeroId !== actor.id && !supervisor) {
      throw new AppError("SIN_PERMISO", "El turno pertenece a otro cajero");
    }

    const [resumen, pagos, movimientos, detalle] = await Promise.all([
      this.repo.resumenVentas(db, turno.id),
      this.repo.pagosPorForma(db, turno.id),
      this.repo.movimientos(db, turno.id),
      this.repo.detalleEfectivo(db, turno),
    ]);

    // Cierre ciego: abierto + cajero → no se revela nada que permita deducir el efectivo esperado.
    const ciego = turno.estado === "ABIERTO" && !supervisor;
    const porFormaPago = pagos
      .filter((p) => !(ciego && p.formaPago === "EFECTIVO"))
      .map((p) => ({ ...p, neto: round2(p.monto - p.cambio) }));

    let efectivo: ReporteTurno["efectivo"];
    if (ciego) efectivo = null;
    else if (turno.estado === "CERRADO") {
      efectivo = { esperado: turno.montoCierreReal ?? detalle.esperado, contado: turno.montoCierreCiego, diferencia: turno.diferencia };
    } else efectivo = { esperado: detalle.esperado, contado: null, diferencia: null };

    return {
      turno: {
        id: turno.id,
        sucursalId: turno.sucursalId,
        sucursal: turno.sucursal.nombre,
        cajeroId: turno.cajeroId,
        cajero: `${turno.cajero.nombre} ${turno.cajero.apellido}`,
        estado: turno.estado,
        fechaApertura: turno.fechaApertura,
        fechaCierre: turno.fechaCierre,
        montoApertura: turno.montoApertura,
        observaciones: turno.observaciones,
      },
      ventas: { ...resumen.completadas, anuladas: resumen.anuladas },
      porFormaPago,
      movimientos: { ingresos: detalle.ingresos, egresos: detalle.egresos, detalle: movimientos },
      efectivo,
    };
  }
}
