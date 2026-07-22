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
$sqlFile = Join-Path $repoRoot 'database\maintenance\cleanup_pilot_uat_artifacts.sql'
if (-not (Test-Path -LiteralPath $secretFile)) { throw "Pilot secret file is missing: $secretFile" }
if (-not (Test-Path -LiteralPath $sqlFile)) { throw "Cleanup SQL is missing: $sqlFile" }

foreach ($line in Get-Content -LiteralPath $secretFile -Encoding UTF8) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    $pair = $trimmed.Split('=', 2)
    if ($pair.Count -ne 2) { throw 'Pilot secret file contains an invalid line.' }
    Set-Item -Path "Env:$($pair[0].Trim())" -Value $pair[1].Trim()
}

foreach ($name in @('PILOT_DB_OWNER', 'PILOT_DB_OWNER_PASSWORD', 'PILOT_DB_NAME', 'PILOT_DB_PORT')) {
    if ([string]::IsNullOrWhiteSpace((Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue).Value)) {
        throw "Required Pilot database setting is missing: $name"
    }
}

$psql = Get-Command psql.exe -ErrorAction SilentlyContinue
if (-not $psql) {
    $psql = Get-ChildItem -LiteralPath (Join-Path $resolvedRuntimeRoot 'PostgreSQL') -Filter psql.exe -Recurse -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}
$psqlPath = if ($psql) { if ($psql.Source) { $psql.Source } else { $psql.FullName } } else { $null }

$execute = $Mode -eq 'Execute'
if ($execute) {
    if ($Confirmation -cne 'DELETE-PILOT-UAT-ONLY') {
        throw 'Execute mode requires -Confirmation DELETE-PILOT-UAT-ONLY.'
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
    $manifestHash = (Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash
    Write-Host "Verified backup manifest: $manifest"
    Write-Host "Backup manifest SHA256: $manifestHash"
} else {
    if ($Confirmation -or $BackupDirectory) {
        Write-Warning 'Confirmation and BackupDirectory are ignored in DryRun mode.'
    }
    $Confirmation = ''
}

$previousPgPassword = $env:PGPASSWORD
try {
    $env:PGPASSWORD = $env:PILOT_DB_OWNER_PASSWORD
    Write-Host "Pilot UAT cleanup mode: $Mode"
    if ($psqlPath) {
        $arguments = @(
            '-X', '--no-password', '--set', 'ON_ERROR_STOP=1',
            '--set', "cleanup_execute=$($execute.ToString().ToLowerInvariant())",
            '--set', "cleanup_confirmation=$Confirmation",
            '--host', '127.0.0.1', '--port', $env:PILOT_DB_PORT,
            '--username', $env:PILOT_DB_OWNER, '--dbname', $env:PILOT_DB_NAME,
            '--file', $sqlFile
        )
        & $psqlPath @arguments
    } else {
        $java = Get-ChildItem -LiteralPath (Join-Path $repoRoot '.tooling\jdk') -Filter java.exe -Recurse | Select-Object -First 1
        $javac = Get-ChildItem -LiteralPath (Join-Path $repoRoot '.tooling\jdk') -Filter javac.exe -Recurse | Select-Object -First 1
        $driver = Join-Path $env:USERPROFILE '.m2\repository\org\postgresql\postgresql\42.7.7\postgresql-42.7.7.jar'
        $runnerSource = Join-Path $repoRoot 'tools\pilot\PostgresMaintenanceRunner.java'
        if (-not $java -or -not $javac -or -not (Test-Path -LiteralPath $driver)) {
            throw 'Neither psql.exe nor the checked-in JDBC maintenance runtime is available.'
        }
        & $javac.FullName -cp $driver $runnerSource
        if ($LASTEXITCODE -ne 0) { throw 'JDBC maintenance runner compilation failed.' }
        $jdbcUrl = "jdbc:postgresql://127.0.0.1:$($env:PILOT_DB_PORT)/$($env:PILOT_DB_NAME)"
        $classpath = "$(Join-Path $repoRoot 'tools\pilot');$driver"
        $confirmationArgument = if ([string]::IsNullOrEmpty($Confirmation)) { '-' } else { $Confirmation }
        & $java.FullName -cp $classpath PostgresMaintenanceRunner $jdbcUrl $sqlFile $execute.ToString().ToLowerInvariant() $confirmationArgument
    }
    if ($LASTEXITCODE -ne 0) { throw "Pilot UAT cleanup failed with database runner exit code $LASTEXITCODE." }
} finally {
    $env:PGPASSWORD = $previousPgPassword
}

if ($execute) {
    Write-Host 'Pilot UAT cleanup committed only after protected-data and zero-remaining verification.'
} else {
    Write-Host 'Dry-run complete. The SQL transaction was rolled back.'
}
