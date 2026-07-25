[CmdletBinding()]
param(
    [string]$NodeExecutable,
    [switch]$RunRealPostgres,
    [string]$PostgresBin
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Invoke-Checked {
    param(
        [Parameter(Mandatory)]
        [string]$FilePath,
        [Parameter(Mandatory)]
        [string[]]$ArgumentList,
        [Parameter(Mandatory)]
        [string]$WorkingDirectory,
        [Parameter(Mandatory)]
        [string]$Label
    )

    Write-Host "==> $Label"
    Push-Location $WorkingDirectory
    try {
        & $FilePath @ArgumentList
        if ($LASTEXITCODE -ne 0) {
            throw "$Label failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

function Resolve-NodeExecutable {
    if ($NodeExecutable) {
        return (Resolve-Path $NodeExecutable).Path
    }

    $command = Get-Command node -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $candidate = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $candidate) {
        return $candidate
    }

    throw 'Node.js was not found. Pass -NodeExecutable with an explicit node.exe path.'
}

$jdk = (Resolve-Path (Join-Path $repoRoot '.tooling\jdk\jdk-21.0.11+10')).Path
$maven = (Resolve-Path (Join-Path $repoRoot '.tooling\maven\apache-maven-3.9.9\bin\mvn.cmd')).Path
$mavenRepo = (Resolve-Path (Join-Path $repoRoot '.tooling\m2')).Path
$resolvedNode = Resolve-NodeExecutable
$webRoot = Join-Path $repoRoot 'apps\ota-standalone-web'

$previousJavaHome = $env:JAVA_HOME
$previousMavenOpts = $env:MAVEN_OPTS
try {
    $env:JAVA_HOME = $jdk
    $env:MAVEN_OPTS = "-Dmaven.repo.local=$mavenRepo"

    Invoke-Checked `
        -FilePath $maven `
        -ArgumentList @('-o', '-f', (Join-Path $repoRoot 'ota-platform-pom.xml'), 'test') `
        -WorkingDirectory $repoRoot `
        -Label 'Maven contracts, API and worker tests'

    Invoke-Checked `
        -FilePath $resolvedNode `
        -ArgumentList @('--test', 'tests/*.test.mjs') `
        -WorkingDirectory $webRoot `
        -Label 'Sprint 1 web tests'

    Invoke-Checked `
        -FilePath $resolvedNode `
        -ArgumentList @((Join-Path $webRoot 'node_modules\typescript\bin\tsc'), '-b') `
        -WorkingDirectory $webRoot `
        -Label 'Sprint 1 web TypeScript build'

    Invoke-Checked `
        -FilePath $resolvedNode `
        -ArgumentList @((Join-Path $webRoot 'node_modules\vite\bin\vite.js'), 'build', '--configLoader', 'runner') `
        -WorkingDirectory $webRoot `
        -Label 'Sprint 1 web production bundle'

    Invoke-Checked `
        -FilePath 'powershell.exe' `
        -ArgumentList @(
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', (Join-Path $repoRoot 'database\ota-migrations\verify-structure.ps1')
        ) `
        -WorkingDirectory $repoRoot `
        -Label 'Database migration structure gate'

    Invoke-Checked `
        -FilePath 'powershell.exe' `
        -ArgumentList @(
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', (Join-Path $repoRoot 'infra\ota\verify-deployment-structure.ps1')
        ) `
        -WorkingDirectory $repoRoot `
        -Label 'Database deployment structure gate'

    if ($RunRealPostgres) {
        if (-not $PostgresBin) {
            throw '-PostgresBin is required with -RunRealPostgres.'
        }
        Invoke-Checked `
            -FilePath 'powershell.exe' `
            -ArgumentList @(
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-File', (Join-Path $repoRoot 'database\ota-migrations\verify-real-postgresql.ps1'),
                '-PostgresBin', (Resolve-Path $PostgresBin).Path
            ) `
            -WorkingDirectory $repoRoot `
            -Label 'Real PostgreSQL RLS and catalog verification'
    }
}
finally {
    $env:JAVA_HOME = $previousJavaHome
    $env:MAVEN_OPTS = $previousMavenOpts
}

Write-Host 'PASS: OTA Sprint 1 verification completed.'
