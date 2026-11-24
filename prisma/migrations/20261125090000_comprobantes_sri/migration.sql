-- Corrección de códigos de IVA a la Tabla 17 de la Ficha Técnica del SRI (v2.34):
--   0 = 0 %, 2 = 12 %, 3 = 14 %, 4 = 15 %, 5 = 5 %, 6 = no objeto, 7 = exento.
-- Antes el sistema usaba "2" para 15 % y "3" para 5 %, lo que habría generado XML con códigos erróneos.

-- 1) Códigos que no existen en la tabla oficial ("8" = 8 %, "9" = 15 %, "10" = 10 %): se desvinculan y se eliminan
UPDATE "Producto" SET "tarifaImpuestoId" = NULL WHERE "tarifaImpuestoId" IN (SELECT "id" FROM "TarifaImpuesto" WHERE "tipoImpuesto" = 'IVA' AND "codigo" IN ('8', '9', '10'));
DELETE FROM "TarifaImpuesto" WHERE "tipoImpuesto" = 'IVA' AND "codigo" IN ('8', '9', '10');

-- 2) Renombrado de las tarifas vigentes (conservan su id: los productos asignados siguen apuntando a ellas)
UPDATE "TarifaImpuesto" SET "codigo" = '4' WHERE "tipoImpuesto" = 'IVA' AND "codigo" = '2';
UPDATE "TarifaImpuesto" SET "codigo" = '5' WHERE "tipoImpuesto" = 'IVA' AND "codigo" = '3';

-- 3) Código SRI de los productos
UPDATE "Producto" SET "codigoIvaSRI" = CASE "codigoIvaSRI" WHEN '2' THEN '4' WHEN '3' THEN '5' WHEN '8' THEN '4' WHEN '9' THEN '4' WHEN '10' THEN '4' ELSE "codigoIvaSRI" END;

-- AlterTable
ALTER TABLE "Empresa" ADD COLUMN "contribuyenteEspecial" TEXT;

-- CreateTable
CREATE TABLE "SecuencialComprobante" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "puntoEmisionId" TEXT NOT NULL,
    "tipoComprobante" TEXT NOT NULL,
    "ultimo" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SecuencialComprobante_puntoEmisionId_fkey" FOREIGN KEY ("puntoEmisionId") REFERENCES "PuntoEmision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ComprobanteElectronico" (
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
    "xmlGenerado" TEXT,
    "xmlFirmado" TEXT,
    "xmlAutorizado" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "numeroAutorizacion" TEXT,
    "fechaAutorizacion" DATETIME,
    "mensajesRespuesta" TEXT,
    "motivo" TEXT,
    "comprobanteOrigenId" TEXT,
    "intentosEnvio" INTEGER NOT NULL DEFAULT 0,
    "proximoIntento" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ComprobanteElectronico_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ComprobanteElectronico_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ComprobanteElectronico_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ComprobanteElectronico_puntoEmisionId_fkey" FOREIGN KEY ("puntoEmisionId") REFERENCES "PuntoEmision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ComprobanteElectronico_comprobanteOrigenId_fkey" FOREIGN KEY ("comprobanteOrigenId") REFERENCES "ComprobanteElectronico" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ComprobanteElectronico" ("ambiente", "claveAcceso", "createdAt", "empresaId", "estado", "fechaAutorizacion", "fechaEmision", "id", "intentosEnvio", "mensajesRespuesta", "numeroAutorizacion", "proximoIntento", "puntoEmisionId", "secuencial", "serie", "sucursalId", "tipoComprobante", "updatedAt", "ventaId", "xmlAutorizado", "xmlFirmado") SELECT "ambiente", "claveAcceso", "createdAt", "empresaId", "estado", "fechaAutorizacion", "fechaEmision", "id", "intentosEnvio", "mensajesRespuesta", "numeroAutorizacion", "proximoIntento", "puntoEmisionId", "secuencial", "serie", "sucursalId", "tipoComprobante", "updatedAt", "ventaId", "xmlAutorizado", "xmlFirmado" FROM "ComprobanteElectronico";
DROP TABLE "ComprobanteElectronico";
ALTER TABLE "new_ComprobanteElectronico" RENAME TO "ComprobanteElectronico";
CREATE UNIQUE INDEX "ComprobanteElectronico_ventaId_key" ON "ComprobanteElectronico"("ventaId");
CREATE UNIQUE INDEX "ComprobanteElectronico_claveAcceso_key" ON "ComprobanteElectronico"("claveAcceso");
CREATE INDEX "ComprobanteElectronico_comprobanteOrigenId_idx" ON "ComprobanteElectronico"("comprobanteOrigenId");
CREATE INDEX "ComprobanteElectronico_estado_proximoIntento_idx" ON "ComprobanteElectronico"("estado", "proximoIntento");
CREATE INDEX "ComprobanteElectronico_claveAcceso_idx" ON "ComprobanteElectronico"("claveAcceso");
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
    "codigoIvaSRI" TEXT NOT NULL DEFAULT '',
    "presentacionId" TEXT,
    "factorConversion" REAL NOT NULL DEFAULT 1,
    "cantidadBase" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "LineaVenta_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineaVenta_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LineaVenta_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "Lote" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LineaVenta" ("cantidad", "cantidadBase", "costoUnitario", "descripcion", "descuento", "factorConversion", "id", "iva", "loteId", "porcentajeIva", "precioUnitario", "presentacionId", "productoId", "subtotal", "tipoDescuento", "total", "ventaId") SELECT "cantidad", "cantidadBase", "costoUnitario", "descripcion", "descuento", "factorConversion", "id", "iva", "loteId", "porcentajeIva", "precioUnitario", "presentacionId", "productoId", "subtotal", "tipoDescuento", "total", "ventaId" FROM "LineaVenta";
DROP TABLE "LineaVenta";
ALTER TABLE "new_LineaVenta" RENAME TO "LineaVenta";
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
    "codigoIvaSRI" TEXT NOT NULL DEFAULT '4',
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
INSERT INTO "new_Producto" ("aplicaIva", "categoriaId", "codigo", "codigoBarras", "codigoIvaSRI", "concentracion", "costoPromedio", "createdAt", "descripcion", "destinoPreparacion", "formaFarmaceutica", "id", "margen", "nombre", "precioCompra", "precioVenta", "principioActivo", "requiereLote", "status", "stockActual", "stockMinimo", "tarifaImpuestoId", "tieneVencimiento", "tipo", "unidadMedidaId", "updatedAt") SELECT "aplicaIva", "categoriaId", "codigo", "codigoBarras", "codigoIvaSRI", "concentracion", "costoPromedio", "createdAt", "descripcion", "destinoPreparacion", "formaFarmaceutica", "id", "margen", "nombre", "precioCompra", "precioVenta", "principioActivo", "requiereLote", "status", "stockActual", "stockMinimo", "tarifaImpuestoId", "tieneVencimiento", "tipo", "unidadMedidaId", "updatedAt" FROM "Producto";
DROP TABLE "Producto";
ALTER TABLE "new_Producto" RENAME TO "Producto";
CREATE UNIQUE INDEX "Producto_codigo_key" ON "Producto"("codigo");
CREATE INDEX "Producto_codigo_idx" ON "Producto"("codigo");
CREATE INDEX "Producto_codigoBarras_idx" ON "Producto"("codigoBarras");
CREATE INDEX "Producto_nombre_idx" ON "Producto"("nombre");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "SecuencialComprobante_puntoEmisionId_tipoComprobante_key" ON "SecuencialComprobante"("puntoEmisionId", "tipoComprobante");

