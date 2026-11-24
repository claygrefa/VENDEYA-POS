// ============================================================
// src/server/services/hardware/balanza.protocolo.ts — Protocolos de balanzas seriales y lectura de peso estable
//
//   · CAS      — líneas «ST,GS,+  1.250kg» (ST estable / US inestable; GS bruto / NT neto), como las CAS PR, AP y similares.
//   · GENERICO — cualquier línea con un número y una unidad opcional («  1.250 kg», «W: 0.456»); reconoce las marcas de
//                estabilidad más comunes (ST/S, US/M). Sin marca, el peso se considera estable al repetirse varias veces.
// Los pesos se normalizan a kilogramos. La conexión se abstrae en `PuertoSerie` (sustituible en pruebas).
// ============================================================
import { AppError } from "../appError.util";

export type ProtocoloBalanza = "GENERICO" | "CAS";

export interface LecturaBalanza {
  /** Peso en kilogramos */
  pesoKg: number;
  /** true/false si la balanza lo indica; null si el protocolo no informa estabilidad */
  estable: boolean | null;
  /** true si la balanza informa que es peso neto (con tara de la propia balanza) */
  neto: boolean | null;
  /** Línea original (para diagnóstico) */
  linea: string;
}

const KG_POR_UNIDAD: Record<string, number> = { kg: 1, g: 0.001, lb: 1 / 2.20462 };
const redondear = (kg: number): number => Math.round(kg * 10_000) / 10_000;

const aKilos = (valor: number, unidad: string | undefined): number => redondear(valor * (KG_POR_UNIDAD[(unidad ?? "kg").toLowerCase()] ?? 1));

/** Interpreta UNA línea de la balanza; `null` si no trae un peso. */
export function parsearLinea(linea: string, protocolo: ProtocoloBalanza): LecturaBalanza | null {
  const texto = linea.trim();
  if (texto === "") return null;

  if (protocolo === "CAS") {
    const m = /^(ST|US),\s*(GS|NT),\s*([+-]?)\s*(\d+(?:\.\d+)?)\s*(kg|g|lb)?/i.exec(texto);
    if (m === null) return null;
    const valor = Number(m[4]) * (m[3] === "-" ? -1 : 1);
    return { pesoKg: aKilos(valor, m[5]), estable: (m[1] as string).toUpperCase() === "ST", neto: (m[2] as string).toUpperCase() === "NT", linea: texto };
  }

  const m = /([+-]?\d+(?:[.,]\d+)?)\s*(kg|g|lb)?/i.exec(texto);
  if (m === null) return null;
  const valor = Number((m[1] as string).replace(",", "."));
  if (!Number.isFinite(valor)) return null;
  let estable: boolean | null = null;
  if (/\b(US|M|MOTION|UNSTABLE)\b|\?/i.test(texto)) estable = false;
  else if (/^(ST|S)\b|\b(STABLE)\b/i.test(texto)) estable = true;
  return { pesoKg: aKilos(valor, m[2]), estable, neto: null, linea: texto };
}

// ── Puerto serie ─────────────────────────────────────────────

export interface PuertoSerie {
  abrir(): Promise<void>;
  /** Registra el receptor de bytes. Debe llamarse antes de `abrir`. */
  alRecibir(receptor: (datos: Buffer) => void): void;
  /** Registra el aviso de error o de desconexión. */
  alFallar(receptor: (error: Error) => void): void;
  cerrar(): Promise<void>;
}

export interface OpcionesPuertoSerie {
  ruta: string;
  baudios: number;
}

/** Puerto serie real con el paquete `serialport` (dependencia opcional: si no está instalada, se informa con claridad). */
export class PuertoSerieNode implements PuertoSerie {
  private receptor: (d: Buffer) => void = () => undefined;
  private fallo: (e: Error) => void = () => undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private puerto: any = null;

  constructor(private readonly opciones: OpcionesPuertoSerie) {}

  alRecibir(receptor: (datos: Buffer) => void): void {
    this.receptor = receptor;
  }

  alFallar(receptor: (error: Error) => void): void {
    this.fallo = receptor;
  }

  abrir(): Promise<void> {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let SerialPort: any;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        SerialPort = (require("serialport") as { SerialPort: unknown }).SerialPort;
      } catch {
        reject(new AppError("ESTADO_INVALIDO", "El paquete de puertos seriales (serialport) no está disponible en esta instalación"));
        return;
      }
      this.puerto = new SerialPort({ path: this.opciones.ruta, baudRate: this.opciones.baudios, autoOpen: false });
      this.puerto.on("data", (d: Buffer) => this.receptor(d));
      this.puerto.on("error", (e: Error) => this.fallo(e));
      this.puerto.on("close", () => this.fallo(new Error("Se cerró el puerto de la balanza")));
      this.puerto.open((error: Error | null) => {
        if (error !== null) reject(new AppError("ESTADO_INVALIDO", `No se pudo abrir el puerto ${this.opciones.ruta}: ${error.message}`));
        else resolve();
      });
    });
  }

  cerrar(): Promise<void> {
    return new Promise((resolve) => {
      if (this.puerto === null || !this.puerto.isOpen) {
        resolve();
        return;
      }
      this.puerto.removeAllListeners("close");
      this.puerto.close(() => resolve());
    });
  }
}

// ── Lectura de peso estable ──────────────────────────────────

export interface OpcionesLectura {
  protocolo: ProtocoloBalanza;
  /** Lecturas consecutivas iguales que se exigen cuando la balanza no informa estabilidad (default 3) */
  lecturasIguales?: number;
  /** Tiempo máximo de espera (default 3 s) */
  timeoutMs?: number;
}

const TOLERANCIA_KG = 0.0005;

/** Abre el puerto, espera un peso estable y lo cierra siempre. */
export async function leerPesoEstable(puerto: PuertoSerie, opciones: OpcionesLectura): Promise<LecturaBalanza> {
  const exigidas = opciones.lecturasIguales ?? 3;
  const timeoutMs = opciones.timeoutMs ?? 3_000;

  return new Promise<LecturaBalanza>((resolve, reject) => {
    let pendiente = "";
    let anterior: LecturaBalanza | null = null;
    let repetidas = 0;
    let vistas = 0;
    let terminado = false;

    const terminar = (accion: () => void): void => {
      if (terminado) return;
      terminado = true;
      clearTimeout(reloj);
      void puerto.cerrar().then(accion, accion);
    };
    const reloj = setTimeout(() => {
      terminar(() =>
        reject(new AppError("ESTADO_INVALIDO", vistas === 0 ? "La balanza no responde: revise el cable, el puerto y la velocidad" : "El peso no se estabilizó: espere a que el producto quede quieto")),
      );
    }, timeoutMs);

    const procesar = (l: LecturaBalanza): void => {
      vistas += 1;
      if (l.estable === false) {
        anterior = null;
        repetidas = 0;
        return;
      }
      repetidas = anterior !== null && Math.abs(anterior.pesoKg - l.pesoKg) <= TOLERANCIA_KG ? repetidas + 1 : 1;
      anterior = l;
      if (l.estable === true || repetidas >= exigidas) terminar(() => resolve(l));
    };

    puerto.alRecibir((datos) => {
      pendiente += datos.toString("latin1");
      // Las tramas terminan en CR, LF o ETX; lo último (sin terminador) espera al siguiente bloque
      const partes = pendiente.split(/[\r\n\u0003]+/);
      pendiente = partes.pop() ?? "";
      for (const parte of partes) {
        const lectura = parsearLinea(parte, opciones.protocolo);
        if (lectura !== null) procesar(lectura);
        if (terminado) return;
      }
    });
    puerto.alFallar((e) => terminar(() => reject(new AppError("ESTADO_INVALIDO", `Se perdió la conexión con la balanza: ${e.message}`))));
    puerto.abrir().catch((e: unknown) => terminar(() => reject(e)));
  });
}
