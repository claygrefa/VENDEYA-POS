// ============================================================
// src/server/config/app.config.ts — Configuración del servidor
// ============================================================

export interface AppConfig {
  nodeEnv:    "development" | "production" | "test";
  serverPort: number;
  logLevel:   "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  dbPath:     string;   // Ruta absoluta al archivo SQLite
}

function requireEnv(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Variable de entorno requerida: ${key}`);
  }
  return value;
}

export function loadAppConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV ?? "development") as AppConfig["nodeEnv"];

  return {
    nodeEnv,
    serverPort: parseInt(process.env.SERVER_PORT ?? "3001", 10),
    logLevel:   (process.env.LOG_LEVEL ?? (nodeEnv === "production" ? "warn" : "info")) as AppConfig["logLevel"],
    dbPath:     requireEnv("DB_PATH", "./vendeya.db"),
  };
}
