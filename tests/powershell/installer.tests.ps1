$ErrorActionPreference = 'Stop'
$Installer = (Resolve-Path (Join-Path $PSScriptRoot '../../install.ps1')).Path
$OriginalLocation = Get-Location
$TestRoot = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
$Fixtures = Join-Path $TestRoot 'fixtures'
$Unpacked = Join-Path $Fixtures 'unpacked'
New-Item -ItemType Directory -Force -Path $Unpacked | Out-Null
$global:HesariTestRequests = [System.Collections.Generic.List[string]]::new()
$global:HesariTestFailWorker = $false
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Invoke-RestMethod {
    param($Uri)
    $global:HesariTestRequests.Add($Uri)
    if ($Uri.EndsWith('/VERSION')) { return 'v3.1.0' }
    if ($Uri.EndsWith('/SHA256SUMS')) { return Get-Content (Join-Path $Fixtures 'SHA256SUMS') -Raw }
    throw "Unexpected URL $Uri"
}
function Invoke-WebRequest {
    param($Uri, $OutFile)
    $global:HesariTestRequests.Add($Uri)
    if ($global:HesariTestFailWorker -and $Uri.EndsWith('/worker.js')) { throw 'Simulated download failure' }
    $Name = ([Uri]$Uri).Segments[-1]
    Copy-Item (Join-Path $Fixtures $Name) $OutFile
}
function Copy-Item {
    param($Path, $Destination, [switch]$Force)
    Microsoft.PowerShell.Management\Copy-Item -Path $Path -Destination $Destination -Force:$Force
    if (-not $IsWindows -and "$Destination".EndsWith('wizard.exe')) { & chmod +x $Destination }
}

try {
    $Stub = Join-Path $Fixtures 'main.go'
    @'
package main
import ("fmt"; "os")
func main() {
    if len(os.Args) > 1 && os.Args[1] == "--version" { fmt.Println("v3.1.0"); return }
    if err := os.WriteFile("../launched.txt", []byte(os.Getenv("LAUNCHED_BY_SCRIPT")), 0600); err != nil { panic(err) }
}
'@ | Set-Content $Stub
    & go build -o (Join-Path $Unpacked 'wizard.exe') $Stub
    if ($LASTEXITCODE -ne 0) { throw 'Could not build installer fixture' }
    'GPL-3.0 test fixture' | Set-Content (Join-Path $Unpacked 'LICENSE')
    $Arch = if ([Environment]::Is64BitOperatingSystem) { 'amd64' } else { '386' }
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { $Arch = 'arm64' }
    $Archive = "HESARI-Wizard-windows-$Arch.zip"
    $ZipPath = Join-Path $Fixtures $Archive
    Compress-Archive -Path (Join-Path $Unpacked '*') -DestinationPath $ZipPath
    $Checksum = (Get-FileHash -Algorithm SHA256 $ZipPath).Hash
    "$Checksum  $Archive" | Set-Content (Join-Path $Fixtures 'SHA256SUMS')
    'export default {}; // HESARI OS fixture' | Set-Content (Join-Path $Fixtures 'worker.js')
    Set-Location $TestRoot
    & $Installer
    Assert ((Get-Content 'launched.txt' -Raw) -eq '1') 'Wizard was not launched by the installer'
    Assert ((Get-Content 'hesari-wizard/worker.js' -Raw).Contains('HESARI OS')) 'Wrong panel downloaded'
    Assert (($global:HesariTestRequests -join "`n").Contains('mjhesari/Hesari-Os/releases/latest/download/worker.js')) 'Wrong panel source'
    Assert (-not (($global:HesariTestRequests -join "`n").Contains('bia-pain-bache'))) 'Unexpected upstream download'
    Remove-Item 'launched.txt'
    $global:HesariTestRequests.Clear()
    & $Installer
    Assert (-not (($global:HesariTestRequests -join "`n").Contains('.zip'))) 'Current binary was downloaded again'
    Remove-Item 'launched.txt'
    Remove-Item 'hesari-wizard/wizard.exe'
    "bad-checksum  $Archive" | Set-Content (Join-Path $Fixtures 'SHA256SUMS')
    $Failed = $false
    try { & $Installer } catch { $Failed = $_.Exception.Message.Contains('checksum') }
    Assert $Failed 'Bad checksum was accepted'
    Assert (-not (Test-Path 'launched.txt')) 'Unverified binary was launched'
    "$Checksum  $Archive" | Set-Content (Join-Path $Fixtures 'SHA256SUMS')
    'previous panel' | Set-Content 'hesari-wizard/worker.js'
    $global:HesariTestFailWorker = $true
    $Failed = $false
    try { & $Installer } catch { $Failed = $true }
    Assert $Failed 'Failed panel download was ignored'
    Assert (-not (Test-Path 'launched.txt')) 'Wizard launched after failed panel download'
    Assert ((Get-Content 'hesari-wizard/worker.js' -Raw).Trim() -eq 'previous panel') 'Failed download overwrote existing panel'
    Write-Output 'PowerShell installer: fresh install, reuse, checksum rejection, and download failure passed.'
} finally {
    Set-Location $OriginalLocation
    Remove-Item $TestRoot -Recurse -Force
}
