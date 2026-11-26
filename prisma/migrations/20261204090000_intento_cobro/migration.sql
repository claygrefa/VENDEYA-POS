CREATE TABLE "IntentoCobro" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "empresaId" TEXT NOT NULL,
    "cajeroId" TEXT NOT NULL,
    "huella" TEXT NOT NULL,
    "estado" TEXT NOT NULL CHECK ("estado" IN ('PENDING', 'CONFIRMED', 'FAILED')),
    "respuesta" TEXT,
    "errorCodigo" TEXT,
    "errorMensaje" TEXT,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
