// ============================================================
// src/server/services/sri/certificado.service.ts — Certificado digital (.p12) de la empresa
//
// El archivo .p12 se guarda en la carpeta de secretos (fuera de la BD y del repositorio) y su contraseña se guarda en
// ConfiguracionGiro cifrada con AES-256-GCM. La clave maestra vive aparte (ProveedorClaveMaestra): quien copie solo la
// BD no obtiene ni el archivo ni la clave, y quien copie solo la carpeta de certificados no obtiene la contraseña.
// La contraseña y la clave privada nunca se devuelven por la API ni se registran.
// ============================================================
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import type { PrismaClient } from "@prisma/client";
import { CargarCertificadoSchema, MAX_BYTES_P12 } from "../../../shared/schemas/certificado.schema";
import type { ConfiguracionRepository } from "../../repositories/configuracion.repository";
import { AppError } from "../appError.util";
import type { ActorCaja } from "../turno.service";
import { parsear } from "../validation.util";
import { cifrarSecreto, descifrarSecreto, type SecretoCifrado } from "./firma/cifrado.util";
import type { ProveedorClaveMaestra } from "./firma/claveMaestra.provider";
import { DIAS_AVISO_VENCIMIENTO, leerPkcs12, validarCertificadoParaEmisor, type MaterialFirma } from "./firma/pkcs12.util";
import { renombrarConReintento } from "../archivo.util";

const DIA_MS = 86_400_000;

export interface InformacionCertificado {
  cargado: boolean;
  titular: string | null;
  emisor: string | null;
  /** SHA-1 (hex) del certificado */
  huella: string | null;
  vencimiento: Date | null;
  diasRestantes: number | null;
  vencido: boolean;
  /** Presente cuando vence pronto o ya venció */
  advertencia: string | null;
}

export interface ResultadoCargaCertificado {
  certificado: InformacionCertificado;
  advertencias: string[];
}

const aadDe = (empresaId: string): string => `vendeya:certificado-p12:${empresaId}`;
const fecha = (f: Date): string => f.toISOString().slice(0, 10);

export class CertificadoService {
  private readonly directorio: string;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: ConfiguracionRepository,
    private readonly claves: ProveedorClaveMaestra,
    /** Carpeta donde se guardan los archivos .p12 */
    directorioCertificados: string
  ) {
    this.directorio = directorioCertificados;
  }

  // ── Carga / consulta / baja ────────────────────────────────

  /** Valida el .p12 contra el RUC de la empresa, cifra su contraseña y lo deja como certificado de firma. */
  async guardar(entrada: unknown, actor: ActorCaja, ahora: Date = new Date()): Promise<ResultadoCargaCertificado> {
    const datos = parsear(CargarCertificadoSchema, entrada);
    const config = await this.repo.porEmpresa(this.prisma, actor.empresaId);
    if (config === null) throw new AppError("NO_ENCONTRADO", "Configure primero el giro del negocio");
    const empresa = await this.repo.rucDeEmpresa(this.prisma, actor.empresaId);
    if (empresa === null) throw new AppError("NO_ENCONTRADO", "Empresa no encontrada");

    const archivo = Buffer.from(datos.archivoBase64, "base64");
    if (archivo.length === 0 || archivo.length > MAX_BYTES_P12) throw new AppError("VALIDACION", "El archivo del certificado no es válido");

    // Todo lo que puede fallar se resuelve antes de escribir
    const material = leerPkcs12(archivo, datos.password);
    const advertencias = validarCertificadoParaEmisor(material.info, {
      ruc: empresa.ruc,
      ahora,
      ...(datos.confirmarTitular !== undefined ? { confirmarTitular: datos.confirmarTitular } : {}),
    });
    const secreto = cifrarSecreto(datos.password, this.claves.obtener(), aadDe(actor.empresaId));

    const nombre = `${actor.empresaId}-${material.info.huella.slice(0, 8)}.p12`;
    const anterior = config.rutaCertificadoP12;
    this.escribirArchivo(nombre, archivo);
    try {
      await this.repo.guardarCertificado(this.prisma, actor.empresaId, {
        rutaArchivo: nombre,
        secreto,
        vencimiento: material.info.vigenteHasta,
        titular: material.info.titular,
        emisor: material.info.emisor,
        huella: material.info.huella,
      });
    } catch (e) {
      if (anterior !== nombre) this.borrarArchivo(nombre);
      throw e;
    }
    if (anterior !== null && anterior !== nombre) this.borrarArchivo(anterior);

    return { certificado: await this.informacion(actor, ahora), advertencias };
  }

  async informacion(actor: ActorCaja, ahora: Date = new Date()): Promise<InformacionCertificado> {
    const c = await this.repo.porEmpresa(this.prisma, actor.empresaId);
    if (c === null || c.rutaCertificadoP12 === null) {
      return { cargado: false, titular: null, emisor: null, huella: null, vencimiento: null, diasRestantes: null, vencido: false, advertencia: null };
    }
    const vencimiento = c.certVencimiento;
    const diasRestantes = vencimiento === null ? null : Math.floor((vencimiento.getTime() - ahora.getTime()) / DIA_MS);
    const vencido = vencimiento !== null && ahora.getTime() > vencimiento.getTime();
    let advertencia: string | null = null;
    if (vencimiento !== null && vencido) advertencia = `El certificado venció el ${fecha(vencimiento)}: cargue uno vigente para seguir facturando`;
    else if (vencimiento !== null && diasRestantes !== null && diasRestantes <= DIAS_AVISO_VENCIMIENTO) {
      advertencia = `El certificado vence en ${diasRestantes} día(s): renuévelo antes del ${fecha(vencimiento)}`;
    }
    return { cargado: true, titular: c.certTitular, emisor: c.certEmisor, huella: c.certHuella, vencimiento, diasRestantes, vencido, advertencia };
  }

  async eliminar(actor: ActorCaja): Promise<void> {
    const c = await this.repo.porEmpresa(this.prisma, actor.empresaId);
    if (c === null || c.rutaCertificadoP12 === null) throw new AppError("NO_ENCONTRADO", "La empresa no tiene un certificado cargado");
    await this.repo.quitarCertificado(this.prisma, actor.empresaId);
    this.borrarArchivo(c.rutaCertificadoP12);
  }

  // ── Uso para firmar ────────────────────────────────────────

  /**
   * Abre el certificado de la empresa para firmar. Falla si no hay certificado, si el archivo falta o no
   * corresponde al registrado, si la contraseña cifrada fue alterada o si el certificado está vencido.
   */
  async obtenerMaterial(empresaId: string, ahora: Date = new Date()): Promise<MaterialFirma> {
    const c = await this.repo.porEmpresa(this.prisma, empresaId);
    if (c === null || c.rutaCertificadoP12 === null || c.certPasswordEncriptado === null || c.certIv === null || c.certTag === null) {
      throw new AppError("ESTADO_INVALIDO", "La empresa no tiene un certificado de firma cargado");
    }
    const password = this.descifrar({ cifrado: c.certPasswordEncriptado, iv: c.certIv, tag: c.certTag }, empresaId);
    const material = leerPkcs12(this.leerArchivo(c.rutaCertificadoP12), password);
    if (c.certHuella !== null && c.certHuella !== material.info.huella) {
      throw new AppError("ESTADO_INVALIDO", "El archivo del certificado no corresponde al registrado: vuelva a cargar el certificado");
    }
    if (ahora.getTime() > material.info.vigenteHasta.getTime()) {
      throw new AppError("ESTADO_INVALIDO", `El certificado venció el ${fecha(material.info.vigenteHasta)}: cargue uno vigente para firmar`);
    }
    return material;
  }

  // ── Rotación de la clave maestra ───────────────────────────

  /**
   * Cambia la clave maestra y re-cifra las contraseñas de todos los certificados en una sola transacción.
   * Dos fases: la clave nueva se guarda aparte y solo reemplaza a la vigente cuando la BD ya quedó actualizada;
   * un corte a mitad no deja secretos inaccesibles (mientras haya una clave pendiente se prueban ambas).
   */
  async rotarClaveMaestra(): Promise<{ recifrados: number }> {
    if (this.claves.desdeEntorno) throw new AppError("ESTADO_INVALIDO", "La clave maestra viene del entorno y no se puede rotar desde la aplicación");
    await this.resolverRotacionPendiente();

    const filas = await this.repo.conCertificado(this.prisma);
    // Primero se descifra todo con la clave vigente: si algo está alterado se aborta sin tocar nada
    const textos = filas.map((f) => ({
      empresaId: f.empresaId,
      password: this.descifrar({ cifrado: f.certPasswordEncriptado, iv: f.certIv, tag: f.certTag }, f.empresaId),
    }));

    const nueva = this.claves.prepararRotacion();
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const t of textos) await this.repo.actualizarSecreto(tx, t.empresaId, cifrarSecreto(t.password, nueva, aadDe(t.empresaId)));
      });
    } catch (e) {
      this.claves.cancelarRotacion();
      throw e;
    }
    if (this.claves.hayRotacionPendiente) this.claves.confirmarRotacion();
    return { recifrados: textos.length };
  }

  // ── Internos ───────────────────────────────────────────────

  /** Descifra con la clave vigente o, si hay una rotación a medias, con la pendiente (y en ese caso la confirma). */
  private descifrar(secreto: SecretoCifrado, empresaId: string): string {
    const claves = this.claves.candidatas();
    let ultimoError: unknown;
    for (const [i, clave] of claves.entries()) {
      try {
        const texto = descifrarSecreto(secreto, clave, aadDe(empresaId));
        // La BD ya contiene lo cifrado con la clave pendiente: la rotación sí se completó
        if (i > 0 && this.claves.hayRotacionPendiente) this.claves.confirmarRotacion();
        return texto;
      } catch (e) {
        ultimoError = e;
      }
    }
    throw ultimoError;
  }

  /** Cierra una rotación que quedó a medias (corte entre la transacción y la promoción de la clave). */
  private async resolverRotacionPendiente(): Promise<void> {
    if (!this.claves.hayRotacionPendiente) return;
    const [, pendiente] = this.claves.candidatas();
    const filas = await this.repo.conCertificado(this.prisma);
    const aplicada =
      pendiente !== undefined &&
      filas.some((f) => {
        try {
          descifrarSecreto({ cifrado: f.certPasswordEncriptado, iv: f.certIv, tag: f.certTag }, pendiente, aadDe(f.empresaId));
          return true;
        } catch {
          return false;
        }
      });
    if (aplicada) this.claves.confirmarRotacion();
    else this.claves.cancelarRotacion();
  }

  private ruta(nombre: string): string {
    // El nombre lo genera el servicio, pero se defiende igual contra rutas manipuladas en la BD
    if (nombre !== path.basename(nombre)) throw new AppError("ESTADO_INVALIDO", "Ruta de certificado inválida: vuelva a cargar el certificado");
    return path.join(this.directorio, nombre);
  }

  /** Escritura atómica con permisos restringidos al usuario. */
  private escribirArchivo(nombre: string, contenido: Buffer): void {
    mkdirSync(this.directorio, { recursive: true });
    const destino = this.ruta(nombre);
    const temporal = `${destino}.tmp`;
    writeFileSync(temporal, contenido, { mode: 0o600 });
    renombrarConReintento(temporal, destino);
  }

  private leerArchivo(nombre: string): Buffer {
    try {
      return readFileSync(this.ruta(nombre));
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError("ESTADO_INVALIDO", "No se encuentra el archivo del certificado: vuelva a cargarlo");
    }
  }

  private borrarArchivo(nombre: string): void {
    rmSync(this.ruta(nombre), { force: true });
  }
}
