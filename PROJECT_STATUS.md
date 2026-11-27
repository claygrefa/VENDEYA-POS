# PROJECT_STATUS.md — Bitácora Maestra de Desarrollo (VENDEYA POS)

## Estado General

### Reparación de estabilidad y auditoría — 2026-11-26

- [x] **Cobros.** Después de 30 días se archivan el UUID, el resultado mínimo y el folio antes de eliminar la respuesta completa. La reserva del UUID evita duplicar ventas, pagos o movimientos de inventario ante reintentos tardíos. Se pueden cerrar intentos `PENDING` preexistentes. El POS muestra el folio cuando recupera un cobro ya archivado. El archivo solo puede conservar intentos que todavía existan en la base al aplicar el cambio.
- [x] **Durabilidad.** SQLite abre la conexión con `synchronous=FULL` y usa WAL. Se comprobó la recuperación tras perder la respuesta TCP, el reinicio del backend y el rollback completo ante un fallo de persistencia, incluido un fallo de inserción en la cola del SRI.
- [x] **Servicios cloud.** El receptor de telemetría comprueba y aplica la cuota dentro de una transacción PostgreSQL, deduplica UUID y acepta reenvíos de reportes guardados aun con la cuota llena. Los logs de arranque identifican la etapa fallida sin imprimir credenciales.
- [x] **Herramientas.** Se actualizaron Vite, Vitest, electron-builder y electron/rebuild. La configuración de Windows conserva la verificación de firma del actualizador y usa `win.signtoolOptions` para SHA-256.

**Archivos modificados.** `prisma/schema.prisma`, `prisma/migrations/20261206090000_cobro_archivado/migration.sql`, `src/server/index.ts`, `src/server/services/{appError.util,intentoCobro.service}.ts`, `src/renderer/pages/PosScreen.tsx`, `src/server/cloud/{app,cli,database}.ts`, `package.json`, `package-lock.json`, `electron-builder.yml`, `vite.config.ts`, `vitest.config.ts` y las pruebas de backend, telemetría, cobro, POS, empaquetado y estrés. El informe local `AUDIT_REPORT.md` registra los hallazgos corregidos y queda fuera de Git.

**Verificación.** TypeScript en los cuatro proyectos y ESLint sin errores. Pasaron 1.140 pruebas en 79 archivos y 5 pruebas de estrés en aislamiento. El banco confirmó el rollback de caja e inventario tras un fallo de la cola del SRI y recuperó 500 comprobantes al restablecer el servicio simulado. `npm audit` y `npm audit --omit=dev` reportaron 0 vulnerabilidades.

**Comprobación del paquete de Windows.** Se construyó el paquete sin instalador. La prueba de humo pasó las 13 comprobaciones de contenido y backend empaquetado, incluidas 17 migraciones sobre una base nueva. El ejecutable y el binario de Electron original terminaron con el mismo código `0x80000003` en esta sesión, por lo que siguen pendientes las dos comprobaciones de primer arranque con ventana y perfil temporal.

**Siguiente tarea atómica.** Revisar el primer error en los logs del despliegue `e59adc4` de `vendeya-cloud` en Render y validar el servicio con `cloud:verify` cuando responda por HTTPS. También quedan pendientes la prueba en equipos limpios, la firma comercial, la notarización, la autorización real en `celcer` y la aprobación del tag.

### Automatización de salida comercial v1.0.0 — 2026-11-26

- [x] Backend cloud en `src/server/cloud/` con contrato de Electron, PostgreSQL, migración, Docker, Compose y Blueprint de Render. `cloud:init` genera una clave Ed25519 local. `cloud:verify` prueba el origen HTTPS, renueva una licencia verificable y registra telemetría.
- [x] `tests/smoke/sriTestReal.smoke.ts` pide factura, RUC, certificado y contraseña oculta. Conserva la respuesta SOAP del SRI tras una autorización de pruebas válida. `tests/smoke/smoke-test-install.ps1` genera recibos distintos para instalación limpia y upgrade NSIS con conservación de datos.
- [x] `.github/workflows/release.yml` firma el candidato ejecutado manualmente en Actions, verifica Authenticode y notariza macOS. El tag publica los mismos artefactos verificados. `electron/updater/release/` genera los manifiestos y aplica la comprobación de evidencia antes de crear el tag. El configurador Electron incorpora URL de licencias, clave pública y URL de telemetría al candidato.
- [x] `docs/RELEASE_V1_RUNBOOK.md` y `npm run release:runbook` guían los pasos en orden. `evidence/` y `.release-private/` se excluyen de Git y del instalador. Se actualizaron `package.json`, `package-lock.json`, `electron-builder.yml`, `.gitignore`, el cliente SOAP y las pruebas del backend y del empaquetado.
- [ ] Siguiente tarea atómica. Ejecutar `npm.cmd run cloud:init`, crear el Blueprint y generar `evidence/services.json` contra el HTTPS real. Después siguen `celcer`, los recibos de Windows, validación de firma y aprobación del tag.

**Verificación local.** Pasaron 1.121 pruebas de regresión en 78 archivos, los cuatro chequeos TypeScript y ESLint. La integración cloud aplica la migración con PostgreSQL embebido, valida dispositivos y revocación, y comprueba telemetría deduplicada. Se confirmó la inicialización idempotente de claves en un directorio temporal, la sintaxis de Compose y de PowerShell, y el rechazo del control de publicación al faltar evidencia. La suite de estrés corresponde a la verificación previa. Docker Desktop no tenía un motor activo durante esta sesión. El despliegue HTTPS, la autorización del SRI, el smoke de la VM y la firma real siguen como verificaciones de campo.

El control vigente es `npm run release:publish` para validar evidencia y `npm run release:publish -- --publish` para crear el tag anotado y subirlo tras aprobar el candidato. Esta sección reemplaza los comandos directos de tag de las bitácoras previas.

### Bloqueos de pre-lanzamiento v1.0.0 — 2026-11-26

- [x] **Punto 5.** Electron escribe el UUID y la solicitud en disco antes de enviar el cobro. El POS ofrece recuperarlo al reiniciar. SQLite confirma el resultado junto al pago, la venta y el inventario. Los rechazos de negocio se guardan como `FAILED`. Las pruebas cubren un corte TCP posterior al commit, un reinicio del backend y un nuevo arranque del POS. Los clientes HTTP anteriores pueden omitir `intentoId`; para recuperar su propio cobro deben generarlo y reenviarlo. El contrato también admite UUID en el cobro de comandas.
- [x] **Punto 4.** `package.json` y `electron-builder.yml` apuntan a `claygrefa/VENDEYA-POS`, que coincide con `origin`. La sección de automatización comercial documenta el nuevo flujo con comprobación de evidencia.

- [x] **Punto 6.** La app lee `LICENSE_SERVER_URL`, `LICENSE_PUBLIC_KEY` (PEM Ed25519) y `TELEMETRY_URL` del entorno **solo en desarrollo**; instalada, usa únicamente el `licencia.config.json` incrustado al compilar (ver «Correcciones de la auditoría 2026-11-26 (2)»). Mantiene la validación en segundo plano cada 24 h y hasta 15 días de gracia desde la última validación exitosa, limitada por el vencimiento de la suscripción. La telemetría envía errores con consentimiento del administrador. Para probar el protocolo HTTP, ejecutar `npm run mock:prelanzamiento -- <RUC-de-prueba>` y configurar las variables que imprime en el proceso de la app. En desarrollo, añadir `VENDEYA_LICENCIA=on`. El receptor es local y su estado y clave cambian al reiniciarlo.
- [x] **Punto 1, preparación.** El flujo comercial local y CI requieren `CSC_LINK` y `CSC_KEY_PASSWORD`, y activan `forceCodeSigning`. En Windows, cargar ambas variables en la sesión y ejecutar `npm run prisma:generate`, `npm run build:main`, `npm run build:vite` y `npm run build:release:win`. Configurar los secretos Windows/macOS del workflow para publicar. [Documentación de firma de electron-builder](https://www.electron.build/v26/docs/features/code-signing/).
- [x] **Punto 2, automatización.** Copiar el candidato firmado y `tests/smoke/smoke-test-install.ps1` a una VM Windows limpia e interactiva. Ejecutar `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\smoke-test-install.ps1 -Installer .\vendeyapos-Setup-1.0.0.exe`. Desde el repositorio también funciona `npm run smoke-test-install -- -Installer .\release\vendeyapos-Setup-1.0.0.exe`. Comprueba Authenticode, código de salida de NSIS, ventana, base SQLite nueva y API del asistente sin empresa configurada.
- [x] **Punto 3, preparación.** `SRI_TEST_RECEPCION_URL` y `SRI_TEST_AUTORIZACION_URL` se resuelven a los servicios de recepción y autorización del ambiente oficial `celcer`. Con una factura XML sin firma de ambiente `1` (v2.1.0), su certificado `.p12` y `SRI_P12_PASSWORD` en el proceso, validar primero con `npm run sri:smoke -- "C:\ruta\factura.xml" "C:\ruta\firma.p12"`. Añadir `--enviar` para enviar a pruebas y consultar autorización. Si queda pendiente, ejecutar `npm run sri:smoke -- --consultar <clave-de-acceso>` con la misma clave. Usar archivos fuera del repositorio y retirar la contraseña del entorno al terminar. [Ficha técnica del SRI](https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/bd280acc-3e16-429a-809b-fa7eb5c6f855/FICHA%20T%C3%89CNICA%20COMPROBANTES%20ELECTR%C3%93NICOS%20ESQUEMA%20OFFLINE%20Versi%C3%B3n%202.22.pdf).

**Pendiente fuera de VS Code.** Obtener un candidato con el certificado comercial, ejecutar el smoke en Windows limpio y verificar una actualización real. Firmar y notarizar en macOS y probar el DMG en un equipo limpio. Ejecutar el envío controlado de una factura en `celcer` y registrar el estado `AUTORIZADO`. Configurar los servidores comerciales de licencias y telemetría. Crear y subir el tag tras aprobar esas verificaciones.

**Archivos modificados y creados**

- Cobro en `prisma/schema.prisma` y `prisma/migrations/20261204090000_intento_cobro/migration.sql`, esquemas, rutas y controladores de venta y restaurante, `intentoCobro.service.ts`, `venta.service.ts` y `comanda.service.ts`.
- Recuperación en `electron/ipc/{app,cobroPendiente}.ipc.ts`, `electron/preload.ts`, `PosScreen.tsx`, `cobroPendiente.ts` y `pos.api.ts`.
- Licencias y telemetría en `electron/{main,licencia.config}.ts`, `licencia.{cliente,service}.ts`, `telemetria.service.ts` y `receptorPrelanzamiento.mock.ts`.
- Distribución y SRI en `electron-builder.yml`, `.github/workflows/release.yml`, `verificarFirmaRelease.cjs`, `smoke-test-install.ps1`, `sriFacturaPruebas.smoke.ts` y `sriSoap.client.ts`.
- Verificación en `package.json`, `package-lock.json`, `tests/config/eslint.config.cjs`, anotaciones de lint en `producto.repository.ts` y `balanza.protocolo.ts` y pruebas de POS, IPC, ventas, empaquetado, XML y receptor.

**Siguiente tarea atómica.** Construir el NSIS con el certificado comercial y ejecutar `smoke-test-install` en la VM Windows limpia.

**Verificación local.** Pasaron los tres chequeos de TypeScript, ESLint, `build:main`, `build:vite`, 1.120 pruebas de regresión (77 archivos) y las cinco pruebas de estrés ejecutadas aparte. La búsqueda parcial de catálogo alcanzó 73,10 ms en una corrida simultánea y 17,73 ms en aislamiento frente al umbral de 50 ms. Se verificaron la sintaxis y el rechazo de un instalador inexistente en `smoke-test-install`, la comprobación de credenciales de firma y la ayuda de `sri:smoke`. El NSIS firmado y la autorización real del SRI requieren las pruebas de campo indicadas arriba.

- **Proyecto:** VENDEYA POS (Sistema Punto de Venta Multi-Giro & Facturación Electrónica SRI Ecuador)
- **Horizonte:** 6 Meses (24 Semanas)
- **Fase Actual:** Candidata v1.0.0, pendiente de validación de campo. Ver «Bloqueos de pre-lanzamiento v1.0.0».
- **Estado de Compilación:** ✅ `tsc --noEmit` → 0 errores | ✅ `tsconfig.node.json` → 0 errores | ✅ `tsconfig.electron.json` → 0 errores
- **Tests:** ✅ 1.140 pruebas en 79 archivos. La suite de estrés se ejecuta aparte con `npm run test:estres`.
- **Entregable de pre-lanzamiento:** `fix: cierra bloqueos de prelanzamiento del POS` (2026-11-26). Tag pendiente de aprobar el candidato firmado.

---

## Hoja de Ruta de 6 Meses (24 Semanas)

### MES 1: Cimientos, Arquitectura y Base de Datos
- [x] **Semana 1 (COMPLETADA):** Inicializar Git, estructura de carpetas (`electron/`, `src/server/`, `src/renderer/`, `src/shared/`, `prisma/`, `tests/`), `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` e instalación de dependencias base.
- [x] **Semana 2 (COMPLETADA):** Diseño e implementación de `prisma/schema.prisma` completo (multi-empresa, sucursales, puntos de emisión, impuestos dinámicos SRI, productos, lotes, kardex, turnos de caja, ventas, comprobantes SRI, roles RBAC y feature flags) + migración inicial.
- [x] **Semana 3 (COMPLETADA):** Creación de `prisma/seed.ts` (impuestos SRI vigentes, Consumidor Final, usuario admin, configuraciones base) y capa de repositorios/servicios base en `src/server/`.
- [x] **Semana 4 (COMPLETADA):** Implementación del núcleo de Electron (`electron/main.ts`, `electron/preload.ts`), arranque automático del servidor Fastify embebido, ejecución automática de migraciones SQLite al iniciar y pruebas unitarias de arranque.

### MES 2: Núcleo POS, Inventario y Módulos Multi-Giro
- [x] **Semana 5 (COMPLETADA):** Motor transaccional ACID de ventas, múltiples formas de pago, descuentos, anulaciones y actualización automática de Kardex (costo promedio ponderado).
- [x] **Semana 6 (COMPLETADA):** Gestión de Turnos y Arqueos de Caja (apertura, ingresos/egresos de efectivo, cierre ciego, cuadre y reportes de turno) + Cuentas por Cobrar y Cuentas por Pagar.
- [x] **Semana 7 (COMPLETADA):** Módulo Retail/Ferretería (múltiples presentaciones, fraccionamiento, listas de precios, códigos de barras) y Módulo Farmacia (lotes, fechas de caducidad, alertas).
- [x] **Semana 8 (COMPLETADA):** Módulo Restaurantes (mapa de mesas, cuentas abiertas, división de cuentas, envío de comandas) + Suite completa de pruebas de integración del núcleo POS.

### MES 3: Motor Tributario SRI Ecuador (100% Offline-First)
- [x] **Semana 9 (COMPLETADA):** Generador de Clave de Acceso (49 dígitos, Módulo 11) + Constructor de XML v2.10/v2.30 para Facturas y Notas de Crédito + validación contra esquemas XSD del SRI.
- [x] **Semana 10 (COMPLETADA):** Firmador digital XAdES-BES en Node.js compatible con certificados `.p12` de Ecuador + encriptación AES-256-GCM de credenciales del certificado.
- [x] **Semana 11 (COMPLETADA):** Cliente SOAP para Web Services del SRI (`RecepcionComprobantesOffline` y `AutorizacionComprobantesOffline` en Pruebas y Producción) + Worker en segundo plano para cola offline (`cola_sri`).
- [x] **Semana 12 (COMPLETADA):** Soporte para Retenciones, Guías de Remisión, Liquidaciones de Compra y generador automático de archivo XML del Anexo Transaccional Simplificado (ATS).

### MES 4: Hardware, Red Local (LAN) y Experiencia de Caja
- [x] **Semana 13 (COMPLETADA):** Motor de impresión térmica directa ESC/POS (USB, Ethernet, 80mm/58mm), apertura automática de gaveta de dinero y generador de RIDE en PDF A4.
- [x] **Semana 14 (COMPLETADA):** Integración de periféricos (lectores de códigos de barras, balanzas seriales) y sincronización multi-caja en red local (LAN) vía WebSockets sin depender de internet.
- [x] **Semana 15 (COMPLETADA):** Frontend POS principal (`PosScreen`), búsqueda ultrarrápida, atajos de teclado (`F2`, `F4`, `F8`, `ESC`), modo táctil y modal de cobro.
- [x] **Semana 16 (COMPLETADA):** Vistas de Inventario, Kardex, Clientes, Reportes Gerenciales y Monitor de Comprobantes SRI (`SriMonitor`).

### MES 5: Instalador Cero Fricción, Auto-Updater y Licenciamiento
- [x] **Semana 17 (COMPLETADA):** Asistente de Configuración Inicial (`SetupWizard`) guiado en 3 pasos para clientes sin conocimientos técnicos (datos RUC, carga de `.p12`, selección de giro de negocio).
- [x] **Semana 18 (COMPLETADA):** Implementación de `electron-updater` con descarga silenciosa en segundo plano, respaldo automático de la base de datos SQLite antes de aplicar actualizaciones y banner de actualización.
- [x] **Semana 19 (COMPLETADA):** Sistema de licenciamiento y suscripciones (activación online, validación periódica con período de gracia offline de 15 días, control de dispositivos).
- [x] **Semana 20 (COMPLETADA, parcial: ver «No verificado»):** Configuración de `electron-builder` + Inno Setup para generar instaladores nativos `.exe` (Windows) y `.dmg` (macOS) firmados y listos para distribución.

### MES 6: Auditoría, Seguridad, Estrés y Lanzamiento Comercial
- [x] **Semana 21 (COMPLETADA):** Pruebas de estrés y rendimiento con bases de datos de 20,000+ productos y simulación de 1,500 ventas diarias en hardware de gama baja/media.
- [x] **Semana 22 (COMPLETADA, parcial: ver «No resuelto»):** Auditoría de seguridad (protección de SQLite, sanitización de entradas, permisos RBAC por rol de cajero/supervisor/admin, respaldos automáticos locales y en nube).
- [x] **Semana 23 (COMPLETADA, parcial: ver «No resuelto»):** Centro de ayuda integrado en la aplicación, guías rápidas para cajeros/contadores y telemetría opcional de errores.
- [x] **Semana 24 (COMPLETADA como candidata; publicación pendiente, ver «No verificado»):** Corrección final de detalles, congelamiento de código, pruebas en máquinas limpias (Windows 10/11 y macOS) y empaquetado oficial **v1.0.0 Comercial**.

---

## Registro de Avances y Decisiones Técnicas

### Semana 1 — 2026-11-22 ✅ COMPLETADA
**Archivos creados:**
- `.gitignore` — Reglas de exclusión (node_modules, DB, certificados, dist)
- `package.json` — Stack completo: Electron 33, React 18, Fastify 4, Prisma 5, Vitest 2, TypeScript 5.6, Tailwind 3
- `tsconfig.json` — Config renderer (bundler mode, JSX react-jsx, paths @shared/@renderer)
- `tsconfig.node.json` — Config Node/Electron/Server (CommonJS, composite: true, paths @shared/@server)
- `vite.config.ts` — Vite 5 con @vitejs/plugin-react, root en src/renderer, aliases
- `vitest.config.ts` — Vitest 2 con globals, cobertura v8, setupFiles
- `tailwind.config.ts` — Paleta VENDEYA (brand, success, warning, danger, surface) + componentes POS
- `postcss.config.cjs` — PostCSS con tailwindcss y autoprefixer
- `electron-builder.yml` — Build config: NSIS (Windows), DMG (macOS), publish via GitHub releases
- `electron/main.ts` — BrowserWindow con contextIsolation, CSP, dev/prod routing
- `electron/preload.ts` — contextBridge con allowlist de canales IPC (invoke + on)
- `src/shared/types/` — 6 archivos: common, empresa, producto, venta, sri, feature-flags + index
- `src/shared/schemas/` — 4 archivos Zod: empresa, producto, venta, paginacion + index
- `src/shared/constants/sri.constants.ts` — IVA 15%, URLs WS SRI, tipos comprobante, Consumidor Final, Clave Acceso longitudes
- `src/server/index.ts` — Fastify stub con health-check y CORS
- `src/server/config/app.config.ts` — Carga de configuración con validación de env vars
- `src/renderer/main.tsx` — Punto de entrada React con ReactDOM.createRoot
- `src/renderer/App.tsx` — Dashboard de estado del sistema con QueryClientProvider
- `src/renderer/index.html` — HTML con CSP estricta
- `src/renderer/vite-env.d.ts` — Tipos Vite + Window.vendeya API
- `src/renderer/styles/globals.css` — Tailwind + componentes (.btn-primary, .card, .input, .badge-*)
- `tests/setup.ts` — Setup global Vitest (mock console.log/info)
- `tests/unit/shared/feature-flags.test.ts` — 10 pruebas de Feature Flags por giro
- `tests/unit/shared/sri-constants.test.ts` — 8 pruebas de constantes SRI Ecuador
- `tests/unit/shared/zod-schemas.test.ts` — 10 pruebas de validación de esquemas Zod
- Placeholders en: `electron/ipc/`, `electron/updater/`, todos los subdirectorios de `src/server/` y `src/renderer/`, `tests/integration/`, `prisma/`

**Decisiones Técnicas:**
- `better-sqlite3` movido a `optionalDependencies`: el sistema Windows no tiene Visual Studio C++ Build Tools. La compilación nativa se realizará con `@electron/rebuild` contra el runtime de Electron en Semana 4. No afecta Semanas 1–3 que no usan DB runtime.
- `@electron/rebuild` agregado a devDependencies para Semana 4.
- `tsconfig.json` sin `references` (evita conflicto de outDir con archivos shared). El type-check del renderer incluye `src/shared/**` directamente.
- `tsconfig.node.json` con `composite: true` para soportar referencias de proyecto TypeScript.

**Verificación:**
- `npx tsc --noEmit` → ✅ 0 errores
- `npx tsc --noEmit -p tsconfig.node.json` → ✅ 0 errores
- `npx vitest run` → ✅ 28/28 tests passed (3 archivos)

---

### Semana 2 — 2026-11-22 ✅ COMPLETADA
**Archivos creados:**
- `prisma/schema.prisma` — 26 modelos (24 solicitados + `RolPermiso` e `ItemComanda`): Empresa, Sucursal, PuntoEmision, Rol/Permiso/RolPermiso, Usuario, ConfiguracionGiro, TarifaImpuesto, Categoria, UnidadMedida, Producto, Lote, Kardex, Cliente, Proveedor, TurnoCaja, MovimientoCaja, Venta, LineaVenta, PagoVenta, ComprobanteElectronico, ColaSRI, Mesa, Comanda, ItemComanda
- `prisma/migrations/20261122062347_init/migration.sql` — migración inicial SQLite
- `tests/integration/prisma-schema.test.ts` — 32 pruebas (26 delegados + consultas básicas)
- `.env.test` — entorno de pruebas (`vendeya-test.db`)

**Decisiones Técnicas:**
- Enums modelados como `String` (SQLite no soporta enums en Prisma 5); los valores válidos se documentan en comentarios y se validarán con Zod.
- BD de test (`prisma/vendeya-test.db`) se prepara con `DATABASE_URL="file:./vendeya-test.db" npx prisma migrate deploy`; los `*.db` están en `.gitignore`.
- `$queryRaw` en SQLite devuelve `BigInt` → el test convierte con `Number()`.

**Verificación:** `tsc --noEmit` (ambos tsconfig) ✅ 0 errores | `npx vitest run` ✅ 60/60

---

### Semana 3 — 2026-11-22 ✅ COMPLETADA
**Archivos creados/modificados:**
- `prisma/seed.ts` — `runSeed(prisma, opciones)` idempotente (upserts): 54 permisos (9 módulos × 6 acciones), 5 roles RBAC (ADMIN, SUPERVISOR, CAJERO, BODEGUERO, CONTADOR), 8 unidades de medida, categoría "General", empresa demo (RUC marcador `9999999999001`), sucursal 001, punto de emisión 001, tarifas IVA SRI, usuario `admin`, Consumidor Final y `ConfiguracionGiro` RETAIL_GENERAL. Ejecutable con `npm run prisma:seed`.
- `src/server/config/database.config.ts` — Prisma singleton (`getPrisma`, `disconnectPrisma`)
- `src/server/repositories/` — `empresa`, `usuario` (con rol y permisos), `producto` (búsqueda paginada, código de barras), `cliente`
- `src/server/services/` — `empresa.service`, `usuario.service` (alta, autenticación, `tienePermiso`), `producto.service` (margen automático), `cliente.service`, más utilidades `appError.util`, `object.util` (`omitUndefined`), `password.util` (scrypt), `validation.util` (Zod → `AppError`)
- `src/shared/schemas/cliente.schema.ts` (validación RUC / cédula Módulo 10 / pasaporte / Consumidor Final) y `usuario.schema.ts`; exportados en `index.ts`
- `tests/unit/server/utils.test.ts` (11) y `tests/integration/server/seed-services.test.ts` (19, BD SQLite aislada por proceso que se elimina al terminar)
- `package.json` — `prisma:seed` ahora usa `ts-node --project tsconfig.node.json` (con `tsconfig.json` fallaba por módulos ESM)
- Eliminados `.gitkeep.ts` de `repositories/` y `services/`

**Decisiones Técnicas:**
- Contraseñas con `crypto.scrypt` nativo (formato `scrypt$salt$hash`) en vez de `bcrypt`: evita compilación nativa (no hay C++ Build Tools).
- Contraseña inicial del admin: `SEED_ADMIN_PASSWORD` o, por defecto, `Admin123!` — **cambiarla en el SetupWizard (Semana 17)**; el RUC/empresa demo también se reemplazan ahí.
- Servicios y repositorios reciben dependencias por constructor (testeables sin singleton).
- Errores de dominio vía `AppError` con códigos (`VALIDACION`, `NO_ENCONTRADO`, `DUPLICADO`, `CREDENCIALES_INVALIDAS`, `USUARIO_INACTIVO`) para mapear a HTTP en Semana 4+.

**Verificación:** `tsc --noEmit` (ambos tsconfig) ✅ 0 errores | `npx vitest run` ✅ 90/90 | `npm run prisma:seed` ✅ ejecutado dos veces sin duplicar.

---

### Semana 4 — 2026-11-22 ✅ COMPLETADA
**Archivos creados/modificados:**
- `electron/main.ts` — instancia única; orden de arranque backend → IPC → ventana; `userData/data/vendeya.db` (o `DB_PATH`); migraciones en `process.resourcesPath` si está empaquetado; diálogo de error si el arranque falla; apagado limpio (`before-quit` cierra Fastify y Prisma).
- `electron/preload.ts` — agrega canal `backend:get-info` a la allowlist.
- `electron/ipc/app.ipc.ts` — handlers `app:get-version`, `app:get-paths`, `db:health-check`, `backend:get-info`.
- `src/server/index.ts` — `buildServer(servicios)` (CORS, mapeo `AppError`→HTTP, 404/500 propios) e `iniciarBackend(opciones)` (BD → migraciones+respaldo → WAL → HTTP con fallback a puerto libre si está ocupado; limpia recursos si falla).
- `src/server/services/migration.service.ts` — migraciones sin CLI de Prisma, compatibles con `_prisma_migrations` (checksum SHA-256); respaldo previo con `VACUUM INTO` (retención de 5); detecta migraciones aplicadas que fueron modificadas; atómicas salvo las que redefinen tablas (PRAGMA foreign_keys).
- `src/server/services/session.service.ts` (sesiones Bearer en memoria, TTL 12 h) y `container.factory.ts` (composición de servicios).
- `src/server/routes/` (`index.ts`, `auth.guard.ts` con RBAC) y `src/server/controllers/` (health, auth, producto, cliente). Endpoints: `GET /api/health`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/productos[?search&page&pageSize]`, `/api/productos/barcode/:codigo`, `/api/productos/:id`, `GET /api/clientes`, `/api/clientes/consumidor-final`, `/api/clientes/:id`.
- `src/server/config/database.config.ts` — `sqliteUrl`, `crearPrismaPara`.
- `src/renderer/index.html` — CSP `connect-src` admite cualquier puerto de `127.0.0.1` (el backend puede usar puerto alterno).
- `tsconfig.electron.json` (salida a `dist-electron/`), `package.json`: `main` → `dist-electron/electron/main.js`, script `build:main`, `dev:electron` y `build` compilan el proceso principal.
- Tests: `tests/unit/server/session-migration-utils.test.ts` (7), `tests/integration/server/migration.service.test.ts` (9), `tests/integration/server/backend-api.test.ts` (15).

**Decisiones Técnicas:**
- No se usa `prisma migrate deploy` en runtime (el CLI no viaja en el instalador); `MigrationService` replica su contrato y se verificó con `prisma migrate status`.
- `better-sqlite3` sigue sin usarse: el acceso a SQLite es vía Prisma. `@electron/rebuild` solo será necesario si se adopta `better-sqlite3` directo.
- Backend en `127.0.0.1` únicamente. El acceso LAN multicaja (Semana 14) requerirá host configurable + TLS/autenticación reforzada.
- Las sesiones viven en memoria: se pierden al reiniciar la app (diseño local).
- El seed NO se ejecuta automáticamente en el primer arranque: una instalación nueva tiene BD vacía (sin roles ni admin) hasta que el SetupWizard (Semana 17) la inicialice. Hasta entonces, usar `npm run prisma:seed` en desarrollo.
- Entorno VS Code define `ELECTRON_RUN_AS_NODE=1`: para lanzar Electron desde su terminal hay que quitarla (`env -u ELECTRON_RUN_AS_NODE`), de lo contrario `electron.app` queda `undefined`.

**Verificación:** `tsc --noEmit` (3 tsconfig) ✅ 0 errores | `npx vitest run` ✅ 121/121 | Prueba manual: Electron real arrancó, migró una BD nueva, `GET /api/health` → `db: ok` y el cierre por ventana liberó puerto y archivos WAL (`[backend] cerrado`).

---

### Semana 5 — 2026-11-22 ✅ COMPLETADA
**Archivos creados/modificados:**
- `prisma/schema.prisma` + migración `20261122120000_ventas_secuencial_anulacion`: `PuntoEmision.secuencialVenta` (contador atómico), `Venta.numero` pasa de único global a único por punto de emisión (`@@unique([puntoEmisionId, numero])`), `Venta.fechaAnulacion` y `anuladaPorId`. La migración incluye un `RedefineTables` (valida el camino sin transacción de `MigrationService`).
- `src/server/services/ventaCalculo.util.ts` — funciones puras: `round2/round4`, `calcularLinea` (descuento por valor o %, IVA), `calcularTotales`, `distribuirPagos` (cambio solo desde efectivo), `calcularCostoPromedio`.
- `src/server/services/kardex.service.ts` + `repositories/kardex.repository.ts` — `registrarEntrada` (costo promedio ponderado, compare-and-swap con reintentos), `registrarSalida` (descuento atómico `stock >= cantidad`, al costo promedio vigente), `historial`. Operan sobre el cliente transaccional del llamador.
- `src/server/services/venta.service.ts` + `repositories/venta.repository.ts` — `crear` (una transacción: secuencial → turno abierto → productos/tarifas/cliente → cálculo → persistencia → lote + Kardex), `anular` (cambio de estado atómico + reversión con movimientos `DEVOLUCION` al costo original + reposición de lote), `obtener`. Todo acotado a la empresa del usuario.
- `src/server/controllers/venta.controller.ts`, rutas: `POST /api/ventas` (201), `POST /api/ventas/:id/anular`, `GET /api/ventas/:id` con permisos `ventas:crear|anular|leer`.
- `src/server/services/appError.util.ts` + `index.ts`: nuevos códigos `STOCK_INSUFICIENTE`, `TURNO_REQUERIDO`, `ESTADO_INVALIDO` (HTTP 409). `container.factory.ts`: servicios `kardex` y `ventas`.
- `src/shared/schemas/venta.schema.ts`: `puntoEmisionId` obligatorio en `VentaInputSchema` y nuevo `AnularVentaSchema` (motivo 5–300 caracteres).
- `src/server/config/database.config.ts`: `crearPrismaPara` usa una sola conexión (`connection_limit=1`, `pool_timeout=60`).
- Tests: `tests/unit/server/ventaCalculo.util.test.ts` (20), `tests/integration/server/{kardex.service (8), venta.service (29), ventas-api (7)}.test.ts`, helper `tests/integration/helpers/entorno.helper.ts`. `prisma-schema.test.ts` ahora migra su propia BD con `MigrationService` (ya no depende de `migrate deploy` manual).

**Reglas de negocio implementadas:**
- Número de venta `SSS-PPP-000000001` por punto de emisión; sin huecos: si la venta falla, el secuencial se revierte.
- IVA por línea: `tarifaImpuestoId` del producto si existe; si no, `aplicaIva` + `codigoIvaSRI` contra las tarifas vigentes de la empresa. Base = bruto − descuento.
- Pagos: suma ≥ total; el excedente es cambio y solo puede salir de pagos en efectivo (`PagoVenta.monto` = lo recibido, `cambio` en el pago en efectivo). Pago `CREDITO` exige cliente registrado.
- Regla mínima de caja: el cajero debe tener un `TurnoCaja` ABIERTO en la sucursal del punto de emisión (si no, `TURNO_REQUERIDO`). Apertura/cierre/arqueo → Semana 6.
- Productos `SERVICIO` no mueven stock ni Kardex. Lotes: se valida vigencia y cantidad y se descuenta del lote.
- No se anula una venta con factura `AUTORIZADA` (requerirá nota de crédito, Semana 9). `emitirFactura` del input se acepta pero aún no se procesa.

**Decisiones Técnicas:**
- Concurrencia SQLite: las pruebas de 20 ventas simultáneas y de sobreventa fallaron con varias conexiones (timeouts de bloqueo, una venta perdida). Solución: pool de UNA conexión; las transacciones se encolan. **Regla: dentro de `prisma.$transaction(async (tx) => …)` usar siempre `tx`; usar el cliente base ahí produce bloqueo.** La primera escritura de cada transacción es el incremento del secuencial.
- Stock decimal (granel) en `Float`; entradas se redondean a 4 decimales.
- `migrate dev` no es usable sin terminal interactiva cuando hay avisos; la migración se generó con `prisma migrate diff` y se aplicó con `migrate deploy`.
- Sin endpoints de compras/ajustes de inventario todavía: el stock se carga vía `KardexService.registrarEntrada` (Semana 7 lo expondrá en el módulo de inventario).
- El precio de venta de cada línea lo envía el cliente (sin validación contra el precio de catálogo); definir política/permiso de modificación de precio en la UI (Semana 15).

**Verificación:** `tsc --noEmit` (3 tsconfig) ✅ 0 errores | `npx vitest run` ✅ 185/185 (13 archivos).

---

### Semana 6 — 2026-11-22 ✅ COMPLETADA
**Archivos creados/modificados:**
- `prisma/schema.prisma` + migración `20261122180000_caja_compras_cartera`: modelos `Compra`, `LineaCompra`, `CuentaPorCobrar`, `PagoCuentaPorCobrar`, `CuentaPorPagar`, `PagoCuentaPorPagar`; `MovimientoCaja.categoria` (`MANUAL` | `ABONO_CXC` | `PAGO_CXP`) y `usuarioId`. (Incluye otro `RedefineTables`, aplicado por `MigrationService`.)
- Turnos: `turno.repository.ts`, `turno.service.ts`, `cuadreCaja.util.ts`, `turno.controller.ts`, `src/shared/schemas/turno.schema.ts`.
- Cartera: `cuentaPorCobrar.{repository,service}.ts`, `cuentaPorPagar.{repository,service}.ts`, `cuenta.controller.ts`, `src/shared/schemas/cuenta.schema.ts`.
- Compras: `compra.{repository,service}.ts`, `src/shared/schemas/compra.schema.ts`.
- `impuesto.util.ts` (resolución de IVA extraída de `venta.service.ts`, reutilizada por compras), `controllers/actor.util.ts` (actor de la sesión con permisos), `container.factory.ts` (turnos, compras, cuentas), `venta.service.ts` (genera/anula CxC), `appError.util.ts` + `index.ts` (códigos `LIMITE_CREDITO_EXCEDIDO` 409 y `SIN_PERMISO` 403).
- `producto.service.buscar`, `cliente.service.buscar` y `cuenta*.listar` ahora son `async` (antes lanzaban de forma síncrona si la validación fallaba).
- Tests nuevos: `cuadreCaja.util` (11), `turno.service` (14), `cartera-compras` (25), `caja-cartera-api` (9); `prisma-schema.test.ts` incluye los 6 modelos nuevos; `venta.service.test.ts` ajustado (el cliente a crédito ahora necesita `limiteCredito`).

**Endpoints nuevos** (todos requieren sesión Bearer):
| Ruta | Permiso |
|---|---|
| `POST /api/turnos/abrir`, `POST /api/turnos/:id/movimientos`, `POST /api/turnos/:id/cerrar` | `caja:crear` |
| `GET /api/turnos/actual`, `GET /api/turnos/:id/reporte` | `caja:leer` |
| `POST /api/compras`, `GET /api/compras/:id` | `inventario:crear` / `inventario:leer` |
| `GET /api/cuentas-por-cobrar[/:id]` | `clientes:leer` |
| `POST /api/cuentas-por-cobrar/:id/abonos` | `caja:crear` |
| `GET /api/cuentas-por-pagar[/:id]` | `proveedores:leer` |
| `POST /api/cuentas-por-pagar/:id/pagos` | `proveedores:actualizar` |

Filtros de listados: `estado`, `clienteId`/`proveedorId`, `vencidas=true|false`, `page`, `pageSize`.

**Reglas de negocio implementadas:**
- **Turno:** un solo turno ABIERTO por cajero y sucursal. Movimientos manuales con concepto obligatorio (≥3 caracteres); un EGRESO no puede superar el efectivo disponible.
- **Cuadre:** `esperado = apertura + efectivo recibido en ventas − cambio entregado + ingresos − egresos`; las ventas ANULADAS no cuentan. `diferencia = contado − esperado` (negativo = faltante).
- **Cierre ciego:** el cajero declara `efectivoContado` sin ver el esperado. Mientras el turno está abierto y quien consulta no es supervisor, el reporte devuelve `efectivo: null` y oculta la forma de pago EFECTIVO. Al cerrar, el reporte revela esperado, contado y diferencia. Cierres simultáneos: solo uno prospera.
- **Supervisor** = permiso `caja:actualizar` (constante `PERMISO_SUPERVISION`): ve el esperado en vivo y opera/cierra/ve turnos de otros cajeros; un cajero sobre un turno ajeno recibe `SIN_PERMISO` (403).
- **Crédito:** una venta con pago `CREDITO` crea una `CuentaPorCobrar` por el monto a crédito (vencimiento = fecha + `Cliente.diasCredito`). `limiteCredito` = 0 significa sin crédito autorizado; se valida `saldo pendiente + venta ≤ límite` (si falla, se revierte toda la venta). Un abono en EFECTIVO exige turno abierto en la sucursal de la venta y registra un INGRESO `ABONO_CXC` en esa caja; otras formas de pago no tocan la caja. Abonos protegidos contra concurrencia (compare-and-swap del saldo). Una venta a crédito con abonos no puede anularse; sin abonos su cuenta pasa a ANULADA.
- **Compras:** solo bienes; IVA según catálogo; factura única por proveedor; cada línea entra al Kardex como `COMPRA` (costo promedio ponderado, costo sin IVA). Compra a crédito → `CuentaPorPagar` (vencimiento = fecha + `diasCredito` o `Proveedor.diasPago`). Pago a proveedor en EFECTIVO sale de la caja (EGRESO `PAGO_CXP`) con validación de fondos.
- Todo está acotado por empresa (`sucursal.empresaId`).

**Decisiones Técnicas / Limitaciones conocidas:**
- Anular una venta cuyo turno ya está CERRADO no genera un egreso en el turno actual (el efectivo ya se cerró en el turno original): definir la política de devolución de efectivo en una próxima semana.
- Una compra de contado no genera egreso de caja automático (se asume pago fuera de caja); solo los pagos de CxP en efectivo lo hacen. No hay anulación de compras todavía.
- Las notas de crédito a clientes llegan con el motor SRI (Semanas 9–12).
- Los `Float` de saldos se redondean a 2 decimales en cada operación (`round2`) y se comparan por igualdad exacta en el compare-and-swap.
- Los servicios usan el patrón de la Semana 5: dentro de `$transaction` solo se usa el cliente `tx` (pool de una conexión).

**Verificación:** `tsc --noEmit` (3 tsconfig) ✅ 0 errores | `npx vitest run` ✅ 250/250 (17 archivos).

---

### Semana 7 — 2026-11-23 ✅ COMPLETADA
**Esquema (migración `20261123090000_retail_farmacia`):** `UnidadMedida.permiteDecimales` (KG, LB, L, M = true); modelos `PresentacionProducto` (factor, código de barras propio y único, precio opcional), `ListaPrecio` y `PrecioProducto`; `Cliente.listaPrecioId`; `LineaVenta.presentacionId`, `factorConversion` y `cantidadBase`. La migración incluye backfills (`cantidadBase = cantidad` en líneas previas y unidades fraccionables) y reconstruye tres tablas; verificada con una prueba que actualiza una BD con datos reales.

**Archivos creados/modificados:**
- Utilidades puras: `inventario.util.ts` (conversión a unidades base, validación de cantidades, precio por lista/presentación, `asignarFefo`, `repartirProporcional`, vencimientos).
- Servicios nuevos: `giro.service.ts` (feature flags), `presentacion.service.ts`, `listaPrecio.service.ts`, `lote.service.ts`, `inventario.service.ts` (catálogo con flags, ajustes, Kardex, alertas). Repositorios: `configuracion`, `presentacion` (incluye `codigoBarrasEnUso`), `listaPrecio`, `lote`.
- `venta.service.ts` reescrito: resuelve presentación, cantidad en unidades base, precio y lotes FEFO; `compra.service.ts` (lotes en compras); `producto.service.ts` (código de barras único entre productos y presentaciones, categoría/unidad existentes, `porCodigoBarras` reconoce presentaciones); `container.factory.ts`.
- API: `inventario.controller.ts` + rutas (ver tabla). Esquemas Zod: `inventario.schema.ts`; `venta.schema` (precio opcional, `presentacionId`), `compra.schema` (lote por línea), `producto.schema` (principio activo, concentración, forma farmacéutica).
- Nuevo código de error `MODULO_DESHABILITADO` (HTTP 403).
- Tests: `inventario.util` (23), `retail` (26), `farmacia` (24), `inventario-api` (12) + 1 de actualización de BD con datos en `migration.service.test.ts`; `prisma-schema.test.ts` incluye los 3 modelos nuevos; helper con unidades, flags y lotes.

**Endpoints nuevos** (sesión Bearer):
| Ruta | Permiso |
|---|---|
| `POST /api/productos`, `POST /api/productos/:id/presentaciones`, `POST /api/listas-precio`, `POST /api/inventario/lotes` | `inventario:crear` |
| `PATCH /api/productos/:id`, `PATCH /api/presentaciones/:id`, `PATCH /api/listas-precio/:id`, `PUT /api/listas-precio/:id/precios`, `DELETE /api/listas-precio/:id/precios/:precioId`, `PATCH /api/inventario/lotes/:id`, `POST /api/inventario/ajustes` | `inventario:actualizar` |
| `GET /api/productos/:id/presentaciones`, `GET /api/listas-precio[/:id/precios]`, `GET /api/inventario/lotes[/:id]`, `GET /api/inventario/productos/:id/kardex`, `GET /api/inventario/alertas-vencimiento?dias=`, `GET /api/inventario/alertas-stock` | `inventario:leer` |
| `PUT /api/clientes/:id/lista-precio` (`{ listaPrecioId \| null }`) | `clientes:actualizar` |
`GET /api/productos/barcode/:codigo` ahora también reconoce códigos de presentaciones (la respuesta agrega `presentacion`).

**Reglas de negocio implementadas:**
- **Presentaciones:** `factor` = unidades base que contiene. Se venden siempre completas (cantidad entera). Stock y Kardex siempre en unidad base; `LineaVenta.costoUnitario` es por unidad base y `cantidadBase` guarda lo descontado (la anulación lo revierte exactamente).
- **Fraccionamiento:** solo unidades con `permiteDecimales` (hasta 4 decimales); las demás exigen enteros.
- **Precio:** el servidor lo resuelve (cliente con lista activa: precio de presentación en lista → precio base de lista × factor; si no, presentación del catálogo → base × factor → catálogo). `precioUnitario` en la línea es opcional: **si difiere del resuelto exige el permiso `ventas:actualizar`** (supervisor/admin); un actor sin lista de permisos nunca puede modificarlo. Cierra el pendiente de política de precios de la Semana 5. Los descuentos siguen sin restricción por permiso.
- **Listas de precios:** por empresa, nombre único; el precio por presentación es opcional; una lista inactiva no se aplica ni puede asignarse a clientes.
- **Lotes / FEFO:** si el producto exige lote y la línea no indica uno, se reparte entre los lotes vigentes (ACTIVO, no vencidos, con existencia) por fecha de vencimiento (empate: el más antiguo), generando una línea por lote; el descuento por valor se prorratea exacto y el porcentual se mantiene. Un lote explícito se respeta. Vencidos y bloqueados nunca se usan. Con presentación, el reparto puede producir cantidades fraccionarias de la presentación (p. ej. 1,5 + 0,5 cajas).
- **Lotes y compras:** un producto con `requiereLote` exige número y vencimiento en la compra (crea o repone el lote, ligado al proveedor); un lote ya vencido, bloqueado o con otra fecha se rechaza. El alta manual de un lote es una entrada de inventario `AJUSTE_ENTRADA`.
- **Ajustes:** motivo obligatorio (≥5 caracteres); la ENTRADA exige costo (y lote si corresponde); la SALIDA de un producto con lote indica de cuál descontar.
- **Alertas:** vencimiento (`dias` 0–365, por defecto 30) devuelve lotes vencidos y por vencer con `diasRestantes`; stock mínimo lista bienes activos con stock ≤ mínimo.
- **Feature flags (`ConfiguracionGiro`):** `moduloListasPrecios` gobierna las listas (y su aplicación en ventas), `moduloLotes` los lotes/`requiereLote`, `moduloVencimientos` las alertas y `tieneVencimiento`. Sin configuración, todos están deshabilitados. El seed RETAIL_GENERAL activa solo listas de precios: para Farmacia hay que activar lotes y vencimientos.

**Decisiones Técnicas / Limitaciones conocidas:**
- Las compras se registran en unidades base (no por presentación).
- `requiereLote` no puede cambiarse con existencias (hay que dejar el stock en cero y volver a ingresarlo con lotes).
- Una venta con lotes explícitos y FEFO del mismo producto en una misma venta puede fallar por stock en el momento de descontar (se revierte completa).
- El catálogo (`Producto`, `Categoria`, `UnidadMedida`) es global, no por empresa; los permisos de flags usan la empresa del usuario.
- No hay aún endpoints de CRUD de categorías, unidades de medida ni proveedores.

**Verificación:** `tsc --noEmit` (3 tsconfig) ✅ 0 errores | `npx vitest run` ✅ 339/339 (21 archivos) | `npm run prisma:seed` ✅.

---

### Semana 8 — 2026-11-24 ✅ COMPLETADA (cierra el MES 2)
**Esquema (migración `20261124090000_restaurante`):** `Producto.destinoPreparacion` (COCINA|BARRA); `Sucursal.secuencialComanda`; `Mesa.status`; `Comanda` (reescrita: `sucursalId`, `numero` consecutivo por sucursal, `comensales`, `estado` ABIERTA|CERRADA|ANULADA|UNIDA, `divisionPartes`, `motivoAnulacion`, `fechaCierre`); `ItemComanda` (`destino`, `envio`, `enviadoAt`, `motivoCancelacion`, `cobrado`, `ventaId`); nuevo `CobroComanda` (cada venta de una cuenta: modo ITEMS | PARTE_IGUAL, nº de parte); `Venta.propina`. Reconstruye tablas con datos (aplicada sobre la BD de desarrollo y cubierta por la prueba de actualización con datos).

**Archivos creados/modificados:**
- `comanda.util.ts` (transiciones de ítems, división de cantidades y montos, líneas de cobro), `mesa.service.ts`, `comanda.service.ts` y repositorios `mesa`/`comanda`; `restaurante.controller.ts` + rutas; `restaurante.schema.ts`.
- `venta.service.ts`: nuevo `crearEnTx(tx, …, { desdeComanda })` (el cobro de una cuenta se compone con el cierre de la mesa en **una** transacción; con el pool de una conexión no se pueden anidar), y `propina` en `crear`.
- RBAC: nuevo módulo `restaurante` (6 acciones → 60 permisos en total) y roles **MESERO** y **COCINA**; CAJERO recibe `restaurante:leer|crear|actualizar`. `GiroService`: flags `moduloMesas` y `moduloComandasCocina`.
- `vitest.config.ts`: `testTimeout` 30 s, `hookTimeout` 60 s y máx. 6 procesos (ver Decisiones).
- Tests nuevos: `comanda.util` (11), `restaurante` (34), `restaurante-api` (14), **suite del núcleo** `nucleo-pos` (12) con `helpers/invariantes.helper.ts`, **matriz RBAC** `rbac-matriz` (23). `seed-services` ajustado a 60 permisos.

**Endpoints nuevos:**
| Ruta | Permiso |
|---|---|
| `POST /api/mesas`, `PATCH /api/mesas/:id` (plano de mesas) | `configuracion:actualizar` (solo ADMIN) |
| `GET /api/mesas`, `GET /api/comandas[/:id]`, `GET /api/comandas/:id/pre-cuenta?partes=`, `GET /api/cocina/pendientes?destino=&estado=` | `restaurante:leer` |
| `POST /api/comandas` (abrir), `POST /api/comandas/:id/items` | `restaurante:crear` |
| `POST /api/mesas/:id/estado`, `…/items/:itemId/cancelar`, `…/items/:itemId/estado`, `…/enviar`, `…/mover`, `…/unir` | `restaurante:actualizar` |
| `POST /api/comandas/:id/cobrar` | `ventas:crear` (+ `restaurante:actualizar` en el servicio) |
| `POST /api/comandas/:id/anular` | `restaurante:anular` (supervisor) |

**Reglas de negocio implementadas:**
- **Cuentas:** una sola comanda ABIERTA por mesa (también bajo concurrencia); abrirla ocupa la mesa; numeración consecutiva por sucursal sin huecos. Los ítems fijan precio y destino al pedir; el IVA y el stock se resuelven al cobrar.
- **Cocina/barra:** `enviar` pasa los pendientes a EN_PREPARACION y devuelve el ticket agrupado por destino y numerado por envío; `PENDIENTE → EN_PREPARACION → LISTO → ENTREGADO`, sin saltos ni retrocesos. Sin `moduloComandasCocina` no hay envío y un pendiente pasa directo a ENTREGADO.
- **Cancelaciones:** un ítem pendiente se quita libremente; uno ya enviado exige `restaurante:anular` y motivo ≥5 caracteres. Anular una cuenta exige `restaurante:anular`, no puede tener cobros y deja la mesa libre.
- **Mover / unir:** mover a una mesa libre de la misma sucursal; unir traslada los ítems a otra cuenta abierta (la origen queda UNIDA).
- **Cobro por ítems:** cada cobro es una `Venta` independiente a los precios pactados (no necesita permiso de precio); tras un cobro parcial se puede seguir pidiendo; la cuenta se cierra y la mesa se libera al cobrar el último ítem.
- **Partes iguales:** N ventas, cada una con la fracción de cada ítem (la última absorbe el resto: el stock total descontado es exacto); congela el contenido de la cuenta y no se mezcla con el cobro por ítems. La pre-cuenta simula las partes (los centavos pueden diferir por redondeo por línea).
- **Propina:** `propina` ≥ 0 en ventas y cobros: **no lleva IVA**, se suma al valor a pagar (los pagos deben cubrir total + propina) y su efectivo entra al arqueo del turno. Se guarda en `Venta.propina`; en la Semana 9 se mapea al campo `propina` de la factura electrónica (verificar con la ficha técnica vigente del SRI).
- Todo cobro falla sin dejar rastro (stock insuficiente, sin turno, punto de emisión de otra sucursal, sin permiso): la cuenta sigue abierta, sin ítems cobrados ni divisiones a medias, y el secuencial no se consume.

**Suite de integración del núcleo POS (`nucleo-pos.test.ts`):** escenarios extremo a extremo por giro (Retail, Farmacia, Restaurante) + concurrencia mixta (~90 operaciones simultáneas: ventas con sobreventa imposible, anulaciones duplicadas, abonos, compras, ajustes, movimientos de caja) + una **meta-prueba** que corrompe datos a propósito y comprueba que el verificador lo detecta. `verificarInvariantes` comprueba: stock = cadena de Kardex; stock = suma de lotes; lotes 0 ≤ actual ≤ inicial; secuenciales de venta y de comanda sin huecos ni duplicados; cada venta cuadra (subtotal/IVA/total = líneas; pagos netos = total + propina; cambio solo en efectivo); Kardex coherente con cada venta y su anulación; cuadre de caja (esperado recalculado = sistema; arqueo guardado coherente); cartera (saldo = total − pagos, estados); mesas (OCUPADA ⇔ cuenta abierta; una cuenta abierta por mesa; cuentas cerradas sin ítems por cobrar).

**Matriz RBAC (`rbac-matriz.test.ts`):** una tabla con las 69 rutas × 7 roles. Falla si se añade una ruta sin cubrir (compara contra las rutas realmente registradas mediante un hook `onRoute`), si cambia un permiso de rol (están fijados a mano) o si alguna ruta responde 401/403/5xx donde no corresponde. **Al añadir una ruta nueva hay que agregarla a `RUTAS` en ese archivo.**

**Decisiones Técnicas / Limitaciones conocidas:**
- **Suite intermitente por CPU:** la primera corrida tras compilar tardó 92 s y 5 pruebas superaron el límite de 5 s; la siguiente pasó completa. Causa: ~11 procesos simultáneos, cada uno con su motor de Prisma. Solución: `testTimeout` 30 s, `hookTimeout` 60 s y `maxForks` 6; 3 corridas consecutivas 434/434 (34–62 s según la carga de la máquina).
- La unicidad "una cuenta ABIERTA por mesa" se garantiza en el servicio (válido con el pool de una conexión de SQLite). Para el modo Multicaja con PostgreSQL (Semana 14) hay que añadir un índice único parcial (`WHERE estado = 'ABIERTA'`); Prisma no lo expresa en el esquema, por lo que irá como SQL manual en la migración (y `migrate diff` deberá ignorarlo).
- Un plato `BIEN` sin stock puede pedirse y falla al cobrarse (no se valida disponibilidad al pedir; no hay recetas/insumos).
- El cobro en partes iguales usa cantidades fraccionarias aunque la unidad no lo permita (solo vía comanda, no por HTTP directo a `/api/ventas`).
- Siguen vigentes las limitaciones de la Semana 6 (anular una venta de un turno ya cerrado no genera egreso en el turno actual; sin anulación de compras).

**Verificación:** `tsc --noEmit` (3 tsconfig) ✅ 0 errores | `npx vitest run` ✅ 434/434 (26 archivos), 3 corridas consecutivas.

---

### Semana 9 — 2026-11-23 ✅ COMPLETADA
**Fuentes oficiales usadas:** XSD de Factura (V2.1.0) y Nota de Crédito (V1.1.0) descargados del portal del SRI y la *Ficha Técnica de Comprobantes Electrónicos — Esquema Offline v2.34* (ver `src/server/services/sri/xsd/ORIGEN.md`). Los XSD **no se escribieron a mano**. Nota: en el SRI no existe un XML "v2.30"; las versiones vigentes de los esquemas son factura **2.1.0** y nota de crédito **1.1.0**.

**⚠️ Corrección importante de la Semana 1 — códigos de IVA.** Las constantes del proyecto usaban `"2"` para 15 % y `"3"` para 5 %, pero la **Tabla 17 oficial** es: `0` = 0 %, `2` = 12 %, `3` = 14 %, `4` = **15 %**, `5` = **5 %**, `6` = no objeto, `7` = exento (`8` = IVA diferenciado por decreto, `10` = 13 %). Con los códigos anteriores las facturas habrían salido con `codigoPorcentaje` erróneo. Corregido en constantes, esquema Zod (`codigoIvaSRI` por defecto `"4"`), seed (12 % y 14 % quedan como históricas no vigentes) y pruebas. La migración renombra los datos existentes (`2→4`, `3→5`) y retira los códigos `8/9/10` que no existen en la tabla oficial (se desvinculan de los productos).

**Esquema (migración `20261125090000_comprobantes_sri`):** `Empresa.contribuyenteEspecial`; `Producto.codigoIvaSRI` por defecto `"4"`; `LineaVenta.codigoIvaSRI` (código aplicado, necesario porque un 0 % puede ser código 0, 6 o 7); `ComprobanteElectronico.xmlGenerado` (XML sin firmar), `motivo` y `comprobanteOrigenId` (nota de crédito → factura que modifica); nuevo `SecuencialComprobante` (último secuencial por punto de emisión y tipo de comprobante). Incluye los `UPDATE` de datos del código de IVA.

**Archivos creados/modificados** (todo en `src/server/services/sri/` salvo indicación):
- `claveAcceso.util.ts` — Clave de Acceso de 49 dígitos (Tabla 1): `generarClaveAcceso`, `parsearClaveAcceso`, `validarClaveAcceso`, Módulo 11 (ponderadores 2–7 desde la derecha; 11 → 0 y 10 → 1), código numérico aleatorio.
- `fechaEcuador.util.ts` — fechas civiles de Ecuador (UTC−5): una venta a las 21:30 locales no se fecha como "mañana".
- `xmlTexto.util.ts` — saneamiento de texto (saltos de línea, caracteres de control, longitudes máximas del XSD) y formato numérico (2 decimales; 6 en cantidad y precio unitario).
- `comprobante.types.ts`, `comprobanteXml.builder.ts` — constructores puros de **Factura 2.1.0** y **Nota de Crédito 1.1.0** (orden de nodos y formatos del XSD).
- `xsdValidator.service.ts` — validación contra los XSD oficiales con `xmllint-wasm` (WebAssembly, sin compilación nativa); errores con el elemento afectado; filtra el ruido de libxml2 (el XSD de nota de crédito declara XML 1.1).
- `comprobanteMapper.ts` — venta → datos del comprobante (comprador, emisor, líneas, pagos netos, información adicional) y reglas de la ficha.
- `comprobante.service.ts` + `repositories/comprobante.repository.ts` + `controllers/comprobante.controller.ts` — emisión, consulta y rutas.
- `impuesto.util.ts` (`resolverTarifaIva` devuelve código + porcentaje), `venta.service.ts` (emisión opcional y anulación según estado), `comanda.service.ts`/`restaurante.schema.ts` (`emitirFactura` al cobrar), `shared/schemas/comprobante.schema.ts`, `empresa.schema.ts` (contribuyente especial), `giro.service.ts` (flag `emitirFacturas`).
- `package.json`: `build:main` ahora copia la carpeta `xsd/` a `dist-electron/` (verificado: el código compilado valida por sí solo). Dependencia nueva: `xmllint-wasm`.
- Tests nuevos: `tests/unit/server/sri/` — `claveAcceso` (17), `comprobanteXml` (18), `mapeoSri` (9); `tests/integration/server/comprobantes.test.ts` (27). `invariantes.helper.ts` ahora verifica también los comprobantes; la matriz RBAC cubre las 3 rutas nuevas (72 rutas).

**Endpoints nuevos:**
| Ruta | Permiso |
|---|---|
| `GET /api/comprobantes` (filtros `estado`, `tipoComprobante`, paginación; sin XML) | `sri:leer` |
| `GET /api/comprobantes/:id` (incluye `xmlGenerado`, cola y factura de origen) | `sri:leer` |
| `POST /api/ventas/:id/comprobante` — genera o reintenta la factura (201 al crearla; 200 si ya existía); acepta `{ clienteId }` para asignar el comprador | `sri:crear` (ADMIN y SUPERVISOR) |
`POST /api/ventas` y `POST /api/comandas/:id/cobrar` aceptan `emitirFactura: true` y devuelven `advertencias: string[]`.

**Reglas implementadas:**
- **Factura al vender:** con `emitirFactura` y el módulo `emitirFacturas` activo se genera la factura (PENDIENTE) con su registro en `ColaSRI`, dentro de la misma transacción de la venta. **Nunca bloquea la venta**: todo lo que puede fallar (reglas de la ficha, clave de acceso, XML y validación XSD) se resuelve antes de escribir, de modo que un error solo produce una advertencia y la venta queda registrada sin factura (sin consumir secuencial). Se puede reintentar con `POST /api/ventas/:id/comprobante`; la operación es idempotente.
- **Reglas de la Ficha Técnica:** factura a Consumidor Final solo hasta **USD 50** (9.10); propina ≤ **10 %** del subtotal (9.16); la nota de crédito exige identificar al comprador (5.7).
- **XML:** comprador por cédula (05), RUC (04), pasaporte (06), consumidor final (07) o exterior (08); líneas con su código de IVA y los totales agrupados por código; pagos **netos** (sin el cambio) unidos por forma de pago (Tabla 24: efectivo y crédito → 01 con plazo en días, tarjeta de crédito → 19, débito → 16, transferencia/cheque/otros → 20); propina fuera de la base del IVA e incluida en el importe total; RIMPE → leyenda `CONTRIBUYENTE RÉGIMEN RIMPE`; contribuyente especial y agente de retención cuando aplican; hasta 15 campos adicionales (venta, correo, teléfono, observaciones); fecha y hora civil de Ecuador.
- **Secuenciales:** consecutivos por (punto de emisión, tipo), independientes entre facturas (01) y notas de crédito (04); solo los consume una emisión exitosa. Ambiente 1 (pruebas) / 2 (producción) según la empresa; la nota de crédito hereda el de la factura que modifica.
- **Anulación de una venta facturada:** factura PENDIENTE, RECHAZADA o DEVUELTA → se anula localmente y sale de la cola; EN_PROCESO → se rechaza (hay que esperar la respuesta del SRI); AUTORIZADA → se emite una **nota de crédito por el total** (PENDIENTE, en cola) y la factura se conserva; si la factura fue a Consumidor Final no puede anularse automáticamente (la nota de crédito exige identificar al comprador) y no cambia nada. Resuelve la restricción de la Semana 5.

**Limitaciones conocidas / decisiones:**
- Falta la **firma digital** (Semana 10) y el **envío/autorización** (Semana 11): los comprobantes quedan PENDIENTE con `xmlGenerado`; `xmlFirmado` y `xmlAutorizado` aún son nulos.
- Solo notas de crédito por el **total**; sin devoluciones parciales, sin notas de débito. Sin ICE, IRBPNR, reembolsos, exportaciones, subsidios ni IVA diferenciado (código 8).
- La fecha de emisión es la del momento de generar el comprobante (la ficha exige emisión cronológica y secuencial, 9.18).
- El monto máximo para Consumidor Final (USD 50) figura en el texto de la ficha v2.34, pero un historial de la misma ficha indica que el SRI lo actualizó en 2023: **verificar el valor vigente** antes de producción (constante `MONTO_MAXIMO_CONSUMIDOR_FINAL`).
- La leyenda RIMPE se emite igual para Emprendedor y Negocio Popular: el XSD 2.1.0 solo admite ese texto.
- **Auditoría independiente:** en la raíz hay `REVIEWER_AGENT.md` (protocolo del agente auditor, preexistente) y `AUDIT_REPORT.md` (su informe). El informe actual describe el estado **a medias** de esta semana (451 pruebas, sin la integración con ventas): sus tres defectos bloqueantes (`emitirFactura` ignorado, falta de prueba de integración y rutas sin cubrir en la matriz RBAC) quedaron resueltos en esta entrega, y se aplicaron sus recomendaciones 3.1 (`sri/index.ts`) y 3.2 (constantes `VERSION_XML_COMPROBANTE` y `VERSION_FICHA_TECNICA_SRI`). **Hace falta volver a ejecutar la auditoría** para que el informe refleje el estado actual. Ambos archivos quedan fuera de este commit (no son del agente constructor).
- Intermitencia de la suite bajo carga: la máquina de desarrollo comparte CPU con otros proyectos (`tsc --watch`, `vite`, etc.). Una vez, la prueba de concurrencia mixta falló con errores que no eran de dominio y no se pudo reproducir (4 corridas completas posteriores, 3 seguidas con 505/505). Si reaparece, capturar el mensaje de `inesperados` en `nucleo-pos.test.ts`.

**Verificación:** `tsc --noEmit` (3 tsconfig) ✅ 0 errores | `npx vitest run` ✅ 505/505 (30 archivos), 3 corridas consecutivas | `npm run build:main` ✅ (copia los XSD) | el código compilado valida contra los XSD.

### Semana 10 — 2026-11-23 ✅ COMPLETADA
**Fuente oficial:** *Ficha Técnica de Comprobantes Electrónicos — Esquema Offline v2.34*, sección 6 (firma electrónica) y **Anexo 14** (estructura XAdES-BES). Los algoritmos no se asumieron: se fijaron de la ficha.

**Algoritmos (ficha):** firma **enveloped** XAdES-BES (esquema 1.3.2) · canonicalización **C14N 1.0 inclusiva** · **RSA-SHA1** con resumen **SHA-1** · clave RSA **≥ 2048 bits** · certificado en PKCS#12. La firma cubre tres referencias: `#comprobante` (transformación enveloped), las `SignedProperties` de XAdES y el `KeyInfo` con el certificado. `SigningTime` lleva la hora de Ecuador (`-05:00`) y el emisor va en formato RFC 2253 como en el ejemplo oficial.

**Esquema (migración `20261126090000_certificado_firma`):** `ConfiguracionGiro` gana `certTitular`, `certEmisor` y `certHuella` (informativos). Los campos `rutaCertificadoP12`, `certPasswordEncriptado`, `certIv`, `certTag` y `certVencimiento` ya existían.

**Archivos** (en `src/server/services/sri/` salvo indicación):
- `firma/cifrado.util.ts` — **AES-256-GCM**: IV aleatorio de 12 bytes, tag de 16, clave derivada con **HKDF-SHA256** de la clave maestra y **AAD** que enlaza el secreto a su empresa (un secreto copiado a otra fila no se descifra). Cualquier fallo (texto, IV, tag, AAD o clave) produce el mismo error genérico.
- `firma/claveMaestra.provider.ts` — clave maestra de 32 bytes: variable de entorno `VENDEYA_CLAVE_MAESTRA` (servidores) o archivo `master.key` en la carpeta de secretos, **fuera de la BD y del repositorio**; en Electron se envuelve con `safeStorage` (DPAPI/Keychain). Escritura atómica y permisos 0600. **Rotación en dos fases** (`master.key.nueva`): un corte a mitad nunca deja secretos inaccesibles.
- `firma/pkcs12.util.ts` — lectura de `.p12` con `node-forge` (soporta el cifrado clásico RC2/3DES de las entidades ecuatorianas y AES-256); empareja la clave privada con **su** certificado aunque el archivo traiga la cadena; contraseña incorrecta y archivo dañado dan el mismo error. `validarCertificadoParaEmisor`: clave ≥ 2048, vigencia, RUC (o cédula del titular) presente; aviso a ≤ 30 días del vencimiento.
- `firma/xades.firma.ts` — `firmarXmlXades` y `verificarFirmaXades`. Estructura XAdES armada según el Anexo 14 con el canonicalizador de xml-crypto (su `SignedXml` no puede firmar referencias a nodos dentro de la propia firma). El verificador exige los algoritmos de la ficha, las 3 referencias, Id únicos, que `#comprobante` sea la **raíz** (defensa contra *signature wrapping*), la transformación enveloped, los tres resúmenes, la firma RSA con el certificado de `KeyInfo` y que `SigningCertificate` corresponda a ese certificado. El analizador XML rechaza también las advertencias de xmldom (etiquetas sin cerrar).
- `certificado.service.ts` — `guardar` (valida, cifra, guarda `<empresaId>-<huella8>.p12` de forma atómica, borra el anterior), `informacion`, `eliminar`, `obtenerMaterial` (descifra, comprueba que el archivo corresponda a la huella registrada y que no esté vencido) y `rotarClaveMaestra` (re-cifra todo en una transacción; se recupera sola si hubo un corte).
- `firma.service.ts` — `firmarComprobante`: solo PENDIENTE/RECHAZADO/DEVUELTO; firma el `xmlGenerado`, **autoverifica**, valida el firmado contra el **XSD oficial** y guarda `xmlFirmado` con escritura condicional al estado. El estado **no cambia** (sigue PENDIENTE) y la cola no se toca.
- `shared/schemas/certificado.schema.ts`, `controllers/certificado.controller.ts`, `repositories/configuracion.repository.ts` y `comprobante.repository.ts` (`guardarXmlFirmado`), `container.factory.ts` (`crearServicios(prisma, { directorioSecretos, proteccionClave }, sesiones)`), `server/index.ts` (`directorioSecretos`, `proteccionClave`; por defecto `<carpeta de la BD>/secretos`), `electron/main.ts` (carpeta `userData/secretos` + `safeStorage`), `fechaEcuador.util.ts` (`fechaHoraIsoEcuador`).
- Dependencias nuevas: `xml-crypto` (canonicalización y verificación independiente en pruebas) y `@xmldom/xmldom`.

**Endpoints nuevos:**
| Ruta | Permiso |
|---|---|
| `PUT /api/configuracion/certificado` — `{ archivoBase64, password, confirmarTitular? }` | `configuracion:actualizar` (solo ADMIN) |
| `GET /api/configuracion/certificado` — titular, emisor, huella, vencimiento, días restantes, advertencia | `configuracion:leer` (solo ADMIN) |
| `DELETE /api/configuracion/certificado` (204; borra el archivo) | `configuracion:actualizar` |
| `POST /api/configuracion/certificado/rotar-clave` | `configuracion:actualizar` |
| `POST /api/comprobantes/:id/firmar` — firma o re-firma | `sri:crear` (ADMIN y SUPERVISOR) |

Las respuestas nunca incluyen la contraseña, la clave privada, la ruta del archivo ni datos de la clave maestra (hay pruebas que lo verifican).

**Reglas y decisiones:**
- **Titular:** un certificado que declara **otro** RUC/cédula nunca se acepta, ni siquiera con `confirmarTitular`; la confirmación solo cubre certificados que no declaran ninguno. La identificación se detecta buscando cadenas de 10/13 dígitos en el sujeto y en las extensiones (heurística: cada entidad certificadora la coloca en un OID distinto).
- **Dos piezas separadas:** quien copie solo la BD no obtiene ni el `.p12` ni la clave; quien copie solo la carpeta de certificados no obtiene la contraseña.
- La clave maestra del entorno no se puede rotar desde la aplicación (409).

**Pruebas nuevas (68):** `tests/unit/server/sri/firma/` — `xades` (22: estructura del Anexo 14, hora y emisor, determinismo, XSD de factura y nota de crédito, verificación con el verificador independiente de **xml-crypto**, alteración de importe/comprador/cantidad/SigningTime/certificado/SignatureValue/algoritmos, firma eliminada o duplicada, *signature wrapping*, Id duplicado, XML mal formado, 3DES y AES-256), `cifrado` (11: ida y vuelta, manipular tag/IV/texto, AAD, clave distinta, proveedor de clave, rotación en dos fases) y `validacionCertificado` (8); `tests/integration/server/firma-certificado.test.ts` (27: carga, rechazos sin efectos secundarios, firma de factura y nota de crédito, re-firma, estados, certificado vencido al firmar, manipulación de la BD y del archivo, ruta fuera de la carpeta, secreto trasladado a otra empresa, rotación con recuperación de cortes, API y RBAC). Los `.p12` se generan en cada prueba (`tests/helpers/certificados.helper.ts`); no hay ningún certificado en el repositorio (`.gitignore` ya excluye `*.p12`). La matriz RBAC cubre las 5 rutas nuevas (77 rutas).

**Limitaciones conocidas:**
- La firma se verificó con nuestro verificador y con **xml-crypto**, pero **no contra el validador del SRI**: la confirmación real llega con el ambiente de pruebas (`celcer`) en la Semana 11. Si el SRI rechazara la firma, los puntos a revisar son la canonicalización en contexto y el orden de los nodos de `KeyInfo`.
- No se valida la cadena de confianza ni la revocación del certificado (el SRI lo hace del lado servidor).
- La identificación del titular es heurística; sin soporte para certificados en token/tarjeta (solo `.p12`). Un único certificado por empresa.
- `AUDIT_REPORT.md` sigue obsoleto (describe la Semana 9): hay que volver a ejecutar la auditoría; ambos archivos de auditoría quedan fuera del commit.

**Verificación:** `tsc --noEmit` (3 tsconfig) ✅ 0 errores | `npx vitest run` ✅ 573/573 (34 archivos).

### Semana 11 — 2026-11-23 ✅ COMPLETADA
**Fuentes:** *Ficha Técnica de Comprobantes Electrónicos — Esquema Offline v2.34* (servicios `RecepcionComprobantesOffline` y `AutorizacionComprobantesOffline`). ⚠️ El texto de la ficha **no estaba disponible** en esta sesión (la búsqueda web no devolvió el documento): los estados y códigos de mensaje se tomaron del comportamiento publicado de los servicios y están aislados en constantes para poder corregirse. **Verificar contra la ficha y contra `celcer` antes de producción** (ver limitaciones).

**Contrato implementado:**
- Recepción `validarComprobante` (XML firmado en base64) → `RECIBIDA` o `DEVUELTA` con mensajes (`identificador`, `mensaje`, `informacionAdicional`, `tipo`).
- Autorización `autorizacionComprobante` (por clave de acceso) → lista de autorizaciones: `AUTORIZADO` (número, fecha, ambiente, comprobante), `NO AUTORIZADO` (mensajes), `EN PROCESAMIENTO` o lista vacía.
- Identificadores con significado propio: **43** (clave de acceso registrada → no es un rechazo: se consulta la autorización) y **70** (en procesamiento → se reintenta). Cualquier otra `DEVUELTA` es definitiva (DEVUELTO).
- URL de **Pruebas** (`celcer`) y **Producción** (`cel`) según el ambiente del comprobante (`ambiente` 1/2); las URL oficiales siguen en `shared/constants/sri.constants.ts`.

**Archivos:**
- `src/server/services/sri/ws/sriSoap.types.ts` — contrato (`ClienteSri`, respuestas, mensajes) y `SriTransporteError` (todo fallo de comunicación: **siempre reintentable, nunca un rechazo**).
- `ws/sriSoap.client.ts` — `SriSoapClient`: sobre SOAP 1.1 armado a mano sobre `http`/`https` (no depende de descargar el WSDL con Internet inestable), timeout configurable (30 s), tope de 8 MB, SOAP Fault/HTTP ≠ 2xx/XML ininteligible → `SriTransporteError`. Endpoints sustituibles para pruebas.
- `services/sri/envioSri.service.ts` — `EnvioSriService`: firma si falta, toma el comprobante (PENDIENTE → EN_PROCESO, atómico), envía, consulta, y guarda `xmlAutorizado` (`<autorizacion>` con el comprobante en CDATA), `numeroAutorizacion`, `fechaAutorizacion` y `mensajesRespuesta`; `reintentar`, `estadoCola`, `recuperarEnProceso`. **Backoff exponencial** 30 s → 1 min → 2 min … tope 30 min; nunca se abandona un comprobante (offline-first).
- `repositories/colaSri.repository.ts` — cola ordenada por prioridad y **fecha de emisión (cronológico, ficha 9.18)**, reclamo atómico, liberación, cierre de estado, recuperación, estado.
- `src/server/jobs/sriWorker.job.ts` — `SriWorker`: ciclo cada 15 s (inmediato si hubo trabajo), de uno en uno; al arrancar libera lo que quedó EN_PROCESO; durante la operación libera lo abandonado hace más de 10 min; `despertar()` ante un reintento manual; `detener()` espera el envío en curso; los errores inesperados se informan sin matar el worker.
- Integración: `server/index.ts` (`sri`, `sriWorker`; `BackendHandle.worker`, se detiene en `close`), `container.factory.ts` (`OpcionesServicios.sri`, `servicios.envioSri`), `electron/main.ts` (worker activo; `SRI_WORKER=off` lo desactiva), `comprobante.controller.ts`, `routes/index.ts`. **El worker está desactivado por defecto**: solo arranca si se pide (las pruebas nunca llaman al SRI real).

**Endpoints nuevos:**
| Ruta | Permiso |
|---|---|
| `GET /api/sri/cola` — conteo por estado y comprobantes en cola (intentos, último error, próximo intento; sin XML) | `sri:leer` |
| `POST /api/comprobantes/:id/reintentar` — deja PENDIENTE y sin espera (RECHAZADO/DEVUELTO descartan la firma para re-firmar) | `sri:crear` (ADMIN y SUPERVISOR) |

**Reglas:**
- **No bloquea ventas:** el worker corre aparte, sin transacciones abiertas durante las llamadas de red; hay una prueba con un SRI que no responde mientras se siguen emitiendo facturas.
- **Sin certificado / vencido:** el comprobante queda PENDIENTE con el motivo en `ultimoError` y se reintenta con backoff; al cargar un certificado nuevo, `reintentar` evita la espera.
- **Idempotencia:** un comprobante AUTORIZADO/ANULADO/fuera de cola nunca se reenvía; dos procesos sobre el mismo comprobante → solo uno lo envía (reclamo atómico).
- **Recuperación:** un cierre a mitad de un envío deja EN_PROCESO; al arrancar se libera y, si el SRI ya lo había recibido, la respuesta 43 lleva a consultar la autorización (no se duplica).
- Al salir de la cola (AUTORIZADO, RECHAZADO, DEVUELTO) se borra su registro de `ColaSRI`.

**Pruebas nuevas (30):** `tests/unit/server/sri/ws/sriSoap.client.test.ts` (8: recepción, autorización, timeout, conexión cortada, Fault, HTTP 503, XML inválido, escala del backoff, CDATA) y `tests/integration/server/envio-sri.test.ts` (22: flujo completo con firma automática, cada estado de recepción y autorización, 43/70, reintentos con espera exponencial verificada, certificado ausente/vencido, recuperación tras cierre, concurrencia, orden cronológico, worker real, SRI colgado sin afectar ventas, error inesperado, API y RBAC). Helper `tests/helpers/sriSimulado.helper.ts` (servidor SOAP local programable). La matriz RBAC cubre las 2 rutas nuevas (79).

**Limitaciones conocidas:**
- Los códigos 43/70 y los textos de estado no se contrastaron con el texto de la ficha ni con `celcer` (no hubo acceso): es lo primero que hay que verificar con un certificado real de pruebas. Códigos como 45 (secuencial registrado) se tratan como DEVUELTO definitivo.
- Solo se prioriza por tipo (prioridad de la cola) y fecha de emisión; no hay envío por lotes ni consulta masiva.
- Un comprobante RECHAZADO/DEVUELTO no se corrige solo: hay que arreglar la causa y usar «reintentar» (la nota de crédito necesita que su factura esté AUTORIZADA).
- No hay detección de conectividad: se confía en el fallo de red + backoff.
- La prueba de concurrencia mixta de `nucleo-pos.test.ts` volvió a fallar una vez en la suite completa bajo carga (pasa sola y en las corridas siguientes, 603/603); misma intermitencia documentada en la Semana 9.
- `AUDIT_REPORT.md` sigue obsoleto (Semana 9); hay que re-ejecutar la auditoría. Ambos archivos de auditoría quedan fuera del commit.

**Verificación:** `tsc --noEmit` (3 tsconfig) ✅ 0 errores | `npx vitest run` ✅ 603/603 (36 archivos).

### Semana 12 — 2026-11-23 ✅ COMPLETADA (parcial: ver «No incluido»)
**Fuentes oficiales descargadas del portal del SRI (sin modificar):** `XML y XSD Comprobante de Retención` (usado: **2.0.0**), `XML y XSD Liquidación` (**1.1.0**), `XML y XSD Guía de Remisión` (**1.1.0**) → `src/server/services/sri/xsd/` y `ORIGEN.md`; y la *Ficha Técnica Esquema Offline v2.34* en PDF (leída para la contrastación de la Semana 11).

**Contrastación de la Semana 11 con la ficha y con `celcer`:** la ficha (7.2.3) documenta la respuesta de recepción (`RECIBIDA`/`DEVUELTA`) y la de autorización; se hizo una consulta de prueba inocua (XML vacío y una clave inexistente) a `celcer` con `curl`: la respuesta real coincide con lo que parsea el cliente (`DEVUELTA` con identificador 35, y `autorizaciones` vacío con `numeroComprobantes` 0). **Corrección:** la ficha ilustra el rechazo con el estado `RECHAZADO` (el servicio real suele devolver `NO AUTORIZADO`): ahora ambos se tratan como rechazo. **Sin confirmar:** los identificadores 43 y 70 **no aparecen** en el texto de la ficha (solo el 35, 46 y 60 en los ejemplos); siguen siendo suposición y hay que verificarlos con un envío real a `celcer`. Además la ficha pide esperar un tiempo (parametrizable) entre RECIBIDA y la consulta de autorización y fija 24 h como máximo de respuesta, y un máximo de 320 KB por comprobante (hoy no se valida el tamaño). **Prueba pendiente:** el cliente de Node (`http`) recibió `ECONNRESET` de `celcer` en una prueba puntual mientras `curl` sí obtuvo respuesta; no se investigó más (el entorno bloqueó nuevas pruebas contra el servicio externo). Hay que repetir la llamada desde la propia aplicación y, si se reproduce, revisar cabeceras/TLS del cliente.

**Esquema (migración `20261127090000_documentos_compra_sri`):** `Compra.tipoDocumento` (FACTURA | NOTA_VENTA | LIQUIDACION), `Compra.codSustento` (2 dígitos), `Compra.autorizacion`; `ComprobanteElectronico.compraId` (+ relación); nueva tabla `RetencionLinea` (impuesto 1 renta / 2 IVA / 6 ISD, código de retención, base, porcentaje, valor).

**Archivos:**
- `sri/comprobantesCompra.builder.ts` — constructores puros de **Retención 2.0.0 (07)**, **Liquidación de Compra 1.1.0 (03)** y **Guía de Remisión 1.1.0 (06)** (reutiliza `infoTributaria`, `detalles`, `infoAdicional` del constructor de factura, ahora exportados).
- `sri/emisionDocumentos.service.ts` — `EmisionDocumentosService`: `emitirRetencion`, `emitirLiquidacion`, `emitirGuiaRemision`. Mismo patrón que la factura: todo se valida **antes** de escribir (reglas, clave de acceso, XML, XSD) y recién entonces se reserva el secuencial, se guarda y se encola. Las **retenciones van con prioridad 1** en la cola. Idempotente por compra. Respetan los flags `emitirRetenciones`, `emitirLiquidaciones` y `emitirGuiasRemision`.
- `sri/ats.service.ts` + `repositories/ats.repository.ts` — generador del **ATS** mensual.
- `shared/schemas/documentosSri.schema.ts` (entradas Zod y periodo), `compra.schema.ts`/`compra.service.ts`/`compra.repository.ts` (nuevos campos), `giro.service.ts` (3 flags), `xsdValidator.service.ts` y `firma.service.ts` (nuevos tipos 03/06/07), `container.factory.ts`, `comprobante.controller.ts`, `routes/index.ts`.

**Endpoints nuevos:**
| Ruta | Permiso |
|---|---|
| `POST /api/compras/:id/retencion` — `{ puntoEmisionId, retenciones: [{ codigo, codigoRetencion, baseImponible, porcentaje }], parteRelacionada? }` (201 / 200 si ya existía) | `sri:crear` |
| `POST /api/compras/:id/liquidacion` — `{ puntoEmisionId }` (compra de tipo LIQUIDACION) | `sri:crear` |
| `POST /api/guias-remision` — transportista, fechas, placa, destinatarios con sus productos y documento de sustento opcional | `sri:crear` |
| `GET /api/reportes/ats?anio=&mes=` — descarga el XML (`ATS-AAAA-MM.xml`); `&formato=json` devuelve `{ xml, resumen }` | `reportes:exportar` |
La matriz RBAC cubre las 4 rutas nuevas (77 entradas en la tabla; el recuento de semanas anteriores era aproximado).

**Reglas implementadas:**
- **Retención:** solo agentes de retención; el valor se calcula en el servidor (base × % redondeado a 2 decimales); base de IVA ≤ IVA de la compra y base de renta ≤ subtotal; sustento con 15 dígitos (el número de la compra debe ser `001-001-000000123`) y autorización del proveedor si existe; si la compra es una liquidación, el sustento es la propia liquidación (hay que emitirla antes). Tipo de sujeto deducido del RUC (3.er dígito 6/9 = sociedad) y tipo de identificación de su longitud.
- **Liquidación:** solo para compras registradas como LIQUIDACION (el proveedor no emite comprobantes); a crédito lleva plazo.
- **ATS:** compras con sustento, autorización, bases (gravada / 0 %), IVA y las retenciones emitidas (IVA según % → `valRetBien10`, `valRetServ20`, `valorRetBienes`, `valRetServ50`, `valorRetServicios`, `valRetServ100`; renta en `air/detalleAir`; datos de la retención); ventas agrupadas por cliente y tipo (18 factura, 04 nota de crédito) con bases y formas de pago; ventas por establecimiento y total neto de notas de crédito; anulados con autorización. Solo entran los comprobantes **AUTORIZADOS** y el resumen informa cuántos del periodo siguen pendientes. **Si faltan datos de una compra (formato del número, autorización, liquidación sin emitir) no se genera un anexo incompleto: se devuelve el listado a corregir.** Meses en hora de Ecuador.
- **Arreglo de la intermitencia de la suite:** la prueba de concurrencia mixta fallaba bajo carga con *«Unable to start a transaction in the given time»*: Prisma espera 2 s por defecto para iniciar una transacción y con una única conexión SQLite las transacciones se encolan. Ahora `crearPrismaPara` fija `maxWait` 30 s y `timeout` 60 s para **todas** las transacciones (2 corridas completas seguidas 628/628).

**Pruebas nuevas (25):** `tests/unit/server/sri/comprobantesCompra.test.ts` (6: XML de los tres comprobantes válido contra su XSD oficial y reglas) y `tests/integration/server/documentos-sri.test.ts` (19: emisión, idempotencia, rechazos sin rastro, agente de retención y módulos apagados, firma y envío por el SRI simulado, prioridad 1 antes de una factura, estado `RECHAZADO` de la ficha, liquidación y su retención, guía con sustento, ATS con ventas/notas de crédito/compras/retenciones cuadradas contra las ventas y compras reales, anexo incompleto rechazado, API y RBAC).

**No incluido / limitaciones:**
- **Nota de débito (05): no se implementó** (la tarea decía «si cabe»); el XSD tampoco se incluye.
- **ATS sin XSD oficial:** el SRI no publica `ats.xsd` en el portal de comprobantes electrónicos (el anexo se carga con DIMM Formularios) y no se pudo obtener de una fuente oficial. Se siguió la estructura publicada del anexo (orden de nodos y campos de memoria del formato), **sin validación contra un XSD**: debe revisarse en DIMM antes de presentarlo. Campos no cubiertos: reembolsos, exportaciones, retenciones que nos practican los clientes (`valorRetIva`/`valorRetRenta` salen en 0), ICE, base no objeto/exenta en compras (todo lo no gravado va a la base 0 %), pagos al exterior y formas de pago de compras (siempre `01`).
- Una sola retención por compra y un solo documento sustento por retención (el XSD admite varios); sin dividendos, compras de banano ni reembolsos.
- Las retenciones de renta se ingresan a mano (código y porcentaje): no hay catálogo de conceptos de retención ni cálculo automático por tipo de proveedor/bien/servicio.
- No se valida el plazo legal para emitir la retención (5 días hábiles) ni se anulan retenciones/guías/liquidaciones desde la aplicación.
- La guía de remisión no se vincula a una venta ni descuenta inventario: es un documento independiente con los datos indicados.
- **Auditoría independiente (`REVIEWER_AGENT.md`) sin re-ejecutar:** `AUDIT_REPORT.md` sigue describiendo la Semana 9. Hay que lanzarla (no la inicié por mi cuenta). Ambos archivos de auditoría quedan fuera del commit.

**Verificación:** `tsc --noEmit` (3 tsconfig) ✅ 0 errores | `npx vitest run` ✅ 628/628 (38 archivos), 2 corridas consecutivas.

### Semana 13 — 2026-11-23 ✅ COMPLETADA
**Dependencias nuevas:** `pdfkit` (PDF puro en JavaScript, sin módulos nativos), `bwip-js` (solo calcula las barras del Code 128), `iconv-lite` (CP858 para la impresora) y `@types/pdfkit`.

**Esquema (migración `20261128090000_impresora_termica`):** `ConfiguracionGiro.impresoraConexion` (NINGUNA | RED | SISTEMA), `impresoraDireccion`, `impresoraPuerto` (9100) e `impresoraAncho` (80 | 58). Se reutilizan los interruptores que ya existían: `impresionTermica` (imprimir al cobrar) y `aperturaGaveta`.

**Archivos** (en `src/server/services/hardware/` salvo indicación):
- `escpos.builder.ts` — `EscPosBuilder`: inicializar + página de códigos CP858 (acentos, ñ, ¿, €), alineación, negrita, tamaño, `columnasLR`, separador, avance, **QR nativo** (GS ( k), **corte** y **pulso de gaveta** (`ESC p`). El texto se sanea: ningún carácter de control (ESC, GS, DEL, separadores Unicode) del nombre de un producto o cliente llega a la impresora. 80 mm = 48 columnas, 58 mm = 32.
- `ticket.builder.ts` — ticket de venta (datos del negocio, cliente, líneas, totales, pagos y cambio; con factura: ambiente, estado, clave de acceso en texto y QR; ANULADA / REIMPRESIÓN; gaveta al final) y ticket de **arqueo / cierre de caja**.
- `transporteImpresora.ts` — `TransporteRed` (socket TCP, 9100) y `TransporteSistema` (cola de impresión del sistema en modo RAW: `copy /b` a la impresora local en Windows y `lp -o raw` en Linux/macOS; valida el nombre de la impresora contra inyección y borra el archivo temporal). Interfaz `TransporteImpresora` sustituible.
- `impresion.service.ts` — `ImpresionService`: configuración, `alCobrar` (automático, **nunca lanza**), `reimprimirVenta`, `imprimirArqueo`, `abrirGaveta`, `probar`. La gaveta se abre solo al cobrar con **efectivo** (también en pagos mixtos), nunca en reimpresiones ni ventas anuladas, y respeta el interruptor del giro.
- `sri/ride/ride.datos.ts` — XML → datos del RIDE para factura, liquidación, nota de crédito, retención y guía de remisión (acepta el XML autorizado con el comprobante en CDATA). `ride.pdf.ts` — PDF A4: cabecera con los datos del emisor y del comprobante, **código de barras Code 128 de la clave de acceso**, receptor, detalle paginado, totales por tarifa, formas de pago e información adicional; **marca de agua «SIN VALOR TRIBUTARIO»** y leyenda de pie si aún no está autorizado. `ride.service.ts` — usa el XML autorizado, o el firmado/generado si no lo hay.
- `repositories/impresion.repository.ts`, `shared/schemas/impresora.schema.ts`, `controllers/impresion.controller.ts`, `container.factory.ts`/`server/index.ts` (opciones `impresion` y `ride`), `venta.controller.ts` y `restaurante.controller.ts` (impresión **aparte** al cobrar), `electron/ipc/printer.ipc.ts` (`printer:list`: impresoras instaladas, canal que ya estaba en la allowlist del preload) y `electron/main.ts`.

**Endpoints nuevos:**
| Ruta | Permiso |
|---|---|
| `GET /api/impresora` — configuración | `caja:leer` |
| `PUT /api/impresora` — `{ conexion, direccion, puerto, ancho }` | `configuracion:actualizar` (solo ADMIN) |
| `POST /api/impresora/probar` (204) | `caja:crear` |
| `POST /api/impresora/gaveta` (204; 403 si la apertura está desactivada) | `caja:crear` |
| `POST /api/ventas/:id/imprimir` — reimpresión (204) | `caja:crear` |
| `POST /api/turnos/:id/imprimir` — arqueo (204; cierre ciego: el cajero no ve el efectivo esperado de su turno abierto, el supervisor sí) | `caja:crear` |
| `GET /api/comprobantes/:id/ride` (`?descargar=1` como archivo; cabecera `X-Comprobante-Autorizado`) | `sri:leer` |

**Reglas:**
- **La impresión nunca bloquea ni hace fallar una venta:** `POST /api/ventas` y el cobro de comandas responden sin esperar a la impresora (hay una prueba con una impresora que nunca responde). Los errores de la impresión automática se informan por `alError`; las acciones explícitas (reimprimir, probar, gaveta, arqueo) devuelven 409 con el motivo.
- Sin impresora configurada (`NINGUNA`, el valor por defecto) no se imprime nada.

**Pruebas nuevas (47):** `tests/unit/server/hardware/escpos.test.ts` (17: bytes golden de cada comando y del QR, CP858, saneamiento de caracteres hostiles, ajuste a 32/48 columnas, ticket de venta/arqueo, gaveta, TCP real contra un servidor local, `lp`/`copy` con ejecutor simulado, nombres de impresora peligrosos), `tests/unit/server/sri/ride.test.ts` (13: datos de los cinco tipos desde su XML, hora de autorización, Code 128 —ancho y parada—, PDF A4 con su texto, marca de agua, paginación de 120 líneas, comprimido) y `tests/integration/server/impresion.test.ts` (17: configuración y validación, gaveta según forma de pago y flags, 58 mm, factura con QR, impresora que falla o se cuelga, API, reimpresión, arqueo, RIDE sin autorizar/autorizado/permisos). La matriz RBAC suma 7 rutas (84 filas). Helpers `tests/helpers/pdf.helper.ts` y `documentosSri.fixture.ts`.

**Limitaciones conocidas:**
- **Sin impresora física ni inspección visual del PDF:** los bytes ESC/POS se verifican contra el estándar (golden) y el PDF se comprobó con su texto extraído y con `pdftotext` (poppler), pero no se imprimió en un equipo real ni se miró renderizado (no hay rasterizador en el entorno). Primera prueba a hacer en un equipo con impresora Epson/Bixolon: página de prueba (acentos y 32/48 columnas), ticket con QR y pulso de gaveta.
- **USB:** no hay acceso directo por `libusb` (evita módulos nativos y controladores). Las impresoras USB se usan a través de la cola del sistema (`SISTEMA`); en Windows la impresora debe estar **compartida** con el nombre configurado (`\\localhost\<nombre>`). Hay que probarlo en un equipo real.
- La página de códigos fija es CP858; algunos modelos de 58 mm usan otra y mostrarán mal las tildes (hay que parametrizarla por modelo).
- El código de barras de la clave no va en el ticket térmico (solo texto y QR); sí va en el RIDE.
- El diseño del RIDE sigue la estructura de la ficha (datos del emisor, autorización, clave de acceso, detalle, totales, pagos, información adicional) pero **no se comparó píxel a píxel** con el formato oficial; no incluye logotipo. No hay RIDE de notas de débito (no se emiten).
- El cobro de comandas dispara la impresión igual que la venta, pero no tiene prueba propia de integración (comparte el mismo servicio que `POST /ventas`).
- Deudas del MES 3 que siguen abiertas (ver «Próxima Tarea»): `ECONNRESET` del cliente SOAP contra `celcer`, auditoría independiente sin re-ejecutar, `ats.xsd` oficial y nota de débito.

**Verificación:** `tsc --noEmit` (3 tsconfig) ✅ 0 errores | `npx vitest run` ✅ 675/675 (41 archivos), 2 corridas consecutivas.

### Semana 14 — 2026-11-24 ✅ COMPLETADA
**Dependencias nuevas:** `ws` (cliente y pruebas del WebSocket; `@fastify/websocket` ya era dependencia) con `@types/ws`, y `serialport` como **dependencia opcional** (se carga solo al abrir la balanza; si falta o no compila para Electron se informa con claridad).

**Esquema (migración `20261129090000_balanza_sync_lan`):** `ConfiguracionGiro.balanzaPuerto`, `balanzaBaudios` (9600), `balanzaProtocolo` (GENERICO | CAS) y `balanzaEtiqueta` (PESO | PRECIO); nueva tabla `EventoSync` (bitácora numerada de cambios). Se reutilizan los interruptores `moduloBalanza` y `sincronizacionLAN`.

**1. Lectores de códigos** (`services/hardware/`):
- `detectorEscaneo.util.ts` — `DetectorEscaneo`, función pura para la pantalla del POS: recibe cada tecla con su marca de tiempo y, al llegar Enter, distingue **ESCANEO** (ráfaga ≤ 50 ms entre teclas, 4–64 caracteres, sin Retroceso) de **MANUAL** (pausas, correcciones o texto corto). Umbrales configurables.
- `codigoBarras.util.ts` — dígito verificador GS1 (EAN-8/13, UPC-A, GTIN-14) y etiquetas de balanza **EAN-13 con prefijo 2**: `2 PPPPPP VVVVV C` (PLU de 6 dígitos + 5 dígitos de peso en gramos o de precio en centavos).
- `escaneo.service.ts` — `GET /api/escaneo/:codigo`: producto → 1 unidad; presentación (caja, paquete) → 1 presentación; etiqueta de balanza (requiere `moduloBalanza`) → producto por PLU (se registra el PLU como código de barras del producto) y cantidad en **su unidad** (kg, lb o g) o importe ÷ precio unitario.

**2. Balanza serial:**
- `balanza.protocolo.ts` — protocolos **CAS** (`ST,GS,+  1.250kg`) y **GENERICO** (número + unidad opcional, marcas ST/US), pesos normalizados a kg; `leerPesoEstable` (marca de estabilidad o N lecturas iguales; tramas partidas; tiempo máximo; cierra siempre el puerto); `PuertoSerie` sustituible y `PuertoSerieNode` (con `serialport`).
- `balanza.service.ts` — configuración (`GET/PUT /api/balanza`, solo el administrador cambia) y `GET /api/balanza/peso?productoId=&tara=`: peso estable − tara, convertido a la unidad del producto. Un solo dueño del puerto: la segunda lectura simultánea recibe un aviso.

**3. Sincronización multi-caja en LAN** (`services/sync/`, `routes/sync.routes.ts`):
- **Modelo:** la BD (SQLite) vive **solo en el equipo servidor**; las demás cajas son clientes de su API, sin copia local. Por eso no hay conflictos de escritura (cada cambio pasa por una transacción del servidor). Lo que se sincroniza es el **aviso** del cambio.
- `GET /api/sync?token=&cajaId=&desde=` (WebSocket): valida la sesión (4401), exige `sincronizacionLAN` activo (4403), una caja que se vuelve a conectar reemplaza a la anterior (4409). Responde `hola` con el último evento y las cajas presentes, difunde `presencia` de las que llegan y salen y **reenvía lo perdido** desde `desde`; si la bitácora ya no lo conserva envía `resync` (recargar todo).
- **Eventos:** un gancho `onResponse` anuncia toda operación que cambia datos y termina bien (ventas, productos, inventario, turnos, compras, comprobantes…) con módulo, método, ruta, parámetros, usuario y `x-caja-id`; también los cambios de estado de comprobantes hechos por el worker del SRI. Lecturas, sesión, impresora, balanza y operaciones fallidas no generan eventos. Bitácora con retención configurable (5000) y poda periódica.
- **Latido:** cada 15 s se cierra la sesión revocada (4408) y se da de baja la caja que no responde al ping; las demás cajas lo saben.
- `syncCliente.ts` — `ClienteSync` para cada caja: recuerda el último evento, reconecta con espera creciente pidiendo `desde`, ignora repetidos y **no reintenta** cuando el cierre es definitivo (sesión, módulo apagado, caja duplicada). Independiente del navegador (recibe la función que crea el WebSocket).
- `GET /api/sync/cajas` (`caja:leer`): cajas conectadas.
- **Red:** el servidor escucha solo en este equipo (127.0.0.1) salvo `redLocal` (Electron: `VENDEYA_LAN=1`) → 0.0.0.0. Caja secundaria en Electron: `VENDEYA_SERVIDOR_URL=http://IP:3001` no abre BD ni servidor y usa los del servidor (`backend:get-info` devuelve esa URL).

**Pruebas nuevas (41):** `tests/unit/server/hardware/lectores.test.ts` (17: GS1 y etiquetas, detector de escaneo con temporización simulada, protocolos y lectura estable con puerto simulado), `tests/integration/server/lectores.test.ts` (11: escaneo de los tres tipos y sus errores, balanza con tara y unidades, API) y `tests/integration/server/sync-lan.test.ts` (13, **con el backend real y clientes WebSocket**: autenticación y cierres, presencia, difusión con quién y desde dónde, ausencia de eventos en lecturas/fallos, evento del worker del SRI, reanudación sin duplicados, reconexión automática, `resync`, sesión revocada sin reintento, caja duplicada, caja que no contesta, permisos). La matriz RBAC suma 5 rutas (89 filas). Dos defectos encontrados por las pruebas y corregidos: el cliente descartaba los eventos reenviados porque el `hola` adelantaba su cursor, y un test de turnos fallaba al azar cuando un UUID contenía «133» (`turno.service.test.ts`).

**Limitaciones conocidas:**
- **Sin hardware ni red real:** los protocolos de balanza y el puerto serie se probaron con tramas simuladas; **ni `serialport` ni el cableado de una balanza CAS se probaron en un equipo** (y `serialport` es un módulo nativo: hay que verificar `electron-rebuild`/prebuilds en el empaquetado). Toledo y otros protocolos no están. La sincronización se probó en `127.0.0.1`, no entre equipos distintos (firewall de Windows: abrir el puerto del servidor).
- **Seguridad en la LAN:** el token de sesión viaja en la URL del WebSocket y el tráfico va **sin cifrar** (HTTP/WS en red local). Aceptable en una red privada de confianza; para redes compartidas hace falta TLS.
- **Descubrimiento:** la caja secundaria se configura a mano con la IP del servidor (sin mDNS). Si el servidor cae, las cajas no pueden vender (no hay modo offline por caja).
- Las etiquetas de **precio** usan el precio unitario **sin IVA** del producto; las balanzas que imprimen el precio con IVA incluido darán una cantidad mayor a la real hasta que se parametrice.
- El PLU debe registrarse como código de barras del producto (6 dígitos; se acepta con o sin ceros a la izquierda); no hay otros formatos de etiqueta (prefijos distintos de 2, PLU de 4–5 dígitos).
- La bitácora solo se registra mientras `sincronizacionLAN` esté activo; al activarla por primera vez las cajas deben cargar todo desde la API. Los eventos indican **qué** cambió, no los datos: la caja vuelve a consultar.
- El detector de escaneo es una función pura sin interfaz: **no hay pantalla que lo use todavía** (llega con el POS de la Semana 15). Tampoco hay aún cliente de `ClienteSync` en el renderer.
- Deudas de semanas anteriores aún abiertas (ver «Próxima Tarea»).

**Verificación:** `tsc --noEmit` (3 tsconfig) ✅ 0 errores | `npx vitest run` ✅ 716/716 (44 archivos), última corrida completa.

### Semana 15 — 2026-11-24 ✅ COMPLETADA
**Dependencias nuevas (solo desarrollo):** `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/dom` y `@testing-library/jest-dom` fijada en la 6.x (la 8 exige Vitest 5). Cada prueba de interfaz declara `// @vitest-environment jsdom`; las de servidor siguen en Node.

**Frontend** (`src/renderer/`, React + TypeScript + Tailwind + Zustand + TanStack Query):
- `services/` — `api.ts` (`ApiCliente`: token de sesión, cabecera `x-caja-id`, errores del dominio como `ApiError{codigo,status}`, `SIN_CONEXION`, aviso de 401), `pos.api.ts` (operaciones del POS), `tipos.ts`, `totales.ts` y `contexto.tsx` (dependencias inyectables: API y WebSocket).
- `totales.ts` **reutiliza las mismas funciones puras del servidor** (`calcularLinea`, `calcularTotales`, `distribuirPagos`): lo que ve el cajero es lo que registra el servidor (hay una prueba contra el backend real). El precio nunca se envía: lo resuelve el servidor (lista del cliente, presentación, producto).
- `store/` — `sesion.store` (token, usuario, turno, punto de emisión, modo táctil recordado) y `carrito.store` (líneas, descuentos, presentaciones, cliente).
- `hooks/` — `useAtajos` (F2, F4, F8, ESC), `useEscaneo` (usa `DetectorEscaneo`: escaneo vs. digitación, también sin campo enfocado), `useSincronizacion` (usa `ClienteSync`: refresca productos/stock, clientes, turno y cola del SRI cuando **otra** caja cambia algo; `resync` recarga todo; si el servidor no tiene la sincronización activa la caja sigue sola) y `consultas`.
- `components/` — `BuscadorProductos`, `CarritoPanel`, `ModalCobro`, `ModalLinea`, `ModalCliente`, `BarraEstado`, `TecladoNumerico`, `Modal`.
- `pages/` — `LoginPage`, `AperturaTurnoPage` (retoma un turno abierto), `PosScreen`; `App.tsx` resuelve la URL del backend (`backend:get-info` de Electron, o la del servidor en una caja secundaria) y el flujo Ingreso → Turno → Venta.

**Cómo se usa:** `F2` busca (la búsqueda filtra en el servidor por nombre, código o código de barras) · `F4` elige cliente (por defecto Consumidor Final) · `F8` cobra · `ESC` cierra el diálogo, o la confirmación, o borra la búsqueda · Enter en la búsqueda agrega el producto si es el único resultado o coincide exacto. Un lector de códigos (ráfaga + Enter) llama a `GET /api/escaneo/:codigo` (producto, presentación o etiqueta de balanza con su peso). Los productos a granel piden la cantidad: **«Pesar»** lee la balanza (`GET /api/balanza/peso`) o se teclea. Cobro con formas de pago mixtas, «Exacto», cambio, propina y «emitir factura». Tras cobrar: número de venta, cambio, estado de la factura, avisos del servidor y **reimprimir ticket**; el ticket y la gaveta salen solos desde el servidor. Barra de estado: cajero, sucursal y punto, conexión LAN, cola del SRI (si el rol puede verla), impresora y modo táctil (botones grandes y teclado numérico en pantalla).

**Backend (cambios para la pantalla):** `GET /api/puntos-emision` (`caja:leer`: sucursales y puntos activos para abrir turno y vender); `GET /api/productos` y `GET /api/escaneo/:codigo` ahora incluyen `unidadMedida` y `tarifaImpuesto` del producto (cambio solo aditivo). Tabla de permisos: 90 filas.

**Correcciones de arrastre:** `vite build` **fallaba desde la Semana 1** (`globals.css` usaba `surface-300…700`, que no existían en `tailwind.config.ts`): paleta completada y build verificado. La CSP del renderer solo permitía `127.0.0.1`: ahora permite `http:`/`ws:` para que una caja secundaria llegue al servidor de la red local (los scripts siguen limitados a los propios).

**Pruebas nuevas (66):** `tests/unit/renderer/servicios.test.ts` (19: cliente HTTP, cálculos —IVA por tarifa, descuentos, pagos y cambio— y stores), `pos.test.tsx` (30: catálogo, carrito, descuento, escaneo vs. digitación con la misma cadena, escáner sin foco y con diálogo abierto, etiqueta de balanza, atajos, kilos con «Pesar», cliente, cobro mixto con el cuerpo validado por el esquema compartido, errores de stock/crédito/validación/sin red/sin turno, modo táctil, barra de estado) y `app.test.tsx` (11: ingreso, apertura y retomar turno, salir, sesión vencida y sincronización multi-caja con un WebSocket simulado); `tests/integration/renderer/pos-backend.test.ts` (6: el cliente del POS contra el **backend real por HTTP**: login, turno, formas de los datos, total de pantalla = total del servidor con varias tarifas, descuento en % y kilos, errores y permisos). Helpers en `tests/helpers/renderer/`. Los `tsconfig` quedaron así: el raíz compila interfaz, pruebas de interfaz y la prueba contra el backend; `tsconfig.node.json` las excluye.

**Limitaciones conocidas:**
- **No se probó dentro de Electron ni con un lector/impresora/balanza reales**, y no se miró la interfaz renderizada (solo jsdom y `vite build`): hay que revisar a ojo el diseño, el tamaño táctil y el rendimiento con un catálogo grande en un equipo de caja real.
- El catálogo muestra los primeros 24 productos y filtra por texto en el servidor (sin paginación infinita ni categorías); la búsqueda ya es rápida pero la navegación por categorías/favoritos no existe.
- El carrito vive en memoria: si se cierra la aplicación a mitad de una venta se pierde. No hay ventas en espera, devoluciones, anulaciones, cierre de turno ni arqueo desde la pantalla (el backend sí los tiene): llegan con las vistas de la Semana 16.
- El total en pantalla es una estimación con el precio del catálogo; si el servidor resuelve otro precio (lista de precios del cliente) la confirmación muestra el total real, y el cobro exige haber cubierto el total estimado (si el real fuera mayor, el servidor lo rechaza con «Pago insuficiente»).
- Sin factura para clientes nuevos desde el POS (no hay alta rápida de cliente), ni lectura de cédula/RUC; el modo táctil no tiene gestos ni pantalla de bloqueo.
- Sin internacionalización: todo en español. Sin pruebas de accesibilidad automáticas (se usan roles y etiquetas, no hay auditoría axe).
- Deudas de semanas anteriores abiertas (ver «Próxima Tarea»).

**Verificación:** `tsc --noEmit` (3 tsconfig) ✅ 0 errores | `vite build` ✅ | `npx vitest run` ✅ 782/782 (48 archivos), 2 corridas consecutivas.

### Semana 16 — 2026-11-24 ✅ COMPLETADA
**Frontend** (`src/renderer/`): marco con menú lateral por permisos y las vistas de gestión sobre los endpoints del backend.
- `components/Shell.tsx` — barra de estado (conexión LAN, cola del SRI, impresora, modo táctil, salir) + menú lateral + vista activa; **Ctrl+1…7** cambia de vista. El menú depende del rol (`store/navegacion.store.ts`): **Venta** `ventas:crear` · **Caja** `caja:leer` · **Clientes** `clientes:leer` · **Inventario** `inventario:actualizar` · **Compras** `inventario:crear` · **Reportes** `reportes:leer` · **Comprobantes SRI** `sri:leer`. El cajero ve Venta, Caja y Clientes (no Inventario, Compras, Reportes ni SRI); quien no opera caja (contador, bodeguero) entra directo a sus vistas sin abrir turno. El carrito se conserva al cambiar de vista.
- `pages/InventarioPage.tsx` — productos con búsqueda y paginación, alta/edición (categoría, unidad, tarifa de IVA, lotes, vencimiento), **ajustes** de entrada/salida con motivo, **kardex** con existencia y costo promedio, y **alertas** de stock mínimo y de lotes vencidos/por vencer.
- `pages/ClientesPage.tsx` — clientes (alta con `clientes:crear`, edición con `clientes:actualizar`; el Consumidor Final no se edita) y **cuentas por cobrar** con filtro de vencidas y **abonos** (valida contra el saldo).
- `pages/ComprasPage.tsx` — compras (listado y registro: proveedor, documento FACTURA/NOTA_VENTA/LIQUIDACION, autorización, contado/crédito, líneas con costo), **proveedores** (alta/edición/desactivar) y **cuentas por pagar** con pagos (las dos últimas exigen `proveedores:leer`).
- `pages/CajaPage.tsx` — resumen del turno con **cierre ciego** (el cajero no ve el efectivo esperado), ingreso/egreso, ventas del turno con **reimpresión** y **anulación con motivo** (solo `ventas:anular`), arqueo impreso y **cierre de turno** que muestra esperado, contado y diferencia y vuelve a la apertura.
- `pages/ReportesPage.tsx` — ventas (por día, producto, forma de pago o cajero), utilidad, stock valorado y cartera; periodo, totales y **descarga CSV** (solo `reportes:exportar`).
- `pages/SriMonitorPage.tsx` (**SriMonitor**) — resumen por estado, listado filtrable por estado y tipo, último mensaje, **detalle** con clave de acceso y mensajes de rechazo del SRI, **reintento** (`sri:crear`, solo en PENDIENTE/RECHAZADO/DEVUELTO), descarga del **RIDE** en PDF y del **ATS** del periodo.
- Piezas comunes: `components/Gestion.tsx` (tabla, pestañas, paginador, campos), `services/gestion.api.ts` (cliente de las vistas) y `ApiCliente.archivo()` (descargas con la sesión).

**Backend (nuevo, con sus pruebas y permisos):** `POST /api/clientes` (`clientes:crear`) y `PATCH /api/clientes/:id` (`clientes:actualizar`); `GET/POST/PATCH /api/proveedores` (`proveedores:*`); `GET /api/ventas` (`ventas:leer`; filtros por turno, estado, fecha y texto; **quien no es supervisor solo ve sus ventas**); `GET /api/compras` (`inventario:leer`); `GET /api/catalogos` (categorías y unidades); `GET /api/reportes/:tipo` (`reportes:leer`; `tipo` = ventas · utilidad · stock · cartera; `?formato=csv` exige además `reportes:exportar`). Reportes: solo ventas COMPLETADAS, días civiles de Ecuador, cobros netos del cambio, utilidad con el costo promedio al momento de cada venta; CSV con BOM y celdas a salvo de fórmulas de Excel. Tabla de permisos: 99 filas.

**Pruebas nuevas (51):** `tests/integration/server/gestion.test.ts` (12: clientes, proveedores, listados con alcance por usuario, catálogos y reportes con cifras verificadas, CSV y su escape), `tests/unit/renderer/gestion.test.tsx` (33: menú por rol, atajos, y cada vista con su API simulada: validaciones, cargas útiles enviadas, errores del servidor, permisos, descargas, cierre ciego) y `tests/integration/renderer/gestion-backend.test.ts` (6: el cliente de gestión contra el **backend real**: las cargas útiles que arman los formularios las acepta el servidor y las respuestas tienen la forma que la interfaz espera). `PosScreen` ya no incluye la barra de estado (la aporta el marco).

**Limitaciones conocidas:**
- Igual que en la Semana 15: **no se vio la interfaz renderizada ni se probó en Electron** (jsdom y `vite build`). Las vistas son funcionales pero sobrias (sin gráficos, sin ordenar columnas ni impresión de reportes); habrá que pulir el diseño con uso real.
- **Alcance parcial de lo pedido:** en Inventario no hay pantalla de presentaciones, listas de precios ni lotes (solo sus alertas; el backend sí los tiene); las notas de crédito/devoluciones parciales no existen; la compra no admite lotes ni fechas de vencimiento desde la pantalla (las compras de productos con lote se rechazan con el mensaje del servidor); no hay retenciones, liquidaciones, guías de remisión ni su emisión desde la interfaz (el backend sí).
- Los reportes son los cuatro básicos: sin filtros por categoría o cliente, sin comparativos ni gráficos; la utilidad se calcula con el costo promedio vigente en cada venta y no incluye gastos. El CSV usa comas (Excel con configuración regional latina puede pedir «Importar»).
- La anulación de una factura ya autorizada a Consumidor Final no es posible (regla del SRI ya existente): la pantalla muestra el motivo del servidor.
- El listado de ventas de un cajero muestra solo sus ventas; el supervisor ve las de toda la empresa pero la vista de Caja solo trabaja con el turno propio.
- Deudas de semanas anteriores abiertas (ver «Próxima Tarea»).

**Verificación:** `tsc --noEmit` (3 tsconfig) ✅ 0 errores | `vite build` ✅ | `npx vitest run` ✅ 833/833 (51 archivos), 2 corridas consecutivas.

---

### Semana 17 — 2026-11-24 ✅ COMPLETADA
**Alta inicial (backend):** un equipo recién instalado tiene la base vacía (solo migraciones); antes únicamente `prisma/seed.ts` creaba la empresa.
- `src/server/services/setup/instalacion.util.ts` — **catálogos base y alta de una instalación compartidos con el seed**: `sembrarBase` (roles, los 60 permisos y su asignación por rol, unidades), `crearInstalacion` (empresa, sucursal 001, punto de emisión 001, tarifas de IVA, categoría «General», Consumidor Final, configuración del giro, administrador) y `banderasDeGiro`. `prisma/seed.ts` ahora los usa (los tests del seed no cambiaron).
- `setup.service.ts` + `GET /api/setup/estado` (público: `{configurado}`), `POST /api/setup` y `POST /api/setup/certificado` (públicos pero **solo desde este equipo**: el controlador exige IP de loopback, de modo que nadie en la red local pueda adelantarse al dueño si el servidor escucha en toda la red). El alta va **en una sola transacción que vuelve a comprobar «no hay empresa»**: dos intentos simultáneos crean una sola empresa y el otro recibe 409; si algo falla no queda nada a medias.
- Validaciones: RUC de 13 dígitos con **dígito verificador** (persona natural por cédula módulo 10, sector público 6 y sociedad 9 por módulo 11; el SRI tiene excepciones históricas, así que el asistente permite **confirmar** un RUC que no la cumple con `confirmarRuc`), usuario `[a-z0-9._-]{3,30}`, contraseña ≥ 8 con letra y número, correo y teléfono. El certificado `.p12` se valida **antes de crear nada** (contraseña, vigencia, 2048 bits, titular/RUC) con las mismas reglas que la carga normal y no se guarda; se guarda después, con la sesión del administrador recién creado (`PUT /api/configuracion/certificado`).
- **Ajustes (backend):** `configuracion.service.ts` — `GET /api/configuracion` (`configuracion:leer`), `PATCH /api/configuracion/empresa` (todo menos el RUC, que identifica a la empresa y sus comprobantes; un `ruc` en el cuerpo se rechaza), `PATCH /api/configuracion/modulos` (17 interruptores; claves desconocidas rechazadas; la sincronización LAN se aplica al instante) y `POST /api/configuracion/giro` (reajusta los módulos al giro elegido), los tres con `configuracion:actualizar`. Matriz RBAC: 106 filas.

**Frontend** (`src/renderer/`):
- `pages/SetupWizard.tsx` — **3 pasos**: (1) empresa (RUC con aviso y casilla de confirmación si falla el dígito verificador, tipo de contribuyente, régimen, ambiente, obligado a contabilidad, sucursal; se crea 001-001), (2) certificado (archivo `.p12`/`.pfx`, contraseña, «Validar» muestra titular, emisor y días de vigencia o el motivo del rechazo; se puede **omitir** y cargarlo después), (3) giro y administrador (contraseña repetida). Al terminar muestra el resumen (certificado cargado / pendiente / fallo con el motivo) y «Comenzar» inicia la sesión del administrador. Validación en el cliente con los mismos esquemas Zod que el servidor.
- `App.tsx` — sin sesión consulta `GET /api/setup/estado`: `configurado:false` → asistente; si el servidor no responde se deja el ingreso normal (nunca bloquea una instalación ya configurada).
- `pages/AjustesPage.tsx` (menú «Ajustes», solo `configuracion:actualizar`): **Empresa** (RUC de solo lectura; pasar a **producción** exige confirmar), **Giro y módulos** (cambio de giro con confirmación; interruptores sueltos), **Impresora** (conexión red/sistema, dirección, puerto, ancho, página de prueba), **Balanza** (puerto, baudios, protocolo, etiqueta), **Certificado de firma** (estado, vencimiento y advertencia; renovar, quitar) y **Red local** (sincronización LAN, nombre de esta caja y cajas conectadas).
- `services/ajustes.api.ts`, `useAjustes()`, `ApiCliente.put/delete/conSesion`; formularios con `noValidate` (los mensajes los da la aplicación, no el navegador).

**Instalador (inicio):** se empaquetó con `electron-builder --dir` y se probó el paquete. Hallazgos corregidos:
- **El cliente de Prisma generado (`node_modules/.prisma/client`, con el motor nativo) no entraba al paquete** (carpeta oculta fuera del árbol de dependencias): la aplicación no habría arrancado. Ahora se copia con `files: from/to` y se desempaqueta (`asarUnpack`) junto con `serialport` (binding N-API) y `xmllint-wasm`.
- **`pdfkit` 0.21 depende de `fontkit` 3 (solo ESM) y el Node de Electron 33 (20.18) no admite `require()` de ESM:** el backend empaquetado fallaba al cargar el RIDE (los tests y `tsc` no lo ven porque corren con Node 24). Se fijó **`pdfkit ~0.20.1`** (fontkit 2, CommonJS). **No actualizar pdfkit a 0.21+ hasta subir Electron a uno con Node ≥ 22.12.**
- `package.json` tenía un bloque `build` duplicado (con íconos inexistentes) junto a `electron-builder.yml`: eliminado. Se agregaron íconos provisionales (`src/renderer/assets/icon.ico/.png`, «VP» sobre el azul de la marca; **hay que reemplazarlos por la marca real**), `buildResources` apunta ahí, `npmRebuild: false` (no hay nada que recompilar: **`better-sqlite3` no se usa** —SQLite va por Prisma— y está en `optionalDependencies` sin compilar; `serialport` trae prebuilds N-API, solo se incluye win32-x64), `npm run build` ejecuta `prisma generate` primero.
- Migraciones y schema en `resources/prisma/`, XSD y compilado en `app.asar`; datos, respaldos y secretos en `userData` (`data/vendeya.db`, `data/backups`, `secretos/`); el **primer arranque muestra el asistente** porque la base está vacía y `GET /api/setup/estado` devuelve `configurado:false`.

**Qué se probó del paquete:** (1) el backend **dentro del `app.asar`** (ejecutando el binario empaquetado como Node): 10 migraciones desde `resources`, alta inicial `201`, login del administrador con 60 permisos, validación XSD (xmllint-wasm), Code128 (bwip-js), PDF (pdfkit) y `serialport` (listó 2 puertos); (2) el **ejecutable completo** arrancó con un `userData` limpio: backend en el puerto 3017, `vendeya.db` creada en `userData/data`, estado `configurado:false`.
**Qué NO se probó / falta del empaquetado:** el instalador **NSIS (`.exe`) no se llegó a generar**: en este equipo `winCodeSign` no se puede extraer (Windows niega crear enlaces simbólicos sin Modo desarrollador o administrador); el paquete se armó con `-c.win.signAndEditExecutable=false`, por lo que **el ejecutable no lleva el ícono ni los metadatos** de la marca. Tampoco: instalar/desinstalar/actualizar sobre una instalación previa, equipo limpio sin Node ni herramientas, ver la ventana y el asistente renderizados (solo se comprobó que el proceso arranca y el backend responde), firma de código, macOS/Linux, `electron-updater` (Semana 18) y la carpeta `release/` del proyecto conserva un `app.asar` bloqueado por otro proceso (está en `.gitignore`; borrar al reiniciar). Nota de entorno: dentro de VS Code `ELECTRON_RUN_AS_NODE=1` está definido y hace que el ejecutable de Electron arranque como Node; hay que quitarlo (`env -u ELECTRON_RUN_AS_NODE`) para probar la aplicación.

**Pruebas nuevas (36):** `tests/integration/server/setup.test.ts` (15: dígito verificador con RUC reales, estado, validación del `.p12` —contraseña, otro RUC, vencido, sin identificación, confirmación—, validaciones del alta, rechazo desde la red local, alta simultánea, contenido completo de la instalación, login del administrador sin contraseña en claro, alta rechazada si ya hay empresa, ajustes con sus permisos), `tests/unit/renderer/setup.test.tsx` (18 con API simulada: asistente y ajustes) y `tests/integration/renderer/setup-backend.test.tsx` (3: la **interfaz real contra el backend real con la base vacía**, de «sin empresa» a «turno abierto y ajustes cambiados», comprobando la base de datos).

**Limitaciones conocidas:**
- **No hay gestión de usuarios ni de sucursales/puntos de emisión adicionales** (ni API ni pantalla): tras el asistente solo existe el administrador y un punto 001-001; crear cajeros, supervisores o más cajas hoy solo se puede por código/seed. Es lo primero que necesita un cliente real.
- Impresora y balanza se guardan **por empresa** (no por caja): dos cajas en red comparten la misma configuración de puerto/impresora.
- El asistente solo funciona desde el propio equipo del servidor; una caja secundaria (`VENDEYA_SERVIDOR_URL`) nunca lo ve. Si el servidor se instala con `VENDEYA_LAN=1`, el alta sigue limitada al equipo local.
- Cambiar el RUC de una empresa creada no es posible desde la aplicación (decisión deliberada). Sin recuperación de contraseña del administrador (Semana 22).
- Como en las semanas 15–16, la interfaz **no se vio renderizada**: solo jsdom y `vite build`.
- Deudas de semanas anteriores abiertas (ver «Próxima Tarea»).

**Verificación:** `tsc --noEmit` (3 tsconfig) ✅ 0 errores | `vite build` ✅ | `npm run build:main` ✅ | `npx vitest run` ✅ 869/869 (54 archivos), 2 corridas consecutivas | `electron-builder --dir` ✅ (paquete verificado como arriba).

---

### Semana 18 — 2026-11-24 ✅ COMPLETADA
**Auto-actualización** (`electron/updater/`, `electron/ipc/updater.ipc.ts`; la lógica no importa `electron` ni `electron-updater`, recibe el actualizador y las funciones del sistema, así que se prueba sin red ni ventanas):
- `ActualizadorApp` — busca a los 60 s de arrancar y cada 4 h; **descarga silenciosa** (`autoDownload`) y se **instala al cerrar** la aplicación (`autoInstallOnAppQuit`). Estados (`src/shared/types/actualizacion.types.ts`): desactivado · inactivo · buscando · al día · descargando (con %) · lista · error. Un fallo de red se informa y se reintenta en la siguiente búsqueda (no lanza); un error posterior no descarta una actualización ya descargada y respaldada.
- **Respaldo previo:** al terminar de descargar se respalda la base de datos; **si el respaldo falla, la actualización NO se instala sola** (`autoInstallOnAppQuit=false` y aviso) — se prefiere seguir en la versión actual a arriesgar los datos. Al cerrar la aplicación se vuelve a respaldar (los datos cambiaron desde la descarga) **antes de cerrar la base de datos** (`before-quit` en `main.ts`).
- **Nunca interrumpe una venta:** «Reiniciar e instalar» se rechaza si la interfaz informa venta en curso (carrito con líneas, que incluye el cobro abierto), también si empieza durante el propio respaldo; ante un valor raro del IPC se considera «ocupado». Un turno abierto sin carrito no bloquea (no se interrumpe nada). Solo en la aplicación instalada (`app.isPackaged`) y apagable con `VENDEYA_UPDATES=off`; una caja secundaria de la red no respalda (no tiene base propia).
- IPC: `updater:check`, `updater:get-status`, `updater:install`, `updater:set-busy` y el evento `updater:status` (allowlist del preload actualizada).

**Respaldos y vuelta atrás** (`src/server/services/respaldo.service.ts`): `RespaldoService` — copia con `VACUUM INTO` y **verificación** (`PRAGMA integrity_check` + que traiga el esquema; una copia que no pasa se borra y se lanza el error: no se conserva un respaldo inservible), nombre con versión (`vendeya-pre-actualizacion-<sello>-v1.2.0.db`, etiqueta saneada), **rotación independiente por motivo** (pre-migración / pre-actualización, 5 de cada uno), `listar()` y `restaurarRespaldo()` (descarta los `-wal`/`-shm` de la base anterior). `MigrationService` usa este servicio y ahora lanza `MigracionFallidaError` (migración, causa y respaldo); `iniciarBackend` **restaura automáticamente la copia tomada justo antes de migrar** si una migración falla (probado con una migración que falla a medias dejando una tabla creada) y `main.ts` explica al usuario que sus datos están intactos y qué hacer. `BackendHandle.respaldos` expone el servicio.

**Interfaz:** `BannerActualizacion` en el marco (descargando con %, «lista» con «Reiniciar e instalar» —deshabilitado y explicado si hay venta en curso—, error con «Reintentar»; no aparece si no hay nada que decir), hook `useActualizacion` (puente `window.vendeya`; fuera de Electron no hace nada) y pestaña **Ajustes › Actualizaciones** (versión instalada, estado y «Buscar actualizaciones»).

**Pruebas nuevas (36):** `tests/unit/electron/updater.service.test.ts` (16: desactivado, programación 60 s/4 h, flujo completo con porcentaje, al día, error de red y reintento, no buscar dos veces, respaldo que falla → no se instala sola, respaldo previo al reiniciar y orden respaldo→reinicio, venta en curso, venta que empieza durante el respaldo, IPC), `tests/integration/server/respaldo.test.ts` (10: copia con datos, foto del momento, etiqueta que no escapa de la carpeta, listado, rotación por motivo, verificación de archivos vacíos/corruptos/ajenos, copia mala que se borra, restauración, migración que falla a medias → vuelta a la copia, base nueva sin respaldo) y `tests/unit/renderer/actualizacion.test.tsx` (10: banner por estado, rechazo explicado, error con reintento, venta en curso, salida de sesión, pestaña de Ajustes).

**Verificación del paquete:** `electron-builder --dir` ✅ incluye `electron-updater` y el actualizador; el ejecutable empaquetado arranca (backend, 10 migraciones, estado `configurado:false`).

**Limitaciones conocidas:**
- **No se probó una actualización real**: no existe todavía una versión publicada ni el repositorio de releases (`publish` apunta a `vendeya/vendeya-pos` en GitHub, que hay que crear con sus releases y `latest.yml`); `electron-updater` solo se ejercitó con un actualizador simulado. El instalador NSIS sigue sin generarse (ver Semana 17), y las actualizaciones silenciosas en Windows exigen instalador NSIS **firmado** para no mostrar advertencias de SmartScreen.
- Los respaldos viven en la misma carpeta (`userData/data/backups`) que la base: no protegen de la pérdida del disco (respaldo en nube: Semana 22). No hay pantalla para listar/restaurar respaldos manualmente (la restauración automática solo ocurre ante una migración fallida).
- Una caja secundaria de la red se actualiza sola pero sin respaldo ni coordinación con el servidor: si el servidor queda en una versión con otro esquema, no hay aviso de incompatibilidad.
- En macOS/Linux no se probó nada del actualizador.

**Verificación:** `tsc --noEmit` (3 tsconfig) ✅ 0 errores | `vite build` ✅ | `npm run build:main` ✅ | `npx vitest run` ✅ 905/905 (57 archivos), 2 corridas consecutivas.

---

### Semana 19 — 2026-11-24 ✅ COMPLETADA
**Licenciamiento y suscripciones** (`src/server/services/licencia/`, `src/server/jobs/licencia.job.ts`, `electron/licencia.config.ts`). No existía una «Próxima Tarea Exacta» detallada para esta semana (solo la línea de la hoja de ruta): el diseño es de esta sesión.
- **Licencia firmada por el servidor** (`licencia.token.ts`): `base64url(JSON) + "." + base64url(firma Ed25519)` con RUC, plan, máximo de dispositivos, **dispositivo**, emisión y **vencimiento de la suscripción**. La aplicación solo trae la clave **pública** (puede comprobar, no fabricar). Se guarda en la tabla nueva `Licencia` (migración `20261130090000_licencia`): clave, token, dispositivo, `ultimaValidacion`, `ultimoRelojVisto` y el último bloqueo informado por el servidor.
- **Contrato del servidor** (`licencia.cliente.ts`, documentado en cabecera): `POST /v1/licencias/{activar,validar,desactivar,dispositivos,liberar}` con errores `CLAVE_INVALIDA · RUC_NO_COINCIDE · REVOCADA · SUSCRIPCION_VENCIDA · LIMITE_DISPOSITIVOS · DISPOSITIVO_NO_REGISTRADO`. `ClienteLicenciasHttp` (timeout 15 s, respuestas validadas con Zod; sin red, timeout, 5xx o respuesta mal formada = fallo **pasajero** que no cambia el estado).
- **Estados** (`licencia.estado.ts`, función pura, 9 tipos): NO_REQUERIDA · SIN_LICENCIA · ACTIVA · **POR_VENCER** (≤ 7 días) · **GRACIA** (> 2 días sin validar; muestra los días que quedan) · **BLOQUEADA_OFFLINE** (> **15 días** sin validar) · VENCIDA · REVOCADA · INVALIDA (firma inválida, otra empresa, **otro equipo**, o **reloj atrasado** más de 10 min respecto al más alto visto). Lo que responde el servidor (revocada / suscripción vencida / equipo liberado) manda aunque la licencia guardada aún no venza; una respuesta de bloqueo cuenta como validación (el servidor sí respondió, no corre la gracia).
- **Servicio** (`LicenciaService`): activar (valida el formato, pide la licencia, comprueba firma, RUC y equipo, guarda), **validar en línea** (renueva el token; una validación a la vez por empresa), desactivar este equipo (si el servidor no responde NO se borra nada), listar dispositivos y **liberar otro equipo**. `LicenciaWorker`: valida a los 20 s de arrancar y cada **24 h**, sin lanzar nunca.
- **Aplicación de la regla:** sin licencia que permita operar se rechazan con **402 `LICENCIA_REQUERIDA`** solo `POST /api/ventas`, `POST /api/comandas/:id/cobrar` y `POST /api/turnos/abrir`. **Nunca** se bloquea cerrar el turno, consultar, reportes/CSV, emitir comprobantes de ventas ya hechas ni respaldar: los datos del cliente no quedan retenidos. Solo se exige en la aplicación instalada (`app.isPackaged`, apagable con `VENDEYA_LICENCIA=off`) y **con servidor y clave pública configurados**: sin ellos se avisa en Ajustes y las cajas siguen operando (no se bloquea por un build mal configurado). Sin la opción `licencia` (desarrollo, pruebas) no se toca la base.
- **Equipo:** `dispositivo.util.ts` — id estable = hash del `MachineGuid` de Windows (`machine-id` en Linux, `IOPlatformUUID` en macOS); si no se puede leer, uno aleatorio guardado en `secretos/dispositivo.id`. Reinstalar no consume otra plaza.
- **Configuración de la compilación:** `electron/licencia.config.ts` toma `servidorUrl` (https; http solo contra localhost) y `clavePublica` (PEM) de `VENDEYA_LICENCIAS_URL` / `VENDEYA_LICENCIAS_CLAVE_PUBLICA` o de `licencia.config.json` (`electron/` dentro del paquete o `resources/`). **Ese archivo todavía no existe** (ver limitaciones).
- **API:** `GET /api/licencia` (cualquier usuario autenticado: el marco avisa al cajero), `POST /api/licencia/activar`, `POST /api/licencia/validar`, `DELETE /api/licencia`, `GET /api/licencia/dispositivos`, `POST /api/licencia/dispositivos/:id/liberar` (los cinco con `configuracion:actualizar`). Matriz RBAC: 112 filas. Código de error nuevo `LICENCIA_REQUERIDA` → HTTP 402.

**Interfaz:** `BannerLicencia` en el marco (alerta roja «No se puede vender» si bloquea; aviso ámbar en gracia o por vencer; el administrador tiene el botón «Abrir Ajustes › Licencia», el cajero la indicación de avisarle), pestaña **Ajustes › Licencia** (estado con clave enmascarada, plan, vencimiento, última validación y días de gracia; activar con clave; «Validar ahora» que explica si no hubo conexión; equipos con «Liberar» confirmado; «Desactivar este equipo» con confirmación) y navegación directa a una pestaña de Ajustes. **Arranque sin licencia:** el administrador ya no queda atrapado en «Abrir turno» (que daría 402): entra al marco en Ajustes para activar, y al activarse pasa a abrir turno.

**Pruebas nuevas (61):** `tests/unit/server/licencia.test.ts` (21: firma y manipulación, cada estado y sus límites —7/2/15 días, gracia configurable, reloj atrasado y su tolerancia—, id del equipo, cliente HTTP y sus errores), `tests/integration/server/licencia.test.ts` (20, backend real + servidor de licencias simulado que firma de verdad + reloj controlado: sin licencia, activación y sus rechazos, licencia manipulada o copiada a otro equipo, gracia 3 → 16 días con venta permitida y luego 402 **pero cierre de turno, reportes y respaldo funcionando**, vuelta de la conexión, por vencer/vencida/renovada, vencimiento y revocación que informa el servidor, reloj atrasado, límite de equipos, liberar y desactivar —también sin conexión—, validación periódica en segundo plano que se detiene al cerrar, licenciamiento sin configurar y desactivado), `tests/unit/electron/licencia.config.test.ts` (6), `tests/unit/renderer/licencia.test.tsx` (12) y `tests/integration/renderer/licencia-backend.test.tsx` (2: la **interfaz real contra el backend real**, de «sin licencia» a «turno abierto», y la pestaña con el servidor de licencias). Helper `tests/helpers/licencias.helper.ts`.

**Verificación del paquete:** el ejecutable empaquetado aplica las **11 migraciones**, identifica el equipo con el MachineGuid y, sin servidor de licencias configurado, informa «no está configurado» y deja operar.

**Limitaciones conocidas (importantes):**
- **No existe el servidor de licencias real** ni sus claves: lo hecho es el cliente, el contrato y un servidor simulado para pruebas. Falta construir el servicio (altas de clientes, claves, planes, cobro/renovación, panel del proveedor), generar el par de claves Ed25519 (la **privada nunca** en este repositorio), y crear `electron/licencia.config.json` con la URL y la clave pública **antes de distribuir**; hasta entonces cualquier build funciona sin licencia.
- **Es una protección contra el uso indebido casual, no contra un atacante con acceso a la base de datos:** `ultimaValidacion` y `ultimoRelojVisto` están en la base local sin firma, y alguien con acceso al archivo `.db` puede adelantar la validación. Los datos de la licencia en sí (vencimiento, RUC, equipo) sí van firmados. Endurecimiento (sello firmado por el servidor en cada validación, ofuscación) → Semana 22.
- Liberar o desactivar un equipo no invalida su licencia local hasta que ese equipo valide en línea (puede operar hasta agotar su gracia de 15 días). Una máquina virtual clonada comparte el MachineGuid.
- Las cajas secundarias de la red local no tienen licencia propia: el servidor (caja principal) es quien la aplica. El plan limita equipos con licencia, no cajas conectadas por LAN.
- No hay facturación, pasarela de pago ni recordatorios por correo; la renovación ocurre en el servidor de licencias y la aplicación la recoge en la siguiente validación (o con «Validar ahora»).
- La aplicación no muestra aún la fecha de la próxima validación automática ni el historial de validaciones.

**Verificación:** `tsc --noEmit` (3 tsconfig) ✅ 0 errores | `vite build` ✅ | `npm run build:main` ✅ | `npx vitest run` ✅ 966/966 (62 archivos), 2 corridas consecutivas | `electron-builder --dir` ✅.

---

### Semana 20 — 2026-11-25 ✅ COMPLETADA (parcial: ver «No verificado»)
**Instalador de Windows (NSIS) generado de verdad:** `VENDEYA-POS-Setup-0.1.0.exe` (≈ 100 MB) con `latest.yml` y bloque de actualización diferencial, **ícono y metadatos de la marca embebidos** (ProductName, CompanyName, Copyright, versión). El bloqueo de `winCodeSign` de la Semana 17 se resolvió dejando en la caché de electron-builder una copia ya extraída (`Cache/winCodeSign/winCodeSign-2.6.0`: solo fallaban los enlaces simbólicos de macOS, que Windows no usa), sin cambiar ninguna configuración.
- `electron-builder.yml`: NSIS de un clic, por usuario, `asInvoker`, `language: "3082"` (es-ES), accesos directos, `runAfterFinish`, **`deleteAppDataOnUninstall: false`** (desinstalar no borra la base de datos, los respaldos ni los certificados: viven en `%APPDATA%/vendeya-pos`), nombre de archivo **sin espacios** (`VENDEYA-POS-Setup-${version}.${ext}`, debe coincidir con `latest.yml` y con lo que sirve GitHub).
- **Firma de código:** electron-builder firma solo si encuentra `CSC_LINK`/`CSC_KEY_PASSWORD` en el entorno (nunca en el repositorio); el flujo de publicación exige la firma con `-c.forceCodeSigning=true`. `verifyUpdateCodeSignature: false` **hasta que exista el certificado** (activarlo entonces para que `electron-updater` verifique al editor).
- **macOS (`.dmg`, x64 y arm64):** configuración lista (`hardenedRuntime`, `entitlements.mac.plist` con solo JIT, memoria ejecutable, validación de bibliotecas y red cliente/servidor; sin cámara ni micrófono; `icon.icns` generado; notarización con `-c.mac.notarize=true` y `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`). **No se construyó ni se probó (hace falta un Mac).** El esquema de Prisma ahora declara `binaryTargets = ["native","darwin","darwin-arm64"]`: cada instalador lleva solo el motor de su plataforma.
- **Canal estable/beta** (`configurarCanal` en `electron/updater/updater.service.ts`): estable por omisión; `VENDEYA_CANAL=beta` recibe también las versiones de prueba (etiquetas `vX.Y.Z-beta.N` se publican como prerelease).
- **Publicación y CI** (`.github/workflows/`): `ci.yml` (cada push/PR: `prisma generate`, los 3 `tsc`, `npm test`, compilación) y `release.yml` (etiqueta `vX.Y.Z`: verifica que la etiqueta coincida con `package.json`, corre los tests, construye Windows y macOS **firmados**, notariza y publica como GitHub Release con `latest.yml`/`latest-mac.yml`). Los secretos (`WIN_CSC_*`, `MAC_CSC_*`, `APPLE_*`) llegan solo por `secrets.*`.

**Hallazgos graves del empaquetado, corregidos:**
- **El `app.asar` llevaba código de desarrollo:** `src/`, `tests/`, `prisma/` con las **bases de datos de desarrollo** (`vendeya-dev.db`, `vendeya-test.db`, `test-backups/`), **`.env` y `.env.test`**, `AUDIT_REPORT.md`, `REVIEWER_AGENT.md` y hasta la carpeta `release/` del proyecto (91 MB). Causa: electron-builder **ignora la lista `files` global en una plataforma que define la suya** (`win.files`/`mac.files`) y añade `**/*`. Ahora la lista común (con la exclusión explícita de todo eso y de `*.db|*.p12|*.pfx|*.pem|*.key`) va repetida en `files`, `win.files` y `mac.files`; el `app.asar` solo contiene `dist`, `dist-electron`, `node_modules` y `package.json`.
- `react`, `react-dom`, `@tanstack/react-query`, `zustand` y `lucide-react` pasaron a `devDependencies` (Vite ya los empaqueta en `dist`): el instalador pasó de ≈ 116 MB a ≈ 100 MB.
- Los binarios de `serialport` y el motor de Prisma se filtran por plataforma.
- Nota para quien actualice dependencias: `pdfkit` sigue fijado en `~0.20.x` (ver Semana 17).

**Verificación del paquete reproducible** (`npm run test:paquete -- <carpeta win-unpacked>`, `tests/smoke/paquete.smoke.js`): ejecuta el binario empaquetado como Node y levanta el backend desde el `app.asar` con base vacía — 11 migraciones desde `resources/`, alta inicial, login (60 permisos), licenciamiento sin configurar no bloquea, XSD, Code128, PDF, `serialport`, respaldo verificado —, comprueba que el asar no lleva nada de desarrollo y que el motor de Prisma está desempaquetado, y arranca el ejecutable completo con un `userData` temporal (la base se crea en `userData/data`). Variables: `VENDEYA_HUMO_TMP` (carpeta de trabajo) y `VENDEYA_HUMO_GUI=off` (omite el arranque completo).

**No verificado (importante):**
- **Instalar, actualizar sobre una instalación previa y desinstalar no se probó.** Al lanzar el instalador, **Windows SmartScreen lo bloqueó esperando una decisión del usuario** (es lo esperado con un instalador **sin firmar** y es exactamente lo que resuelve la firma de código); no se esquivó. Tampoco la conservación de datos al desinstalar (queda configurada con `deleteAppDataOnUninstall: false`), ni el comportamiento en una **máquina limpia**. Lo único comprobado del instalador es su contenido (abierto con 7-Zip: la aplicación, `app-update.yml`, nativos desempaquetados).
- **El arranque del ejecutable completo no se pudo comprobar en esta sesión:** los procesos de Electron recibían `EPERM` al escribir fuera de la carpeta del proyecto (Temp, AppData) y el ejecutable terminaba con código 3 al instante — también el `electron.exe` original; Node normal sí escribe. Parece una restricción del entorno de ejecución, no del paquete (la misma aplicación empaquetada arrancó bien en las Semanas 17–19), pero **conviene repetir `npm run test:paquete` en un equipo normal**.
- El flujo de CI/publicación **nunca se ejecutó**: requiere el repositorio en GitHub, los secretos y las etiquetas; ni se publicó una versión, ni se probó una actualización de punta a punta.
- `.dmg`: ver arriba. Linux: la configuración existe pero no se usa ni se probó.
- Los íconos siguen siendo **provisionales** («VP» sobre el azul de la marca).

**Procedimiento para probar en una máquina limpia (Windows 10/11 sin Node ni herramientas de desarrollo):** (1) con el certificado de firma configurado, generar el instalador firmado (`npm run build` o el flujo de release) y comprobar en las propiedades del `.exe` la pestaña «Firmas digitales»; (2) copiar el instalador al equipo y ejecutarlo: no debe pedir administrador ni mostrar el aviso rojo de SmartScreen; (3) confirmar el acceso directo, que abre y muestra el **asistente de configuración** y que `%APPDATA%/vendeya-pos/data/vendeya.db` se crea; (4) completar el asistente, vender y cerrar; (5) instalar encima una versión mayor y comprobar que los datos siguen y se creó un respaldo `vendeya-pre-actualizacion-*` (o `pre-migracion-*` si hubo migraciones); (6) desinstalar desde «Aplicaciones» y comprobar que `%APPDATA%/vendeya-pos` **sigue** con la base de datos; (7) anotar tamaño de instalación, tiempo de primer arranque y cualquier aviso.

**Pruebas nuevas (19):** `tests/unit/electron/paquete.test.ts` (17: que la lista común coincida entre plataformas, que no viaje nada de desarrollo —`src`, `tests`, `prisma`, `.env`, informes, bases de datos y certificados—, que solo entre lo compilado, motor de Prisma y `serialport` por plataforma, `asarUnpack`, migraciones y XSD, librerías de la interfaz fuera de las dependencias, `pdfkit` fijado, un solo origen de configuración, NSIS de un clic/por usuario/datos conservados/español/nombre sin espacios, íconos válidos, permisos de macOS, publicación en GitHub Releases, workflows con verificación previa, firma obligatoria y secretos solo por `secrets.*`, `.gitignore` de certificados) y 2 de canal en `updater.service.test.ts`. Nuevos devDependencies: `js-yaml` y `@types/js-yaml`.

**Limitaciones conocidas:** el paquete incluye código del servidor sin ofuscar (el `app.asar` se puede abrir); el licenciamiento y la protección del código son un estorbo, no una barrera. El instalador pesa ≈ 100 MB por Electron, Chromium y `pdfkit`/`bwip-js`/`@prisma`; la actualización diferencial (`.blockmap`) reduce lo que se descarga en las siguientes versiones.

**Verificación:** `tsc --noEmit` (3 tsconfig) ✅ 0 errores | `vite build` ✅ | `npm run build:main` ✅ | `npx vitest run` ✅ 985/985 (63 archivos), 2 corridas consecutivas | `electron-builder --win` ✅ (instalador generado) | `npm run test:paquete` ✅ pasos 1 y 2 (paso 3 sin verificar, ver arriba).

---

### Semana 21 — 2026-11-25 ✅ COMPLETADA
**Banco de rendimiento** (`tests/performance/`, fuera de `npm test`; `vitest.config.ts` lo excluye salvo `VENDEYA_RENDIMIENTO=1`): `npm run test:rendimiento`.
- `generador.ts`: generador reproducible (mulberry32, semilla fija) de **20 000 productos** (categorías, presentaciones, lotes, stock), **5 000 clientes**, **90 días × 1 500 ventas** (con Kardex, CxC y comprobantes), 8 cajeros y 3 000 ventas en un turno abierto. Resultado: **138 000 ventas, 482 517 líneas**, base de 458 MB (548 MB tras la prueba).
- `base.ts`: la base se genera UNA vez en `out/rendimiento/base-<parámetros>.db` (ignorada por git; borrar la carpeta para regenerar) y cada ejecución trabaja sobre una copia. Parámetros reducibles con `VENDEYA_RENDIMIENTO_{PRODUCTOS,CLIENTES,DIAS,VENTAS_DIA,TURNO_ABIERTO}`.
- `rendimiento.test.ts`: presupuestos con `expect.soft` (p50/p95), 8 cajas × 100 ventas por HTTP con invariantes (sin ventas perdidas/duplicadas, sin sobreventa, secuenciales sin huecos, sin `SQLITE_BUSY`) y resultados en `out/rendimiento/resultados.json`.
- Tests del propio banco en la suite normal: `generador-rendimiento` (5), `estadisticas` (2), `rendimiento-ui` (5).

**Hardware de referencia:** portátil i5-13420H (12 hilos), 16 GB, Windows 11, Node 24. **Ruido:** las mediciones variaron hasta ≈10× entre corridas (portátil con otras cargas); los presupuestos son ≈2× el peor valor observado y los rangos de abajo son mínimo–máximo de varias corridas.

**Cuellos de botella reales corregidos:**
- Caché de SQLite de 2 MB → `cache_size=-65536`, `temp_store=MEMORY`, `mmap_size=256 MB`.
- Índices faltantes (migración `20261201090000_indices_rendimiento`, ahora 12 migraciones): Kardex(referencia), LineaVenta(ventaId), LineaVenta(productoId), MovimientoCaja(turnoId), PagoVenta(ventaId), Venta(turnoId), Venta(cajeroId, createdAt).
- Reportes agregados en JS → agregación SQL (`reporte.service.ts`; día de Ecuador = `(createdAt-18000000)/86400000`), orden con `Intl.Collator`.
- Sin `sqlite_stat1` el planificador elegía mal: `asegurarEstadisticas` ejecuta `ANALYZE` una sola vez en bases grandes (≥ 2 000 páginas) y `PRAGMA optimize` al cerrar. (Mejora no demostrada de forma concluyente por el ruido.)
- Respaldo: verificación con `quick_check` en lugar de `integrity_check` (29 s → 7–25 s).
- Interfaz: búsqueda de productos con *debounce* de 150 ms (`useDiferido`, una sola consulta con el texto completo) y reportes paginados de 100 filas (totales y CSV siguen incluyendo todo).

**Números medidos a escala completa (antes → después):** búsqueda por nombre p50 20–40 ms, código 27–90, barras 2–5 · venta de 1 línea 26–41 ms (154) · 20 líneas 61–242 · anulación 15–25 (141) · reporte de turno de 3 187 ventas 31–60 (1 218) · cierre de turno 40–170 · ventas por día 113–420 ms (3 668) · por producto 3,5–7 s · utilidad 3–7 s · stock valorado 0,6–1,6 s · cartera 0,1–0,4 s · comprobantes pendientes 5–12 ms, autorizados 60–210 · cola SRI 35–105 · **ATS del mes 10–25 s** · respaldo 7–25 s · primer arranque con la migración de índices ≈ 20–29 s · arranque normal 80–330 ms · **8 cajas simultáneas 8–24,6 ventas/s, p95 430–860 ms** (antes 4,9/s, p95 2,1 s). Todos los invariantes de concurrencia se cumplieron. La corrida final del banco pasó 8/8.

**Gama baja** (simulada: 2 núcleos, heap de 1 GB): venta p50 37 ms; 8 cajas 20,2 ventas/s, p95 521 ms; RSS 216 → 346 MB tras 800 ventas.

**Limitaciones conocidas:** el ATS y los reportes de producto/utilidad a 90 días tardan segundos (aceptable para reportes gerenciales, no para uso interactivo repetido); venta de 20 líneas ≈ 140–240 ms en el peor caso; se mantiene `synchronous=FULL` (NORMAL arriesga la última transacción ante un corte de luz); **no** hay prueba de fugas de varias rondas ni se simuló la velocidad de un solo núcleo lento; no se probó en equipos reales de gama baja. Varias pruebas de interfaz sensibles al tiempo (escáner «ráfaga rápida», `pos` «escribir filtra…», asistente y Ajustes con backend real) pueden fallar en una corrida completa con la máquina saturada y pasan solas: no son regresiones, pero conviene aumentar sus márgenes.

**Verificación:** `tsc --noEmit` (3 tsconfig) ✅ 0 errores | `build:main` ✅ | `build:vite` ✅ | banco de rendimiento ✅ 8/8 | `tests/unit/renderer` ✅ 138/138 | corrida completa: ver «Tests» arriba (4 fallos de temporización bajo carga).

---

### Semana 22 — 2026-11-25 ✅ COMPLETADA (parcial: ver «No resuelto»)
**Auditoría de seguridad** del backend, los respaldos y el contenedor Electron. Se revisó: autenticación y sesiones, matriz RBAC (ya cubría todas las rutas), SQL crudo, validación de entradas, cabeceras/CORS/registros, asistente de configuración, almacenamiento de secretos y respaldos, y la configuración de la ventana de Electron.

**Hallazgos y correcciones:**
1. **Sin freno a la fuerza bruta en `/api/auth/login`** (intentos ilimitados). → `LimitadorIntentos` (`services/limitadorIntentos.util.ts`): 5 fallos por usuario+dirección en 15 min bloquean ese par 15 min (HTTP 429 `DEMASIADOS_INTENTOS`, también con la contraseña correcta); un acierto reinicia; la tabla tiene tope de 10 000 claves. `trustProxy: false` explícito (un `X-Forwarded-For` falsificado no evade el bloqueo ni hace pasar por local al asistente de configuración).
2. **Enumeración de usuarios por tiempo** (con usuario inexistente no se calculaba el hash). → se verifica contra un hash señuelo: mismo tiempo y misma respuesta.
3. **El token de la sincronización LAN viajaba en la URL del WebSocket y el registro de Fastify la escribía.** → serializador que lo oculta (`urlSinToken`).
4. **Sin cabeceras de seguridad ni límite de cuerpo.** → `Cache-Control: no-store`, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`; `bodyLimit` de 5 MB.
5. **Respaldos:** solo existían los previos a migrar/actualizar. → motivos nuevos `automatico` (se conservan 7) y `manual` (10); **programador diario** (`jobs/respaldo.job.ts`: a los 2 min de abrir y cada 6 h; toma uno si el último tiene > 24 h; activo en la app de escritorio, `RESPALDO_AUTOMATICO=off` lo desactiva); permisos 700/600 en macOS/Linux (`protegerRuta`).
6. **Copia «en la nube»** (`services/respaldoNube.service.ts`, `respaldoCifrado.util.ts`): no usa APIs de proveedores; copia el respaldo **cifrado con AES-256-GCM** (frase ≥ 12 caracteres → scrypt N=2^15; sal e IV aleatorios; la cabecera va como AAD; por bloques, sin cargar la base en memoria; formato `.vdbk`) a una carpeta que el cliente ya sincroniza (OneDrive, Google Drive, Dropbox), un disco externo o de red. El proveedor solo ve texto cifrado. La frase se guarda cifrada con la clave maestra en `secretos/respaldos.json` (nunca en claro ni en la respuesta de la API); se escribe a un temporal y se renombra; se conservan 14 copias. `restaurarRespaldoCifrado()` descifra a un temporal, verifica que sea una base válida y solo entonces reemplaza la base (con frase equivocada o archivo alterado no se toca nada; se conserva `…antes-de-restaurar`).
7. **API de respaldos** (solo `configuracion:actualizar`, es decir administrador): `GET/POST /api/respaldos`, `PUT/DELETE /api/respaldos/nube`, `POST /api/respaldos/nube/exportar`; añadidas a la matriz RBAC.
8. **Electron:** bloqueo de navegación fuera de la interfaz (`will-navigate`), de `webview` y de todos los permisos del navegador; enlaces externos solo http(s) sin credenciales (`electron/navegacion.seguridad.ts`). CSP con `object-src 'none'; base-uri 'none'; form-action 'none'`.

**Revisado y sin hallazgos:** el SQL crudo (`$queryRawUnsafe`/`$executeRawUnsafe`) usa texto fijo o valores escapados (el único con ruta interpolada es `VACUUM INTO`, que la genera el programa y escapa comillas); las consultas del usuario van por Prisma parametrizado; aislamiento por empresa en los servicios revisados; contraseñas con scrypt + `timingSafeEqual`; tokens de 256 bits aleatorios con vencimiento; certificado `.p12` y su clave cifrados (Semana 10); `contextIsolation`/`sandbox` activos; el XML escapa los datos del usuario (pruebas de la Semana 9).

**Pruebas nuevas (28):** `tests/integration/server/seguridad.test.ts` (21: bloqueo y desbloqueo por tiempo, misma respuesta para usuario inexistente, cabeceras, cuerpo de 6 MB → 413, token fuera de los registros, asistente solo local aun con `X-Forwarded-For` falso, 401 sin sesión/token inventado/esquema Basic, 7 cargas de inyección en 7 rutas + login sin 5xx y sin alterar la base, cuerpos con tipos equivocados, cifrado y descifrado sin pérdida, frase errónea y 6 alteraciones de bytes sin dejar archivo, copia en carpeta externa verificada, frase ausente de la API y del disco, restauración, rotación a 14, carpeta no disponible → 409, programador diario y retención de 7) y `tests/unit/electron/navegacion.seguridad.test.ts` (7, incluida la revisión estática de `main.ts`, la CSP y el preload).

**No resuelto / límites (importante):**
- **La base de datos SQLite y los respaldos locales NO están cifrados en reposo**: se apoyan en los permisos del usuario del sistema operativo. Recomendar BitLocker/FileVault. En Windows `chmod` no tiene efecto (se confía en la ACL de `%APPDATA%`, no verificada). La copia en la nube sí va cifrada.
- **No hay pantalla en la interfaz** para respaldos ni para restaurar (solo API y la función `restaurarRespaldoCifrado`, que debe usarse con la aplicación cerrada). Queda para la Semana 23 junto al centro de ayuda.
- Rotar la clave maestra deja ilegible la frase guardada de la nube: el estado lo indica (`requiereReconfigurar`) y hay que configurarla de nuevo.
- La sesión guarda una copia de los permisos del usuario: no hay gestión de usuarios, así que desactivar a alguien o cambiar su rol no cierra sus sesiones abiertas (hasta 12 h). Se resuelve junto con la gestión de usuarios.
- El tráfico entre cajas de la LAN es **HTTP/WS sin TLS**: el token y los datos viajan en claro por la red local; usar solo redes de confianza. Sin bitácora de auditoría de accesos.
- CORS acepta el origen `null`/`file://` (necesario para la interfaz empaquetada). El bloqueo de intentos es en memoria (se reinicia al reiniciar la app).
- La configuración de la ventana de Electron se verifica solo de forma estática (los procesos de Electron no pueden ejecutarse en esta sesión). **No se ejecutó `npm audit`** ni una prueba de penetración externa; el informe independiente (`REVIEWER_AGENT.md`) sigue sin re-ejecutarse.

**Verificación:** `tsc --noEmit` (3 tsconfig) ✅ 0 errores | `npx vitest run` ✅ 1025/1025 (68 archivos).

---

### Semana 23 — 2026-11-25 ✅ COMPLETADA (parcial: ver «No resuelto»)
**1. Centro de ayuda integrado** (`pages/AyudaPage.tsx`, contenido en `pages/ayuda.contenido.ts`): vista «Ayuda» al final del menú para **todos** los roles (permiso especial `PARA_TODOS`; no mueve los atajos Ctrl+número). 16 guías **locales** (funcionan sin internet) agrupadas en primeros pasos, cajero, supervisor, contador y administrador: atajos, abrir turno, vender, anular, ingresos/egresos, cierre ciego, supervisión, clientes y crédito, inventario/compras/ajustes, comprobantes SRI, reportes y ATS, configuración, certificado, licencia, respaldos, **restaurar**, privacidad y solución de problemas. Muestra por defecto las de su rol («Mostrar las guías de todos los roles» amplía), búsqueda sin distinguir tildes/mayúsculas que exige todas las palabras, y artículo con pasos numerados y recuadro «Tenga en cuenta». Una prueba comprueba que los atajos y los nombres de botones que cita la ayuda existen en las pantallas. Se retiraron las guías de **mesas/comandas y de retenciones/liquidaciones/guías de remisión**: esas funciones existen en la API pero la interfaz todavía no tiene pantalla (ver «No resuelto»).

**2. Respaldos en Ajustes** (`pages/AjustesRespaldos.tsx`, pestaña «Respaldos»): lista de respaldos del equipo con su motivo, «Respaldar ahora», configuración de la **copia cifrada en la nube** (carpeta + frase ≥ 12 caracteres, con aviso destacado de que sin la frase no se recupera y casilla «Ya anoté la frase» obligatoria), «Copiar a la nube ahora» y «Dejar de copiar», y **restauración guiada**.
- **Restauración en dos tiempos** (`services/restauracion.service.ts`): «Preparar restauración» exige la **contraseña del administrador** (con el mismo freno de intentos del login; un error de contraseña devuelve 400, no 401, para que la interfaz no cierre la sesión), la frase si es de la nube y marcar que entiende que se reemplazan todos los datos. El servidor descifra (si hace falta) y **verifica** el respaldo y lo deja como `restauracion-pendiente.db`; no toca la base en uso. **Al reabrir la aplicación**, antes de abrir la base, `aplicarRestauracionPendiente` guarda la base actual (y su WAL) como `vendeya.db.antes-de-restaurar-<fecha>`, pone la restaurada y continúa el arranque (que migra si hace falta, con su respaldo previo). «Cancelar restauración» descarta lo preparado. Solo se aceptan nombres que existan en la lista de respaldos o en la carpeta de la nube (probado contra `../`, rutas absolutas y `..\`); la frase no se guarda.
- API nueva: `POST/DELETE /api/respaldos/restaurar`; `GET /api/respaldos` ahora incluye `restauracionPendiente` y las copias de la nube.

**3. Telemetría opcional de errores** (`services/telemetria/`, `controllers/telemetria.controller.ts`, `pages/AjustesPrivacidad.tsx`, `hooks/useReporteErrores.ts`, `components/LimiteErrores.tsx`):
- **Desactivada por defecto**; solo el administrador la activa (Ajustes › Privacidad, que lista qué se reúne y qué nunca). Sin consentimiento el servidor descarta los reportes (ni siquiera crea archivos) y la interfaz no envía la petición. Retirar el consentimiento **borra** la cola.
- **Limpieza de datos personales en el servidor** (`telemetria.util.ts`) antes de guardar: RUC/cédula/claves de acceso y toda secuencia de ≥ 9 dígitos, correos, URL, IP, tokens y valores de `password=`/`Bearer`, rutas con el usuario del sistema (Windows/macOS/Linux); mensaje ≤ 300 y pila ≤ 2 000 caracteres. Un reporte solo contiene: id, fecha, versión, plataforma, origen (interfaz/servidor), nombre de la vista, mensaje y pila. El id de instalación es un UUID aleatorio (no se deriva de la empresa ni del equipo).
- Cola local de 50 reportes (sin ráfagas repetidas); el administrador puede **ver exactamente lo que se enviaría**, descartarlo o enviarlo. El envío va detrás de `TransporteTelemetria` (sustituible); `TransporteHttp` solo acepta https (o este equipo) con espera de 10 s y conserva en la cola lo que el servidor no aceptó. **Sin servidor de destino configurado (`VENDEYA_TELEMETRIA_URL`, no hay ninguno real) los reportes solo se acumulan para revisarlos y «Enviar ahora» queda deshabilitado.**
- Orígenes: errores 500 del servidor (manejador global) y errores no capturados / de dibujo de la interfaz. `LimiteErrores` evita la pantalla en blanco: muestra «Esta pantalla tuvo un problema» con «Volver a intentar» y se reinicia al cambiar de vista.
- API (`/api/telemetria…`, añadida a la matriz RBAC, 86 rutas): estado y registrar errores para cualquier sesión; activar, ver, descartar y enviar solo `configuracion:actualizar`.

**Pruebas nuevas (44):** `tests/integration/server/telemetria.test.ts` (19: 6 familias de datos personales eliminadas, consentimiento, ráfagas, tope, revocación, envío real a un servidor HTTP simulado con fallo 503 y reintento, id estable, destino https, API y 500 limpio), `restauracion.test.ts` (6: contraseña, rutas hostiles, cancelar, aplicar al reabrir con la base anterior conservada, rol, copia cifrada con frase equivocada/correcta), `tests/unit/renderer/ayuda-respaldos.test.tsx` (19: contenido, búsqueda, navegación, respaldos, nube, restauración, privacidad, límite de errores y reporte de `window.onerror` con/sin consentimiento); 4 expectativas del menú actualizadas («Ayuda»).

**Hallazgo de la propia semana:** un 401 por contraseña incorrecta al confirmar la restauración habría cerrado la sesión del administrador (el cliente HTTP trata todo 401 como sesión caducada); se devuelve 400 `VALIDACION`.

**No resuelto / límites:**
- **La interfaz no tiene pantallas** para mesas/comandas, retenciones, liquidaciones ni guías de remisión (solo API): la ayuda no las describe. Tampoco hay gestión de usuarios ni de sucursales.
- La restauración **no es en caliente**: hay que cerrar y reabrir la aplicación (no hay botón de reinicio). En una caja secundaria de la LAN no aplica (no tiene base propia). Restaurar a una base anterior descarta las ventas posteriores (la ayuda lo advierte).
- La telemetría **no tiene servidor real**: lo enviado nunca se probó contra uno de producción; el envío automático (al registrar, máx. 1 por minuto) solo actúa si hay destino. La limpieza de datos personales es por patrones: un dato personal con formato inusual (p. ej. un nombre propio dentro de un mensaje de error) **podría no detectarse**; por eso existe la vista previa y el consentimiento. El asistente de configuración inicial no pregunta por la telemetría (solo Ajustes).
- La ayuda está **solo en español** y es texto estático (sin capturas ni vídeo); la guía de restaurar en una computadora nueva no se probó en un equipo real. Las guías de rol no se validaron con cajeros/contadores reales.
- Una prueba de licencia con intervalos reales (`Validación periódica en segundo plano`) falló una vez en una corrida completa con la máquina saturada y pasa sola 3 de 3 (mismo tipo de fragilidad de tiempo ya registrada).

**Verificación:** `tsc --noEmit` (3 tsconfig) ✅ 0 errores | `npx vitest run` ✅ 1069/1069 (71 archivos; en la segunda corrida completa).

---

### Semana 24 — 2026-11-25 ✅ COMPLETADA como **candidata a v1.0.0** (NO publicada: ver «No verificado» y «Bloqueos para publicar»)
Código congelado en la versión `1.0.0`; instalador de Windows generado; **no se creó la etiqueta `v1.0.0` ni se publicó nada**, porque no se cumplieron las condiciones fijadas para ello (equipo limpio sin probar, instalador sin firmar, sin repositorio de releases, Electron con vulnerabilidades conocidas).

**Revisión y congelamiento**
- Auditoría de estructura (AGENTS.md §5): sin `TODO`/`FIXME`/funciones vacías en `src/`, `electron/`, `prisma/` ni `tests/` (única coincidencia: la palabra «TODO» en el título de una prueba); la raíz solo contiene configuración estándar y carpetas (`out/`, `release/`, `dist*/` ignoradas por git); `AUDIT_REPORT.md` y `REVIEWER_AGENT.md` siguen sin versionar a propósito.
- Versión `1.0.0` en `package.json`/`package-lock.json` y en los valores de respaldo de `health.controller.ts` y `preload.ts`.
- **`npm audit`** (dependencias de producción): de 5 hallazgos altos se corrigieron 4 actualizando **Fastify 4 → 5.12.8** (con `@fastify/cors` 10 y `@fastify/websocket` 11; corrige 9 avisos de Fastify y de `find-my-way`) y **xmlbuilder2 3 → 4** (retira `js-yaml` 3.x vulnerable). El único cambio de código fue tipar `error` como `unknown` en el manejador de errores. Todas las pruebas, el empaquetado y el humo del paquete pasan con las versiones nuevas. **Queda `zod` 3.25 (aviso alto: agotamiento de memoria al validar colecciones enormes con restricciones)**: la corrección exige Zod 4 (cambio mayor que toca todos los esquemas); se acepta temporalmente porque el servidor limita el cuerpo a 5 MB y escucha solo en `127.0.0.1` salvo que el administrador active la red local. **Pendiente de decisión antes de publicar.**
- **`npm audit` completo (incluye herramientas de desarrollo):** además aparecen avisos en `electron` (**la versión incluida, 33.4.x, está dentro del rango vulnerable `<=42.11.15`**), `app-builder-lib`/`builder-util-runtime`/`extract-zip`/`tar` (herramientas de empaquetado, no viajan en el instalador), `esbuild`/`vitest`/`tinypool`/`glob`/`minimatch` (solo desarrollo). **Subir Electron a una versión soportada es la tarea de seguridad más importante antes de publicar**; no se hizo porque el proceso de Electron no se puede ejecutar en esta sesión y un salto de varias versiones mayores (Chromium, Node, `safeStorage`, `electron-updater`) sin poder abrir la aplicación sería un riesgo ciego.
- Pruebas frágiles por tiempo, endurecidas: la «ráfaga del escáner» usa un reloj controlado (el detector mide pausas entre teclas y fallaba con la máquina cargada), la búsqueda con *debounce* tiene margen de 8 s y el margen general de Testing Library pasó de 1 s a 6 s (`tests/helpers/renderer/entorno.tsx`). Antes de este ajuste fallaban 4 pruebas de interfaz en las corridas completas cargadas.

**Empaquetado**
- `npm run build` (prisma generate, 3 compilaciones, Vite) ✅. `electron-builder --win` generó **`VENDEYA-POS-Setup-1.0.0.exe`** (≈ 100 MB, NSIS de un clic por usuario) con `latest.yml`, `.blockmap` y la carpeta `win-unpacked`, en `release/v1.0.0/` (ignorada por git). La carpeta `release/win-unpacked` de la Semana 20 estaba bloqueada por un proceso o filtro que no se pudo identificar (ningún proceso la tenía abierta), así que se usó otra carpeta de salida (`--config.directories.output=release/v1.0.0`). SHA-512 del instalador en `latest.yml`.
- **Firma de código: omitida** (no hay certificado): el instalador es **sin firmar**, Windows SmartScreen mostrará el aviso. No se construyó el `.dmg` (hace falta un Mac).
- `npm run test:paquete -- release/v1.0.0/win-unpacked` ✅ **13/13 comprobaciones** del contenido (12 migraciones desde `resources/`, alta, login con 60 permisos, licencia no requerida, XSD, Code128, PDF, `serialport`, respaldo verificado, el `app.asar` sin código fuente/bases de datos/certificados/`.env`, motor de Prisma desempaquetado) **con Fastify 5 dentro del paquete**.

**No verificado (importante, sin ocultar nada)**
- **El ejecutable empaquetado no arranca en esta sesión** (termina al instante con código 3 sin escribir nada, igual que en la Semana 20; los procesos de Electron no pueden escribir fuera de la carpeta del proyecto aquí). Es una restricción del entorno, pero **la aplicación completa (ventana, IPC, asistente, Electron 33 + Fastify 5) no se ha visto funcionando con esta versión**.
- **Instalar, actualizar sobre una versión previa, desinstalar conservando datos y la máquina limpia (Windows 10/11 y macOS) NO se probaron** (SmartScreen bloqueó el instalador sin firmar en la Semana 20 y no se esquivó). Tampoco la restauración de una copia en un equipo nuevo.
- Sin probar con equipos reales: impresora térmica/gaveta, balanza, lector de códigos, dos cajas en red, rendimiento en gama baja. Sin servidor real de licencias, de actualizaciones (GitHub Releases) ni de telemetría. El CI/publicación nunca se ejecutó.
- Contra el SRI solo se probó con un cliente simulado; la prueba real contra `celcer` (con el `ECONNRESET` pendiente) **no se hizo**: ninguna factura de esta versión fue autorizada por el SRI real.

**Notas de la versión 1.0.0 (lo entregado, por semana)**
Cimientos y base de datos (S1–4) · núcleo POS, inventario y turnos con cierre ciego, cartera, retail, farmacia y restaurante (S5–8; la interfaz de mesas aún no existe) · motor tributario SRI: clave de acceso, XML v2.10/2.30 con XSD, firma XAdES-BES con `.p12` cifrado AES-256-GCM, cola offline con reintentos, retenciones/liquidaciones/guías/ATS (S9–12) · impresión térmica y RIDE, periféricos y red local con sincronización (S13–14) · interfaz POS y vistas de gestión (S15–16) · asistente inicial, auto-actualización con respaldo previo, licenciamiento con gracia sin conexión e instalador (S17–20) · rendimiento a 138 000 ventas con 8 cajas (S21) · auditoría de seguridad, freno a fuerza bruta, respaldos cifrados (S22) · centro de ayuda, restauración guiada y telemetría opcional (S23) · dependencias actualizadas y paquete 1.0.0 (S24).

**Límites conocidos del producto** (acumulados): ver cada semana. Los principales: base SQLite sin cifrar en reposo; LAN sin TLS; sin pantallas de mesas/comandas ni de retenciones/liquidaciones/guías; sin nota de débito ni `ats.xsd` oficial; ATS y reportes de 90 días tardan segundos; licenciamiento e instalación son un estorbo, no una barrera.

**Verificación:** `tsc --noEmit` (3 tsconfig) ✅ | `npx vitest run` ✅ 71/71 archivos (≈ 1069 pruebas) | `npm run build` ✅ | instalador `1.0.0` generado ✅ | `test:paquete` ✅ 13/13 (arranque del ejecutable ✗ por el entorno).

---

### Corrección de auditoría (2026-11-26) — `fix:` ✅
El auditor (`AUDIT_REPORT.md`, fuera de Git) revisó el código hasta la Semana 24 y lo aprobó; pidió cerrar lo siguiente, que quedó corregido:
- **`EPERM` al renombrar archivos temporales en Windows** (antivirus/indexador reteniendo el archivo recién escrito): `src/server/services/archivo.util.ts` → `renombrarConReintento` (hasta 6 intentos con espera creciente solo ante `EPERM`/`EBUSY`/`EACCES`; cualquier otro error, o un bloqueo que no cede, se propaga). Aplicado a todos los «escribir `.tmp` y renombrar»: telemetría, certificado, clave maestra, configuración de la nube y restauración preparada. El patrón sigue siendo atómico ante un corte de luz. 4 pruebas nuevas (`tests/unit/server/archivo.util.test.ts`).
- **Prueba frágil de licencia** (`licencia.test.ts`, validación periódica): era una carrera entre el intervalo real de 40 ms y la lectura del estado; ahora el servidor de licencias está «caído» durante la comprobación de gracia y solo después se restablece.
- **Higiene de release**: `tsconfig.json` sin `baseUrl` (rutas con `./`) y `tsconfig.node.json` con `module`/`moduleResolution` `Node16` (aviso de TypeScript 6; el emit sigue siendo CommonJS); pruebas unitarias de `fechaEcuador`, `xmlTexto` y `xsdValidator`; contrato de `validarClaveAcceso` documentado; espera de `sync-lan.test.ts` ampliada; `.env.test` fuera de Git (nada lo leía) y registrado en `.gitignore`.
- **Empaquetado con `Node16`** (pedido por el auditor): `build:main`, `build:vite` y `electron-builder --win --dir` OK; `npm run test:paquete` sobre ese paquete: **13/13 comprobaciones de contenido ✅** (migraciones, alta, login, XSD, Code128, PDF, serialport, respaldo, `app.asar` limpio, motor de Prisma); las 2 que abren el ejecutable siguen fallando solo por el entorno (los procesos de Electron no pueden escribir fuera del proyecto aquí). La carpeta temporal del humo se apuntó a `out/` (dentro del proyecto).
- **No corregido a propósito (requiere recursos externos o decisión):** Electron 33.x vulnerable, firma de código, factura autorizada por el SRI real, Zod 4, máquina limpia/servidores reales (ver «Próxima Tarea Exacta»). Opcional pendiente: configuración de Vite en ESM (aviso «CJS build of Vite's Node API is deprecated»).

---

### Post-1.0 — Gestión de usuarios y sucursales (2026-11-25) ✅
Cierra la limitación «no hay gestión de usuarios ni de sucursales» de las Semanas 15–24: hasta hoy un cliente real no podía crear un cajero ni una caja nueva sin tocar código.

**Servidor** (`usuarioAdmin.service.ts`, `sucursal.service.ts`, controladores `usuario`/`sucursal`; sin migraciones: usa las tablas y permisos existentes `usuarios:*` y `configuracion:*`)
- Usuarios: `GET/POST /api/usuarios`, `PATCH /api/usuarios/:id`, `POST /api/usuarios/:id/estado|password`, `GET /api/roles`, y `POST /api/auth/password` (cada persona cambia la suya, cualquier rol). Solo el administrador (`usuarios:*`) gestiona a los demás.
- Reglas en el servidor: nunca se ve ni toca a otra empresa (404); nadie se desactiva ni cambia el rol a sí mismo; la empresa no se queda sin un administrador activo; no se desactiva a quien tiene un turno de caja abierto; las personas **no se borran, se desactivan**; el nombre de usuario no cambia y se guarda en minúsculas (el inicio de sesión ya no distingue mayúsculas; los usuarios antiguos con mayúsculas siguen entrando).
- **Cierre de sesiones** (el pendiente de la Semana 22): `SessionService.revocarDeUsuario` cierra todas las sesiones de una persona al desactivarla, cambiarle el rol o la contraseña (la sesión guardaba una copia de los permisos); las cajas de la LAN pierden su conexión en el siguiente latido. Al cambiar la propia contraseña se cierran las demás sesiones propias y continúa la actual.
- Contraseñas: restablecer la de otra persona exige la del administrador (con el mismo freno de intentos del login); una confirmación equivocada responde **400**, no 401 (un 401 haría que la pantalla cierre la sesión).
- Sucursales: `GET/POST /api/sucursales`, `PATCH /api/sucursales/:id`, `POST /api/sucursales/:id/estado|puntos-emision`, `PATCH /api/puntos-emision/:id`. El código (001, 002…) lo asigna el sistema, es consecutivo, **no cambia ni se reutiliza** (es parte de la serie y de la clave de acceso del SRI); crear una sucursal crea su «Caja principal». No se desactiva una sucursal con turnos o cuentas de mesa abiertos, ni se deja a la empresa sin un punto de emisión activo; desactivar conserva todo el historial y el POS deja de ofrecerla.

**Interfaz**: Ajustes › **Usuarios** (solo con `usuarios:leer`) y Ajustes › **Sucursales**; botón **Mi contraseña** en la barra superior para todos los roles; guías «Usuarios» y «Sucursales y cajas» en el centro de ayuda.

**Pruebas** (+30): `tests/integration/server/usuarios-sucursales.test.ts` (25: alta, filtros, edición, rol, auto-protecciones, último administrador, turno abierto, sesiones cerradas, contraseñas, aislamiento entre empresas, sucursales/cajas), `tests/integration/renderer/usuarios-backend.test.tsx` (5: la interfaz real contra el backend real), matriz RBAC ampliada (13 rutas) y ayuda. Además: `tsconfig` sin `baseUrl` y con `Node16` (avisos de TypeScript 6), 3 pruebas de utilidades SRI y una espera ampliada en `sync-lan.test.ts`.

**Guardar la factura al cobrar**: la pantalla de venta terminada ofrece «Guardar factura (PDF)» (el RIDE de esa venta) para entregarla o enviarla sin impresora. Ruta nueva `GET /api/ventas/:id/ride` con el permiso `ventas:leer` (el cajero no tiene el del monitor del SRI); solo devuelve la factura de esa venta (404 si no tiene). El PDF de una factura aún no autorizada sale marcado «sin valor tributario». No se ofrece si la venta no generó factura (hoy el ticket térmico solo existe para la impresora).

**Límites / pendiente**: no hay PIN de caja rápida ni «usuarios por sucursal» (cualquier usuario puede abrir turno en cualquier sucursal activa); no hay recuperación de contraseña si se pierde la del único administrador (hay que restaurar o resetear la base: fuera del alcance); no hay registro de auditoría de quién cambió qué (solo `updatedAt`); el establecimiento nuevo debe registrarse en el SRI fuera del sistema (la pantalla lo advierte).

---

## Pendientes registrados antes de resolver los bloqueos de pre-lanzamiento
El plan de 24 semanas está ejecutado; **el producto no debe publicarse todavía**. Lista de verificación en orden de prioridad:

1. ~~Actualizar Electron~~ ✅ **hecho (2026-11-26): Electron 33.4.11 → 45.5.0 y Zod 3 → 4.6.7** (`npm audit --omit=dev`: 0 vulnerabilidades; Electron ya no figura). Verificado: `tsc` ×3 0 errores, `npm test` 76/76 archivos (1118 pruebas), `electron-builder --win --dir` y `test:paquete` **13/13 comprobaciones de contenido** sobre el motor de Electron 45 (Prisma, serialport, PDF, XSD, respaldo). **Falta, y solo se puede en un equipo real: abrir la aplicación con Electron 45** (ventana, IPC, `safeStorage`, impresoras, actualización); aquí el ejecutable sigue saliendo con código 3 por el entorno. Ajustes de compatibilidad: `will-navigate` usa `evento.url` (los argumentos sueltos están obsoletos) y el tipo de impresoras (`isDefault`). `electron-builder` no pudo descargar su propia copia de Electron (carpeta fuera del proyecto); se empaquetó con `--config.electronDist=node_modules/electron/dist --config.electronVersion=45.5.0`. Quedan avisos solo en herramientas de empaquetado (`electron-builder` 25 / `electron-updater`), que no viajan en el instalador.
2. **Máquina limpia Windows 10/11 (y un Mac para el `.dmg`)** con el procedimiento de la Semana 20: instalar, asistente, vender, cerrar turno, respaldar y **restaurar**, actualizar encima, desinstalar conservando `%APPDATA%/vendeya-pos`. Anotar resultados aquí.
3. **Certificado de firma de código** (Windows y Apple), `verifyUpdateCodeSignature: true`, repositorio de releases en GitHub con los secretos (`WIN_CSC_*`, `MAC_CSC_*`, `APPLE_*`), CI/`release.yml` y una **actualización real de punta a punta**; solo entonces etiqueta `v1.0.0` (`git tag v1.0.0`) y publicación.
4. **SRI real:** consulta y factura completa en `celcer` con certificado de pruebas (`ECONNRESET`), luego producción; nota de débito y `ats.xsd` oficial.
5. **Equipos reales:** ticket/RIDE, gaveta, balanza, lector, dos cajas en red, rendimiento en gama baja.
6. Servidor de licencias real y `electron/licencia.config.json`; servidor de telemetría (o dejarla sin destino); íconos y marca definitivos.
7. Re-ejecutar la auditoría independiente (`REVIEWER_AGENT.md`); funciones pendientes de producto: pantallas de mesas/retenciones/guías, usuarios por sucursal (hoy un usuario opera en cualquiera), TLS en la LAN y cifrado en reposo de la base.

---

### Revisión de distribución — 2026-11-26

- Estado: publicación bloqueada. El ejecutable de `release/v1.0.0` devuelve `NotSigned` en Authenticode. Su SHA-512 y tamaño coinciden con `latest.yml`. El ASAR de esa compilación no contiene los controladores de usuarios y sucursales que están en el código actual.
- Seguridad: `npm audit --omit=dev` reportó un hallazgo alto en Zod 3.25.76. El informe completo reportó 28 hallazgos (4 críticos, 16 altos y 8 moderados), incluido Electron 33.4.11, que se distribuye como runtime aunque figure en devDependencies.
- Actualizaciones: `verifyUpdateCodeSignature` está en `false`. El paquete y electron-builder apuntan a `vendeya/vendeya-pos`, mientras que el remoto `origin` es `claygrefa/VENDEYA-POS`. Confirmar el repositorio de publicación y el acceso para el flujo de release antes de generar un paquete de distribución.
- Alcance: el único esquema Prisma usa SQLite. PostgreSQL para multicaja sigue pendiente respecto del stack definido. Persisten los límites y las verificaciones de campo pendientes de la Semana 24.
- Archivos actualizados: `PROJECT_STATUS.md` y `tests/integration/server/seed-services.test.ts`. La suite de seed prepara su base SQLite con `MigrationService`, el migrador de arranque de la aplicación. El CLI de Prisma fallaba desde Vitest en este entorno, aunque aplicó las 12 migraciones al ejecutarlo directamente con una ruta absoluta. Después del cambio, la suite de seed pasó 19/19.
- Verificación: los tres `tsc --noEmit`, `build:main` y `build:vite` finalizaron correctamente. La última corrida completa anterior a la corrección final obtuvo 1092 pruebas aprobadas, 1 fallo intermitente en Ajustes y 19 pruebas sin ejecutar por el fallo inicial de seed. En ejecuciones aisladas posteriores pasaron seed (19/19) y Ajustes con backend real (3/3). Queda confirmar la suite completa en CI desde el commit candidato.
- Siguiente tarea técnica: actualizar Electron y verificar el arranque del nuevo paquete con la base local, IPC y periféricos nativos. Después, resolver el aviso de Zod, repetir el análisis de dependencias y construir un candidato firmado desde un commit verificable.

---

### Correcciones de la auditoría 2026-11-26 (2) — `fix:` ✅
El auditor aprobó el código salvo un defecto alto y varias mejoras; todo lo siguiente quedó corregido y verificado (`tsc` ×3, ESLint, `npm test` 79/79 archivos y 1136 pruebas).
- **Defecto alto: una caja ya no puede quedar bloqueada en «Cobro pendiente».** Tras un intento fallido aparece **«Descartar cobro pendiente»** (con confirmación). Es **seguro porque lo decide el servidor**: `POST /api/cobros/:intentoId/descartar` (`ventas:crear`, `intentoCobro.service.ts › descartarIntento`) comprueba en una transacción si el cobro ya se registró — si sí, responde 409 y hay que «Recuperar cobro» (nunca se descarta una venta existente); si no, deja una **lápida** `FAILED/COBRO_DESCARTADO` con el mismo UUID, de modo que un reintento rezagado ya no puede crear la venta (se rechaza como `DUPLICADO`) y queda constancia. Un cajero no puede descartar ni reservar el UUID de otro. El carrito se conserva. *Decisión:* no se restringió a supervisores —el intento está guardado por cajero, así que un supervisor no lo vería— porque la seguridad la da el servidor, no el rol. Los errores no controlados siguen sin guardarse como resultado (así los fallos transitorios se pueden reintentar); la salida es el descarte. 8 pruebas de servidor (`cobro-descartar.test.ts`) y 3 de pantalla.
- **Purga de `IntentoCobro`** (cada venta guardaba su respuesta completa para siempre): se borran los intentos `CONFIRMED`/`FAILED` con más de 30 días, al arrancar y cada 24 h (`purgarIntentosCobro`); índice nuevo `IntentoCobro_creadoEn_idx` (migración `20261205090000_intento_cobro_indice`). **La prueba detectó un fallo real:** estas filas se insertan con SQL directo y su fecha queda como texto, y Prisma compara fechas como números, por lo que un `deleteMany` por `creadoEn` no habría borrado nada; la purga compara dentro de SQLite.
- **Licenciamiento no desactivable desde el entorno:** instalada, la app **siempre** exige licencia (se quitó `VENDEYA_LICENCIA=off`) y la URL, la clave pública y el destino de telemetría salen solo del `licencia.config.json` incrustado (`empaquetada: app.isPackaged`); en desarrollo siguen valiendo las variables. 2 pruebas nuevas.
- **Suite de estrés fuera de `npm test`** (depende de la carga de la máquina): `npm run test:estres` y un trabajo manual `estres` en `ci.yml`.
- **Estructura:** `STRESS_AUDIT_REPORT.md` → `docs/`; eliminado `electron/updater/.gitkeep.ts`; `AGENTS.md` documenta `docs/`, `src/server/cloud/` y los bancos de pruebas.
- **Opcionales:** cuota diaria de telemetría en el backend cloud (500 por instalación y 50.000 en total → 429; prueba con PGlite); `pg` y `@fastify/rate-limit` excluidos del instalador (`electron-builder.yml`, las tres listas; prueba en `paquete.test.ts`); CI ejecuta `npm run lint` y `npm audit --omit=dev`; BOM quitado de `release.yml`; `version` fija eliminada del `preload`.
- **No aplicado a propósito:** fijar las acciones de GitHub por SHA de commit (hay que consultarlas en GitHub, no se pueden resolver sin red) y validar `event.senderFrame` en los manejadores IPC (no se puede probar con Electron abierto en este entorno y un fallo dejaría la aplicación sin IPC; está mitigado porque la ventana solo carga `file://` y la navegación está bloqueada).
- **Cambios de otro proceso confirmados:** `electron/dev-runner.cjs` y el script `dev:electron` (lanzan Electron sin `ELECTRON_RUN_AS_NODE`) y la limpieza del registro `electron-dev.log` en `electron/main.ts`.

### Actualizador silencioso — `fix:`
- El repositorio de releases ya era el correcto en todas las fuentes (`electron-builder.yml` → `claygrefa/VENDEYA-POS`, igual a `package.json › repository`, al remoto `origin` y a `publicar.ts`); `paquete.test.ts` ahora comprueba que las tres coincidan. Un `app-update.yml` con `owner: vendeya` solo existe en `release/v1.0.0/` (artefacto viejo, ignorado por Git).
- **Los fallos al comprobar actualizaciones (404 por no haber releases, sin red, evento `error`) ya no llegan a la interfaz:** se eliminó el estado `error` de `EstadoActualizacion`, `ActualizadorApp.alFallar` solo registra y vuelve al estado anterior (`al-dia` o `inactivo`) y se quitó el banner de error. La búsqueda periódica (4 h) reintenta.
- Archivos: `electron/updater/updater.service.ts`, `src/shared/types/actualizacion.types.ts`, `src/renderer/components/BannerActualizacion.tsx`, `src/renderer/pages/AjustesPage.tsx`, tests de `updater.service`, `actualizacion` y `paquete`.
- **Verificación:** `tsc` ×3 = 0 errores; `npm test` **79/79 archivos · 1140/1140 pruebas ✅** (incluye las pruebas nuevas del actualizador silencioso).
- **Fallo del ejecutor («Vitest failed to find the runner») — causa y solución:** no eran las versiones (Vitest 5.1.2 + Vite 8.4.0 son compatibles y se mantienen). Ocurre solo cuando la carpeta de trabajo llega con la **letra de unidad en minúscula** (`c:\Users\…`, como abre la terminal de VS Code): Vitest 5 carga dos copias del módulo `vitest`. Desde `C:\Users\…` (mayúscula) todo pasa. Ejecuta las pruebas desde `cd "C:/Users/elder/Desktop/VENDEYA-POS"`. Se probó normalizar la ruta en `vitest.config.ts` (`root`, `setupFiles`) y no basta, por eso no se tocó la configuración ni `package.json`.

### Auditoría de estrés POS — 2026-11-26

- Se añadió `tests/stress/posStress.test.ts` con SQLite temporal, 25.000 productos, 1.000 ventas consecutivas, 50 peticiones simultáneas, 500 facturas offline, fallos controlados de persistencia y corte TCP antes de completar un cobro.
- Se corrigieron el timeout SQLite, la búsqueda de catálogo, el redondeo de líneas y la limpieza de WebSockets. Se añadieron migraciones para unicidad fiscal e índice FTS5. Los archivos y límites están detallados en `docs/STRESS_AUDIT_REPORT.md`.
- Verificación: los tres chequeos de TypeScript pasaron y Vitest aprobó 1.118/1.118 pruebas en 76 archivos, incluidas las cinco de estrés. Máximos de catálogo 5,13 ms por barras y 23,19 ms por nombre parcial. Se registraron 34,85 ventas/s consecutivas, 20 cobros de 50 con stock limitado y 500 autorizaciones simuladas tras restablecer la conexión. SQLite pasó integridad y se eliminó la base temporal. Persisten avisos de Vite CJS y de `act()` en pruebas del renderer. El cliente Prisma se generó en un destino aislado porque Windows mantenía ocupada la DLL local.
- Próxima tarea atómica: comprobar el arranque y la migración de un candidato firmado sobre una copia representativa. Se mantiene pendiente la idempotencia ante pérdida de respuesta tras confirmar un cobro.

### Revisión del candidato 74aa179 — 2026-11-26

- Distribución comercial bloqueada. El único instalador NSIS local devuelve `NotSigned`. El paquete descomprimido de Electron 45 pasó 13 comprobaciones de backend y contenido, con 14 migraciones aplicadas. El ejecutable completo no respondió ni creó la base en el perfil temporal de la prueba.
- Los tres chequeos de TypeScript y las 1.118 pruebas en 76 archivos pasaron. `npm audit --omit=dev` no reportó hallazgos. La auditoría completa reportó 25 en herramientas de desarrollo y empaquetado (4 críticos, 13 altos y 8 moderados). Electron no figura en esa lista.
- La configuración de Windows mantiene `verifyUpdateCodeSignature: false`, incluso cuando el flujo de release exige firmar el instalador. El destino de publicación configurado difiere de `origin`. Sigue pendiente verificar la autorización de una factura con el SRI y probar instalación, actualización y restauración en equipos limpios.
- El cobro carece de idempotencia ante pérdida de respuesta después de confirmar la transacción. La prueba de estrés cubre un corte durante el envío, antes de completar la solicitud.
- Archivo actualizado: `PROJECT_STATUS.md`. Siguiente tarea atómica: generar un instalador firmado de Windows con verificación de firma de actualizaciones habilitada y confirmar que inicia en un equipo limpio.

### Firma de actualizaciones de Windows — 2026-11-26

- `electron-builder.yml` habilita `win.verifyUpdateCodeSignature`. En una compilación firmada, electron-builder registra el editor del certificado en `app-update.yml`. `tests/unit/electron/paquete.test.ts` comprueba que la protección siga habilitada.
- Pasaron los tres chequeos de TypeScript, las 1.118 pruebas en 76 archivos, `build:main` y `build:vite`. La compilación NSIS con firma obligatoria y publicación deshabilitada llegó a SignTool y se detuvo por falta de acceso al certificado de firma de código.
- Siguiente tarea atómica: usar el certificado de VENDEYA para construir el NSIS, validar Authenticode y el editor en `app-update.yml`, e instalar y verificar el primer arranque en el Windows limpio.

### Nombre visible de Windows — 2026-11-26

- `electron-builder.yml` usa `vendeyapos` en el acceso directo y `vendeyapos-Setup-1.0.0.exe` como nombre previsto del instalador. `electron/main.ts` y `src/renderer/index.html` aplican el mismo nombre a la ventana. `tests/unit/electron/paquete.test.ts` verifica el acceso directo.
- Pasaron los tres chequeos de TypeScript, `build:main`, `build:vite` y las 1.118 pruebas.
- Siguiente tarea atómica: construir el instalador con el certificado de firma de código y verificar el primer arranque en el Windows limpio.

### Instalador firmado de prueba para Windows — 2026-11-26

- Se generó `out/vendeyapos-prueba/vendeyapos-Setup-1.0.0.exe` con firma Authenticode, sello de tiempo y el certificado autofirmado `vendeyapos (prueba)`. Se exportó el certificado público a `out/vendeyapos-prueba/vendeyapos-prueba.cer`. La clave privada no exportable queda en el almacén personal de Windows. No se publicó el instalador ni se cambió la confianza de Windows.
- La huella del firmante coincide con la del certificado público y `app-update.yml` contiene el mismo editor. Windows identificó la firma y reportó que su raíz no es de confianza en este entorno.
- Pasaron los tres chequeos de TypeScript, las 1.118 pruebas y las 13 comprobaciones de contenido y backend del paquete. El ejecutable completo no respondió ni creó la base con el perfil temporal de la prueba.
- Siguiente tarea atómica: probar el instalador en el Windows limpio que el usuario tiene disponible, con confianza de prueba configurada únicamente en ese equipo, y verificar la ventana del asistente y la creación de la base.

### Recuperación de un primer arranque interrumpido — 2026-11-26

- La inspección de solo lectura confirmó que la base que producía «El respaldo no contiene el esquema de la aplicación» únicamente tenía el registro de migraciones sin filas. `src/server/services/migration.service.ts` omite el respaldo previo en ese caso y mantiene el respaldo obligatorio para esquemas existentes. `tests/integration/server/migration.service.test.ts` cubre el reinicio después de un fallo durante la primera migración.
- Se generó y verificó el firmante de `out/vendeyapos-arranque-corregido/vendeyapos-Setup-1.0.0.exe` con el certificado de prueba. El backend empaquetado aplicó las 14 migraciones y respondió HTTP 200 para el asistente usando una copia de la base afectada. La base original quedó intacta.
- Pasaron los tres chequeos de TypeScript, las 1.119 pruebas y 13 comprobaciones de contenido y backend del paquete. El arranque gráfico con perfil temporal sigue sin pasar en este entorno.
- Siguiente tarea atómica: instalar el paquete corregido sobre la instalación de prueba y confirmar que se abre la ventana del asistente en Windows.

### Arranque verificado en la instalación local — 2026-11-26

- El acceso directo apuntaba a una instalación con el ASAR del paquete anterior. NSIS terminó con código 2 al intentar retirar esa instalación. Se respaldaron y reemplazaron únicamente los tres archivos de programa que diferían del paquete firmado corregido, sin borrar datos ni modificar accesos directos.
- Se verificó el arranque real de la instalación reparada. La API respondió `configurado: false` y la ventana mostró el paso «Empresa» del asistente. La ventana quedó abierta.
- Siguiente tarea atómica: reproducir el código 2 de NSIS en un entorno aislado y validar la actualización y el primer arranque en otra máquina Windows limpia.
