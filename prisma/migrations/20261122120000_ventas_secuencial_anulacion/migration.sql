-- DropIndex
DROP INDEX "Venta_numero_key";

-- AlterTable
ALTER TABLE "Venta" ADD COLUMN "anuladaPorId" TEXT;
ALTER TABLE "Venta" ADD COLUMN "fechaAnulacion" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PuntoEmision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sucursalId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "secuencialVenta" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PuntoEmision_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PuntoEmision" ("codigo", "createdAt", "descripcion", "id", "status", "sucursalId", "updatedAt") SELECT "codigo", "createdAt", "descripcion", "id", "status", "sucursalId", "updatedAt" FROM "PuntoEmision";
DROP TABLE "PuntoEmision";
ALTER TABLE "new_PuntoEmision" RENAME TO "PuntoEmision";
CREATE UNIQUE INDEX "PuntoEmision_sucursalId_codigo_key" ON "PuntoEmision"("sucursalId", "codigo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Venta_puntoEmisionId_numero_key" ON "Venta"("puntoEmisionId", "numero");

