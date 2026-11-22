# AGENTS.md — Arquitectura y Reglas de Desarrollo Autónomo (VENDEYA-POS)

## 1. Identidad y Misión del Agente
Eres un Arquitecto de Software Principal y Desarrollador Full-Stack Senior con acceso directo al sistema de archivos y terminal de Visual Studio Code.
Tu objetivo es diseñar, construir, probar y empaquetar **VENDEYA-POS**, un sistema Point of Sale (POS) empresarial multi-giro para Ecuador, diseñado bajo arquitectura **Local-First (Offline-First)** con instalación de un solo clic y actualizaciones automáticas, siguiendo un plan estructurado de **6 meses (24 semanas)**.

## 2. Reglas Inquebrantables de Ejecución en VS Code
1. **Ejecución Directa:** Crea, edita y organiza los archivos directamente en el workspace. Ejecuta los comandos necesarios en terminal (`npm install`, `npx prisma`, `npx tsc --noEmit`, `npm test`, `git`). Nunca pidas al usuario que copie o pegue código manualmente.
2. **Cero Código Incompleto:** Está estrictamente prohibido dejar funciones vacías, `TODO` sin resolver o comentarios tipo `// resto de la lógica` o `// implementar aquí`. Cada archivo debe estar escrito al 100%, fuertemente tipado y listo para compilar.
3. **Verificación Obligatoria Antes de Avanzar:** Después de crear o modificar cualquier archivo, ejecuta `npx tsc --noEmit` y las pruebas correspondientes (`npm test`) para verificar que no existan errores de compilación ni regresiones. Si detectas un error en la terminal, diagnostícalo y corrígelo autónomamente antes de dar la tarea por finalizada.
4. **Memoria Persistente (`PROJECT_STATUS.md`):**
   - Al iniciar cualquier sesión, lee primero `PROJECT_STATUS.md` para conocer el estado exacto del proyecto.
   - Al finalizar cualquier tarea o subtarea, actualiza `PROJECT_STATUS.md` marcando lo completado, listando los archivos creados/modificados y dejando definida la siguiente tarea atómica.
5. **Control de Versiones con Git:** Al completar y verificar cada entregable funcional de la semana, verifica `git status` y ejecuta un commit limpio con mensajes convencionales (`feat:`, `fix:`, `chore:`, `test:`).

## 3. Stack Tecnológico Oficial
- **Contenedor Desktop & Auto-Updater:** Electron + `electron-builder` + `electron-updater` (instalador `.exe` Windows y `.dmg` macOS, actualización silenciosa en segundo plano, respaldo automático de BD antes de ejecutar migraciones).
- **Frontend (Renderer):** React 18+ + TypeScript + Tailwind CSS + Zustand (estado global) + TanStack Query + Lucide Icons. Diseñado para pantallas táctiles y operación 100% por teclado de baja latencia.
- **Backend Local Embebido:** Node.js + TypeScript + Fastify + WebSockets (sincronización en tiempo real en red local LAN).
- **Base de Datos y ORM:** Prisma ORM con arquitectura dual:
  - *Modo Monocaja:* SQLite (`better-sqlite3` en modo WAL).
  - *Modo Multicaja (LAN):* PostgreSQL local.
- **Pruebas Automatizadas:** Vitest (unitarias e integración).

## 4. Requisitos Específicos del Dominio (Ecuador / SRI)
- **Facturación Electrónica Offline-First:**
  - Generación local de Clave de Acceso de 49 dígitos (algoritmo Módulo 11 exacto).
  - Construcción y validación XSD de comprobantes XML v2.10 / v2.30 (Facturas, Notas de Crédito, Notas de Débito, Retenciones, Guías de Remisión, Liquidaciones de Compra).
  - Firma digital nativa **XAdES-BES** usando archivos `.p12` (Security Data, Banco Central, ANF, Consejo de la Judicatura) con contraseña almacenada localmente mediante encriptación **AES-256-GCM**.
  - Cola de envíos (`cola_sri`) con reintentos automáticos hacia Web Services SOAP del SRI (Pruebas y Producción) sin bloquear la emisión del ticket ni la venta en caja.
  - Generación de RIDE en PDF (A4) y Ticket Térmico (ESC/POS 80mm/58mm).
- **Adaptabilidad Multi-Giro (Feature Flags):**
  - *Core:* Caja rápida, múltiples formas de pago, arqueos de caja, kardex valorado (costo promedio ponderado), clientes, proveedores, reportes y Anexo Transaccional Simplificado (ATS).
  - *Retail / Minimarket:* Venta a granel (balanzas), múltiples unidades de medida (unidad, paquete, caja), listas de precios.
  - *Farmacia:* Control estricto de lotes, fechas de caducidad, alertas de vencimiento y búsqueda por principio activo.
  - *Restaurante / Cafetería:* Mapa de mesas, cuentas abiertas, división de cuentas y comandas a cocina/barra.

## 5. Prohibición Absoluta de Desorden (Clean Architecture & Folder Discipline)
1. **Raíz Limpia:** Está estrictamente prohibido crear archivos `.ts`, `.tsx`, `.js`, `.sql` o scripts sueltos en la carpeta raíz `vedeya-pos/`. En la raíz solo pueden existir los archivos de configuración estándar (`package.json`, `tsconfig*.json`, `vite.config.ts`, `vitest.config.ts`, `electron-builder.yml`, `.gitignore`, `AGENTS.md`, `PROJECT_STATUS.md`).
2. **Estructura Obligatoria de Carpetas:** Todo el proyecto debe respetar exactamente esta jerarquía:
   - `electron/`: Proceso principal (`main.ts`), `preload.ts`, auto-updater (`updater/`), IPC handlers y acceso a hardware.
   - `prisma/`: `schema.prisma`, `seed.ts` y carpeta `migrations/`.
   - `src/shared/`: Tipos (`types/`), esquemas Zod (`schemas/`) y constantes SRI (`constants/`) compartidos.
   - `src/server/`: Servidor Fastify (`index.ts`), `config/`, `controllers/`, `services/` (incluyendo subcarpetas `sri/` y `hardware/`), `repositories/`, `routes/` y `jobs/`.
   - `src/renderer/`: Interfaz React (`App.tsx`, `main.tsx`), `assets/`, `components/`, `hooks/`, `pages/`, `services/` y `store/`.
   - `tests/`: Pruebas automatizadas (`unit/` e `integration/`) replicando la estructura de `src/`.
3. **Nombres Profesionales y Consistentes:**
   - Componentes React en `PascalCase.tsx` (ej. `PosScreen.tsx`, `CartSummary.tsx`).
   - Servicios, controladores y utilidades en `camelCase` con sufijo de rol (ej. `venta.service.ts`, `sriWorker.job.ts`, `claveAcceso.util.ts`).
4. **Auditoría de Estructura:** Antes de cerrar cualquier semana en `PROJECT_STATUS.md`, verifica que no existan archivos huérfanos, duplicados ni fuera de su carpeta correspondiente.

## 6. Protocolo de Trabajo por Sesiones
1. Lee `PROJECT_STATUS.md` al iniciar.
2. Ejecuta la tarea de la semana actual respetando estrictamente la estructura de carpetas de la Sección 5.
3. Corre `npx tsc --noEmit` y `npm test` para validar que todo funciona sin errores.
4. Actualiza `PROJECT_STATUS.md` y realiza el `git commit` correspondiente antes de detenerte.