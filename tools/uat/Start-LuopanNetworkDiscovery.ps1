[CmdletBinding()]
param(
    [ValidatePattern('^[a-z0-9][a-z0-9_-]{0,39}$')]
    [string]$ProfileName = 'default'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$baseRuntimeRoot = Join-Path $repoRoot '.uat-runtime\luopan-discovery'
$runtimeRoot = if ($ProfileName -eq 'default') {
    $baseRuntimeRoot
} else {
    Join-Path $baseRuntimeRoot ('profiles\' + $ProfileName)
}
$statusPath = Join-Path $runtimeRoot 'status.json'
$stdoutPath = Join-Path $runtimeRoot 'launcher.stdout.log'
$stderrPath = Join-Path $runtimeRoot 'launcher.stderr.log'
$scriptPath = Join-Path $PSScriptRoot 'discover-luopan-network.mjs'
$nodePath = Join-Path $env:USERPROFILE (
    '.cache\codex-runtimes\codex-primary-runtime\' +
    'dependencies\node\bin\node.exe'
)

if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    throw 'BUNDLED_NODE_NOT_FOUND'
}
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
    throw 'LUOPAN_DISCOVERY_SCRIPT_NOT_FOUND'
}

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

if (Test-Path -LiteralPath $statusPath -PathType Leaf) {
    $previous = Get-Content -LiteralPath $statusPath -Raw -Encoding utf8 |
        ConvertFrom-Json
    if ($previous.pid) {
        $running = Get-Process `
            -Id ([int]$previous.pid) `
            -ErrorAction SilentlyContinue
        if ($running -and $running.ProcessName -eq 'node') {
            [ordered]@{
                status = 'ALREADY_RUNNING'
                pid = $running.Id
                statusPath = $statusPath
            } | ConvertTo-Json
            exit 0
        }
    }
}

$process = Start-Process `
    -FilePath $nodePath `
    -ArgumentList @(
        ('"{0}"' -f $scriptPath),
        ('--profile={0}' -f $ProfileName)
    ) `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru

$deadline = [DateTimeOffset]::Now.AddSeconds(15)
$status = $null
while ([DateTimeOffset]::Now -lt $deadline) {
    Start-Sleep -Milliseconds 250
    if (Test-Path -LiteralPath $statusPath -PathType Leaf) {
        $candidate = Get-Content `
            -LiteralPath $statusPath `
            -Raw `
            -Encoding utf8 |
            ConvertFrom-Json
        if (
            $candidate.pid -eq $process.Id -and
            $candidate.status -in @('STARTING', 'WAITING_FOR_USER')
        ) {
            $status = $candidate
            break
        }
    }
    if ($process.HasExited) {
        $errorTail = if (
            Test-Path -LiteralPath $stderrPath -PathType Leaf
        ) {
            @(Get-Content -LiteralPath $stderrPath -Tail 10)
        } else {
            @()
        }
        throw (
            'LUOPAN_DISCOVERY_START_FAILED: ' +
            ($errorTail -join ' ')
        )
    }
}

if (-not $status) {
    throw 'LUOPAN_DISCOVERY_START_TIMEOUT'
}

[ordered]@{
    status = $status.status
    pid = $process.Id
    profileName = $ProfileName
    browserWindowExpected = $true
    localServerStarted = $false
    localPushStarted = $false
    statusPath = $statusPath
} | ConvertTo-Json
