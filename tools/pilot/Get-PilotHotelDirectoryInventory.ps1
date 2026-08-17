[CmdletBinding()]
param([string]$RuntimeRoot = 'D:\SifangguanHotelAIOS')

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$resolvedRuntimeRoot = [IO.Path]::GetFullPath($RuntimeRoot)
$secretFile = Join-Path $resolvedRuntimeRoot 'Secrets\pilot-uat.env'
if (-not (Test-Path -LiteralPath $secretFile)) { throw 'PILOT_SECRET_FILE_MISSING' }
$previousEnvironment = @{}
$loadedEnvironmentNames = @()
try {
    foreach ($line in Get-Content -LiteralPath $secretFile -Encoding UTF8) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $pair = $trimmed.Split('=', 2)
        if ($pair.Count -ne 2) { throw 'PILOT_SECRET_FILE_INVALID' }
        $name = $pair[0].Trim()
        if ($name -notin $loadedEnvironmentNames) {
            $existing = Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue
            $previousEnvironment[$name] = if ($null -eq $existing) { $null } else { $existing.Value }
            $loadedEnvironmentNames += $name
        }
        Set-Item -Path "Env:$name" -Value $pair[1].Trim()
    }
    foreach ($name in @('PILOT_DB_OWNER', 'PILOT_DB_OWNER_PASSWORD', 'PILOT_DB_NAME', 'PILOT_DB_PORT')) {
        if ([string]::IsNullOrWhiteSpace((Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue).Value)) {
            throw "PILOT_DATABASE_SETTING_MISSING:$name"
        }
    }
    $java = Get-ChildItem -LiteralPath (Join-Path $repoRoot '.tooling\jdk') -Filter java.exe -Recurse |
        Select-Object -First 1
    $driver = Get-ChildItem -LiteralPath (Join-Path $repoRoot '.tooling\m2\org\postgresql\postgresql') -Filter '*.jar' -Recurse |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $java -or -not $driver) { throw 'PILOT_JDBC_RUNTIME_MISSING' }
    $source = Join-Path $repoRoot 'tools\pilot\PilotHotelDirectoryInventory.java'
    $url = "jdbc:postgresql://127.0.0.1:$($env:PILOT_DB_PORT)/$($env:PILOT_DB_NAME)"
    & $java.FullName --class-path $driver.FullName $source $url
    if ($LASTEXITCODE -ne 0) { throw "PILOT_HOTEL_INVENTORY_FAILED:$LASTEXITCODE" }
}
finally {
    foreach ($name in $loadedEnvironmentNames) {
        if ($null -eq $previousEnvironment[$name]) {
            Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
        } else {
            Set-Item -Path "Env:$name" -Value $previousEnvironment[$name]
        }
    }
}
