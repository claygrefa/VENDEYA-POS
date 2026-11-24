// ============================================================
// src/server/services/sri/fechaEcuador.util.ts
// Las fechas de los comprobantes son la fecha CIVIL de Ecuador continental (UTC−5, sin horario de verano),
// no la del servidor: una venta a las 21:00 locales ya es "mañana" en UTC y no debe fecharse así.
// ============================================================

const OFFSET_ECUADOR_MS = -5 * 60 * 60 * 1000;

export interface FechaCivil {
  dia: number;
  mes: number;
  anio: number;
}

export function aFechaCivilEcuador(fecha: Date): FechaCivil {
  const local = new Date(fecha.getTime() + OFFSET_ECUADOR_MS);
  return { dia: local.getUTCDate(), mes: local.getUTCMonth() + 1, anio: local.getUTCFullYear() };
}

const dos = (n: number): string => String(n).padStart(2, "0");

/** ddMMyyyy — fecha dentro de la Clave de Acceso (8 dígitos). */
export function fechaParaClave(fecha: Date): string {
  const { dia, mes, anio } = aFechaCivilEcuador(fecha);
  return `${dos(dia)}${dos(mes)}${anio}`;
}

/** dd/MM/yyyy — formato de fecha de los XML del SRI. */
export function fechaParaXml(fecha: Date): string {
  const { dia, mes, anio } = aFechaCivilEcuador(fecha);
  return `${dos(dia)}/${dos(mes)}/${anio}`;
}

/** Fecha y hora civil de Ecuador con su desfase, p. ej. `2024-05-10T21:30:05-05:00` (formato de `SigningTime` de XAdES). */
export function fechaHoraIsoEcuador(fecha: Date): string {
  const local = new Date(fecha.getTime() + OFFSET_ECUADOR_MS).toISOString().slice(0, 19);
  return `${local}-05:00`;
}
