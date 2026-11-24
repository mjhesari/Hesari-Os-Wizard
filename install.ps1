$ErrorActionPreference = "Stop"
$Binary = "wizard.exe"
$InstallDir = "hesari-wizard"
$Arch = if ([Environment]::Is64BitOperatingSystem) { "amd64" } else { "386" }
if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64" -or $env:PROCESSOR_ARCHITEW6432 -eq "ARM64") { $Arch = "arm64" }
$Archive = "HESARI-Wizard-windows-$Arch.zip"
$LatestVersion = (Invoke-RestMethod -Uri "https://raw.githubusercontent.com/mjhesari/Hesari-Os-Wizard/main/VERSION").Trim()
if ($LatestVersion -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+$') { throw "Could not determine the Wizard version." }
$ReleaseUrl = "https://github.com/mjhesari/Hesari-Os-Wizard/releases/download/$LatestVersion"
$WorkerUrl = "https://github.com/mjhesari/Hesari-Os/releases/latest/download/worker.js"
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Force -Path $TempDir, $InstallDir | Out-Null
try {
    $BinaryPath = Join-Path $InstallDir $Binary
    $NeedsInstall = $true
    if (Test-Path $BinaryPath) {
        $InstalledVersion = (& $BinaryPath --version).Trim()
        if ($InstalledVersion -eq $LatestVersion) { $NeedsInstall = $false }
    }
    if ($NeedsInstall) {
        Write-Host "Downloading HESARI OS Wizard $LatestVersion..."
        $ZipPath = Join-Path $TempDir $Archive
        Invoke-WebRequest -Uri "$ReleaseUrl/$Archive" -OutFile $ZipPath
        $Checksums = Invoke-RestMethod -Uri "$ReleaseUrl/SHA256SUMS"
        $Expected = ($Checksums -split "`n" | Where-Object { $_ -match "\s+$([regex]::Escape($Archive))\s*$" } | Select-Object -First 1) -split '\s+'
        $Actual = (Get-FileHash -Algorithm SHA256 -Path $ZipPath).Hash
        if (-not $Expected -or $Expected[0] -ne $Actual) { throw "Wizard download checksum did not match. Please try again." }
        $Unpacked = Join-Path $TempDir "unpacked"
        Expand-Archive -Path $ZipPath -DestinationPath $Unpacked -Force
        Copy-Item (Join-Path $Unpacked $Binary) $BinaryPath -Force
        Copy-Item (Join-Path $Unpacked "LICENSE") (Join-Path $InstallDir "LICENSE") -Force
    }
    Write-Host "Downloading HESARI OS..."
    $WorkerPath = Join-Path $TempDir "worker.js"
    Invoke-WebRequest -Uri $WorkerUrl -OutFile $WorkerPath
    if ((Get-Item $WorkerPath).Length -eq 0) { throw "The panel download was empty." }
    Copy-Item $WorkerPath (Join-Path $InstallDir "worker.js") -Force
} finally { Remove-Item $TempDir -Recurse -Force }
$env:LAUNCHED_BY_SCRIPT = "1"
Push-Location $InstallDir
try { & ".\$Binary" } finally { Pop-Location }
