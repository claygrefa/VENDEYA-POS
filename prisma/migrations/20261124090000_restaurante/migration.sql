-- CreateTable
CREATE TABLE "CobroComanda" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "comandaId" TEXT NOT NULL,
    "ventaId" TEXT NOT NULL,
    "modo" TEXT NOT NULL,
    "parte" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CobroComanda_comandaId_fkey" FOREIGN KEY ("comandaId") REFERENCES "Comanda" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CobroComanda_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Comanda" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sucursalId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "mesaId" TEXT NOT NULL,
    "meseroId" TEXT,
    "comensales" INTEGER NOT NULL DEFAULT 1,
    "estado" TEXT NOT NULL DEFAULT 'ABIERTA',
    "observaciones" TEXT,
    "divisionPartes" INTEGER,
    "motivoAnulacion" TEXT,
    "fechaCierre" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Comanda_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Comanda_mesaId_fkey" FOREIGN KEY ("mesaId") REFERENCES "Mesa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Comanda" ("createdAt", "estado", "id", "mesaId", "meseroId", "observaciones", "updatedAt") SELECT "createdAt", "estado", "id", "mesaId", "meseroId", "observaciones", "updatedAt" FROM "Comanda";
DROP TABLE "Comanda";
ALTER TABLE "new_Comanda" RENAME TO "Comanda";
CREATE INDEX "Comanda_mesaId_estado_idx" ON "Comanda"("mesaId", "estado");
CREATE UNIQUE INDEX "Comanda_sucursalId_numero_key" ON "Comanda"("sucursalId", "numero");
CREATE TABLE "new_ItemComanda" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "comandaId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidad" REAL NOT NULL,
    "precioUnitario" REAL NOT NULL,
    "descuento" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "destino" TEXT NOT NULL DEFAULT 'COCINA',
    "envio" INTEGER NOT NULL DEFAULT 0,
    "enviadoAt" DATETIME,
    "observaciones" TEXT,
    "motivoCancelacion" TEXT,
    "cobrado" BOOLEAN NOT NULL DEFAULT false,
    "ventaId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ItemComanda_comandaId_fkey" FOREIGN KEY ("comandaId") REFERENCES "Comanda" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ItemComanda_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ItemComanda" ("cantidad", "comandaId", "createdAt", "descuento", "estado", "id", "observaciones", "precioUnitario", "productoId", "total", "updatedAt") SELECT "cantidad", "comandaId", "createdAt", "descuento", "estado", "id", "observaciones", "precioUnitario", "productoId", "total", "updatedAt" FROM "ItemComanda";
DROP TABLE "ItemComanda";
ALTER TABLE "new_ItemComanda" RENAME TO "ItemComanda";
CREATE INDEX "ItemComanda_estado_destino_idx" ON "ItemComanda"("estado", "destino");
CREATE TABLE "new_Mesa" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sucursalId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "capacidad" INTEGER NOT NULL DEFAULT 4,
    "zona" TEXT NOT NULL DEFAULT 'SALON',
    "estado" TEXT NOT NULL DEFAULT 'LIBRE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Mesa_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Mesa" ("capacidad", "createdAt", "estado", "id", "nombre", "numero", "sucursalId", "updatedAt", "zona") SELECT "capacidad", "createdAt", "estado", "id", "nombre", "numero", "sucursalId", "updatedAt", "zona" FROM "Mesa";
DROP TABLE "Mesa";
ALTER TABLE "new_Mesa" RENAME TO "Mesa";
CREATE UNIQUE INDEX "Mesa_sucursalId_numero_key" ON "Mesa"("sucursalId", "numero");
CREATE TABLE "new_Producto" (
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
    "destinoPreparacion" TEXT NOT NULL DEFAULT 'COCINA',
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
INSERT INTO "new_Producto" ("aplicaIva", "categoriaId", "codigo", "codigoBarras", "codigoIvaSRI", "concentracion", "costoPromedio", "createdAt", "descripcion", "formaFarmaceutica", "id", "margen", "nombre", "precioCompra", "precioVenta", "principioActivo", "requiereLote", "status", "stockActual", "stockMinimo", "tarifaImpuestoId", "tieneVencimiento", "tipo", "unidadMedidaId", "updatedAt") SELECT "aplicaIva", "categoriaId", "codigo", "codigoBarras", "codigoIvaSRI", "concentracion", "costoPromedio", "createdAt", "descripcion", "formaFarmaceutica", "id", "margen", "nombre", "precioCompra", "precioVenta", "principioActivo", "requiereLote", "status", "stockActual", "stockMinimo", "tarifaImpuestoId", "tieneVencimiento", "tipo", "unidadMedidaId", "updatedAt" FROM "Producto";
DROP TABLE "Producto";
ALTER TABLE "new_Producto" RENAME TO "Producto";
CREATE UNIQUE INDEX "Producto_codigo_key" ON "Producto"("codigo");
CREATE INDEX "Producto_codigo_idx" ON "Producto"("codigo");
CREATE INDEX "Producto_codigoBarras_idx" ON "Producto"("codigoBarras");
CREATE INDEX "Producto_nombre_idx" ON "Producto"("nombre");
CREATE TABLE "new_Sucursal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "empresaId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "secuencialComanda" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Sucursal_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Sucursal" ("codigo", "createdAt", "direccion", "empresaId", "id", "nombre", "status", "telefono", "updatedAt") SELECT "codigo", "createdAt", "direccion", "empresaId", "id", "nombre", "status", "telefono", "updatedAt" FROM "Sucursal";
DROP TABLE "Sucursal";
ALTER TABLE "new_Sucursal" RENAME TO "Sucursal";
CREATE UNIQUE INDEX "Sucursal_empresaId_codigo_key" ON "Sucursal"("empresaId", "codigo");
CREATE TABLE "new_Venta" (
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
    "propina" REAL NOT NULL DEFAULT 0,
    "motivoAnulacion" TEXT,
    "fechaAnulacion" DATETIME,
    "anuladaPorId" TEXT,
    "observaciones" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Venta_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Venta_puntoEmisionId_fkey" FOREIGN KEY ("puntoEmisionId") REFERENCES "PuntoEmision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Venta_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "TurnoCaja" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Venta_cajeroId_fkey" FOREIGN KEY ("cajeroId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Venta_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Venta" ("anuladaPorId", "cajeroId", "clienteId", "clienteNombre", "clienteRuc", "createdAt", "descuento", "estado", "fechaAnulacion", "id", "iva", "motivoAnulacion", "numero", "observaciones", "puntoEmisionId", "subtotal", "sucursalId", "total", "turnoId", "updatedAt") SELECT "anuladaPorId", "cajeroId", "clienteId", "clienteNombre", "clienteRuc", "createdAt", "descuento", "estado", "fechaAnulacion", "id", "iva", "motivoAnulacion", "numero", "observaciones", "puntoEmisionId", "subtotal", "sucursalId", "total", "turnoId", "updatedAt" FROM "Venta";
DROP TABLE "Venta";
ALTER TABLE "new_Venta" RENAME TO "Venta";
CREATE INDEX "Venta_sucursalId_createdAt_idx" ON "Venta"("sucursalId", "createdAt");
CREATE INDEX "Venta_clienteId_idx" ON "Venta"("clienteId");
CREATE INDEX "Venta_numero_idx" ON "Venta"("numero");
CREATE UNIQUE INDEX "Venta_puntoEmisionId_numero_key" ON "Venta"("puntoEmisionId", "numero");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "CobroComanda_ventaId_key" ON "CobroComanda"("ventaId");

-- CreateIndex
CREATE UNIQUE INDEX "CobroComanda_comandaId_parte_key" ON "CobroComanda"("comandaId", "parte");

