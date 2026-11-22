import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.{test,spec}.ts", "tests/**/*.{test,spec}.tsx"],
    exclude: ["node_modules", "dist", "dist-electron", "release"],
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
