# PROJECT_STATUS.md — Bitácora Maestra de Desarrollo (VENDEYA POS)

## Estado General
- **Proyecto:** VENDEYA POS (Sistema Punto de Venta Multi-Giro & Facturación Electrónica SRI Ecuador)
- **Horizonte:** 6 Meses (24 Semanas)
- **Fase Actual:** MES 2 — Semana 6: turnos y arqueos de caja, cuentas por cobrar y por pagar
- **Estado de Compilación:** ✅ `tsc --noEmit` → 0 errores | ✅ `tsconfig.node.json` → 0 errores | ✅ `tsconfig.electron.json` → 0 errores
- **Tests:** ✅ 185/185 passed (13 archivos de prueba)
- **Último Commit:** `feat: Semana 5 - motor transaccional de ventas y kardex`

---

## Hoja de Ruta de 6 Meses (24 Semanas)

### MES 1: Cimientos, Arquitectura y Base de Datos
- [x] **Semana 1 (COMPLETADA):** Inicializar Git, estructura de carpetas (`electron/`, `src/server/`, `src/renderer/`, `src/shared/`, `prisma/`, `tests/`), `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` e instalación de dependencias base.
- [x] **Semana 2 (COMPLETADA):** Diseño e implementación de `prisma/schema.prisma` completo (multi-empresa, sucursales, puntos de emisión, impuestos dinámicos SRI, productos, lotes, kardex, turnos de caja, ventas, comprobantes SRI, roles RBAC y feature flags) + migración inicial.
- [x] **Semana 3 (COMPLETADA):** Creación de `prisma/seed.ts` (impuestos SRI vigentes, Consumidor Final, usuario admin, configuraciones base) y capa de repositorios/servicios base en `src/server/`.
- [x] **Semana 4 (COMPLETADA):** Implementación del núcleo de Electron (`electron/main.ts`, `electron/preload.ts`), arranque automático del servidor Fastify embebido, ejecución automática de migraciones SQLite al iniciar y pruebas unitarias de arranque.

### MES 2: Núcleo POS, Inventario y Módulos Multi-Giro
- [x] **Semana 5 (COMPLETADA):** Motor transaccional ACID de ventas, múltiples formas de pago, descuentos, anulaciones y actualización automática de Kardex (costo promedio ponderado).
- [ ] **Semana 6 (ACTUAL):** Gestión de Turnos y Arqueos de Caja (apertura, ingresos/egresos de efectivo, cierre ciego, cuadre y reportes de turno) + Cuentas por Cobrar y Cuentas por Pagar.
- [ ] **Semana 7:** Módulo Retail/Ferretería (múltiples presentaciones, fraccionamiento, listas de precios, códigos de barras) y Módulo Farmacia (lotes, fechas de caducidad, alertas).
- [ ] **Semana 8:** Módulo Restaurantes (mapa de mesas, cuentas abiertas, división de cuentas, envío de comandas) + Suite completa de pruebas de integración del núcleo POS.

### MES 3: Motor Tributario SRI Ecuador (100% Offline-First)
- [ ] **Semana 9:** Generador de Clave de Acceso (49 dígitos, Módulo 11) + Constructor de XML v2.10/v2.30 para Facturas y Notas de Crédito + validación contra esquemas XSD del SRI.
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

## Próxima Tarea Exacta (Para ejecutar ahora — Semana 6)
1. Crear `turno.service.ts`/`turno.repository.ts`: apertura (un solo turno ABIERTO por cajero y sucursal, monto inicial), ingresos/egresos de efectivo (`MovimientoCaja` con concepto obligatorio), cierre ciego (el cajero declara el efectivo contado sin ver el esperado), cuadre (esperado = apertura + ventas en efectivo − cambio + ingresos − egresos, excluyendo ventas ANULADAS) y diferencia; reporte de turno con totales por forma de pago, ventas, anulaciones y descuentos.
2. Endpoints `POST /api/turnos/abrir`, `GET /api/turnos/actual`, `POST /api/turnos/:id/movimientos`, `POST /api/turnos/:id/cerrar`, `GET /api/turnos/:id/reporte` con permisos `caja:*` (el cierre ciego no debe exponer el esperado hasta cerrar; el supervisor puede ver el reporte de cualquier turno).
3. Cuentas por Cobrar y por Pagar: agregar modelos Prisma (`CuentaPorCobrar`, `PagoCuentaPorCobrar`, `CuentaPorPagar`, `PagoCuentaPorPagar`, y `Compra` mínima si hace falta) con migración; generar la CxC automáticamente al vender con pago `CREDITO` (vencimiento = `Cliente.diasCredito`, validar `limiteCredito` contra el saldo pendiente) y registrar abonos; CxP desde compras a proveedor con abonos y estado. Exponer compras con entrada a Kardex (`COMPRA`) para poder cargar inventario.
4. Pruebas unitarias (cuadre de caja) e integración (ciclo completo apertura → ventas → movimientos → cierre ciego; anulación excluida del cuadre; CxC por venta a crédito y abonos parciales/total; límite de crédito excedido).
5. Verificar con `npx tsc --noEmit` y `npm test`; actualizar este archivo y commit `feat: Semana 6 - turnos de caja, arqueos, cuentas por cobrar y pagar`.
