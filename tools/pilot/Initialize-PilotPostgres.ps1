[CmdletBinding()]
param(
    [string]$RuntimeRoot = 'D:\SifangguanHotelAIOS',
    [string]$ServiceName = 'SifangguanPostgreSQL',
    [int]$Port = 55432,
    [switch]$Portable
)

$ErrorActionPreference = 'Stop'

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'This script must run from an elevated Administrator session.'
    }
}

function New-HexSecret([int]$bytes = 32) {
    $buffer = [byte[]]::new($bytes)
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
    return ([BitConverter]::ToString($buffer) -replace '-', '').ToLowerInvariant()
}

function Protect-SecretFile([string]$path) {
    $acl = [Security.AccessControl.FileSecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $allow = [Security.AccessControl.AccessControlType]::Allow
    foreach ($sid in @(
        [Security.Principal.WindowsIdentity]::GetCurrent().User,
        [Security.Principal.SecurityIdentifier]'S-1-5-18',
        [Security.Principal.SecurityIdentifier]'S-1-5-32-544'
    )) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            $sid, [Security.AccessControl.FileSystemRights]::FullControl, $allow
        ))
    }
    Set-Acl -LiteralPath $path -AclObject $acl
}

function Import-EnvironmentFile([string]$path) {
    foreach ($line in Get-Content -LiteralPath $path -Encoding UTF8) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $pair = $trimmed.Split('=', 2)
        if ($pair.Count -ne 2) { throw "Invalid environment line: $line" }
        Set-Item -Path "Env:$($pair[0])" -Value $pair[1]
    }
}

if (-not $Portable) { Assert-Administrator }
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$resolvedRuntimeRoot = [IO.Path]::GetFullPath($RuntimeRoot)
if ($resolvedRuntimeRoot -in @('C:\', 'D:\') -or $resolvedRuntimeRoot.Length -lt 8) {
    throw "Unsafe runtime root: $resolvedRuntimeRoot"
}

$sourceRoot = Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Temp\embedded-pg') -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\postgres.exe') } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $sourceRoot) { throw 'The verified PostgreSQL runtime was not found in the local embedded-pg cache.' }

$installRoot = Join-Path $resolvedRuntimeRoot 'PostgreSQL\14.22'
$dataRoot = Join-Path $resolvedRuntimeRoot 'Data\PostgreSQL'
$secretRoot = Join-Path $resolvedRuntimeRoot 'Secrets'
$logRoot = Join-Path $resolvedRuntimeRoot 'Logs'
$attachmentRoot = Join-Path $resolvedRuntimeRoot 'Data\Attachments'
$secretFile = Join-Path $secretRoot 'pilot-uat.env'
New-Item -ItemType Directory -Force -Path $installRoot, $dataRoot, $secretRoot, $logRoot, $attachmentRoot | Out-Null

if (-not (Test-Path -LiteralPath (Join-Path $installRoot 'bin\postgres.exe'))) {
    Get-ChildItem -LiteralPath $sourceRoot.FullName -Force |
        Copy-Item -Destination $installRoot -Recurse -Force
}

if (-not (Test-Path -LiteralPath $secretFile)) {
    @(
        'PILOT_DB_OWNER=hotel_ai_os_owner'
        "PILOT_DB_OWNER_PASSWORD=$(New-HexSecret)"
        'PILOT_DB_RUNTIME_USER=hotel_ai_os_app'
        "PILOT_DB_RUNTIME_PASSWORD=$(New-HexSecret)"
        'PILOT_DB_NAME=hotel_ai_os_uat'
        "PILOT_DB_PORT=$Port"
        'PILOT_BASIC_AUTH_USER=pilot'
        "PILOT_BASIC_AUTH_PASSWORD=$(New-HexSecret 18)"
        "PILOT_LOCAL_JWT_SECRET=$(New-HexSecret 48)"
    ) | Set-Content -LiteralPath $secretFile -Encoding UTF8
    Protect-SecretFile $secretFile
}
if (-not (Select-String -LiteralPath $secretFile -Pattern '^PILOT_LOCAL_JWT_SECRET=' -Quiet)) {
    Add-Content -LiteralPath $secretFile -Value "PILOT_LOCAL_JWT_SECRET=$(New-HexSecret 48)" -Encoding UTF8
    Protect-SecretFile $secretFile
}
Import-EnvironmentFile $secretFile

$initdb = Join-Path $installRoot 'bin\initdb.exe'
$pgCtl = Join-Path $installRoot 'bin\pg_ctl.exe'
$postgres = Join-Path $installRoot 'bin\postgres.exe'
foreach ($required in @($initdb, $pgCtl, $postgres)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "PostgreSQL binary is missing: $required" }
}

if (-not (Test-Path -LiteralPath (Join-Path $dataRoot 'PG_VERSION'))) {
    $passwordFile = Join-Path $secretRoot 'initdb-owner-password.tmp'
    try {
        Set-Content -LiteralPath $passwordFile -Value $env:PILOT_DB_OWNER_PASSWORD -Encoding Ascii -NoNewline
        Protect-SecretFile $passwordFile
        & $initdb -D $dataRoot -U $env:PILOT_DB_OWNER --pwfile=$passwordFile --auth-host=scram-sha-256 --auth-local=scram-sha-256 --encoding=UTF8 --locale=C
        if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL initdb failed.' }
    } finally {
        Remove-Item -LiteralPath $passwordFile -Force -ErrorAction SilentlyContinue
    }

    @(
        ''
        '# Hotel AI OS Pilot UAT overrides'
        "listen_addresses = '127.0.0.1'"
        "port = $Port"
        'max_connections = 50'
        "shared_buffers = '256MB'"
        "work_mem = '4MB'"
        "maintenance_work_mem = '64MB'"
        "idle_in_transaction_session_timeout = '30s'"
        "idle_session_timeout = '10min'"
        "password_encryption = 'scram-sha-256'"
        "log_timezone = 'Asia/Shanghai'"
        "timezone = 'Asia/Shanghai'"
    ) | Add-Content -LiteralPath (Join-Path $dataRoot 'postgresql.conf') -Encoding UTF8
    @(
        '# Hotel AI OS Pilot UAT: loopback only'
        'host all all 127.0.0.1/32 scram-sha-256'
        'host all all ::1/128 scram-sha-256'
    ) | Set-Content -LiteralPath (Join-Path $dataRoot 'pg_hba.conf') -Encoding Ascii
}

if ($Portable) {
    & $pgCtl status -D $dataRoot | Out-Null
    if ($LASTEXITCODE -ne 0) {
        & $pgCtl start -D $dataRoot -l (Join-Path $logRoot 'postgresql.log') -o "-p $Port" -w
        if ($LASTEXITCODE -ne 0) { throw 'Unable to start portable PostgreSQL.' }
    }
} else {
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $service) {
        & $pgCtl register -N $ServiceName -D $dataRoot -S auto -o "-p $Port"
        if ($LASTEXITCODE -ne 0) { throw "Unable to register PostgreSQL service: $ServiceName" }
        & sc.exe description $ServiceName 'Hotel AI OS Pilot UAT PostgreSQL - loopback only' | Out-Null
        & sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null
    }
    Start-Service -Name $ServiceName -ErrorAction SilentlyContinue
    (Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
}

$java = Get-ChildItem -LiteralPath (Join-Path $repoRoot '.tooling\jdk') -Filter java.exe -Recurse | Select-Object -First 1
$driver = Get-ChildItem -LiteralPath (Join-Path $repoRoot '.tooling\m2\org\postgresql\postgresql') -Filter '*.jar' -Recurse |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
$bootstrap = Join-Path $repoRoot 'tools\pilot\PostgresBootstrap.java'
if (-not $java -or -not $driver) { throw 'Java or PostgreSQL JDBC driver is missing from .tooling.' }

$adminUrl = "jdbc:postgresql://127.0.0.1:$Port/postgres"
& $java.FullName --class-path $driver.FullName $bootstrap bootstrap $adminUrl
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL role/database bootstrap failed.' }

[pscustomobject]@{
    Service = if ($Portable) { 'portable-current-user' } else { $ServiceName }
    Status = if ($Portable) { 'Running' } else { (Get-Service -Name $ServiceName).Status }
    Version = (& $postgres --version)
    Listen = "127.0.0.1:$Port"
    Database = $env:PILOT_DB_NAME
    DataRoot = $dataRoot
    SecretFile = $secretFile
}
