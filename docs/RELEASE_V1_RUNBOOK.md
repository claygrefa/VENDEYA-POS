# Runbook de VendeYa POS v1.0.0

El asistente `npm.cmd run release:runbook` propone el primer paso con evidencia pendiente. Ejecuta los comandos de PowerShell desde la raíz del repositorio. Usa GitHub CLI autenticado para descargar y publicar el candidato. `evidence/` es una carpeta local privada, excluida de Git.

## 1. Licencias y telemetría por HTTPS

1. Con Node 24 y las dependencias del lockfile instaladas, ejecuta `npm.cmd run cloud:init`. El comando conserva una clave existente. Haz una copia protegida de `.release-private/license.env`. El PEM público queda en `.release-private/license-public.pem`.
2. Con Docker Desktop activo, puedes ensayar el despliegue en loopback.

   ```powershell
   docker compose --env-file .release-private/license.env -f src/server/cloud/deploy/compose.yaml up -d --build --wait
   curl.exe --fail --silent --show-error http://127.0.0.1:8080/health
   ```

3. Integra el commit del candidato en la rama por defecto de GitHub y sube esa rama. Así quedará disponible **Run workflow** en el paso 3. En Render, abre **New → Blueprint**, conecta la rama y usa `src/server/cloud/deploy/render.yaml` en **Blueprint Path**. Revisa el costo antes de desplegar. Introduce el valor de `LICENSE_SIGNING_KEY_BASE64` del archivo local en el campo del mismo nombre. El Blueprint crea el servicio Docker y PostgreSQL privado. [Render Blueprints](https://render.com/docs/infrastructure-as-code).
4. En **Shell** del servicio Docker, emite una licencia de ensayo para el RUC que usarás en la comprobación. La migración se aplica automáticamente al arrancar y también admite ejecución explícita. Guarda la clave de activación en tu gestor de credenciales.

   ```sh
   node dist/src/server/cloud/cli.js migrate
   node dist/src/server/cloud/cli.js issue RUC_DE_PRUEBA 7 1
   # Tras el ensayo puedes revocar la licencia con:
   # node dist/src/server/cloud/cli.js revoke ID_DE_LA_LICENCIA
   ```

5. Verifica HTTPS. El segundo curl espera 401 para un token inválido. `cloud:verify` realiza la prueba positiva con una licencia real, comprueba su firma, ingresa una telemetría de ensayo y libera la plaza.

   ```powershell
   $base = 'https://TU-SERVICIO.onrender.com'
   curl.exe --proto '=https' --fail --silent --show-error "$base/health"
   '{"token":"invalid","dispositivo":{"id":"smoke","nombre":"Smoke","plataforma":"cli","version":"1.0.0"}}' | curl.exe --proto '=https' --silent --show-error -w '\nHTTP %{http_code}\n' -H 'Content-Type: application/json' --data-binary '@-' "$base/api/license/verify"
   npm.cmd run cloud:verify -- $base RUC_DE_PRUEBA
   ```

   Espera `evidence/services.json` con salud 200, licencia 200 y telemetría 204. El receptor limita solicitudes, deduplica reportes y los retiene 30 días. El POS envía telemetría con consentimiento.

## 2. Autorizar una factura en SRI celcer

1. Usa un RUC habilitado en pruebas. Prepara una factura v2.1.0 sin firma con ambiente `1`, secuencial de pruebas y ese mismo RUC. Si la generas desde un POS de ensayo, lánzalo con `SRI_WORKER=off`. Exporta el campo `xmlGenerado` del detalle autenticado del comprobante. [Ficha técnica del SRI](https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/fbb05cf5-32f2-4cc3-bc8a-b539c9e0ed74/FICHA%2BTECNICA%2BCOMPROBANTES%2BELECTR%C3%93NICOS%2Boffline.pdf).

   ```powershell
   $pos = 'http://127.0.0.1:3001'
   $cred = Get-Credential -Message 'Usuario de pruebas con permiso sri:leer'
   $login = Invoke-RestMethod "$pos/api/auth/login" -Method Post -ContentType 'application/json' -Body (@{ username = $cred.UserName; password = $cred.GetNetworkCredential().Password } | ConvertTo-Json)
   $headers = @{ Authorization = "Bearer $($login.token)" }
   (Invoke-RestMethod "$pos/api/comprobantes" -Headers $headers).items | Select-Object id, claveAcceso, estado
   $id = 'ID_DEL_COMPROBANTE_DE_PRUEBAS'
   $detalle = Invoke-RestMethod "$pos/api/comprobantes/$id" -Headers $headers
   if (-not $detalle.xmlGenerado) { throw 'No hay XML generado para ese comprobante' }
   New-Item -ItemType Directory -Force .\evidence | Out-Null
   [IO.File]::WriteAllText((Join-Path (Resolve-Path .\evidence) 'factura-sin-firma.xml'), $detalle.xmlGenerado, (New-Object Text.UTF8Encoding($false)))
   Remove-Variable cred, login, headers
   ```
2. Inicia la CLI. Pedirá RUC, `.p12`, factura y contraseña oculta. Escribe `ENVIAR` para autorizar la transmisión. Si se agota el tiempo, consulta esa misma clave.

   ```powershell
   npm.cmd run sri:test-real
   npm.cmd run sri:test-real -- --consultar CLAVE_DE_ACCESO_DE_49_DIGITOS
   ```

   Espera `evidence/sri.json` y la respuesta SOAP original en `evidence/sri-<clave>.xml`. La CLI exige una autorización en **PRUEBAS** para la clave consultada y verifica la firma XAdES del comprobante.

## 3. Instalación nueva y actualización en Windows limpio

1. Configura las credenciales y variables del paso 4 para obtener el candidato que se va a probar. En Actions, elige **Release → Run workflow** en la rama del commit candidato. Cuando terminen ambos jobs, copia el ID numérico de la ejecución.

   ```powershell
   $run = 'ID_DE_LA_EJECUCION'
   gh run download $run -R claygrefa/VENDEYA-POS -n release-windows -D evidence/candidate/windows
   gh run download $run -R claygrefa/VENDEYA-POS -n release-macos -D evidence/candidate/macos
   ```

2. Usa **dos sesiones limpias** de Windows Sandbox o restaura el mismo checkpoint de la VM entre pruebas. El script solo usa PowerShell 5.1, .NET y utilidades de Windows. Para una VM común, copia el script y ambos EXE a `C:\SmokeInput` y crea `C:\SmokeResults`. En Windows Sandbox, prepara las carpetas mapeadas desde el host. [Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file).

   ```powershell
   $inputDir = New-Item -ItemType Directory -Force .\evidence\vm-input
   $outDir = New-Item -ItemType Directory -Force .\evidence\vm-output
   Copy-Item .\tests\smoke\smoke-test-install.ps1 $inputDir.FullName
   Copy-Item .\evidence\candidate\windows\*.exe $inputDir.FullName
   $inXml = [Security.SecurityElement]::Escape($inputDir.FullName)
   $outXml = [Security.SecurityElement]::Escape($outDir.FullName)
   @"
   <Configuration>
     <MappedFolders>
       <MappedFolder><HostFolder>$inXml</HostFolder><SandboxFolder>C:\SmokeInput</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
       <MappedFolder><HostFolder>$outXml</HostFolder><SandboxFolder>C:\SmokeResults</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
     </MappedFolders>
   </Configuration>
   "@ | Set-Content -Encoding UTF8 .\evidence\vendeya-smoke.wsb
   Start-Process .\evidence\vendeya-smoke.wsb
   ```

3. Ejecuta la primera línea en la primera sesión limpia. Abre una segunda sesión limpia y ejecuta la segunda línea.

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\SmokeInput\smoke-test-install.ps1 -Installer C:\SmokeInput\vendeyapos-Setup-1.0.0.exe -EvidenceDirectory C:\SmokeResults
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\SmokeInput\smoke-test-install.ps1 -Installer C:\SmokeInput\vendeyapos-Setup-1.0.0.exe -BaselineInstaller C:\SmokeInput\baseline.exe -EvidenceDirectory C:\SmokeResults
   ```

   El upgrade instala la base firmada v0.9.99 del ensayo, crea un usuario en la API local e instala encima v1.0.0. Comprueba el inicio de sesión y que la SQLite sea la misma. Esto ejercita NSIS. La descarga de actualizaciones por `electron-updater` requiere su feed publicado.

4. Importa los resultados al host.

   ```powershell
   Copy-Item .\evidence\vm-output\windows-clean.json .\evidence\windows-clean.json
   Copy-Item .\evidence\vm-output\windows-upgrade.json .\evidence\windows-upgrade.json
   ```

## 4. Firma comercial y notarización

En **GitHub Settings → Secrets and variables → Actions → Secrets**, crea estos siete secretos de repositorio.

| Secreto | Valor |
| --- | --- |
| `CSC_LINK` | PFX comercial de Windows con clave privada, codificado en Base64 en una línea |
| `CSC_KEY_PASSWORD` | Contraseña del PFX de Windows |
| `MAC_CSC_LINK` | P12 **Developer ID Application** con clave privada, codificado en Base64 en una línea |
| `MAC_CSC_KEY_PASSWORD` | Contraseña del P12 de macOS |
| `APPLE_ID` | Correo de la cuenta Apple Developer |
| `APPLE_APP_SPECIFIC_PASSWORD` | Contraseña específica de app para `notarytool` |
| `APPLE_TEAM_ID` | ID del equipo Apple Developer |

El flujo usa PFX para Windows. Azure Artifact Signing y los tokens PKCS#11 requieren su propia integración. Authenticode acredita el editor y la integridad. SmartScreen mantiene su propia evaluación de reputación. [Microsoft SmartScreen](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation). [Notarización de electron-builder](https://www.electron.build/v26/docs/notarization/).

En **Variables**, crea `LICENSE_SERVER_URL` con el origen HTTPS probado, `TELEMETRY_URL` con ese origen más `/v1/telemetria` y `LICENSE_PUBLIC_KEY_BASE64` con este PEM **público** en Base64.

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path .release-private/license-public.pem))) | Set-Clipboard
```

En **Settings → Environments**, configura `release-production` con revisores requeridos y limita el despliegue a tags de versión si tu plan lo permite. Revisa en Actions la firma Authenticode con timestamp, la notarización y los tickets de las apps para ambas arquitecturas de macOS y la firma de los DMG. Los ZIP permiten las actualizaciones de macOS. Abre el DMG en un Mac correspondiente para comprobar el primer arranque cuando tengas el equipo. Los `signing.json` de Actions son la evidencia del pipeline.

## 5. Aprobar y publicar v1.0.0

Usa el commit firmado por Actions. El control exige evidencia del HTTPS, SRI, instalación limpia, upgrade y firma para ambos sistemas. Compara los hashes del instalador probado con los de Actions. El modo de comprobación deja el tag pendiente. El modo de publicación descarga la ejecución autenticada, crea el tag anotado y lo sube. El push de `v*` activa la promoción de los mismos binarios.

```powershell
npm.cmd run release:publish
npm.cmd run release:publish -- --publish
```

Aprueba `release-production` en GitHub si tiene revisores. Espera el job **publicar** y comprueba los assets, incluidos NSIS, DMG, ZIP, blockmaps y archivos de actualización. El tag solo conserva huellas de la evidencia privada.
