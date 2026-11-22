-- CreateTable
CREATE TABLE "PresentacionProducto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productoId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "factor" REAL NOT NULL,
    "codigoBarras" TEXT,
    "precioVenta" REAL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PresentacionProducto_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ListaPrecio" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "empresaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ListaPrecio_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PrecioProducto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listaPrecioId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "presentacionId" TEXT,
    "precio" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PrecioProducto_listaPrecioId_fkey" FOREIGN KEY ("listaPrecioId") REFERENCES "ListaPrecio" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PrecioProducto_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PrecioProducto_presentacionId_fkey" FOREIGN KEY ("presentacionId") REFERENCES "PresentacionProducto" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Cliente" (
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
    "updatedAt" DATETIME NOT NULL,
    "listaPrecioId" TEXT,
    CONSTRAINT "Cliente_listaPrecioId_fkey" FOREIGN KEY ("listaPrecioId") REFERENCES "ListaPrecio" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Cliente" ("createdAt", "descuentoHabitual", "diasCredito", "direccion", "email", "id", "identificacion", "limiteCredito", "nombreComercial", "razonSocial", "status", "telefono", "tipoIdentificacion", "updatedAt") SELECT "createdAt", "descuentoHabitual", "diasCredito", "direccion", "email", "id", "identificacion", "limiteCredito", "nombreComercial", "razonSocial", "status", "telefono", "tipoIdentificacion", "updatedAt" FROM "Cliente";
DROP TABLE "Cliente";
ALTER TABLE "new_Cliente" RENAME TO "Cliente";
CREATE INDEX "Cliente_identificacion_idx" ON "Cliente"("identificacion");
CREATE INDEX "Cliente_razonSocial_idx" ON "Cliente"("razonSocial");
CREATE UNIQUE INDEX "Cliente_tipoIdentificacion_identificacion_key" ON "Cliente"("tipoIdentificacion", "identificacion");
CREATE TABLE "new_LineaVenta" (
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
    "presentacionId" TEXT,
    "factorConversion" REAL NOT NULL DEFAULT 1,
    "cantidadBase" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "LineaVenta_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineaVenta_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LineaVenta_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "Lote" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LineaVenta" ("cantidad", "costoUnitario", "descripcion", "descuento", "id", "iva", "loteId", "porcentajeIva", "precioUnitario", "productoId", "subtotal", "tipoDescuento", "total", "ventaId") SELECT "cantidad", "costoUnitario", "descripcion", "descuento", "id", "iva", "loteId", "porcentajeIva", "precioUnitario", "productoId", "subtotal", "tipoDescuento", "total", "ventaId" FROM "LineaVenta";
DROP TABLE "LineaVenta";
ALTER TABLE "new_LineaVenta" RENAME TO "LineaVenta";
CREATE TABLE "new_UnidadMedida" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "permiteDecimales" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_UnidadMedida" ("codigo", "createdAt", "id", "nombre", "status", "updatedAt") SELECT "codigo", "createdAt", "id", "nombre", "status", "updatedAt" FROM "UnidadMedida";
DROP TABLE "UnidadMedida";
ALTER TABLE "new_UnidadMedida" RENAME TO "UnidadMedida";
CREATE UNIQUE INDEX "UnidadMedida_codigo_key" ON "UnidadMedida"("codigo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PresentacionProducto_codigoBarras_key" ON "PresentacionProducto"("codigoBarras");

-- CreateIndex
CREATE UNIQUE INDEX "PresentacionProducto_productoId_nombre_key" ON "PresentacionProducto"("productoId", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "ListaPrecio_empresaId_nombre_key" ON "ListaPrecio"("empresaId", "nombre");

-- CreateIndex
CREATE INDEX "PrecioProducto_listaPrecioId_productoId_idx" ON "PrecioProducto"("listaPrecioId", "productoId");


-- Backfill de datos existentes
UPDATE "LineaVenta" SET "cantidadBase" = "cantidad" WHERE "cantidadBase" = 0;
UPDATE "UnidadMedida" SET "permiteDecimales" = 1 WHERE "codigo" IN ('KG', 'LB', 'L', 'M');
