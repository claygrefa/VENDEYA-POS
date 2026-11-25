import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Las pruebas de integración levantan un backend real con SQLite y su propio motor de Prisma.
    // Con el límite por defecto (5 s) fallaban de forma intermitente por contención de CPU al correr
    // decenas de archivos a la vez; estos valores siguen detectando bloqueos reales (el pool de BD es de 60 s).
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
    poolOptions: { forks: { maxForks: 6, minForks: 1 } },
    include: ["tests/**/*.{test,spec}.ts", "tests/**/*.{test,spec}.tsx"],
    // El banco de rendimiento (tests/performance) tarda minutos y genera una base de cientos de MB: solo corre con `npm run test:rendimiento`
    exclude: ["node_modules", "dist", "dist-electron", "release", "out", ...(process.env["VENDEYA_RENDIMIENTO"] === "1" ? [] : ["tests/performance/**"])],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts", "src/**/*.tsx", "electron/**/*.ts"],
      exclude: [
        "src/renderer/main.tsx",
        "src/renderer/vite-env.d.ts",
        "**/*.d.ts",
      ],
    },
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
      "@renderer": path.resolve(__dirname, "src/renderer"),
      "@server": path.resolve(__dirname, "src/server"),
    },
  },
});
