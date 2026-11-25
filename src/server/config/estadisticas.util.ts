// ============================================================
// src/server/config/estadisticas.util.ts — Estadísticas del planificador de SQLite
//
// Sin `sqlite_stat1`, SQLite no sabe cuántas filas tiene cada tabla ni qué tan selectivo es cada índice, y en las consultas grandes (reportes de
// ventas por producto o utilidad con cientos de miles de líneas) puede recorrer todo un índice y descartar por fecha después, en lugar de
// buscar primero por fecha: con 135 000 ventas la diferencia fue de 1 s a más de 5 s. ANALYZE las calcula una vez; después `PRAGMA optimize` (al
// cerrar) las refresca cuando una tabla cambió mucho.
// ============================================================
import type { PrismaClient } from "@prisma/client";

/** Una base menor que esto (≈ 8 MB con páginas de 4 KB) cabe en la caché: el plan elegido no importa */
export const PAGINAS_MINIMAS_PARA_ANALIZAR = 2_000;

/**
 * Calcula las estadísticas si la base es grande y aún no las tiene. Devuelve true si ejecutó ANALYZE. Es de una sola vez: en los arranques
 * siguientes solo hace dos consultas.
 */
export async function asegurarEstadisticas(prisma: Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe">, paginasMinimas = PAGINAS_MINIMAS_PARA_ANALIZAR): Promise<boolean> {
  const paginas = Number((await prisma.$queryRawUnsafe<Array<{ page_count: bigint | number }>>("PRAGMA page_count"))[0]?.page_count ?? 0);
  if (paginas < paginasMinimas) return false;
  const tabla = await prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_stat1'");
  if (Number(tabla[0]?.n ?? 0) > 0) {
    const filas = await prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>("SELECT COUNT(*) AS n FROM sqlite_stat1");
    if (Number(filas[0]?.n ?? 0) > 0) return false;
  }
  await prisma.$executeRawUnsafe("ANALYZE");
  return true;
}
