// ============================================================
// src/renderer/services/ajustes.api.ts — Asistente de configuración inicial y pantalla de Ajustes
// ============================================================
import type { DispositivosLicencia, EstadoLicencia } from "../../shared/types/licencia.types";
import type { EstadoTelemetria, ReporteError } from "../../shared/types/telemetria.types";
import type { ApiCliente } from "./api";

export interface DatosEmpresa {
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  direccionMatriz: string;
  telefono: string;
  email: string;
  tipoContribuyente: string;
  regimenTributario: string;
  obligadoContabilidad: boolean;
  agenteRetencion: boolean;
  resolucionAgente: string | null;
  contribuyenteEspecial: string | null;
  ambienteSRI: "PRUEBAS" | "PRODUCCION";
}

export interface AjustesNegocio {
  empresa: DatosEmpresa;
  giroNegocio: string;
  modulos: Record<string, boolean>;
}

export interface AltaInicial {
  empresa: Omit<DatosEmpresa, "agenteRetencion" | "resolucionAgente" | "contribuyenteEspecial"> & { agenteRetencion?: boolean };
  confirmarRuc: boolean;
  sucursal: { nombre: string; direccion: string; telefono: string };
  giro: string;
  admin: { username: string; password: string; nombre: string; apellido: string };
}

export interface CertificadoValidado {
  titular: string;
  emisor: string;
  vigenteHasta: string;
  diasRestantes: number;
  advertencias: string[];
}

export interface InformacionCertificado {
  cargado: boolean;
  titular: string | null;
  emisor: string | null;
  huella: string | null;
  vencimiento: string | null;
  diasRestantes: number | null;
  vencido: boolean;
  advertencia: string | null;
}

export interface ConfiguracionImpresora {
  conexion: "NINGUNA" | "RED" | "SISTEMA";
  direccion: string | null;
  puerto: number;
  ancho: 58 | 80;
  impresionTermica: boolean;
  aperturaGaveta: boolean;
}

export interface ConfiguracionBalanza {
  habilitada: boolean;
  puerto: string | null;
  baudios: number;
  protocolo: "GENERICO" | "CAS";
  etiqueta: "PESO" | "PRECIO";
}

export interface CajaConectada {
  cajaId: string;
  [campo: string]: unknown;
}

export interface RespaldoLocal {
  archivo: string;
  motivo: "pre-migracion" | "pre-actualizacion" | "automatico" | "manual";
  creado: string;
  bytes: number;
}

export interface EstadoNube {
  configurada: boolean;
  carpeta: string | null;
  requiereReconfigurar: boolean;
  ultima: { archivo: string; creado: string; bytes: number } | null;
  copias: string[];
}

export interface EstadoRespaldos {
  locales: RespaldoLocal[];
  nube: EstadoNube;
  restauracionPendiente: { origen: "local" | "nube"; archivo: string; preparada: string } | null;
}

export type DatosRestauracion = { origen: "local"; archivo: string; password: string } | { origen: "nube"; archivo: string; frase: string; password: string };

export class AjustesApi {
  constructor(readonly http: ApiCliente) {}

  // Asistente (sin sesión)
  estadoSetup(): Promise<{ configurado: boolean }> {
    return this.http.get("/api/setup/estado");
  }
  validarCertificadoSetup(datos: { archivoBase64: string; password: string; ruc: string; confirmarTitular?: boolean }): Promise<CertificadoValidado> {
    return this.http.post("/api/setup/certificado", datos);
  }
  inicializar(datos: AltaInicial): Promise<unknown> {
    return this.http.post("/api/setup", datos);
  }

  // Ajustes
  ajustes(): Promise<AjustesNegocio> {
    return this.http.get("/api/configuracion");
  }
  actualizarEmpresa(datos: Record<string, unknown>): Promise<AjustesNegocio> {
    return this.http.patch("/api/configuracion/empresa", datos);
  }
  actualizarModulos(datos: Record<string, boolean>): Promise<AjustesNegocio> {
    return this.http.patch("/api/configuracion/modulos", datos);
  }
  aplicarGiro(giro: string): Promise<AjustesNegocio> {
    return this.http.post("/api/configuracion/giro", { giro });
  }
  impresora(): Promise<ConfiguracionImpresora> {
    return this.http.get("/api/impresora");
  }
  configurarImpresora(datos: { conexion: string; direccion?: string; puerto?: number; ancho?: number }): Promise<ConfiguracionImpresora> {
    return this.http.put("/api/impresora", datos);
  }
  probarImpresora(): Promise<void> {
    return this.http.post("/api/impresora/probar");
  }
  balanza(): Promise<ConfiguracionBalanza> {
    return this.http.get("/api/balanza");
  }
  configurarBalanza(datos: { puerto?: string; baudios: number; protocolo: string; etiqueta: string }): Promise<ConfiguracionBalanza> {
    return this.http.put("/api/balanza", datos);
  }
  certificado(): Promise<InformacionCertificado> {
    return this.http.get("/api/configuracion/certificado");
  }
  cargarCertificado(datos: { archivoBase64: string; password: string; confirmarTitular?: boolean }): Promise<{ certificado: InformacionCertificado }> {
    return this.http.put("/api/configuracion/certificado", datos);
  }
  quitarCertificado(): Promise<void> {
    return this.http.delete("/api/configuracion/certificado");
  }
  cajasConectadas(): Promise<{ cajas: CajaConectada[] }> {
    return this.http.get("/api/sync/cajas");
  }

  // Licencia
  licencia(): Promise<EstadoLicencia> {
    return this.http.get("/api/licencia");
  }
  activarLicencia(clave: string): Promise<EstadoLicencia> {
    return this.http.post("/api/licencia/activar", { clave });
  }
  /** Valida en línea ahora; `error` explica por qué no se pudo (sin conexión…) */
  validarLicencia(): Promise<{ estado: EstadoLicencia; error: string | null }> {
    return this.http.post("/api/licencia/validar");
  }
  desactivarLicencia(): Promise<EstadoLicencia> {
    return this.http.delete("/api/licencia");
  }
  dispositivosLicencia(): Promise<DispositivosLicencia> {
    return this.http.get("/api/licencia/dispositivos");
  }
  liberarDispositivo(id: string): Promise<DispositivosLicencia> {
    return this.http.post(`/api/licencia/dispositivos/${encodeURIComponent(id)}/liberar`);
  }

  // Respaldos y restauración
  respaldos(): Promise<EstadoRespaldos> {
    return this.http.get("/api/respaldos");
  }
  respaldarAhora(): Promise<EstadoRespaldos & { archivo: string }> {
    return this.http.post("/api/respaldos");
  }
  configurarNube(datos: { carpeta: string; frase: string }): Promise<EstadoNube> {
    return this.http.put("/api/respaldos/nube", datos);
  }
  quitarNube(): Promise<EstadoNube> {
    return this.http.delete("/api/respaldos/nube");
  }
  copiarANube(): Promise<{ archivo: string; bytes: number; nube: EstadoNube }> {
    return this.http.post("/api/respaldos/nube/exportar");
  }
  prepararRestauracion(datos: DatosRestauracion): Promise<EstadoRespaldos> {
    return this.http.post("/api/respaldos/restaurar", datos);
  }
  cancelarRestauracion(): Promise<EstadoRespaldos> {
    return this.http.delete("/api/respaldos/restaurar");
  }

  // Telemetría opcional de errores
  telemetria(): Promise<EstadoTelemetria> {
    return this.http.get("/api/telemetria");
  }
  configurarTelemetria(consentimiento: boolean): Promise<EstadoTelemetria> {
    return this.http.put("/api/telemetria", { consentimiento });
  }
  reportesTelemetria(): Promise<{ reportes: ReporteError[]; estado: EstadoTelemetria }> {
    return this.http.get("/api/telemetria/pendientes");
  }
  descartarTelemetria(): Promise<{ descartados: number; estado: EstadoTelemetria }> {
    return this.http.delete("/api/telemetria/pendientes");
  }
  enviarTelemetria(): Promise<{ enviados: number; estado: EstadoTelemetria }> {
    return this.http.post("/api/telemetria/enviar");
  }
  /** La interfaz informa un error técnico (el servidor lo descarta si no hay consentimiento) */
  reportarError(datos: { mensaje: string; pila?: string | null; vista?: string | null }): Promise<void> {
    return this.http.post("/api/telemetria/errores", { origen: "interfaz", ...datos });
  }
}

/** Lee un archivo del equipo y lo devuelve en base64 (sin el prefijo `data:`). */
export function archivoABase64(archivo: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error("No se pudo leer el archivo"));
    lector.onload = () => {
      const texto = String(lector.result ?? "");
      resolve(texto.slice(texto.indexOf(",") + 1));
    };
    lector.readAsDataURL(archivo);
  });
}
