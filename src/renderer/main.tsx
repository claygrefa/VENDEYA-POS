// ============================================================
// src/renderer/main.tsx — Punto de entrada del Renderer React
// ============================================================

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import { iniciarPreferencias } from "./store/preferencias.store";

// Tema y tamaño de texto guardados en este equipo: se aplican antes de dibujar para que no haya parpadeo
iniciarPreferencias();

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("No se encontró el elemento #root en el DOM. Verifica index.html.");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
