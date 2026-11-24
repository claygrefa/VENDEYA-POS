# PROJECT_STATUS.md — Bitácora Maestra de Desarrollo (VENDEYA POS)

## Estado General
- **Proyecto:** VENDEYA POS (Sistema Punto de Venta Multi-Giro & Facturación Electrónica SRI Ecuador)
- **Horizonte:** 6 Meses (24 Semanas)
- **Fase Actual:** MES 3 — Semana 12: retenciones, guías de remisión, liquidaciones de compra y ATS
- **Estado de Compilación:** ✅ `tsc --noEmit` → 0 errores | ✅ `tsconfig.node.json` → 0 errores | ✅ `tsconfig.electron.json` → 0 errores
- **Tests:** ✅ 603/603 passed (36 archivos de prueba)
- **Último Commit:** `feat: Semana 11 - cliente SOAP del SRI y worker de la cola offline`

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
- [ ] **Semana 12 (ACTUAL):** Soporte para Retenciones, Guías de Remisión, Liquidaciones de Compra y generador automático de archivo XML del Anexo Transaccional Simplificado (ATS).

### MES 4: Hardware, Red Local (LAN) y Experiencia de Caja
- [ ] **Semana 13:** Motor de impresión térmica directa ESC/POS (USB, Ethernet, 80mm/58mm), apertura automática de gaveta de dinero y generador de RIDE en PDF A4.
- [ ] **Semana 14:** Integración de periféricos (lectores de códigos de barras, balanzas seriales) y sincronización multi-caja en red local (LAN) vía WebSockets sin depender de internet.
- [ ] **Semana 15:** Frontend POS principal (`PosScreen`), búsqueda ultrarrápida, atajos de teclado (`F2`, `F4`, `F8`, `ESC`), modo táctil y modal de cobro.
- [ ] **Semana 16:** Vistas de Inventario, Kardex, Clientes, Reportes Gerenciales y Monitor de Comprobantes SRI (`SriMonitor`).

### MES 5: Instalador Cero Fricción, Auto-Updater y Licenciamiento
- [ ] **Semana 17:** Asistente de Configuración Inicial (`SetupWizard`) guiado en 3 pasos para clientes sin conocimientos técnicos (datos RUC, carga de `.p12`, selección de giro de negocio).
- [ ] **Semana 18:** Implementación de `electron-updater` con descarga silenciosa en segundo plano, respaldo automático de la base de datos SQLite antes de aplicar actualizaciones y banner de actualización.
- [ ] **Semana 19:** Sistema de licenciamiento y suscripciones (activación online, validación periódica con período de gracia offline de 15 días, control de dispositivos).
- [ ] **Semana 20:** Configuración de `electron-builder` + Inno Setup para generar instaladores nativos `.exe` (Windows) y `.dmg` (macOS) firmados y listos para distribución.

### MES 6: Auditoría, Seguridad, Estrés y Lanzamiento Comercial
- [ ] **Semana 21:** Pruebas de estrés y rendimiento con bases de datos de 20,000+ productos y simulación de 1,500 ventas diarias en hardware de gama baja/media.
- [ ] **Semana 22:** Auditoría de seguridad (protección de SQLite, sanitización de entradas, permisos RBAC por rol de cajero/supervisor/admin, respaldos automáticos locales y en nube).
- [ ] **Semana 23:** Centro de ayuda integrado en la aplicación, guías rápidas para cajeros/contadores y telemetría opcional de errores.
- [ ] **Semana 24:** Corrección final de detalles, congelamiento de código, pruebas en máquinas limpias (Windows 10/11 y macOS) y empaquetado oficial **v1.0.0 Comercial**.

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

---

## Próxima Tarea Exacta (Para ejecutar ahora — Semana 12)
1. **Retenciones (07), Guías de Remisión (06), Liquidaciones de Compra (03)** y, si cabe, Notas de Débito (05): descargar los XSD oficiales del SRI (como en la Semana 9; no escribirlos a mano) y registrarlos en `xsd/ORIGEN.md`; constructores XML puros en `comprobanteXml.builder.ts` (o archivos por tipo), mapeo desde compras (liquidación, retención sobre compras/gastos) y validación XSD con `XsdValidatorService`. Reutilizar clave de acceso, secuenciales, firma y la cola de la Semana 10–11 (prioridad 1 para retenciones). Respetar los flags `emitirRetenciones`, `emitirGuiasRemision` y `emitirLiquidaciones` de `ConfiguracionGiro`.
2. **Anexo Transaccional Simplificado (ATS)**: generador del XML mensual (ventas por tipo de comprobante, compras con sus retenciones, anulados) y su validación contra el XSD oficial del ATS; endpoint de descarga por periodo (`reportes:exportar`).
3. **Pruebas:** XML de cada comprobante válido contra su XSD, firma y envío por el SRI simulado, totales del ATS contra datos de ventas/compras reales del entorno de pruebas, matriz RBAC actualizada.
4. Antes de empezar: contrastar con la ficha (y, si se consigue, con `celcer`) los códigos de respuesta de la Semana 11 y re-ejecutar la auditoría independiente (`REVIEWER_AGENT.md`).
5. Verificar con `npx tsc --noEmit` y `npm test`; actualizar este archivo y commit `feat: Semana 12 - retenciones, guias, liquidaciones y ATS`.
