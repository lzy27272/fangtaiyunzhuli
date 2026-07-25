[CmdletBinding()]
param(
    [string]$EnvFile = '.env'
)

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$resolvedEnvFile = if ([System.IO.Path]::IsPathRooted($EnvFile)) {
    $EnvFile
} else {
    Join-Path $scriptDirectory $EnvFile
}

if (-not (Test-Path -LiteralPath $resolvedEnvFile -PathType Leaf)) {
    throw "Environment file not found: $resolvedEnvFile"
}

function Invoke-Compose {
    param([string[]]$Arguments)

    & docker compose --env-file $resolvedEnvFile -f (Join-Path $scriptDirectory 'compose.yml') @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose failed with exit code $LASTEXITCODE: $($Arguments -join ' ')"
    }
}

Push-Location $scriptDirectory
try {
    Invoke-Compose @('up', '-d', 'ota-postgres')

    # Order is a release invariant: provision roles, migrate, seed the
    # non-secret Worker workload identity, converge grants, then verify the
    # catalog whitelist.
    foreach ($job in @(
        'ota-db-role-bootstrap',
        'ota-db-migrator',
        'ota-db-worker-principal-seed',
        'ota-db-grants',
        'ota-db-grant-verifier'
    )) {
        Invoke-Compose @('--profile', 'deployment', 'run', '--rm', $job)
    }
} finally {
    Pop-Location
}

Write-Output 'PASS: database deployment, Worker principal seed, grants and catalog verification completed.'
