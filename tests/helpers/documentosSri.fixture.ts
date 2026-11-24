// ============================================================
// tests/helpers/documentosSri.fixture.ts — Datos de ejemplo de retención, liquidación y guía de remisión
// ============================================================
import { generarClaveAcceso } from "../../src/server/services/sri/claveAcceso.util";
import type { DatosGuiaRemision, DatosLiquidacion, DatosRetencion } from "../../src/server/services/sri/comprobantesCompra.builder";
import { RUC_EMISOR, emisorEjemplo } from "./sri.fixture";

const fecha = new Date("2024-05-10T15:00:00Z");
const clave = (tipo: string): string => generarClaveAcceso({ fechaEmision: fecha, tipoComprobante: tipo, ruc: RUC_EMISOR, ambiente: "1", establecimiento: "001", puntoEmision: "001", secuencial: 1, codigoNumerico: "12345678" });

export const retencion = (cambios: Partial<DatosRetencion> = {}): DatosRetencion => ({
  emisor: emisorEjemplo,
  claveAcceso: clave("07"),
  secuencial: "000000001",
  fechaEmision: fecha,
  sujeto: { tipoIdentificacion: "04", identificacion: "0992345678001", razonSocial: "PROVEEDOR & HIJOS S.A.", tipoSujeto: "02", parteRelacionada: false },
  periodoFiscal: "05/2024",
  docSustento: {
    codSustento: "01",
    codDocSustento: "01",
    numDocSustento: "001002000000123",
    fechaEmision: new Date("2024-05-08T15:00:00Z"),
    fechaRegistroContable: new Date("2024-05-08T15:00:00Z"),
    numAutorizacion: "0805202401099234567800110010020000001231234567811",
    totalSinImpuestos: 100,
    importeTotal: 115,
    impuestos: [{ codigoPorcentaje: "4", baseImponible: 100, tarifa: 15, valor: 15 }],
    pagos: [{ formaPago: "20", total: 115 }],
  },
  retenciones: [
    { codigo: "1", codigoRetencion: "312", baseImponible: 100, porcentaje: 1.75, valor: 1.75 },
    { codigo: "2", codigoRetencion: "10", baseImponible: 15, porcentaje: 20, valor: 3 },
  ],
  infoAdicional: [{ nombre: "Email", valor: "compras@andina.ec" }],
  ...cambios,
});

export const liquidacion = (): DatosLiquidacion => ({
  emisor: emisorEjemplo,
  claveAcceso: clave("03"),
  secuencial: "000000001",
  fechaEmision: fecha,
  proveedor: { tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "María Pérez", direccion: "Vía a Machachi km 4" },
  lineas: [{ codigoPrincipal: "PAPA", descripcion: "Papa chola quintal", unidadMedida: "Quintal", cantidad: 10, precioUnitario: 12.5, descuento: 0, precioTotalSinImpuesto: 125, impuesto: { codigoPorcentaje: "0", tarifa: 0, baseImponible: 125, valor: 0 } }],
  pagos: [{ formaPago: "01", total: 125 }],
  infoAdicional: [],
});

export const guia = (): DatosGuiaRemision => ({
  emisor: emisorEjemplo,
  claveAcceso: clave("06"),
  secuencial: "000000001",
  dirPartida: "Av. Amazonas N34-12, Quito",
  transportista: { tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "Transportes Pérez" },
  fechaInicioTransporte: new Date("2024-05-10T15:00:00Z"),
  fechaFinTransporte: new Date("2024-05-11T15:00:00Z"),
  placa: "PBA-1234",
  destinatarios: [
    {
      identificacion: "0992345678001",
      razonSocial: "Cliente Guayaquil S.A.",
      direccion: "Av. 9 de Octubre 100, Guayaquil",
      motivoTraslado: "Venta",
      codEstabDestino: "001",
      ruta: "Quito - Guayaquil",
      sustento: { codDoc: "01", numero: "001-001-000000123", numAutorizacion: "0805202401099234567800110010010000001231234567811", fechaEmision: new Date("2024-05-08T15:00:00Z") },
      detalles: [{ codigoInterno: "P001", descripcion: "Café molido 250g", cantidad: 20 }],
    },
  ],
  infoAdicional: [],
});

