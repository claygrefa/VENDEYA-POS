-- AlterTable
ALTER TABLE "ConfiguracionGiro" ADD COLUMN "balanzaPuerto" TEXT;
ALTER TABLE "ConfiguracionGiro" ADD COLUMN "balanzaBaudios" INTEGER NOT NULL DEFAULT 9600;
ALTER TABLE "ConfiguracionGiro" ADD COLUMN "balanzaProtocolo" TEXT NOT NULL DEFAULT 'GENERICO';
ALTER TABLE "ConfiguracionGiro" ADD COLUMN "balanzaEtiqueta" TEXT NOT NULL DEFAULT 'PESO';

-- CreateTable
CREATE TABLE "EventoSync" (
    "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "empresaId" TEXT NOT NULL,
    "modulo" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "ruta" TEXT NOT NULL,
    "ids" TEXT NOT NULL,
    "usuarioId" TEXT,
    "cajaId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "EventoSync_empresaId_seq_idx" ON "EventoSync"("empresaId", "seq");
