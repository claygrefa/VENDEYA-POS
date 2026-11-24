-- CreateTable
CREATE TABLE "RetencionLinea" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "comprobanteId" TEXT NOT NULL,
    "codigoImpuesto" TEXT NOT NULL,
    "codigoRetencion" TEXT NOT NULL,
    "baseImponible" REAL NOT NULL,
    "porcentaje" REAL NOT NULL,
    "valor" REAL NOT NULL,
    CONSTRAINT "RetencionLinea_comprobanteId_fkey" FOREIGN KEY ("comprobanteId") REFERENCES "ComprobanteElectronico" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Compra" (
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
    "tipoDocumento" TEXT NOT NULL DEFAULT 'FACTURA',
    "codSustento" TEXT NOT NULL DEFAULT '01',
    "autorizacion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Compra_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Compra_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Compra" ("createdAt", "estado", "fecha", "formaPago", "id", "iva", "numeroFactura", "observaciones", "proveedorId", "subtotal", "sucursalId", "total", "updatedAt", "usuarioId") SELECT "createdAt", "estado", "fecha", "formaPago", "id", "iva", "numeroFactura", "observaciones", "proveedorId", "subtotal", "sucursalId", "total", "updatedAt", "usuarioId" FROM "Compra";
DROP TABLE "Compra";
ALTER TABLE "new_Compra" RENAME TO "Compra";
CREATE INDEX "Compra_sucursalId_fecha_idx" ON "Compra"("sucursalId", "fecha");
CREATE UNIQUE INDEX "Compra_proveedorId_numeroFactura_key" ON "Compra"("proveedorId", "numeroFactura");
CREATE TABLE "new_ComprobanteElectronico" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ventaId" TEXT,
    "compraId" TEXT,
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
    CONSTRAINT "ComprobanteElectronico_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "Compra" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ComprobanteElectronico_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ComprobanteElectronico_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ComprobanteElectronico_puntoEmisionId_fkey" FOREIGN KEY ("puntoEmisionId") REFERENCES "PuntoEmision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ComprobanteElectronico_comprobanteOrigenId_fkey" FOREIGN KEY ("comprobanteOrigenId") REFERENCES "ComprobanteElectronico" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ComprobanteElectronico" ("ambiente", "claveAcceso", "comprobanteOrigenId", "createdAt", "empresaId", "estado", "fechaAutorizacion", "fechaEmision", "id", "intentosEnvio", "mensajesRespuesta", "motivo", "numeroAutorizacion", "proximoIntento", "puntoEmisionId", "secuencial", "serie", "sucursalId", "tipoComprobante", "updatedAt", "ventaId", "xmlAutorizado", "xmlFirmado", "xmlGenerado") SELECT "ambiente", "claveAcceso", "comprobanteOrigenId", "createdAt", "empresaId", "estado", "fechaAutorizacion", "fechaEmision", "id", "intentosEnvio", "mensajesRespuesta", "motivo", "numeroAutorizacion", "proximoIntento", "puntoEmisionId", "secuencial", "serie", "sucursalId", "tipoComprobante", "updatedAt", "ventaId", "xmlAutorizado", "xmlFirmado", "xmlGenerado" FROM "ComprobanteElectronico";
DROP TABLE "ComprobanteElectronico";
ALTER TABLE "new_ComprobanteElectronico" RENAME TO "ComprobanteElectronico";
CREATE UNIQUE INDEX "ComprobanteElectronico_ventaId_key" ON "ComprobanteElectronico"("ventaId");
CREATE UNIQUE INDEX "ComprobanteElectronico_claveAcceso_key" ON "ComprobanteElectronico"("claveAcceso");
CREATE INDEX "ComprobanteElectronico_comprobanteOrigenId_idx" ON "ComprobanteElectronico"("comprobanteOrigenId");
CREATE INDEX "ComprobanteElectronico_compraId_idx" ON "ComprobanteElectronico"("compraId");
CREATE INDEX "ComprobanteElectronico_estado_proximoIntento_idx" ON "ComprobanteElectronico"("estado", "proximoIntento");
CREATE INDEX "ComprobanteElectronico_claveAcceso_idx" ON "ComprobanteElectronico"("claveAcceso");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "RetencionLinea_comprobanteId_idx" ON "RetencionLinea"("comprobanteId");
