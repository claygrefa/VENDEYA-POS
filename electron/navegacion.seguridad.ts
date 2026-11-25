// ============================================================
// electron/navegacion.seguridad.ts — Qué puede abrir o cargar la ventana de la aplicación
//
// La ventana solo debe mostrar la interfaz empaquetada (file://…/dist/index.html) o, en desarrollo, el servidor de Vite. Cualquier otra
// navegación (un enlace, un redireccionamiento, contenido inyectado) se bloquea: una página remota dentro de la ventana heredaría el
// acceso al backend local. Los enlaces externos http(s) se abren en el navegador del sistema, nunca dentro de la aplicación.
// Sin dependencias de Electron para poder probarlo.
// ============================================================

const ORIGEN_DESARROLLO = "http://localhost:5173";

/** ¿Puede la ventana navegar a esta dirección? */
export function esNavegacionPermitida(destino: string, desarrollo: boolean): boolean {
  let url: URL;
  try {
    url = new URL(destino);
  } catch {
    return false;
  }
  if (url.protocol === "file:") return true;
  return desarrollo && url.origin === ORIGEN_DESARROLLO;
}

/** ¿Se puede abrir esta dirección en el navegador del sistema? Solo http(s) sin credenciales incrustadas. */
export function esEnlaceExternoSeguro(destino: string): boolean {
  try {
    const url = new URL(destino);
    return (url.protocol === "https:" || url.protocol === "http:") && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}
