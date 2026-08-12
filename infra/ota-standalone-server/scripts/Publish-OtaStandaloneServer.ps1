[CmdletBinding()]
param(
    [ValidateSet('Plan', 'Package', 'Publish')]
    [string]$Mode = 'Publish',

    [string]$RemoteHost = 'ubuntu@43.136.184.38',

    [string]$IdentityFile = (
        (Join-Path $env:USERPROFILE `
            '.ssh\sifangguan_tencent_ota_ed25519')
    ),

    [string]$GitRemote = 'ota-yunying',

    [string]$GitBranch = 'main',

    [string]$ExpectedGitRemoteUrl = (
        'https://github.com/lzy27272/' +
        'OTAyunyingtuisongzhushou.git'
    ),

    [switch]$SkipGitPush,

    [switch]$SkipTests,

    [switch]$AllowDirtyPlan,

    [ValidateRange(1024, 65535)]
    [int]$LocalTunnelPort = 15180,

    [switch]$SkipTunnelEnsure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (
    Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
).Path
$webRoot = Join-Path $repoRoot 'apps\ota-standalone-web'
$distRoot = Join-Path $webRoot 'dist'
$tscPath = Join-Path $webRoot 'node_modules\typescript\bin\tsc'
$vitePath = Join-Path $webRoot 'node_modules\vite\bin\vite.js'
$scannerPath = Join-Path `
    $repoRoot `
    'tools\release\Test-ReleaseSensitiveInformation.ps1'
$releaseRoot = Join-Path $repoRoot 'tmp\release\ota-standalone'
$deployScriptRelative = (
    'infra/ota-standalone-server/scripts/deploy-native.sh'
)
$runtimeSourcePaths = @(
    $deployScriptRelative,
    'infra/ota-standalone-server/scripts/status-native.sh',
    'infra/ota-standalone-server/scripts/configure-ai-runtime.sh',
    'tools/uat/ota-standalone-review-api.mjs',
    'tools/uat/report-source-cookie-crypto.mjs',
    'tools/uat/review-auth-store.mjs',
    'tools/uat/ota-source-collector.mjs',
    'tools/uat/meituan-comment-browser-collector.mjs',
    'tools/uat/luopan-controlled-browser-collector.mjs',
    'tools/uat/luopan-stayed-order-collector.mjs',
    'tools/uat/luopan-assisted-login.mjs',
    'tools/uat/luopan-forecast-parser.mjs',
    'tools/uat/luopan-network-sanitizer.mjs',
    'tools/uat/luopan-profile.mjs',
    'tools/uat/luopan-repair-challenge.mjs',
    'tools/uat/luopan-repair-page.mjs',
    'tools/uat/luopan-session-state.mjs',
    'tools/uat/live-report-collector.mjs',
    'tools/uat/report-schedule.mjs',
    'tools/uat/send-combined-operations-test.mjs',
    'tools/uat/wecom/src/combined-operations-brief.mjs',
    'tools/uat/wecom/src/delivery-claim.mjs',
    'tools/uat/wecom/src/future-booking-ai-advice.mjs',
    'tools/uat/wecom/src/future-booking-brief.mjs',
    'tools/uat/wecom/src/future-demand-risk.mjs',
    'tools/uat/wecom/src/hot-selling-sold-out-alert.mjs',
    'tools/uat/wecom/src/hourly-delivery-candidates.mjs',
    'tools/uat/wecom/src/briefing-delivery-audit.mjs',
    'tools/uat/wecom/src/pms-json-summary.mjs',
    'tools/uat/wecom/src/report-monitor-brief.mjs',
    'tools/uat/wecom/src/wecom-group-robot.mjs',
    'tools/uat/wecom/src/wecom-repair-bot.mjs',
    'tools/uat/wecom/src/wecom-test-suite.mjs',
    'tools/uat/vendor/wecom-aibot-sdk-1.0.7.cjs',
    'tools/uat/vendor/NOTICE.md',
    'tools/uat/wecom/Test-FutureBookingAiConfig.mjs'
)

function Resolve-RequiredCommand([string]$Name) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "REQUIRED_COMMAND_NOT_FOUND:$Name"
    }
    return $command.Source
}

function Resolve-NodeRuntime {
    $command = Get-Command 'node.exe' -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }
    $bundledNode = Join-Path $env:USERPROFILE (
        '.cache\codex-runtimes\codex-primary-runtime\' +
        'dependencies\node\bin\node.exe'
    )
    if (Test-Path -LiteralPath $bundledNode -PathType Leaf) {
        return $bundledNode
    }
    throw 'REQUIRED_NODE_RUNTIME_NOT_FOUND'
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory)]
        [string]$FilePath,

        [Parameter(Mandatory)]
        [string[]]$Arguments,

        [string]$WorkingDirectory = $repoRoot
    )

    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw (
                'COMMAND_FAILED:{0}:EXIT_{1}' -f
                ([IO.Path]::GetFileName($FilePath)),
                $LASTEXITCODE
            )
        }
    }
    finally {
        Pop-Location
    }
}

function ConvertTo-NormalizedGitUrl([string]$Value) {
    return ($Value.Trim().TrimEnd('/') -replace '\.git$', '').ToLowerInvariant()
}

function Invoke-SensitiveScan {
    param(
        [string]$Directory,
        [string[]]$Files = @()
    )

    $scanInputs = @()
    if ($Directory) {
        $scanInputs += [pscustomobject]@{
            Type = 'Directory'
            Path = $Directory
        }
    }
    foreach ($file in $Files) {
        $scanInputs += [pscustomobject]@{
            Type = 'File'
            Path = $file
        }
    }
    if ($scanInputs.Count -lt 1) {
        throw 'SENSITIVE_SCAN_INPUT_MISSING'
    }
    $filesScanned = 0
    foreach ($input in $scanInputs) {
        $arguments = @(
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            $scannerPath,
            '-OutputFormat',
            'Json'
        )
        if ($input.Type -eq 'Directory') {
            $arguments += @('-RcEvidencePath', $input.Path)
        }
        else {
            $arguments += @('-InputFile', $input.Path)
        }
        $raw = & powershell.exe @arguments
        $exitCode = $LASTEXITCODE
        $result = ($raw -join [Environment]::NewLine) | ConvertFrom-Json
        if ($exitCode -ne 0 -or $result.status -ne 'PASS') {
            $summary = $result.summary
            throw (
                'SENSITIVE_SCAN_BLOCKED:findings={0}:errors={1}' -f
                $summary.findingGroups,
                $summary.errorGroups
            )
        }
        $filesScanned += [int]$result.summary.filesScanned
    }
    return [pscustomobject]@{
        Status = 'PASS'
        FilesScanned = $filesScanned
        FindingGroups = 0
    }
}

function Invoke-SshScript {
    param(
        [Parameter(Mandatory)]
        [string]$Script
    )

    $normalizedScript = $Script.Replace(
        "`r`n",
        "`n"
    ).Replace(
        "`r",
        "`n"
    )
    $encoded = [Convert]::ToBase64String(
        [Text.Encoding]::UTF8.GetBytes($normalizedScript)
    )
    & $script:sshPath `
        -i $IdentityFile `
        -o BatchMode=yes `
        -o StrictHostKeyChecking=accept-new `
        $RemoteHost `
        "echo $encoded | base64 -d | sh"
    if ($LASTEXITCODE -ne 0) {
        throw "SSH_SCRIPT_FAILED:EXIT_$LASTEXITCODE"
    }
}

function Wait-ServerUiThroughTunnel {
    param(
        [int]$Port,
        [int]$TimeoutSeconds = 15
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest `
                -Uri "http://127.0.0.1:$Port/" `
                -UseBasicParsing `
                -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                return [int]$response.StatusCode
            }
        }
        catch {
            # The server services or the tunnel may still be starting.
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    return $null
}

function Test-LocalPortListening([int]$Port) {
    $lines = netstat -ano -p tcp | Select-String -Pattern 'LISTENING'
    return @(
        $lines | Where-Object {
            $_.Line -match (':{0}\s' -f $Port)
        }
    ).Count -gt 0
}

function Ensure-ServerUiTunnel([int]$Port) {
    $status = Wait-ServerUiThroughTunnel -Port $Port -TimeoutSeconds 5
    if ($status -eq 200) {
        return $status
    }
    if (Test-LocalPortListening -Port $Port) {
        throw 'LOCAL_TUNNEL_PORT_OCCUPIED_BUT_UNHEALTHY'
    }
    $arguments = @(
        '-N',
        '-i',
        $IdentityFile,
        '-L',
        "${Port}:127.0.0.1:5180",
        '-o',
        'BatchMode=yes',
        '-o',
        'ExitOnForwardFailure=yes',
        '-o',
        'ServerAliveInterval=30',
        '-o',
        'ServerAliveCountMax=3',
        $RemoteHost
    )
    $null = Start-Process `
        -FilePath $script:sshPath `
        -ArgumentList $arguments `
        -WindowStyle Hidden `
        -PassThru
    $status = Wait-ServerUiThroughTunnel -Port $Port -TimeoutSeconds 15
    if ($status -ne 200) {
        throw 'SERVER_UI_TUNNEL_UNAVAILABLE'
    }
    return $status
}

$gitPath = Resolve-RequiredCommand 'git.exe'
$nodePath = Resolve-NodeRuntime
$tarPath = Resolve-RequiredCommand 'tar.exe'
$script:sshPath = Resolve-RequiredCommand 'ssh.exe'
$scpPath = Resolve-RequiredCommand 'scp.exe'

if (-not (Test-Path -LiteralPath $scannerPath -PathType Leaf)) {
    throw 'SENSITIVE_SCANNER_NOT_FOUND'
}
if (
    -not (Test-Path -LiteralPath $tscPath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $vitePath -PathType Leaf)
) {
    throw 'LOCAL_LOCKED_WEB_TOOLCHAIN_NOT_FOUND'
}

$commit = (& $gitPath -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') {
    throw 'GIT_COMMIT_INVALID'
}
$branch = (& $gitPath -C $repoRoot branch --show-current).Trim()
$dirtyTracked = @(
    & $gitPath -C $repoRoot status --porcelain --untracked-files=no
)
if (
    $dirtyTracked.Count -gt 0 -and
    -not ($Mode -eq 'Plan' -and $AllowDirtyPlan)
) {
    throw 'TRACKED_WORKTREE_NOT_CLEAN'
}

$configuredRemoteUrl = (
    & $gitPath -C $repoRoot remote get-url $GitRemote
).Trim()
if ($LASTEXITCODE -ne 0) {
    throw 'GIT_REMOTE_NOT_FOUND'
}
$normalizedConfiguredRemote = ConvertTo-NormalizedGitUrl $configuredRemoteUrl
$normalizedExpectedRemote = ConvertTo-NormalizedGitUrl $ExpectedGitRemoteUrl
if ($normalizedConfiguredRemote -ne $normalizedExpectedRemote) {
    throw 'GIT_REMOTE_URL_MISMATCH'
}

foreach ($path in $runtimeSourcePaths) {
    & $gitPath -C $repoRoot cat-file -e "${commit}:$path"
    if ($LASTEXITCODE -ne 0) {
        throw "RUNTIME_SOURCE_NOT_COMMITTED:$path"
    }
}

$plan = [ordered]@{
    status = 'OTA_SERVER_RELEASE_PLAN_READY'
    mode = $Mode
    commit = $commit
    localBranch = $branch
    gitRemote = $GitRemote
    gitBranch = $GitBranch
    remoteHost = $RemoteHost
    trackedWorktreeClean = ($dirtyTracked.Count -eq 0)
    runtimeSourceFileCount = $runtimeSourcePaths.Count
    persistentRuntimeExcluded = $true
}
if ($Mode -eq 'Plan') {
    $plan | ConvertTo-Json
    return
}

if (-not (Test-Path -LiteralPath $distRoot -PathType Container)) {
    New-Item -ItemType Directory -Path $distRoot -Force | Out-Null
}
if (-not $SkipTests) {
    $testFiles = @(
        Get-ChildItem `
            -LiteralPath (Join-Path $webRoot 'tests') `
            -Filter '*.test.mjs' `
            -File |
            ForEach-Object { $_.FullName }
    )
    if ($testFiles.Count -lt 1) {
        throw 'WEB_TEST_FILES_NOT_FOUND'
    }
    Invoke-CheckedCommand `
        -FilePath $nodePath `
        -Arguments (@('--test') + $testFiles) `
        -WorkingDirectory $webRoot
}
Invoke-CheckedCommand `
    -FilePath $nodePath `
    -Arguments @($tscPath, '-b') `
    -WorkingDirectory $webRoot
Invoke-CheckedCommand `
    -FilePath $nodePath `
    -Arguments @($vitePath, 'build', '--configLoader', 'runner') `
    -WorkingDirectory $webRoot
if (
    -not (Test-Path `
        -LiteralPath (Join-Path $distRoot 'index.html') `
        -PathType Leaf)
) {
    throw 'WEB_BUILD_OUTPUT_MISSING'
}

$stamp = Get-Date -Format 'yyyyMMddTHHmmss'
$workRoot = Join-Path $releaseRoot "${commit}-${stamp}"
$stageRoot = Join-Path $workRoot 'stage'
$sourceArchive = Join-Path $workRoot 'source.tar'
$releaseArchive = Join-Path $workRoot "sifangguan-ota-${commit}.tar.gz"
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null

$archiveArguments = @(
    'archive',
    '--format=tar',
    "--output=$sourceArchive",
    $commit,
    '--'
) + $runtimeSourcePaths
Invoke-CheckedCommand `
    -FilePath $gitPath `
    -Arguments $archiveArguments
Invoke-CheckedCommand `
    -FilePath $tarPath `
    -Arguments @('-xf', $sourceArchive, '-C', $stageRoot)

$stagedDistParent = Join-Path $stageRoot 'apps\ota-standalone-web'
New-Item -ItemType Directory -Path $stagedDistParent -Force | Out-Null
Copy-Item `
    -LiteralPath $distRoot `
    -Destination (Join-Path $stagedDistParent 'dist') `
    -Recurse `
    -Force

$manifest = [ordered]@{
    schemaVersion = 1
    commit = $commit
    builtAt = [DateTimeOffset]::Now.ToString('o')
    payload = 'OTA_STANDALONE_MINIMAL_RUNTIME'
    persistentRuntimeIncluded = $false
}
[IO.File]::WriteAllText(
    (Join-Path $stageRoot '.release-manifest.json'),
    ($manifest | ConvertTo-Json) + [Environment]::NewLine,
    [Text.UTF8Encoding]::new($false)
)

$forbiddenNames = @(
    '.uat-runtime',
    'credentials.json',
    'secret-key.dpapi',
    'report-source-cookie-secrets.json',
    'pms-login-secrets.json',
    'luopan-session-secrets.json',
    'ota-source-secrets.json',
    'wecom-webhook-secrets.json',
    'wecom-repair-bot-secrets.json',
    'runtime.env'
)
$stagedItems = @(
    Get-ChildItem -LiteralPath $stageRoot -Recurse -Force
)
foreach ($item in $stagedItems) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'RELEASE_REPARSE_POINT_NOT_ALLOWED'
    }
    if ($forbiddenNames -contains $item.Name) {
        throw "RELEASE_FORBIDDEN_FILE:$($item.Name)"
    }
}

$payloadScan = Invoke-SensitiveScan -Directory $stageRoot
Invoke-CheckedCommand `
    -FilePath $tarPath `
    -Arguments @('-czf', $releaseArchive, '-C', $stageRoot, '.')
$archiveSha256 = (
    Get-FileHash -LiteralPath $releaseArchive -Algorithm SHA256
).Hash.ToLowerInvariant()
$archiveBytes = (Get-Item -LiteralPath $releaseArchive).Length

if ($Mode -eq 'Package') {
    [ordered]@{
        status = 'OTA_SERVER_RELEASE_PACKAGE_READY'
        commit = $commit
        archivePath = $releaseArchive
        archiveSha256 = $archiveSha256
        archiveBytes = $archiveBytes
        sensitiveScan = $payloadScan
    } | ConvertTo-Json -Depth 4
    return
}

if (-not (Test-Path -LiteralPath $IdentityFile -PathType Leaf)) {
    throw 'SSH_IDENTITY_FILE_NOT_FOUND'
}

if (-not $SkipGitPush) {
    Invoke-CheckedCommand `
        -FilePath $gitPath `
        -Arguments @(
            'fetch',
            '--no-tags',
            $GitRemote,
            "refs/heads/${GitBranch}:refs/remotes/${GitRemote}/${GitBranch}"
        )
    $remoteCommit = (
        & $gitPath -C $repoRoot rev-parse `
            "refs/remotes/${GitRemote}/${GitBranch}"
    ).Trim()
    & $gitPath -C $repoRoot merge-base --is-ancestor $remoteCommit $commit
    if ($LASTEXITCODE -ne 0) {
        throw 'GIT_REMOTE_NON_FAST_FORWARD'
    }
    if ($remoteCommit -ne $commit) {
        $changedRelativePaths = @(
            & $gitPath -C $repoRoot diff `
                --name-only `
                --diff-filter=ACMR `
                "${remoteCommit}..${commit}" `
                --
        )
        $changedFiles = @(
            $changedRelativePaths |
                ForEach-Object { Join-Path $repoRoot $_ } |
                Where-Object {
                    Test-Path -LiteralPath $_ -PathType Leaf
                }
        )
        if ($changedFiles.Count -gt 0) {
            $null = Invoke-SensitiveScan -Files $changedFiles
        }
        Invoke-CheckedCommand `
            -FilePath $gitPath `
            -Arguments @(
                'push',
                $GitRemote,
                "${commit}:refs/heads/${GitBranch}"
            )
    }
}

$remoteStage = "/var/tmp/sifangguan-ota-release-${commit}-${stamp}"
$remoteArchive = "${remoteStage}/release.tar.gz"
$remoteDeployScript = "${remoteStage}/deploy-native.sh"
$prepareScript = @"
set -eu
[ ! -e '$remoteStage' ] || {
  echo REMOTE_RELEASE_STAGE_ALREADY_EXISTS >&2
  exit 2
}
install -d -m 700 '$remoteStage'
"@
Invoke-SshScript -Script $prepareScript

& $scpPath `
    -i $IdentityFile `
    -o BatchMode=yes `
    $releaseArchive `
    "${RemoteHost}:${remoteArchive}"
if ($LASTEXITCODE -ne 0) {
    throw "RELEASE_UPLOAD_FAILED:EXIT_$LASTEXITCODE"
}
$localDeployScript = Join-Path $stageRoot (
    $deployScriptRelative.Replace('/', '\')
)
& $scpPath `
    -i $IdentityFile `
    -o BatchMode=yes `
    $localDeployScript `
    "${RemoteHost}:${remoteDeployScript}"
if ($LASTEXITCODE -ne 0) {
    throw "DEPLOY_SCRIPT_UPLOAD_FAILED:EXIT_$LASTEXITCODE"
}

$deployScript = @"
set -eu
chmod 600 '$remoteArchive' '$remoteDeployScript'
sudo env \
  SFG_OTA_RELEASE_ARCHIVE='$remoteArchive' \
  SFG_OTA_RELEASE_COMMIT='$commit' \
  SFG_OTA_RELEASE_SHA256='$archiveSha256' \
  bash '$remoteDeployScript'
current=`$(readlink -f /opt/sifangguan-ota/current)
[ "`$current" = "/opt/sifangguan-ota/releases/$commit" ] || {
  echo RELEASE_POINTER_VERIFICATION_FAILED >&2
  exit 1
}
sudo bash \
  /opt/sifangguan-ota/current/infra/ota-standalone-server/scripts/status-native.sh
rm -f '$remoteArchive' '$remoteDeployScript'
rmdir '$remoteStage'
"@
Invoke-SshScript -Script $deployScript

$uiStatus = if ($SkipTunnelEnsure) {
    Wait-ServerUiThroughTunnel `
        -Port $LocalTunnelPort `
        -TimeoutSeconds 5
}
else {
    Ensure-ServerUiTunnel -Port $LocalTunnelPort
}

[ordered]@{
    status = 'OTA_SERVER_RELEASE_PUBLISHED'
    commit = $commit
    gitRemote = $GitRemote
    gitBranch = $GitBranch
    archiveSha256 = $archiveSha256
    archiveBytes = $archiveBytes
    sensitiveScan = $payloadScan
    serverRelease = "/opt/sifangguan-ota/releases/$commit"
    serverUiHttpStatusThroughTunnel = $uiStatus
    persistentRuntimePreserved = $true
} | ConvertTo-Json -Depth 4
