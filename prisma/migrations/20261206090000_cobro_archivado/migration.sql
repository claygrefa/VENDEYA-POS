CREATE TABLE "IntentoCobroArchivado" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "empresaId" TEXT NOT NULL,
    "cajeroId" TEXT NOT NULL,
    "huella" TEXT NOT NULL,
    "confirmado" BOOLEAN NOT NULL,
    "numeroVenta" TEXT
);
