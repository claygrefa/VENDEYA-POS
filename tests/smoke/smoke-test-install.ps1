param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [string]$BaselineInstaller,
    [string]$EvidenceDirectory,
    [ValidateRange(10, 600)][int]$TimeoutSec = 120
)
$ErrorActionPreference = 'Stop'
if (-not [Environment]::UserInteractive) { throw 'Run in an interactive Windows VM or Sandbox.' }

$appKey = '914c1dd6-a64f-5cdc-bd71-625e29cbfcfb'
$installKey = "HKCU:\Software\$appKey"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$appKey"
$profiles = @('vendeya-pos', 'VENDEYA POS') | ForEach-Object { Join-Path $env:APPDATA $_ }
$keys = @($installKey, $uninstallKey, "HKLM:\Software\$appKey",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$appKey",
    "HKLM:\Software\WOW6432Node\$appKey",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\$appKey")
foreach ($path in ($profiles + $keys)) {
    if (Test-Path -LiteralPath $path) { throw "Use a clean Windows VM. Found $path." }
}
foreach ($name in @('vendeya-pos', 'vendeyapos', 'VENDEYA POS')) {
    $path = Join-Path $env:LOCALAPPDATA "Programs\$name"
    if (Test-Path -LiteralPath $path) { throw "Use a clean Windows VM. Found $path." }
}
if (Get-Process -Name 'VENDEYA POS', 'vendeyapos', 'vendeya-pos' -ErrorAction SilentlyContinue) {
    throw 'A VendeYa POS process is already running.'
}

function Read-Installer([string]$Path) {
    $item = Get-Item -LiteralPath $Path
    $signature = Get-AuthenticodeSignature -LiteralPath $item.FullName
    if ($signature.Status -ne 'Valid' -or -not $signature.TimeStamperCertificate) {
        throw "Expected trusted Authenticode and timestamp. Status: $($signature.Status)."
    }
    [pscustomobject]@{
        Path = $item.FullName
        Signer = $signature.SignerCertificate.Subject
        Thumbprint = $signature.SignerCertificate.Thumbprint
        Hash = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

function Install-Candidate($Info) {
    $install = Start-Process -FilePath $Info.Path -ArgumentList '/S' -WindowStyle Hidden -PassThru
    if (-not $install.WaitForExit($TimeoutSec * 1000)) { throw 'NSIS timed out.' }
    if ($install.ExitCode -ne 0) { throw "NSIS failed: $($install.ExitCode)." }
    $location = Get-ItemPropertyValue -LiteralPath $installKey -Name InstallLocation
    $exe = (Get-Item -LiteralPath (Join-Path $location 'VENDEYA POS.exe')).FullName
    $signature = Get-AuthenticodeSignature -LiteralPath $exe
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $Info.Thumbprint) {
        throw 'The installed app signature does not match the installer.'
    }
    $version = Get-ItemPropertyValue -LiteralPath $uninstallKey -Name DisplayVersion
    [pscustomobject]@{ Exe = $exe; Version = $version }
}

function Invoke-FirstBoot($Installed, [bool]$Configured, [scriptblock]$Check) {
    $listener = New-Object System.Net.Sockets.TcpListener ([Net.IPAddress]::Loopback), 0
    try {
        $listener.Start()
        $port = $listener.LocalEndpoint.Port
    } finally { $listener.Stop() }
    $base = "http://127.0.0.1:$port"
    $options = @{
        SERVER_PORT = [string]$port; VENDEYA_UPDATES = 'off'; SRI_WORKER = 'off'
        VENDEYA_LAN = $null; VENDEYA_SERVIDOR_URL = $null; DB_PATH = $null; ELECTRON_RUN_AS_NODE = $null
    }
    $previous = @{}
    $process = $null
    try {
        foreach ($name in $options.Keys) {
            $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
            [Environment]::SetEnvironmentVariable($name, $options[$name], 'Process')
        }
        $process = Start-Process -FilePath $Installed.Exe -PassThru
        $timer = [Diagnostics.Stopwatch]::StartNew()
        while ($timer.Elapsed.TotalSeconds -lt $TimeoutSec) {
            $process.Refresh()
            if ($process.HasExited) { throw "Electron exited with code $($process.ExitCode)." }
            $db = $profiles | ForEach-Object { Join-Path $_ 'data\vendeya.db' } | Where-Object {
                (Test-Path -LiteralPath $_ -PathType Leaf) -and (Get-Item -LiteralPath $_).Length -gt 0
            } | Select-Object -First 1
            if ($db -and $process.MainWindowHandle -ne [IntPtr]::Zero -and $process.MainWindowTitle -eq 'vendeyapos') {
                $health = $null
                $setup = $null
                try {
                    $health = Invoke-RestMethod "$base/api/health" -TimeoutSec 3
                    $setup = Invoke-RestMethod "$base/api/setup/estado" -TimeoutSec 3
                } catch { Write-Verbose $_.Exception.Message }
                if ($health.db -ceq 'ok' -and $null -ne $setup.configurado -and $setup.configurado -eq $Configured) {
                    if ($Check) { & $Check $base | Out-Null }
                    return $db
                }
            }
            Start-Sleep -Milliseconds 500
        }
        throw 'Timed out waiting for the visible app, healthy SQLite and expected setup state.'
    } finally {
        foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
        if ($null -ne $process -and -not $process.HasExited) {
            if (-not $process.CloseMainWindow() -or -not $process.WaitForExit(15000)) {
                throw 'The app did not close cleanly.'
            }
        }
    }
}

$candidate = Read-Installer $Installer
$evidence = @{ installerSha256 = $candidate.Hash; checkedAt = [DateTime]::UtcNow.ToString('o'); nsisExitCode = 0; healthy = $true }
if ($BaselineInstaller) {
    $baseline = Read-Installer $BaselineInstaller
    if ($baseline.Hash -eq $candidate.Hash -or $baseline.Signer -ne $candidate.Signer) {
        throw 'Use different installers from the same trusted publisher.'
    }
    $older = Install-Candidate $baseline
    $account = @{ username = 'release.smoke'; password = ('Aa1-' + [Guid]::NewGuid().ToString('N')) }
    $original = Invoke-FirstBoot $older $false {
        param($base)
        $setup = @{
            confirmarRuc = $true; giro = 'RETAIL_GENERAL'
            empresa = @{
                ruc = '9999999999001'; razonSocial = 'Smoke Upgrade'; nombreComercial = 'Smoke Upgrade'
                direccionMatriz = 'Local de pruebas'; telefono = '0990000000'; email = 'smoke@example.invalid'
                tipoContribuyente = 'SOCIEDAD'; regimenTributario = 'GENERAL'; ambienteSRI = 'PRUEBAS'
            }
            sucursal = @{ nombre = 'Principal'; direccion = 'Local de pruebas'; telefono = '0990000000' }
            admin = @{ username = $account.username; password = $account.password; nombre = 'Smoke'; apellido = 'Upgrade' }
        }
        Invoke-RestMethod "$base/api/setup" -Method Post -ContentType 'application/json' -Body ($setup | ConvertTo-Json -Depth 5) -TimeoutSec 15
    }
    $installed = Install-Candidate $candidate
    if ([version]$installed.Version -le [version]$older.Version) { throw 'Candidate must have a newer stable version.' }
    $updated = Invoke-FirstBoot $installed $true {
        param($base)
        $login = Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType 'application/json' -Body ($account | ConvertTo-Json) -TimeoutSec 10
        if (-not $login.token) { throw 'The baseline account did not survive the update.' }
    }
    if ($original -ne $updated) { throw 'The update used a different SQLite file.' }
    $evidence.mode = 'upgrade'
    $evidence.baselineVersion = $older.Version
    $evidence.baselineSha256 = $baseline.Hash
    $evidence.dataPreserved = $true
} else {
    $installed = Install-Candidate $candidate
    $null = Invoke-FirstBoot $installed $false $null
    $evidence.mode = 'clean'
}
$evidence.version = $installed.Version
if ($EvidenceDirectory) {
    $null = New-Item -Path $EvidenceDirectory -ItemType Directory -Force
    $target = Join-Path $EvidenceDirectory "windows-$($evidence.mode).json"
    $evidence | ConvertTo-Json | Set-Content -LiteralPath $target -Encoding UTF8
}
Write-Host "VendeYa $($installed.Version) passed Windows $($evidence.mode)."
