[CmdletBinding()]
param(
    [string]$ApiBase = '',
    [string]$StateFile = '',
    [string]$TokenFile = '',
    [string]$RunId = '',
    [string]$EvidenceRoot = '',
    [switch]$ConfirmMutation,
    [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$engine = Join-Path $PSScriptRoot 'isolated-v21-role-closed-loop.mjs'
if (-not (Test-Path -LiteralPath $engine -PathType Leaf)) {
    throw "Closed-loop UAT engine is missing: $engine"
}

function Resolve-NodeRuntime {
    $bundled = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $bundled -PathType Leaf) { return $bundled }
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw 'Node.js was not found in the bundled Codex runtime or PATH.'
}

$node = Resolve-NodeRuntime
if ($SelfTest) {
    & $node $engine '--self-test'
    if ($LASTEXITCODE -ne 0) { throw "Closed-loop UAT self-test failed with exit code $LASTEXITCODE." }
    return
}

if (-not $ConfirmMutation) {
    throw 'This tool mutates a disposable UAT database. Re-run with -ConfirmMutation after reviewing ApiBase, StateFile and TokenFile.'
}
foreach ($required in @{
    ApiBase = $ApiBase
    StateFile = $StateFile
    TokenFile = $TokenFile
    RunId = $RunId
}.GetEnumerator()) {
    if ([string]::IsNullOrWhiteSpace([string]$required.Value)) {
        throw "$($required.Key) must be supplied explicitly. No live/default target is inferred."
    }
}
if ($RunId -notmatch '^CL-UAT-[A-Za-z0-9._-]{3,73}$') {
    throw 'RunId must start with CL-UAT- and contain only letters, digits, dot, underscore or hyphen.'
}

$resolvedState = [IO.Path]::GetFullPath($StateFile)
$resolvedTokens = [IO.Path]::GetFullPath($TokenFile)
if (-not (Test-Path -LiteralPath $resolvedState -PathType Leaf)) { throw "StateFile does not exist: $resolvedState" }
if (-not (Test-Path -LiteralPath $resolvedTokens -PathType Leaf)) { throw "TokenFile does not exist: $resolvedTokens" }

$arguments = @(
    $engine,
    '--api-base', $ApiBase,
    '--state-file', $resolvedState,
    '--token-file', $resolvedTokens,
    '--run-id', $RunId,
    '--confirm-mutation', 'ISOLATED-CLOSED-LOOP'
)
if (-not [string]::IsNullOrWhiteSpace($EvidenceRoot)) {
    $arguments += @('--evidence-root', [IO.Path]::GetFullPath($EvidenceRoot))
}

Write-Host 'Running eight-role closed-loop UAT against an explicitly confirmed disposable target.'
Write-Host "ApiBase: $ApiBase"
Write-Host "StateFile: $resolvedState"
Write-Host "RunId: $RunId"
Write-Host 'Credential evidence policy: tokens and passwords are never written to reports.'

& $node @arguments
$engineExit = $LASTEXITCODE
if ($engineExit -eq 2) {
    throw 'Closed-loop UAT completed with BLOCKED gaps. Review the generated matrix report; no shared Pilot target was modified.'
}
if ($engineExit -ne 0) {
    throw "Closed-loop UAT failed with exit code $engineExit."
}

Write-Host 'Eight-role capability UAT passed within its declared scope. This is not a full daily-operations main-closed-loop claim.'
