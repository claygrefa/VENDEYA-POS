// ============================================================
// tests/helpers/sri.fixture.ts — XML de comprobantes de ejemplo (sin firmar) para las pruebas de firma
// ============================================================
import { generarClaveAcceso } from "../../src/server/services/sri/claveAcceso.util";
import { construirFacturaXml, construirNotaCreditoXml } from "../../src/server/services/sri/comprobanteXml.builder";
import type { DatosEmisor, LineaComprobante } from "../../src/server/services/sri/comprobante.types";

export const RUC_EMISOR = "1790012345001";

export const emisorEjemplo: DatosEmisor = {
  ambiente: "1",
  razonSocial: "COMERCIAL ANDINA S.A.",
  nombreComercial: "ANDINA",
  ruc: RUC_EMISOR,
  dirMatriz: "Av. Amazonas N34-12 y Atahualpa, Quito",
  contribuyenteRimpe: false,
  obligadoContabilidad: true,
  estab: "001",
  ptoEmi: "001",
  dirEstablecimiento: "Av. Amazonas N34-12, Quito",
};

const lineas: LineaComprobante[] = [
  { codigoPrincipal: "P001", descripcion: "Café \"Premium\" & <molido> 250g", unidadMedida: "Unidad", cantidad: 2, precioUnitario: 10, descuento: 0, precioTotalSinImpuesto: 20, impuesto: { codigoPorcentaje: "4", tarifa: 15, baseImponible: 20, valor: 3 } },
  { codigoPrincipal: "P002", descripcion: "Arroz 1kg", cantidad: 1, precioUnitario: 1.2, descuento: 0, precioTotalSinImpuesto: 1.2, impuesto: { codigoPorcentaje: "0", tarifa: 0, baseImponible: 1.2, valor: 0 } },
];

export function facturaEjemploXml(secuencial = 1): string {
  const fechaEmision = new Date("2024-05-10T15:00:00Z");
  return construirFacturaXml({
    emisor: emisorEjemplo,
    claveAcceso: generarClaveAcceso({ fechaEmision, tipoComprobante: "01", ruc: RUC_EMISOR, ambiente: "1", establecimiento: "001", puntoEmision: "001", secuencial, codigoNumerico: "12345678" }),
    secuencial: String(secuencial).padStart(9, "0"),
    fechaEmision,
    comprador: { tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "María José Pérez & Hijos", direccion: "Calle 1 y Calle 2" },
    lineas,
    propina: 0,
    pagos: [{ formaPago: "01", total: 24.2 }],
    infoAdicional: [{ nombre: "Email", valor: "maria@correo.ec" }],
  });
}

export function notaCreditoEjemploXml(): string {
  const fechaEmision = new Date("2024-05-12T15:00:00Z");
  return construirNotaCreditoXml({
    emisor: emisorEjemplo,
    claveAcceso: generarClaveAcceso({ fechaEmision, tipoComprobante: "04", ruc: RUC_EMISOR, ambiente: "1", establecimiento: "001", puntoEmision: "001", secuencial: 1, codigoNumerico: "87654321" }),
    secuencial: "000000001",
    fechaEmision,
    comprador: { tipoIdentificacion: "05", identificacion: "1710034065", razonSocial: "María José Pérez" },
    docModificado: { codDoc: "01", numero: "001-001-000000001", fechaEmision: new Date("2024-05-10T15:00:00Z") },
    motivo: "Anulación de la venta",
    lineas,
    infoAdicional: [],
  });
}
