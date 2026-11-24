// ============================================================
// src/server/services/sri/index.ts — API pública del módulo de comprobantes electrónicos SRI
// ============================================================
export {
  calcularDigitoVerificador,
  generarClaveAcceso,
  generarCodigoNumerico,
  parsearClaveAcceso,
  validarClaveAcceso,
  type AmbienteSri,
  type EntradaClaveAcceso,
  type PartesClaveAcceso,
} from "./claveAcceso.util";
export type {
  CampoAdicional,
  DatosComprador,
  DatosEmisor,
  DatosFactura,
  DatosNotaCredito,
  LineaComprobante,
  PagoComprobante,
  TipoIdentificacionComprador,
} from "./comprobante.types";
export {
  COD_DOC_FACTURA,
  COD_DOC_NOTA_CREDITO,
  VERSION_FACTURA,
  VERSION_NOTA_CREDITO,
  construirFacturaXml,
  construirNotaCreditoXml,
} from "./comprobanteXml.builder";
export { ComprobanteService, type ResultadoEmision } from "./comprobante.service";
export { fechaParaClave, fechaParaXml } from "./fechaEcuador.util";
export { XsdValidatorService, type ErrorXsd, type ResultadoXsd, type TipoXsd } from "./xsdValidator.service";
