-- AlterTable
ALTER TABLE "ConfiguracionGiro" ADD COLUMN "impresoraConexion" TEXT NOT NULL DEFAULT 'NINGUNA';
ALTER TABLE "ConfiguracionGiro" ADD COLUMN "impresoraDireccion" TEXT;
ALTER TABLE "ConfiguracionGiro" ADD COLUMN "impresoraPuerto" INTEGER NOT NULL DEFAULT 9100;
ALTER TABLE "ConfiguracionGiro" ADD COLUMN "impresoraAncho" INTEGER NOT NULL DEFAULT 80;
