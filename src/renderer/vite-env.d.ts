// ============================================================
// src/renderer/vite-env.d.ts — Tipos del entorno Vite
// ============================================================

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_ENV: "development" | "production" | "test";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Tipos del API expuesto por preload.ts
interface Window {
  vendeya: import("../../electron/preload").VendeyaAPI;
}
