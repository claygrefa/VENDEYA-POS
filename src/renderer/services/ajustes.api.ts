// ============================================================
// src/renderer/services/ajustes.api.ts — Asistente de configuración inicial y pantalla de Ajustes
// ============================================================
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
