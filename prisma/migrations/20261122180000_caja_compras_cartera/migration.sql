-- CreateTable
CREATE TABLE "Compra" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proveedorId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "numeroFactura" TEXT NOT NULL,
    "fecha" DATETIME NOT NULL,
    "formaPago" TEXT NOT NULL DEFAULT 'CONTADO',
    "subtotal" REAL NOT NULL DEFAULT 0,
    "iva" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL DEFAULT 'REGISTRADA',
    "observaciones" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Compra_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Compra_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LineaCompra" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "compraId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidad" REAL NOT NULL,
    "costoUnitario" REAL NOT NULL,
    "subtotal" REAL NOT NULL,
    "iva" REAL NOT NULL DEFAULT 0,
    "porcentajeIva" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL,
    CONSTRAINT "LineaCompra_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "Compra" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineaCompra_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CuentaPorCobrar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ventaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "montoTotal" REAL NOT NULL,
    "saldo" REAL NOT NULL,
    "fechaEmision" DATETIME NOT NULL,
    "fechaVencimiento" DATETIME NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CuentaPorCobrar_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CuentaPorCobrar_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PagoCuentaPorCobrar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cuentaId" TEXT NOT NULL,
    "monto" REAL NOT NULL,
    "formaPago" TEXT NOT NULL,
    "referencia" TEXT,
    "usuarioId" TEXT NOT NULL,
    "turnoId" TEXT,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PagoCuentaPorCobrar_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "CuentaPorCobrar" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CuentaPorPagar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "compraId" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "montoTotal" REAL NOT NULL,
    "saldo" REAL NOT NULL,
    "fechaEmision" DATETIME NOT NULL,
    "fechaVencimiento" DATETIME NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CuentaPorPagar_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "Compra" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CuentaPorPagar_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PagoCuentaPorPagar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cuentaId" TEXT NOT NULL,
    "monto" REAL NOT NULL,
    "formaPago" TEXT NOT NULL,
    "referencia" TEXT,
    "usuarioId" TEXT NOT NULL,
    "turnoId" TEXT,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PagoCuentaPorPagar_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "CuentaPorPagar" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MovimientoCaja" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "turnoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "concepto" TEXT NOT NULL,
    "monto" REAL NOT NULL,
    "referencia" TEXT,
    "categoria" TEXT NOT NULL DEFAULT 'MANUAL',
    "usuarioId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MovimientoCaja_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "TurnoCaja" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_MovimientoCaja" ("concepto", "createdAt", "id", "monto", "referencia", "tipo", "turnoId") SELECT "concepto", "createdAt", "id", "monto", "referencia", "tipo", "turnoId" FROM "MovimientoCaja";
DROP TABLE "MovimientoCaja";
ALTER TABLE "new_MovimientoCaja" RENAME TO "MovimientoCaja";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Compra_sucursalId_fecha_idx" ON "Compra"("sucursalId", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "Compra_proveedorId_numeroFactura_key" ON "Compra"("proveedorId", "numeroFactura");

-- CreateIndex
CREATE UNIQUE INDEX "CuentaPorCobrar_ventaId_key" ON "CuentaPorCobrar"("ventaId");

-- CreateIndex
CREATE INDEX "CuentaPorCobrar_clienteId_estado_idx" ON "CuentaPorCobrar"("clienteId", "estado");

-- CreateIndex
CREATE INDEX "CuentaPorCobrar_estado_fechaVencimiento_idx" ON "CuentaPorCobrar"("estado", "fechaVencimiento");

-- CreateIndex
CREATE INDEX "PagoCuentaPorCobrar_cuentaId_idx" ON "PagoCuentaPorCobrar"("cuentaId");

-- CreateIndex
CREATE UNIQUE INDEX "CuentaPorPagar_compraId_key" ON "CuentaPorPagar"("compraId");

-- CreateIndex
CREATE INDEX "CuentaPorPagar_proveedorId_estado_idx" ON "CuentaPorPagar"("proveedorId", "estado");

-- CreateIndex
CREATE INDEX "CuentaPorPagar_estado_fechaVencimiento_idx" ON "CuentaPorPagar"("estado", "fechaVencimiento");

-- CreateIndex
CREATE INDEX "PagoCuentaPorPagar_cuentaId_idx" ON "PagoCuentaPorPagar"("cuentaId");

