// ============================================================
// tests/unit/server/session-migration-utils.test.ts
// SessionService y divisor de sentencias SQL
// ============================================================
import { describe, it, expect } from "vitest";
import { SessionService } from "../../../src/server/services/session.service";
import { dividirSentencias } from "../../../src/server/services/migration.service";
import { sqliteUrl } from "../../../src/server/config/database.config";
import type { UsuarioPublico } from "../../../src/server/services/usuario.service";

const usuario: UsuarioPublico = {
  id: "u1", empresaId: "e1", username: "admin", nombre: "A", apellido: "B", rol: "ADMIN", permisos: [],
};

describe("SessionService", () => {
  it("crea tokens únicos de 64 hex y recupera al usuario", () => {
    const s = new SessionService();
    const t1 = s.crear(usuario);
    const t2 = s.crear(usuario);
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
    expect(t1).not.toBe(t2);
    expect(s.obtener(t1)).toEqual(usuario);
  });

  it("devuelve null para token inexistente o revocado", () => {
    const s = new SessionService();
    const t = s.crear(usuario);
    s.revocar(t);
    expect(s.obtener(t)).toBeNull();
    expect(s.obtener("falso")).toBeNull();
  });

  it("expira las sesiones tras el TTL", () => {
    let ahora = 1_000;
    const s = new SessionService(500, () => ahora);
    const t = s.crear(usuario);
    ahora = 1_499;
    expect(s.obtener(t)).not.toBeNull();
    ahora = 1_500;
    expect(s.obtener(t)).toBeNull();
    expect(s.activas).toBe(0);
  });
});

describe("dividirSentencias", () => {
  it("separa sentencias, ignora comentarios y soporta CRLF", () => {
    const sql = '-- CreateTable\r\nCREATE TABLE "A" (\r\n  "id" TEXT\r\n);\r\n\r\n-- CreateIndex\r\nCREATE INDEX "i" ON "A"("id");\r\n';
    expect(dividirSentencias(sql)).toEqual(['CREATE TABLE "A" (\n  "id" TEXT\n)', 'CREATE INDEX "i" ON "A"("id")']);
  });

  it("no parte por punto y coma dentro de una misma línea", () => {
    expect(dividirSentencias("INSERT INTO t VALUES ('a;b');\n")).toEqual(["INSERT INTO t VALUES ('a;b')"]);
  });

  it("devuelve vacío para un script solo con comentarios", () => {
    expect(dividirSentencias("-- nada\n")).toEqual([]);
  });
});

describe("sqliteUrl", () => {
  it("normaliza separadores de Windows", () => {
    expect(sqliteUrl("C:\\datos\\v.db")).toBe("file:C:/datos/v.db");
  });
});
