// ============================================================
// tests/setup.ts — Configuración global de pruebas Vitest
// ============================================================

import { vi, beforeAll, afterAll } from "vitest";

// Silenciar logs del servidor durante las pruebas
beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterAll(() => {
  vi.restoreAllMocks();
});
