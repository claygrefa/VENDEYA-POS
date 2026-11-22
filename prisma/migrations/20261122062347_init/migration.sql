-- CreateTable
CREATE TABLE "Empresa" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruc" TEXT NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "nombreComercial" TEXT NOT NULL,
    "direccionMatriz" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "logo" TEXT,
    "tipoContribuyente" TEXT NOT NULL,
    "regimenTributario" TEXT NOT NULL,
    "obligadoContabilidad" BOOLEAN NOT NULL DEFAULT false,
    "agenteRetencion" BOOLEAN NOT NULL DEFAULT false,
    "resolucionAgente" TEXT,
    "ambienteSRI" TEXT NOT NULL DEFAULT 'PRUEBAS',
    "status" TEXT NOT NULL DEFAULT 'ACTIVO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Sucursal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "empresaId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Sucursal_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PuntoEmision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sucursalId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PuntoEmision_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Rol" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Permiso" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "modulo" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "recurso" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "RolPermiso" (
    "rolId" TEXT NOT NULL,
    "permisoId" TEXT NOT NULL,

    PRIMARY KEY ("rolId", "permisoId"),
    CONSTRAINT "RolPermiso_rolId_fkey" FOREIGN KEY ("rolId") REFERENCES "Rol" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RolPermiso_permisoId_fkey" FOREIGN KEY ("permisoId") REFERENCES "Permiso" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "empresaId" TEXT NOT NULL,
    "rolId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellido" TEXT NOT NULL,
    "email" TEXT,
    "cedula" TEXT,
    "telefono" TEXT,
    "pinCaja" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVO',
    "ultimoAcceso" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Usuario_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Usuario_rolId_fkey" FOREIGN KEY ("rolId") REFERENCES "Rol" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConfiguracionGiro" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "empresaId" TEXT NOT NULL,
    "giroNegocio" TEXT NOT NULL,
    "moduloInventario" BOOLEAN NOT NULL DEFAULT true,
    "moduloKardex" BOOLEAN NOT NULL DEFAULT true,
    "moduloLotes" BOOLEAN NOT NULL DEFAULT false,
    "moduloVencimientos" BOOLEAN NOT NULL DEFAULT false,
    "moduloMesas" BOOLEAN NOT NULL DEFAULT false,
    "moduloComandasCocina" BOOLEAN NOT NULL DEFAULT false,
    "moduloBalanza" BOOLEAN NOT NULL DEFAULT false,
    "moduloListasPrecios" BOOLEAN NOT NULL DEFAULT false,
    "moduloCuentasPorCobrar" BOOLEAN NOT NULL DEFAULT true,
    "moduloCuentasPorPagar" BOOLEAN NOT NULL DEFAULT true,
    "emitirFacturas" BOOLEAN NOT NULL DEFAULT true,
    "emitirNotasCredito" BOOLEAN NOT NULL DEFAULT true,
    "emitirRetenciones" BOOLEAN NOT NULL DEFAULT false,
    "emitirGuiasRemision" BOOLEAN NOT NULL DEFAULT false,
    "emitirLiquidaciones" BOOLEAN NOT NULL DEFAULT false,
    "impresionTermica" BOOLEAN NOT NULL DEFAULT true,
    "aperturaGaveta" BOOLEAN NOT NULL DEFAULT true,
    "lecturaCodigoBarras" BOOLEAN NOT NULL DEFAULT true,
    "sincronizacionLAN" BOOLEAN NOT NULL DEFAULT false,
    "modoTactil" BOOLEAN NOT NULL DEFAULT false,
    "rutaCertificadoP12" TEXT,
    "certPasswordEncriptado" TEXT,
    "certIv" TEXT,
    "certTag" TEXT,
    "certVencimiento" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ConfiguracionGiro_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TarifaImpuesto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "empresaId" TEXT NOT NULL,
    "tipoImpuesto" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "porcentaje" REAL NOT NULL,
    "descripcion" TEXT NOT NULL,
    "vigente" BOOLEAN NOT NULL DEFAULT true,
    "vigenciaDesde" DATETIME,
    "vigenciaHasta" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TarifaImpuesto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Categoria" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UnidadMedida" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Producto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codigo" TEXT NOT NULL,
    "codigoBarras" TEXT,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'BIEN',
    "categoriaId" TEXT NOT NULL,
    "unidadMedidaId" TEXT NOT NULL,
    "tarifaImpuestoId" TEXT,
    "precioCompra" REAL NOT NULL DEFAULT 0,
    "precioVenta" REAL NOT NULL,
    "margen" REAL NOT NULL DEFAULT 0,
    "stockMinimo" REAL NOT NULL DEFAULT 0,
    "stockActual" REAL NOT NULL DEFAULT 0,
    "costoPromedio" REAL NOT NULL DEFAULT 0,
    "aplicaIva" BOOLEAN NOT NULL DEFAULT true,
    "codigoIvaSRI" TEXT NOT NULL DEFAULT '2',
    "tieneVencimiento" BOOLEAN NOT NULL DEFAULT false,
    "requiereLote" BOOLEAN NOT NULL DEFAULT false,
    "principioActivo" TEXT,
    "concentracion" TEXT,
    "formaFarmaceutica" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Producto_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Producto_unidadMedidaId_fkey" FOREIGN KEY ("unidadMedidaId") REFERENCES "UnidadMedida" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Producto_tarifaImpuestoId_fkey" FOREIGN KEY ("tarifaImpuestoId") REFERENCES "TarifaImpuesto" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Lote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productoId" TEXT NOT NULL,
    "numeroLote" TEXT NOT NULL,
    "fechaFabricacion" DATETIME,
    "fechaVencimiento" DATETIME NOT NULL,
    "cantidadInicial" REAL NOT NULL,
    "cantidadActual" REAL NOT NULL,
    "proveedorId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Lote_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Lote_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Kardex" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productoId" TEXT NOT NULL,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tipoMovimiento" TEXT NOT NULL,
    "cantidad" REAL NOT NULL,
    "costoUnitario" REAL NOT NULL,
    "costoTotal" REAL NOT NULL,
    "stockAnterior" REAL NOT NULL,
    "stockResultante" REAL NOT NULL,
    "costoPromAnterior" REAL NOT NULL,
    "costoPromResultante" REAL NOT NULL,
    "referencia" TEXT,
    "observacion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Kardex_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tipoIdentificacion" TEXT NOT NULL DEFAULT '05',
    "identificacion" TEXT NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "nombreComercial" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "direccion" TEXT,
    "limiteCredito" REAL NOT NULL DEFAULT 0,
    "diasCredito" INTEGER NOT NULL DEFAULT 0,
    "descuentoHabitual" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Proveedor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruc" TEXT NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "nombreComercial" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "direccion" TEXT,
    "contacto" TEXT,
    "diasPago" INTEGER NOT NULL DEFAULT 30,
    "status" TEXT NOT NULL DEFAULT 'ACTIVO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TurnoCaja" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sucursalId" TEXT NOT NULL,
    "cajeroId" TEXT NOT NULL,
    "fechaApertura" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaCierre" DATETIME,
    "montoApertura" REAL NOT NULL DEFAULT 0,
    "montoCierreCiego" REAL,
    "montoCierreReal" REAL,
    "diferencia" REAL,
    "estado" TEXT NOT NULL DEFAULT 'ABIERTO',
    "observaciones" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TurnoCaja_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TurnoCaja_cajeroId_fkey" FOREIGN KEY ("cajeroId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MovimientoCaja" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "turnoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "concepto" TEXT NOT NULL,
    "monto" REAL NOT NULL,
    "referencia" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MovimientoCaja_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "TurnoCaja" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Venta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "numero" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "puntoEmisionId" TEXT NOT NULL,
    "turnoId" TEXT NOT NULL,
    "cajeroId" TEXT NOT NULL,
    "clienteId" TEXT,
    "clienteRuc" TEXT,
    "clienteNombre" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'COMPLETADA',
    "subtotal" REAL NOT NULL DEFAULT 0,
    "descuento" REAL NOT NULL DEFAULT 0,
    "iva" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL DEFAULT 0,
    "motivoAnulacion" TEXT,
    "observaciones" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Venta_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Venta_puntoEmisionId_fkey" FOREIGN KEY ("puntoEmisionId") REFERENCES "PuntoEmision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Venta_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "TurnoCaja" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Venta_cajeroId_fkey" FOREIGN KEY ("cajeroId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Venta_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LineaVenta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ventaId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "loteId" TEXT,
    "descripcion" TEXT NOT NULL,
    "cantidad" REAL NOT NULL,
    "precioUnitario" REAL NOT NULL,
    "descuento" REAL NOT NULL DEFAULT 0,
    "tipoDescuento" TEXT NOT NULL DEFAULT 'VALOR',
    "subtotal" REAL NOT NULL,
    "iva" REAL NOT NULL DEFAULT 0,
    "porcentajeIva" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL,
    "costoUnitario" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "LineaVenta_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineaVenta_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LineaVenta_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "Lote" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PagoVenta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ventaId" TEXT NOT NULL,
    "formaPago" TEXT NOT NULL,
    "monto" REAL NOT NULL,
    "referencia" TEXT,
    "cambio" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PagoVenta_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ComprobanteElectronico" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ventaId" TEXT,
    "empresaId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "puntoEmisionId" TEXT NOT NULL,
    "claveAcceso" TEXT NOT NULL,
    "tipoComprobante" TEXT NOT NULL,
    "ambiente" TEXT NOT NULL DEFAULT '1',
    "serie" TEXT NOT NULL,
    "secuencial" TEXT NOT NULL,
    "fechaEmision" DATETIME NOT NULL,
    "xmlFirmado" TEXT,
    "xmlAutorizado" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "numeroAutorizacion" TEXT,
    "fechaAutorizacion" DATETIME,
    "mensajesRespuesta" TEXT,
    "intentosEnvio" INTEGER NOT NULL DEFAULT 0,
    "proximoIntento" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ComprobanteElectronico_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ComprobanteElectronico_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ComprobanteElectronico_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ComprobanteElectronico_puntoEmisionId_fkey" FOREIGN KEY ("puntoEmisionId") REFERENCES "PuntoEmision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ColaSRI" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "comprobanteId" TEXT NOT NULL,
    "prioridad" INTEGER NOT NULL DEFAULT 5,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "ultimoError" TEXT,
    "ultimoIntentoAt" DATETIME,
    "procesandoDesde" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ColaSRI_comprobanteId_fkey" FOREIGN KEY ("comprobanteId") REFERENCES "ComprobanteElectronico" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Mesa" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sucursalId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "capacidad" INTEGER NOT NULL DEFAULT 4,
    "zona" TEXT NOT NULL DEFAULT 'SALON',
    "estado" TEXT NOT NULL DEFAULT 'LIBRE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Mesa_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Comanda" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mesaId" TEXT NOT NULL,
    "meseroId" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'ABIERTA',
    "observaciones" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Comanda_mesaId_fkey" FOREIGN KEY ("mesaId") REFERENCES "Mesa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ItemComanda" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "comandaId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidad" REAL NOT NULL,
    "precioUnitario" REAL NOT NULL,
    "descuento" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "observaciones" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ItemComanda_comandaId_fkey" FOREIGN KEY ("comandaId") REFERENCES "Comanda" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ItemComanda_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Empresa_ruc_key" ON "Empresa"("ruc");

-- CreateIndex
CREATE UNIQUE INDEX "Sucursal_empresaId_codigo_key" ON "Sucursal"("empresaId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "PuntoEmision_sucursalId_codigo_key" ON "PuntoEmision"("sucursalId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Rol_nombre_key" ON "Rol"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Permiso_modulo_accion_recurso_key" ON "Permiso"("modulo", "accion", "recurso");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_username_key" ON "Usuario"("username");

-- CreateIndex
CREATE UNIQUE INDEX "ConfiguracionGiro_empresaId_key" ON "ConfiguracionGiro"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "TarifaImpuesto_empresaId_tipoImpuesto_codigo_key" ON "TarifaImpuesto"("empresaId", "tipoImpuesto", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "UnidadMedida_codigo_key" ON "UnidadMedida"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Producto_codigo_key" ON "Producto"("codigo");

-- CreateIndex
CREATE INDEX "Producto_codigo_idx" ON "Producto"("codigo");

-- CreateIndex
CREATE INDEX "Producto_codigoBarras_idx" ON "Producto"("codigoBarras");

-- CreateIndex
CREATE INDEX "Producto_nombre_idx" ON "Producto"("nombre");

-- CreateIndex
CREATE INDEX "Lote_fechaVencimiento_idx" ON "Lote"("fechaVencimiento");

-- CreateIndex
CREATE UNIQUE INDEX "Lote_productoId_numeroLote_key" ON "Lote"("productoId", "numeroLote");

-- CreateIndex
CREATE INDEX "Kardex_productoId_fecha_idx" ON "Kardex"("productoId", "fecha");

-- CreateIndex
CREATE INDEX "Cliente_identificacion_idx" ON "Cliente"("identificacion");

-- CreateIndex
CREATE INDEX "Cliente_razonSocial_idx" ON "Cliente"("razonSocial");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_tipoIdentificacion_identificacion_key" ON "Cliente"("tipoIdentificacion", "identificacion");

-- CreateIndex
CREATE UNIQUE INDEX "Proveedor_ruc_key" ON "Proveedor"("ruc");

-- CreateIndex
CREATE INDEX "TurnoCaja_sucursalId_estado_idx" ON "TurnoCaja"("sucursalId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "Venta_numero_key" ON "Venta"("numero");

-- CreateIndex
CREATE INDEX "Venta_sucursalId_createdAt_idx" ON "Venta"("sucursalId", "createdAt");

-- CreateIndex
CREATE INDEX "Venta_clienteId_idx" ON "Venta"("clienteId");

-- CreateIndex
CREATE INDEX "Venta_numero_idx" ON "Venta"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "ComprobanteElectronico_ventaId_key" ON "ComprobanteElectronico"("ventaId");

-- CreateIndex
CREATE UNIQUE INDEX "ComprobanteElectronico_claveAcceso_key" ON "ComprobanteElectronico"("claveAcceso");

-- CreateIndex
CREATE INDEX "ComprobanteElectronico_estado_proximoIntento_idx" ON "ComprobanteElectronico"("estado", "proximoIntento");

-- CreateIndex
CREATE INDEX "ComprobanteElectronico_claveAcceso_idx" ON "ComprobanteElectronico"("claveAcceso");

-- CreateIndex
CREATE UNIQUE INDEX "ColaSRI_comprobanteId_key" ON "ColaSRI"("comprobanteId");

-- CreateIndex
CREATE INDEX "ColaSRI_prioridad_intentos_idx" ON "ColaSRI"("prioridad", "intentos");

-- CreateIndex
CREATE UNIQUE INDEX "Mesa_sucursalId_numero_key" ON "Mesa"("sucursalId", "numero");
