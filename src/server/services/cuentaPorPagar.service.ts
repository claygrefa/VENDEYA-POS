// ============================================================
// src/server/services/cuentaPorPagar.service.ts — Cartera de proveedores
// ============================================================
import type { PrismaClient, Proveedor } from "@prisma/client";
import { AbonoSchema, FiltroCuentasPorPagarSchema } from "../../shared/schemas/cuenta.schema";
import type { CuentaPorPagarDetalle, CuentaPorPagarRepository } from "../repositories/cuentaPorPagar.repository";
import type { Db } from "../repositories/kardex.repository";
import type { ResultadoPaginado } from "../repositories/producto.repository";
import type { TurnoRepository } from "../repositories/turno.repository";
import { AppError } from "./appError.util";
import { estadoPorSaldo, sumarDias } from "./cuadreCaja.util";
import { omitUndefined } from "./object.util";
import type { ActorCaja } from "./turno.service";
import { parsear } from "./validation.util";
import { round2 } from "./ventaCalculo.util";

export interface GenerarCxP {
  compraId: string;
  proveedor: Pick<Proveedor, "id" | "diasPago">;
  monto: number;
  fecha: Date;
  /** Plazo específico de la compra; si falta se usa el del proveedor */
  diasCredito?: number | undefined;
}

export class CuentaPorPagarService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: CuentaPorPagarRepository,
    private readonly turnos: TurnoRepository
  ) {}

  /** Crea la cuenta por pagar de una compra a crédito (dentro de la transacción de la compra). */
  generarPorCompra(db: Db, g: GenerarCxP): Promise<CuentaPorPagarDetalle> {
    return this.repo.crear(db, {
      compraId: g.compraId,
      proveedorId: g.proveedor.id,
      montoTotal: round2(g.monto),
      fechaEmision: g.fecha,
      fechaVencimiento: sumarDias(g.fecha, g.diasCredito ?? g.proveedor.diasPago),
    });
  }

  /** Registra un pago al proveedor; si es en efectivo sale de la caja del turno abierto del actor. */
  async registrarPago(cuentaId: string, entrada: unknown, actor: ActorCaja): Promise<CuentaPorPagarDetalle> {
    const datos = parsear(AbonoSchema, entrada);
    const monto = round2(datos.monto);

    return this.prisma.$transaction(async (tx) => {
      const cuenta = await this.repo.buscarPorId(tx, cuentaId, actor.empresaId);
      if (cuenta === null) throw new AppError("NO_ENCONTRADO", "Cuenta por pagar no encontrada");
      if (cuenta.estado !== "PENDIENTE" && cuenta.estado !== "PARCIAL") {
        throw new AppError("ESTADO_INVALIDO", `La cuenta está ${cuenta.estado.toLowerCase()} y no admite pagos`);
      }
      if (monto > cuenta.saldo) {
        throw new AppError("VALIDACION", `El pago (${monto.toFixed(2)}) supera el saldo pendiente (${cuenta.saldo.toFixed(2)})`);
      }

      let turnoId: string | null = null;
      if (datos.formaPago === "EFECTIVO") {
        const turno = await this.turnos.turnoAbierto(tx, actor.id, cuenta.compra.sucursalId);
        if (turno === null) throw new AppError("TURNO_REQUERIDO", "Debe tener un turno de caja abierto para pagar en efectivo");
        const { esperado } = await this.turnos.detalleEfectivo(tx, turno);
        if (monto > esperado) {
          throw new AppError("VALIDACION", `Saldo de caja insuficiente: hay ${esperado.toFixed(2)} y se intenta pagar ${monto.toFixed(2)}`);
        }
        turnoId = turno.id;
        await this.turnos.crearMovimiento(tx, {
          turnoId,
          tipo: "EGRESO",
          concepto: `Pago factura ${cuenta.compra.numeroFactura} - ${cuenta.proveedor.razonSocial}`,
          monto,
          referencia: cuenta.id,
          categoria: "PAGO_CXP",
          usuarioId: actor.id,
        });
      }

      const saldo = round2(cuenta.saldo - monto);
      const filas = await this.repo.actualizarSaldoSiNoCambio(tx, cuenta.id, cuenta.saldo, { saldo, estado: estadoPorSaldo(saldo) });
      if (filas === 0) throw new AppError("ESTADO_INVALIDO", "La cuenta fue modificada simultáneamente; reintente");

      await this.repo.crearPago(tx, {
        cuentaId: cuenta.id,
        monto,
        formaPago: datos.formaPago,
        referencia: datos.referencia ?? null,
        usuarioId: actor.id,
        turnoId,
      });
      return (await this.repo.buscarPorId(tx, cuenta.id, actor.empresaId)) as CuentaPorPagarDetalle;
    });
  }

  async obtener(id: string, actor: ActorCaja): Promise<CuentaPorPagarDetalle> {
    const cuenta = await this.repo.buscarPorId(this.prisma, id, actor.empresaId);
    if (cuenta === null) throw new AppError("NO_ENCONTRADO", "Cuenta por pagar no encontrada");
    return cuenta;
  }

  async listar(entrada: unknown, actor: ActorCaja): Promise<ResultadoPaginado<CuentaPorPagarDetalle>> {
    const f = parsear(FiltroCuentasPorPagarSchema, entrada ?? {});
    return this.repo.listar(this.prisma, {
      empresaId: actor.empresaId,
      page: f.page,
      pageSize: f.pageSize,
      ...omitUndefined({ estado: f.estado, proveedorId: f.proveedorId, vencidas: f.vencidas }),
    });
  }
}
