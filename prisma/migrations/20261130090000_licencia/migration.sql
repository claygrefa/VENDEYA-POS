-- CreateTable
CREATE TABLE "Licencia" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "empresaId" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "dispositivoId" TEXT NOT NULL,
    "ultimaValidacion" DATETIME NOT NULL,
    "ultimoRelojVisto" DATETIME NOT NULL,
    "bloqueoServidor" TEXT,
    "motivoBloqueo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Licencia_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Licencia_empresaId_key" ON "Licencia"("empresaId");

