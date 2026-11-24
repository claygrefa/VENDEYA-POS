// ============================================================
// src/server/services/container.factory.ts — Composición de dependencias
// ============================================================
import type { PrismaClient } from "@prisma/client";
import { ClienteRepository } from "../repositories/cliente.repository";
import { CompraRepository } from "../repositories/compra.repository";
import { ComprobanteRepository } from "../repositories/comprobante.repository";
import { ConfiguracionRepository } from "../repositories/configuracion.repository";
import { CuentaPorCobrarRepository } from "../repositories/cuentaPorCobrar.repository";
import { CuentaPorPagarRepository } from "../repositories/cuentaPorPagar.repository";
import { EmpresaRepository } from "../repositories/empresa.repository";
import { KardexRepository } from "../repositories/kardex.repository";
import { ListaPrecioRepository } from "../repositories/listaPrecio.repository";
import { LoteRepository } from "../repositories/lote.repository";
import { MesaRepository } from "../repositories/mesa.repository";
import { ComandaRepository } from "../repositories/comanda.repository";
import { PresentacionRepository } from "../repositories/presentacion.repository";
import { ProductoRepository } from "../repositories/producto.repository";
import { TurnoRepository } from "../repositories/turno.repository";
import { UsuarioRepository } from "../repositories/usuario.repository";
import { VentaRepository } from "../repositories/venta.repository";
import { ClienteService } from "./cliente.service";
import { ComandaService } from "./comanda.service";
import { CompraService } from "./compra.service";
import { CuentaPorCobrarService } from "./cuentaPorCobrar.service";
import { CuentaPorPagarService } from "./cuentaPorPagar.service";
import { EmpresaService } from "./empresa.service";
import { GiroService } from "./giro.service";
import { InventarioService } from "./inventario.service";
import { KardexService } from "./kardex.service";
import { ListaPrecioService } from "./listaPrecio.service";
import { LoteService } from "./lote.service";
import { MesaService } from "./mesa.service";
import { PresentacionService } from "./presentacion.service";
import { ProductoService } from "./producto.service";
import { SessionService } from "./session.service";
import { TurnoService } from "./turno.service";
import { UsuarioService } from "./usuario.service";
import { ComprobanteService } from "./sri/comprobante.service";
import { XsdValidatorService } from "./sri/xsdValidator.service";
import { VentaService } from "./venta.service";

export interface Servicios {
  prisma: PrismaClient;
  empresas: EmpresaService;
  usuarios: UsuarioService;
  productos: ProductoService;
  clientes: ClienteService;
  kardex: KardexService;
  ventas: VentaService;
  turnos: TurnoService;
  compras: CompraService;
  cuentasPorCobrar: CuentaPorCobrarService;
  cuentasPorPagar: CuentaPorPagarService;
  giro: GiroService;
  lotes: LoteService;
  presentaciones: PresentacionService;
  listasPrecio: ListaPrecioService;
  inventario: InventarioService;
  comprobantes: ComprobanteService;
  mesas: MesaService;
  comandas: ComandaService;
  sesiones: SessionService;
}

export function crearServicios(prisma: PrismaClient, sesiones: SessionService = new SessionService()): Servicios {
  const kardexRepo = new KardexRepository();
  const kardex = new KardexService(kardexRepo);
  const giro = new GiroService(new ConfiguracionRepository());
  const loteRepo = new LoteRepository();
  const lotes = new LoteService(prisma, loteRepo, kardex, giro);
  const productos = new ProductoService(new ProductoRepository(prisma));
  const turnoRepo = new TurnoRepository();
  const cuentasPorCobrar = new CuentaPorCobrarService(prisma, new CuentaPorCobrarRepository(), turnoRepo);
  const comprobantes = new ComprobanteService(prisma, new ComprobanteRepository(), giro, new XsdValidatorService());
  const ventas = new VentaService(prisma, new VentaRepository(), kardex, cuentasPorCobrar, comprobantes);
  const cuentasPorPagar = new CuentaPorPagarService(prisma, new CuentaPorPagarRepository(), turnoRepo);

  return {
    prisma,
    empresas: new EmpresaService(new EmpresaRepository(prisma)),
    usuarios: new UsuarioService(new UsuarioRepository(prisma)),
    productos,
    clientes: new ClienteService(new ClienteRepository(prisma)),
    kardex,
    ventas,
    turnos: new TurnoService(prisma, turnoRepo),
    compras: new CompraService(prisma, new CompraRepository(), kardex, cuentasPorPagar, lotes, giro),
    cuentasPorCobrar,
    cuentasPorPagar,
    giro,
    comprobantes,
    lotes,
    presentaciones: new PresentacionService(prisma, new PresentacionRepository()),
    listasPrecio: new ListaPrecioService(prisma, new ListaPrecioRepository(), giro),
    inventario: new InventarioService(prisma, productos, lotes, loteRepo, kardex, kardexRepo, giro),
    mesas: new MesaService(prisma, new MesaRepository(), giro),
    comandas: new ComandaService(prisma, new ComandaRepository(), giro, ventas),
    sesiones,
  };
}
