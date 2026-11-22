# PROJECT_STATUS.md — Bitácora Maestra de Desarrollo (VENDEYA POS)

## Estado General
- **Proyecto:** VENDEYA POS (Sistema Punto de Venta Multi-Giro & Facturación Electrónica SRI Ecuador)
- **Horizonte:** 6 Meses (24 Semanas)
- **Fase Actual:** MES 3 — Semana 9: Clave de Acceso y XML de comprobantes SRI (Facturas y Notas de Crédito)
- **Estado de Compilación:** ✅ `tsc --noEmit` → 0 errores | ✅ `tsconfig.node.json` → 0 errores | ✅ `tsconfig.electron.json` → 0 errores
- **Tests:** ✅ 434/434 passed (26 archivos de prueba)
- **Último Commit:** `feat: Semana 8 - modulo restaurantes y suite de integracion del nucleo POS`

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
- [ ] **Semana 9 (ACTUAL):** Generador de Clave de Acceso (49 dígitos, Módulo 11) + Constructor de XML v2.10/v2.30 para Facturas y Notas de Crédito + validación contra esquemas XSD del SRI.
- [ ] **Semana 10:** Firmador digital XAdES-BES en Node.js compatible con certificados `.p12` de Ecuador + encriptación AES-256-GCM de credenciales del certificado.
- [ ] **Semana 11:** Cliente SOAP para Web Services del SRI (`RecepcionComprobantesOffline` y `AutorizacionComprobantesOffline` en Pruebas y Producción) + Worker en segundo plano para cola offline (`cola_sri`).
- [ ] **Semana 12:** Soporte para Retenciones, Guías de Remisión, Liquidaciones de Compra y generador automático de archivo XML del Anexo Transaccional Simplificado (ATS).

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

## Próxima Tarea Exacta (Para ejecutar ahora — Semana 9)
1. **Clave de Acceso** (`src/server/services/sri/claveAcceso.util.ts`): 49 dígitos = fecha de emisión `ddMMyyyy` (8) + tipo de comprobante (2) + RUC (13) + ambiente (1) + serie (6: sucursal+punto) + secuencial (9) + código numérico (8) + tipo de emisión (1) + dígito verificador **Módulo 11** (1). Con validación de cada campo, función inversa (`parsearClaveAcceso`) y pruebas con vectores conocidos del Manual SRI (incluyendo los casos de resultado 10 → 1 y 11 → 0).
2. **Constructor de XML** (`xmlbuilder2`) de **Factura** y **Nota de Crédito** v2.10 (y v2.30 si aplica según la ficha técnica vigente): `infoTributaria`, `infoFactura` (incluye `propina`, `totalConImpuestos`, `pagos` con los códigos de forma de pago del SRI), `detalles` (impuestos por línea, descuentos), `infoAdicional`; mapeo desde `Venta`/`LineaVenta`/`PagoVenta`/`Cliente`/`Empresa` (códigos de identificación del comprador, IVA 0/5/15 %, no objeto/exento, Consumidor Final). Redondeos exactos a 2 decimales y coherencia importeTotal = totalSinImpuestos + impuestos + propina.
3. **Validación XSD** de los comprobantes generados contra los esquemas oficiales del SRI (guardarlos en `src/server/services/sri/xsd/`; son los publicados en la ficha técnica de comprobantes electrónicos — obtenerlos del SRI, no inventarlos); elegir un validador XSD para Node que no requiera compilación nativa (o aislar la validación) y reportar errores con la ruta del nodo.
4. **Integración con ventas:** crear el `ComprobanteElectronico` (estado PENDIENTE) y su registro en `ColaSRI` de forma transaccional al emitir una venta con `emitirFactura` (hoy el campo se acepta y se ignora), con secuencial propio del comprobante por punto de emisión y tipo, `claveAcceso` única, ambiente de la empresa y sin bloquear nunca la venta si falla la generación. **Notas de crédito** para anular ventas con factura AUTORIZADA (resuelve la restricción actual de `VentaService.anular`).
5. Pruebas unitarias (clave de acceso, redondeos, mapeos) e integración (venta → comprobante PENDIENTE → XML válido contra XSD; nota de crédito; reintento idempotente), actualizar la matriz RBAC si se agregan rutas, verificar con `npx tsc --noEmit` y `npm test`; actualizar este archivo y commit `feat: Semana 9 - clave de acceso, XML y validacion XSD de comprobantes SRI`.
