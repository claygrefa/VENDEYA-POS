param(
    [Parameter(Mandatory = $true)]
    [string]$Installer,
    [ValidateRange(10, 600)]
    [int]$TimeoutSec = 120
)

$ErrorActionPreference = 'Stop'
if (-not [Environment]::UserInteractive) { throw 'Run this check in an interactive Windows session.' }

$installerPath = (Get-Item -LiteralPath $Installer).FullName
$signature = Get-AuthenticodeSignature -LiteralPath $installerPath
if ($signature.Status -ne 'Valid') { throw "Installer Authenticode status: $($signature.Status)." }

# electron-builder UUID v5 for com.vendeya.pos. NSIS reuses this key to upgrade an existing installation.
$appKey = '914c1dd6-a64f-5cdc-bd71-625e29cbfcfb'
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$appKey"
$profiles = @('vendeya-pos', 'VENDEYA POS') | ForEach-Object { Join-Path $env:APPDATA $_ }
$existingKeys = @(
    $uninstallKey,
    "HKCU:\Software\$appKey",
    "HKLM:\Software\$appKey",
    "HKLM:\Software\WOW6432Node\$appKey",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$appKey",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\$appKey"
)
foreach ($path in ($profiles + $existingKeys)) {
    if (Test-Path -LiteralPath $path) { throw "Use a clean Windows VM. Found $path." }
}
foreach ($name in @('vendeya-pos', 'vendeyapos', 'VENDEYA POS')) {
    $existingApp = Join-Path $env:LOCALAPPDATA "Programs\$name"
    if (Test-Path -LiteralPath $existingApp) { throw "Use a clean Windows VM. Found $existingApp." }
}
if (Get-Process -Name 'VENDEYA POS', 'vendeyapos', 'vendeya-pos' -ErrorAction SilentlyContinue) { throw 'A VendeYa POS process is already running.' }

$nsis = Start-Process -FilePath $installerPath -ArgumentList '/S' -WindowStyle Hidden -PassThru
if (-not $nsis.WaitForExit($TimeoutSec * 1000)) { throw 'NSIS timed out. Check the installer in the test VM.' }
Write-Host "NSIS exit code: $($nsis.ExitCode)"
if ($nsis.ExitCode -ne 0) { throw "NSIS failed with exit code $($nsis.ExitCode)." }

$location = Get-ItemPropertyValue -LiteralPath "HKCU:\Software\$appKey" -Name InstallLocation
$app = (Get-Item -LiteralPath (Join-Path $location 'VENDEYA POS.exe')).FullName
$exeSignature = Get-AuthenticodeSignature -LiteralPath $app
if ($exeSignature.Status -ne 'Valid' -or $exeSignature.SignerCertificate.Thumbprint -ne $signature.SignerCertificate.Thumbprint) {
    throw 'The installed executable lacks a valid signature matching the installer.'
}

$listener = New-Object System.Net.Sockets.TcpListener ([Net.IPAddress]::Loopback), 0
try {
    $listener.Start()
    $port = $listener.LocalEndpoint.Port
} finally {
    $listener.Stop()
}

$options = @{
    SERVER_PORT = [string]$port
    VENDEYA_UPDATES = 'off'
    SRI_WORKER = 'off'
    VENDEYA_LAN = $null
    VENDEYA_SERVIDOR_URL = $null
    DB_PATH = $null
    ELECTRON_RUN_AS_NODE = $null
}
$previous = @{}
$process = $null
try {
    foreach ($name in $options.Keys) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $options[$name], 'Process')
    }
    $process = Start-Process -FilePath $app -PassThru
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while ($timer.Elapsed.TotalSeconds -lt $TimeoutSec) {
        $process.Refresh()
        if ($process.HasExited) { throw "Electron exited with code $($process.ExitCode)." }
        $db = $profiles | ForEach-Object { Join-Path $_ 'data\vendeya.db' } | Where-Object {
            (Test-Path -LiteralPath $_ -PathType Leaf) -and (Get-Item -LiteralPath $_).Length -gt 0
        } | Select-Object -First 1
        if ($db -and $process.MainWindowHandle -ne [IntPtr]::Zero -and $process.MainWindowTitle -eq 'vendeyapos') {
            try {
                $health = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 3
                $setup = Invoke-RestMethod "http://127.0.0.1:$port/api/setup/estado" -TimeoutSec 3
                if ($health.db -ceq 'ok' -and $setup.configurado -eq $false) {
                    Write-Host "First launch passed. Window: vendeyapos. Fresh SQLite database: $db"
                    return
                }
            } catch {
                Write-Verbose $_.Exception.Message
            }
        }
        Start-Sleep -Milliseconds 500
    }
    throw 'Timed out waiting for the VendeYa window, a new SQLite database, and the initial setup API.'
} finally {
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
    if ($null -ne $process -and -not $process.HasExited -and $process.CloseMainWindow()) {
        [void]$process.WaitForExit(10000)
    }
}
