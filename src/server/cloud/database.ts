import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";

export function conectar(env = process.env): Pool {
  const connectionString = env["CLOUD_DATABASE_URL"];
  if (!connectionString) throw new Error("Configura CLOUD_DATABASE_URL");
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 5_000, statement_timeout: 10_000 });
  pool.on("error", () => console.warn("Se perdió una conexión inactiva a PostgreSQL"));
  return pool;
}

export async function transaccion<T>(pool: Pool, ejecutar: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  let descartarConexion = false;
  try {
    await db.query("BEGIN");
    const resultado = await ejecutar(db);
    await db.query("COMMIT");
    return resultado;
  } catch (error) {
    try {
      await db.query("ROLLBACK");
    } catch {
      // Una conexión cuyo estado transaccional ya no se puede comprobar no vuelve al pool.
      descartarConexion = true;
    }
    throw error;
  } finally {
    db.release(descartarConexion);
  }
}

export async function migrar(pool: Pool): Promise<void> {
  const sql = await readFile(path.join(__dirname, "deploy", "001.sql"), "utf8");
  await transaccion(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(721583071)");
    await db.query(sql);
  });
}
