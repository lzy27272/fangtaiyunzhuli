[CmdletBinding()]
param(
    [ValidateSet('DryRun', 'Execute')]
    [string]$Mode = 'DryRun',
    [string]$RuntimeRoot = 'D:\SifangguanHotelAIOS',
    [string]$BackupDirectory = '',
    [string]$Confirmation = '',
    [int]$MaximumBackupAgeHours = 24
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$resolvedRuntimeRoot = [IO.Path]::GetFullPath($RuntimeRoot)
if ($resolvedRuntimeRoot -in @('C:\', 'D:\') -or $resolvedRuntimeRoot.Length -lt 8) {
    throw "Unsafe runtime root: $resolvedRuntimeRoot"
}

$secretFile = Join-Path $resolvedRuntimeRoot 'Secrets\pilot-uat.env'
if (-not (Test-Path -LiteralPath $secretFile)) { throw "Pilot secret file is missing: $secretFile" }
$previousEnvironment = @{}
$loadedEnvironmentNames = @()
try {
foreach ($line in Get-Content -LiteralPath $secretFile -Encoding UTF8) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    $pair = $trimmed.Split('=', 2)
    if ($pair.Count -ne 2) { throw 'Pilot secret file contains an invalid line.' }
    $environmentName = $pair[0].Trim()
    if ($environmentName -notin $loadedEnvironmentNames) {
        $existing = Get-Item -Path "Env:$environmentName" -ErrorAction SilentlyContinue
        $previousEnvironment[$environmentName] = if ($null -eq $existing) { $null } else { $existing.Value }
        $loadedEnvironmentNames += $environmentName
    }
    Set-Item -Path "Env:$environmentName" -Value $pair[1].Trim()
}
foreach ($name in @('PILOT_DB_OWNER', 'PILOT_DB_OWNER_PASSWORD', 'PILOT_DB_NAME', 'PILOT_DB_PORT')) {
    if ([string]::IsNullOrWhiteSpace((Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue).Value)) {
        throw "Required Pilot database setting is missing: $name"
    }
}

$execute = $Mode -eq 'Execute'
if ($execute) {
    if ($Confirmation -cne 'RESTORE-PILOT-DEMO-ACCESS') {
        throw 'Execute mode requires -Confirmation RESTORE-PILOT-DEMO-ACCESS.'
    }
    if ([string]::IsNullOrWhiteSpace($BackupDirectory)) {
        throw 'Execute mode requires -BackupDirectory from PostgresLogicalBackup.'
    }
    $resolvedBackup = [IO.Path]::GetFullPath($BackupDirectory)
    $manifest = Join-Path $resolvedBackup 'manifest.tsv'
    $metadata = Join-Path $resolvedBackup 'metadata.txt'
    if (-not (Test-Path -LiteralPath $manifest) -or -not (Test-Path -LiteralPath $metadata)) {
        throw 'BackupDirectory must contain both manifest.tsv and metadata.txt.'
    }
    $backupAge = (Get-Date) - (Get-Item -LiteralPath $manifest).LastWriteTime
    if ($backupAge.TotalHours -gt $MaximumBackupAgeHours) {
        throw "Backup manifest is older than $MaximumBackupAgeHours hours. Create a new logical backup."
    }
    Write-Host "Verified backup manifest: $manifest"
    Write-Host "Backup manifest SHA256: $((Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash)"
}

$java = Get-ChildItem -LiteralPath (Join-Path $repoRoot '.tooling\jdk') -Filter java.exe -Recurse |
    Select-Object -First 1
$javac = Get-ChildItem -LiteralPath (Join-Path $repoRoot '.tooling\jdk') -Filter javac.exe -Recurse |
    Select-Object -First 1
$driverCandidates = @(
    (Join-Path $repoRoot '.tooling\m2\org\postgresql\postgresql\42.7.7\postgresql-42.7.7.jar'),
    (Join-Path $env:USERPROFILE '.m2\repository\org\postgresql\postgresql\42.7.7\postgresql-42.7.7.jar')
)
$driver = $driverCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $java -or -not $javac -or -not $driver) {
    throw 'Checked-in Java/JDBC maintenance runtime is unavailable.'
}

$classes = Join-Path $repoRoot '.uat-runtime\pilot\java-tools'
New-Item -ItemType Directory -Path $classes -Force | Out-Null
$source = Join-Path $repoRoot 'tools\pilot\PostgresPilotRoleAccessRecovery.java'
& $javac.FullName -cp $driver -d $classes $source
if ($LASTEXITCODE -ne 0) { throw 'Pilot role access recovery compilation failed.' }

$jdbcUrl = "jdbc:postgresql://127.0.0.1:$($env:PILOT_DB_PORT)/$($env:PILOT_DB_NAME)"
$classpath = "$classes;$driver"
$arguments = @($jdbcUrl, $(if ($execute) { 'execute' } else { 'dry-run' }))
if ($execute) { $arguments += $Confirmation }
& $java.FullName -cp $classpath PostgresPilotRoleAccessRecovery @arguments
if ($LASTEXITCODE -ne 0) { throw "Pilot role access recovery failed with exit code $LASTEXITCODE." }
} finally {
    foreach ($environmentName in $loadedEnvironmentNames) {
        if ($null -eq $previousEnvironment[$environmentName]) {
            Remove-Item -Path "Env:$environmentName" -ErrorAction SilentlyContinue
        } else {
            Set-Item -Path "Env:$environmentName" -Value $previousEnvironment[$environmentName]
        }
    }
}
