# PROJECT_STATUS.md — Bitácora Maestra de Desarrollo (VENDEYA POS)

## Estado General
- **Proyecto:** VENDEYA POS (Sistema Punto de Venta Multi-Giro & Facturación Electrónica SRI Ecuador)
- **Horizonte:** 6 Meses (24 Semanas)
- **Fase Actual:** MES 1 — Semana 3: `prisma/seed.ts` y capa de repositorios/servicios base
- **Estado de Compilación:** ✅ `tsc --noEmit` → 0 errores | ✅ `tsconfig.node.json` → 0 errores
- **Tests:** ✅ 60/60 passed (4 archivos de prueba)
- **Último Commit:** `feat: Semana 2 — schema.prisma completo con migración inicial`

---

## Hoja de Ruta de 6 Meses (24 Semanas)

### MES 1: Cimientos, Arquitectura y Base de Datos
- [x] **Semana 1 (COMPLETADA):** Inicializar Git, estructura de carpetas (`electron/`, `src/server/`, `src/renderer/`, `src/shared/`, `prisma/`, `tests/`), `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` e instalación de dependencias base.
- [x] **Semana 2 (COMPLETADA):** Diseño e implementación de `prisma/schema.prisma` completo (multi-empresa, sucursales, puntos de emisión, impuestos dinámicos SRI, productos, lotes, kardex, turnos de caja, ventas, comprobantes SRI, roles RBAC y feature flags) + migración inicial.
- [ ] **Semana 3 (ACTUAL):** Creación de `prisma/seed.ts` (impuestos SRI vigentes, Consumidor Final, usuario admin, configuraciones base) y capa de repositorios/servicios base en `src/server/`.
- [ ] **Semana 4:** Implementación del núcleo de Electron (`electron/main.ts`, `electron/preload.ts`), arranque automático del servidor Fastify embebido, ejecución automática de migraciones SQLite al iniciar y pruebas unitarias de arranque.

### MES 2: Núcleo POS, Inventario y Módulos Multi-Giro
- [ ] **Semana 5:** Motor transaccional ACID de ventas, múltiples formas de pago, descuentos, anulaciones y actualización automática de Kardex (costo promedio ponderado).
- [ ] **Semana 6:** Gestión de Turnos y Arqueos de Caja (apertura, ingresos/egresos de efectivo, cierre ciego, cuadre y reportes de turno) + Cuentas por Cobrar y Cuentas por Pagar.
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

## Próxima Tarea Exacta (Para ejecutar ahora — Semana 3)
1. Crear `prisma/seed.ts`: impuestos SRI vigentes (IVA 0%, 5%, 15%, No objeto, Exento), unidades de medida, roles y permisos RBAC, Consumidor Final (`9999999999999`), empresa/sucursal/punto de emisión base, usuario admin (hash de contraseña) y `ConfiguracionGiro` por defecto.
2. Crear capa base en `src/server/`: cliente Prisma singleton (`config/`), repositorios (`repositories/`) y servicios (`services/`) para Empresa, Usuario, Producto y Cliente, con pruebas en `tests/unit` e `integration`.
3. Verificar con `npx tsc --noEmit` y `npm test`; actualizar este archivo y commit `feat: Semana 3 — seed y capa base de repositorios`.
