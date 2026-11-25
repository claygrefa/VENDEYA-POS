// ============================================================
// src/server/services/container.factory.ts — Composición de dependencias
// ============================================================
import path from "path";
import type { PrismaClient } from "@prisma/client";
import { ClienteRepository } from "../repositories/cliente.repository";
import { CompraRepository } from "../repositories/compra.repository";
import { ConfiguracionService } from "./configuracion.service";
import { SetupService } from "./setup/setup.service";
import { ConsultaService } from "./consulta.service";
import { ProveedorService } from "./proveedor.service";
import { ReporteService } from "./reporte.service";
import { SyncService, type OpcionesSync } from "./sync/sync.service";
import { BalanzaService, type OpcionesBalanza } from "./hardware/balanza.service";
import { EscaneoService } from "./hardware/escaneo.service";
import { ImpresionRepository } from "../repositories/impresion.repository";
import { AtsRepository } from "../repositories/ats.repository";
import { ColaSriRepository } from "../repositories/colaSri.repository";
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
import { ImpresionService, type OpcionesImpresion } from "./hardware/impresion.service";
import { RideService } from "./sri/ride/ride.service";
import { AtsService } from "./sri/ats.service";
import { EmisionDocumentosService } from "./sri/emisionDocumentos.service";
import { CertificadoService } from "./sri/certificado.service";
import { ComprobanteService } from "./sri/comprobante.service";
import { ProveedorClaveMaestra, type ProteccionClave } from "./sri/firma/claveMaestra.provider";
import { EnvioSriService, type OpcionesEnvioSri } from "./sri/envioSri.service";
import { FirmaService } from "./sri/firma.service";
import { SriSoapClient, type OpcionesClienteSri } from "./sri/ws/sriSoap.client";
import type { ClienteSri } from "./sri/ws/sriSoap.types";
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
  certificados: CertificadoService;
  firma: FirmaService;
  envioSri: EnvioSriService;
  documentosSri: EmisionDocumentosService;
  ats: AtsService;
  impresion: ImpresionService;
  balanza: BalanzaService;
  escaneo: EscaneoService;
  sync: SyncService;
  proveedores: ProveedorService;
  setup: SetupService;
  configuracion: ConfiguracionService;
  consultas: ConsultaService;
  reportes: ReporteService;
  ride: RideService;
  mesas: MesaService;
  comandas: ComandaService;
  sesiones: SessionService;
}

export interface OpcionesServicios {
  /**
   * Carpeta de secretos locales (clave maestra y certificados .p12): fuera de la BD y del repositorio.
   * Los certificados van en la subcarpeta `certificados`.
   */
  directorioSecretos: string;
  /** Protección de la clave maestra con el almacén del sistema operativo (Electron safeStorage) */
  proteccionClave?: ProteccionClave;
  /** Conexión con el SRI: opciones del cliente SOAP real o un cliente sustituto (pruebas) */
  /** Impresora térmica (el transporte se sustituye en las pruebas) */
  impresion?: OpcionesImpresion;
  /** Balanza serial (el puerto se sustituye en las pruebas) */
  balanza?: OpcionesBalanza;
  /** Sincronización LAN (latido y retención de la bitácora) */
  sync?: OpcionesSync;
  /** Opciones del PDF del RIDE */
  ride?: { comprimir?: boolean };
  sri?: { cliente?: ClienteSri; soap?: OpcionesClienteSri; envio?: OpcionesEnvioSri };
}

export function crearServicios(prisma: PrismaClient, secretos: OpcionesServicios, sesiones: SessionService = new SessionService()): Servicios {
  const kardexRepo = new KardexRepository();
  const kardex = new KardexService(kardexRepo);
  const giro = new GiroService(new ConfiguracionRepository());
  const loteRepo = new LoteRepository();
  const lotes = new LoteService(prisma, loteRepo, kardex, giro);
  const productos = new ProductoService(new ProductoRepository(prisma));
  const turnoRepo = new TurnoRepository();
  const turnos = new TurnoService(prisma, turnoRepo);
  const cuentasPorCobrar = new CuentaPorCobrarService(prisma, new CuentaPorCobrarRepository(), turnoRepo);
  const xsd = new XsdValidatorService();
  const comprobanteRepo = new ComprobanteRepository();
  const configuracionRepo = new ConfiguracionRepository();
  const impresion = new ImpresionService(prisma, new ImpresionRepository(), configuracionRepo, turnos, secretos.impresion);
  const comprobantes = new ComprobanteService(prisma, comprobanteRepo, giro, xsd);
  const claveMaestra = new ProveedorClaveMaestra({
    directorio: secretos.directorioSecretos,
    ...(secretos.proteccionClave !== undefined ? { proteccion: secretos.proteccionClave } : {}),
  });
  const certificados = new CertificadoService(prisma, configuracionRepo, claveMaestra, path.join(secretos.directorioSecretos, "certificados"));
  const firma = new FirmaService(prisma, comprobanteRepo, certificados, xsd);
  const sync = new SyncService(prisma, sesiones, secretos.sync);
  const envioSri = new EnvioSriService(prisma, new ColaSriRepository(), firma, secretos.sri?.cliente ?? new SriSoapClient(secretos.sri?.soap), {
    ...secretos.sri?.envio,
    // Un comprobante que cambia de estado en segundo plano (el worker) también se anuncia a las demás cajas
    alCambiarEstado: (empresaId, comprobanteId, estado) => {
      void sync.publicar({ empresaId, modulo: "comprobantes", accion: "ESTADO", ruta: "worker-sri", ids: { id: comprobanteId, estado } });
    },
  });
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
    turnos,
    compras: new CompraService(prisma, new CompraRepository(), kardex, cuentasPorPagar, lotes, giro),
    cuentasPorCobrar,
    cuentasPorPagar,
    giro,
    comprobantes,
    certificados,
    firma,
    envioSri,
    documentosSri: new EmisionDocumentosService(prisma, comprobanteRepo, giro, xsd),
    ats: new AtsService(prisma, new AtsRepository()),
    impresion,
    balanza: new BalanzaService(prisma, configuracionRepo, giro, secretos.balanza),
    escaneo: new EscaneoService(prisma, productos, configuracionRepo, giro),
    sync,
    proveedores: new ProveedorService(prisma),
    setup: new SetupService(prisma),
    configuracion: new ConfiguracionService(prisma, sync),
    consultas: new ConsultaService(prisma),
    reportes: new ReporteService(prisma),
    ride: new RideService(prisma, comprobanteRepo, secretos.ride),
    lotes,
    presentaciones: new PresentacionService(prisma, new PresentacionRepository()),
    listasPrecio: new ListaPrecioService(prisma, new ListaPrecioRepository(), giro),
    inventario: new InventarioService(prisma, productos, lotes, loteRepo, kardex, kardexRepo, giro),
    mesas: new MesaService(prisma, new MesaRepository(), giro),
    comandas: new ComandaService(prisma, new ComandaRepository(), giro, ventas),
    sesiones,
  };
}
