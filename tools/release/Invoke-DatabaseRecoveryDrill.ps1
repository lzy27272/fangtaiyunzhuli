[CmdletBinding()]
param(
    [string]$RunId = (Get-Date -Format 'yyyyMMdd-HHmmss'),
    [string]$EvidenceDirectory
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Mount-AsciiWorkspace([string]$path) {
    if ($path -notmatch '[^\x00-\x7F]') {
        return [ordered]@{ root = $path; drive = $null; junction = $null }
    }
    $junction = Join-Path ([System.IO.Path]::GetTempPath()) ("hotel-ai-os-db-drill-" + [Guid]::NewGuid().ToString('N'))
    try {
        New-Item -ItemType Junction -Path $junction -Target $path -ErrorAction Stop | Out-Null
        return [ordered]@{ root = $junction; drive = $null; junction = $junction }
    } catch {
        if (Test-Path -LiteralPath $junction) {
            Remove-Item -LiteralPath $junction -Force
        }
    }
    $subst = Join-Path $env:SystemRoot 'System32\subst.exe'
    foreach ($letter in @('R', 'Q', 'P', 'O')) {
        if (Test-Path -LiteralPath "${letter}:\") { continue }
        & $subst "${letter}:" $path
        if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath "${letter}:\")) {
            return [ordered]@{ root = "${letter}:\"; drive = "${letter}:"; junction = $null }
        }
    }
    throw 'No free drive letter was available for the ASCII build-path mapping.'
}

function Dismount-AsciiWorkspace($mapping) {
    if ($mapping.junction) {
        $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        $junctionPath = [System.IO.Path]::GetFullPath($mapping.junction)
        if (-not $junctionPath.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove junction outside the temporary directory: $junctionPath"
        }
        [System.IO.Directory]::Delete($junctionPath, $false)
    }
    if ($mapping.drive) {
        & (Join-Path $env:SystemRoot 'System32\subst.exe') $mapping.drive '/D'
        if ($LASTEXITCODE -ne 0) { Write-Warning "Failed to remove build-path mapping $($mapping.drive)" }
    }
}

$workspaceMapping = Mount-AsciiWorkspace $repoRoot
$buildRepoRoot = $workspaceMapping.root
$apiDir = Join-Path $buildRepoRoot 'apps\core-api'
if (-not $EvidenceDirectory) {
    $EvidenceDirectory = Join-Path $repoRoot ".uat-runtime\release-db-drill\$RunId\evidence"
}
$evidence = [System.IO.Path]::GetFullPath($EvidenceDirectory)
$allowedRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot '.uat-runtime\release-db-drill'))
if (-not $evidence.StartsWith($allowedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "EvidenceDirectory must stay under $allowedRoot"
}
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
$repoPrefix = $repoRoot.TrimEnd('\') + '\'
if (-not $evidence.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "EvidenceDirectory must stay under the workspace root: $repoRoot"
}
$evidenceForJava = Join-Path $buildRepoRoot $evidence.Substring($repoPrefix.Length)

$maven = Get-Command mvn -ErrorAction SilentlyContinue
if ($maven) { $mavenPath = $maven.Source } else {
    $mavenPath = Get-ChildItem -LiteralPath (Join-Path $buildRepoRoot '.tooling\maven') -Filter mvn.cmd -Recurse |
        Select-Object -First 1 -ExpandProperty FullName
}
$java = Get-Command java -ErrorAction SilentlyContinue
if ($java) { $javaPath = $java.Source } else {
    $javaPath = Get-ChildItem -LiteralPath (Join-Path $buildRepoRoot '.tooling\jdk') -Filter java.exe -Recurse |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $mavenPath -or -not $javaPath) { throw 'Java 21 and Maven are required.' }

$previousJavaHome = $env:JAVA_HOME
$javaHome = Split-Path -Parent (Split-Path -Parent $javaPath)
$env:JAVA_HOME = $javaHome
$env:Path = "$(Join-Path $javaHome 'bin');$env:Path"
try {
    Push-Location $apiDir
    try {
        & $mavenPath "-Dmaven.repo.local=$(Join-Path $buildRepoRoot '.tooling\m2')" `
            '-Drelease.database-drill=true' `
            "-Drelease.drill-run-id=$RunId" `
            "-Drelease.evidence-dir=$evidenceForJava" `
            '-Dtest=PostgresBackupRestoreRollbackIntegrationTest' test
        if ($LASTEXITCODE -ne 0) { throw 'Database backup/restore/rollback drill failed.' }
    } finally { Pop-Location }
} finally {
    $env:JAVA_HOME = $previousJavaHome
    Dismount-AsciiWorkspace $workspaceMapping
}

$resultFile = Join-Path $evidence 'database-recovery-drill.json'
if (-not (Test-Path -LiteralPath $resultFile)) { throw "Recovery evidence was not created: $resultFile" }
$result = Get-Content -LiteralPath $resultFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($result.status -ne 'PASS') { throw "Recovery evidence status is not PASS: $($result.status)" }
$result | ConvertTo-Json -Depth 8
