[CmdletBinding()]
param(
    [ValidateSet('Plan', 'Package', 'Publish')]
    [string]$Mode = 'Publish',

    [string]$RemoteHost = 'ubuntu@43.136.184.38',

    [string]$IdentityFile = (
        (Join-Path $env:USERPROFILE `
            '.ssh\sifangguan_tencent_ota_ed25519')
    ),

    [string]$KnownHostsFile = (
        (Join-Path $env:USERPROFILE '.ssh\known_hosts')
    ),

    [string]$GitRemote = 'ota-yunying',

    [string]$GitBranch = 'main',

    [string]$ExpectedGitRemoteUrl = (
        'https://github.com/lzy27272/' +
        'fangtaiyunzhuli.git'
    ),

    [switch]$SkipGitPush,

    [switch]$SkipTests,

    [ValidateSet('Auto', 'Full')]
    [string]$TestProfile = 'Auto',

    [switch]$ForceRebuild,

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
$releaseCacheRoot = Join-Path $releaseRoot 'cache-v2'
$webBasePath = '/ota-console/'
$publicApiBaseUrl = '/api/v1/ota-console'
$deployScriptRelative = (
    'infra/ota-standalone-server/scripts/deploy-native.sh'
)
$yilianMigrationVerifierRelative = (
    'infra/ota-standalone-server/scripts/' +
    'verify-yilian-source-contract-migration.mjs'
)
$runtimeSourcePaths = @(
    $deployScriptRelative,
    $yilianMigrationVerifierRelative,
    'infra/ota-standalone-server/Caddyfile.native',
    'infra/ota-standalone-server/caddy/ota-console-public.caddy',
    'infra/ota-standalone-server/scripts/configure-public-entry.sh',
    'infra/ota-standalone-server/scripts/configure-phase1-runtime.sh',
    'infra/ota-standalone-server/scripts/configure-analytics-retention.sh',
    'infra/ota-standalone-server/scripts/import-analytics-retention.sh',
    'infra/ota-standalone-server/sql/analytics-retention.sql',
    'infra/ota-standalone-server/systemd/sifangguan-ota-analytics-import.service',
    'infra/ota-standalone-server/systemd/sifangguan-ota-analytics-import.timer',
    'infra/ota-standalone-server/scripts/status-native.sh',
    'infra/ota-standalone-server/scripts/configure-ai-runtime.sh',
    'tools/uat/ota-standalone-review-api.mjs',
    'tools/uat/analytics-retention.mjs',
    'tools/uat/occupancy-review.mjs',
    'tools/uat/wecom-manual-replay.mjs',
    'tools/uat/wecom-hot-selling-retry.mjs',
    'tools/uat/wecom-p1-manual-replay.mjs',
    'tools/uat/pms-repair-alert.mjs',
    'tools/uat/report-source-cookie-crypto.mjs',
    'tools/uat/review-auth-store.mjs',
    'tools/uat/ota-source-collector.mjs',
    'tools/uat/room-type-catalog.mjs',
    'tools/uat/fliggy-source-collector.mjs',
    'tools/uat/fliggy-controlled-login.mjs',
    'tools/uat/ota-review-order-pairing.mjs',
    'tools/uat/ota-source-schedule.mjs',
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
    'tools/uat/bieyanghong-assisted-login.mjs',
    'tools/uat/bieyanghong-browser-broker-client.mjs',
    'tools/uat/bieyanghong-browser-broker.mjs',
    'tools/uat/bieyanghong-remote-desktop.mjs',
    'tools/uat/bieyanghong-repair-challenge.mjs',
    'tools/uat/bieyanghong-repair-page.mjs',
    'tools/uat/bieyanghong-targeted-recovery.mjs',
    'tools/uat/bieyanghong-cookie-validation.mjs',
    'tools/uat/bieyanghong_websockify_auth.py',
    'tools/uat/yilian-cloud-collector.mjs',
    'tools/uat/yilian-assisted-login.mjs',
    'tools/uat/capture-yilian-cloud-session.mjs',
    'tools/uat/activate-yilian-cloud-collection.mjs',
    'tools/uat/live-report-collector.mjs',
    'tools/uat/daily-order-summary.mjs',
    'tools/uat/report-schedule.mjs',
    'tools/uat/trusted-device-intake.mjs',
    'tools/uat/trusted-device-bootstrap.mjs',
    'tools/trusted-device/Install-001TrustedDevice.ps1',
    'tools/trusted-device/Start-001Login.ps1',
    'tools/trusted-device/Uninstall-001TrustedDevice.ps1',
    'tools/trusted-device/trusted-device-agent.mjs',
    'tools/trusted-device/trusted-device-local-state.mjs',
    'tools/trusted-device/package.json',
    'tools/uat/wecom/src/combined-operations-brief.mjs',
    'tools/uat/wecom/src/delivery-state.mjs',
    'tools/uat/wecom/src/delivery-claim.mjs',
    'tools/uat/wecom/src/future-booking-ai-advice.mjs',
    'tools/uat/wecom/src/future-booking-brief.mjs',
    'tools/uat/wecom/src/future-demand-risk.mjs',
    'tools/uat/wecom/src/hot-selling-sold-out-alert.mjs',
    'tools/uat/wecom/src/hourly-delivery-candidates.mjs',
    'tools/uat/wecom/src/ota-alert-notification-policy.mjs',
    'tools/uat/wecom/src/briefing-delivery-audit.mjs',
    'tools/uat/wecom/src/pms-json-summary.mjs',
    'tools/uat/wecom/src/report-monitor-brief.mjs',
    'tools/uat/wecom/src/wecom-group-robot.mjs',
    'tools/uat/wecom/src/wecom-repair-bot.mjs',
    'tools/uat/wecom/src/wecom-repair-admins.mjs',
    'tools/uat/wecom/src/wecom-directory-read.mjs',
    'tools/uat/wecom/src/wecom-repair-approvals.mjs',
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
    $bundledNode = Join-Path $env:USERPROFILE (
        '.cache\codex-runtimes\codex-primary-runtime\' +
        'dependencies\node\bin\node.exe'
    )
    if (Test-Path -LiteralPath $bundledNode -PathType Leaf) {
        return $bundledNode
    }
    $command = Get-Command 'node.exe' -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }
    throw 'REQUIRED_NODE_RUNTIME_NOT_FOUND'
}

function Resolve-BundledNodeModules {
    $bundledModules = Join-Path $env:USERPROFILE (
        '.cache\codex-runtimes\codex-primary-runtime\' +
        'dependencies\node\node_modules'
    )
    if (Test-Path -LiteralPath $bundledModules -PathType Container) {
        return $bundledModules
    }
    return $null
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

function Invoke-CheckedCommandWithRetry {
    param(
        [Parameter(Mandatory)]
        [string]$FilePath,

        [Parameter(Mandatory)]
        [string[]]$Arguments,

        [ValidateRange(1, 5)]
        [int]$Attempts = 3,

        [string]$WorkingDirectory = $repoRoot
    )

    for ($attempt = 1; $attempt -le $Attempts; $attempt += 1) {
        Push-Location $WorkingDirectory
        try {
            & $FilePath @Arguments
            if ($LASTEXITCODE -eq 0) {
                return
            }
        }
        finally {
            Pop-Location
        }
        if ($attempt -lt $Attempts) {
            Write-Warning "Command failed; retrying ($attempt/$Attempts)."
            Start-Sleep -Seconds $attempt
        }
    }
    throw (
        'COMMAND_FAILED_AFTER_RETRY:{0}:EXIT_{1}' -f
        ([IO.Path]::GetFileName($FilePath)),
        $LASTEXITCODE
    )
}

function Get-ReleaseChangePlan {
    param(
        [Parameter(Mandatory)]
        [string]$BaseCommit,

        [Parameter(Mandatory)]
        [string]$TargetCommit
    )

    $paths = @(
        & $gitPath @gitCommonArguments diff `
            --name-only `
            --diff-filter=ACMRD `
            "${BaseCommit}..${TargetCommit}" `
            --
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    if ($LASTEXITCODE -ne 0) {
        throw 'RELEASE_CHANGE_DISCOVERY_FAILED'
    }

    $components = [Collections.Generic.HashSet[string]]::new(
        [StringComparer]::OrdinalIgnoreCase
    )
    $runtimeChanged = $false
    $fullRequired = $false
    foreach ($pathValue in $paths) {
        $path = $pathValue.Replace('\\', '/')
        if (
            $path -match '^apps/ota-standalone-web/(src|public)/' -or
            $path -match '^apps/ota-standalone-web/(index\.html|package\.json|pnpm-lock\.yaml|tsconfig[^/]*\.json|vite\.config\.[^/]+)$'
        ) {
            $null = $components.Add('web')
            $runtimeChanged = $true
            if (
                $path -match '^apps/ota-standalone-web/src/auth/' -or
                $path -match '^apps/ota-standalone-web/src/pages/(PeoplePermissions|AccountSecurity|PersonalSecurity)' -or
                $path -match '^apps/ota-standalone-web/src/api/auth\.'
            ) {
                $fullRequired = $true
            }
            continue
        }
        if ($path -match '^tools/uat/' -or $path -match '^tools/trusted-device/') {
            if ($path -notmatch '/tests?/' -and $path -notmatch '\.test\.mjs$') {
                $null = $components.Add('api')
                $runtimeChanged = $true
                $fullRequired = $true
            }
            continue
        }
        if (
            $path -match '^infra/ota-standalone-server/(sql|systemd)/' -or
            $path -match '^infra/ota-standalone-server/scripts/(configure-analytics-retention|import-analytics-retention)\.sh$'
        ) {
            $null = $components.Add('analytics')
            $null = $components.Add('api')
            $runtimeChanged = $true
            $fullRequired = $true
            continue
        }
        if ($path -eq 'infra/ota-standalone-server/scripts/configure-phase1-runtime.sh') {
            $null = $components.Add('phase1')
            $null = $components.Add('api')
            $runtimeChanged = $true
            $fullRequired = $true
            continue
        }
        if (
            $path -match '^infra/ota-standalone-server/caddy/' -or
            $path -eq 'infra/ota-standalone-server/Caddyfile.native' -or
            $path -eq 'infra/ota-standalone-server/scripts/configure-public-entry.sh'
        ) {
            $null = $components.Add('public')
            $null = $components.Add('web')
            $runtimeChanged = $true
            $fullRequired = $true
            continue
        }
        if ($path -match '^infra/ota-standalone-server/') {
            if (
                $path -notmatch '/README\.md$' -and
                $path -ne 'infra/ota-standalone-server/scripts/Publish-OtaStandaloneServer.ps1'
            ) {
                $null = $components.Add('full')
                $runtimeChanged = $true
                $fullRequired = $true
            }
            continue
        }
    }

    if ($components.Contains('full')) {
        $components.Clear()
        $null = $components.Add('full')
    }
    $orderedComponents = @(
        'full', 'api', 'web', 'phase1', 'analytics', 'public' |
            Where-Object { $components.Contains($_) }
    )
    $effectiveTestProfile = if ($SkipTests) {
        'None'
    }
    elseif ($TestProfile -eq 'Full' -or $fullRequired) {
        'Full'
    }
    elseif ($components.Contains('web')) {
        'Web'
    }
    elseif ($runtimeChanged) {
        'Full'
    }
    else {
        'None'
    }

    return [pscustomobject]@{
        BaseCommit = $BaseCommit
        ChangedPaths = $paths
        Components = $orderedComponents
        RuntimeChanged = $runtimeChanged
        TestProfile = $effectiveTestProfile
    }
}

function Test-JsonCacheReceipt {
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter(Mandatory)]
        [string]$Commit,

        [Parameter(Mandatory)]
        [string]$Profile
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $false
    }
    try {
        $receipt = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
        return (
            $receipt.schemaVersion -eq 2 -and
            $receipt.commit -eq $Commit -and
            $receipt.profile -eq $Profile -and
            $receipt.status -eq 'PASS'
        )
    }
    catch {
        return $false
    }
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
    $arguments = $script:sshConnectionArguments + @(
        $RemoteHost,
        "echo $encoded | base64 -d | sh"
    )
    & $script:sshPath @arguments
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
    $arguments = $script:sshConnectionArguments + @(
        '-N',
        '-L',
        "${Port}:127.0.0.1:5180",
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
$gitCommonArguments = @(
    '-c',
    "safe.directory=$($repoRoot.Replace('\\', '/'))",
    '-c',
    'http.version=HTTP/1.1',
    '-C',
    $repoRoot
)
$nodePath = Resolve-NodeRuntime
$bundledNodeModules = Resolve-BundledNodeModules
$tarPath = Resolve-RequiredCommand 'tar.exe'
$script:sshPath = Resolve-RequiredCommand 'ssh.exe'
$scpPath = Resolve-RequiredCommand 'scp.exe'
$sshKeygenPath = Resolve-RequiredCommand 'ssh-keygen.exe'

if (-not (Test-Path -LiteralPath $scannerPath -PathType Leaf)) {
    throw 'SENSITIVE_SCANNER_NOT_FOUND'
}
if (
    -not (Test-Path -LiteralPath $tscPath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $vitePath -PathType Leaf)
) {
    throw 'LOCAL_LOCKED_WEB_TOOLCHAIN_NOT_FOUND'
}

$commit = (& $gitPath @gitCommonArguments rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') {
    throw 'GIT_COMMIT_INVALID'
}
$branchOutput = @(& $gitPath @gitCommonArguments branch --show-current)
if ($LASTEXITCODE -ne 0) {
    throw 'GIT_BRANCH_DISCOVERY_FAILED'
}
$branch = ($branchOutput -join '').Trim()
$dirtyWorktree = @(
    & $gitPath @gitCommonArguments status --porcelain
)
if ($LASTEXITCODE -ne 0) {
    throw 'GIT_STATUS_FAILED'
}
if (
    $dirtyWorktree.Count -gt 0 -and
    -not ($Mode -eq 'Plan' -and $AllowDirtyPlan)
) {
    throw 'WORKTREE_NOT_CLEAN'
}

$configuredRemoteUrl = (
    & $gitPath @gitCommonArguments remote get-url $GitRemote
).Trim()
if ($LASTEXITCODE -ne 0) {
    throw 'GIT_REMOTE_NOT_FOUND'
}
$normalizedConfiguredRemote = ConvertTo-NormalizedGitUrl $configuredRemoteUrl
$normalizedExpectedRemote = ConvertTo-NormalizedGitUrl $ExpectedGitRemoteUrl
if ($normalizedConfiguredRemote -ne $normalizedExpectedRemote) {
    throw 'GIT_REMOTE_URL_MISMATCH'
}

$remoteCommit = $null
if ($Mode -eq 'Publish' -and -not $SkipGitPush) {
    Invoke-CheckedCommandWithRetry `
        -FilePath $gitPath `
        -Arguments ($gitCommonArguments + @(
            'fetch',
            '--no-tags',
            $GitRemote,
            "refs/heads/${GitBranch}:refs/remotes/${GitRemote}/${GitBranch}"
        ))
    $remoteCommit = (
        & $gitPath @gitCommonArguments rev-parse `
            "refs/remotes/${GitRemote}/${GitBranch}"
    ).Trim()
    & $gitPath @gitCommonArguments merge-base --is-ancestor $remoteCommit $commit
    if ($LASTEXITCODE -ne 0) {
        throw 'GIT_REMOTE_NON_FAST_FORWARD'
    }
}

$parentCommit = (& $gitPath @gitCommonArguments rev-parse "${commit}^").Trim()
if ($LASTEXITCODE -ne 0 -or $parentCommit -notmatch '^[0-9a-f]{40}$') {
    throw 'GIT_PARENT_COMMIT_INVALID'
}
$baseCommit = if (
    $remoteCommit -and
    $remoteCommit -ne $commit
) {
    $remoteCommit
}
else {
    $parentCommit
}
$changePlan = Get-ReleaseChangePlan `
    -BaseCommit $baseCommit `
    -TargetCommit $commit
if (
    $changePlan.RuntimeChanged -and
    $Mode -eq 'Publish' -and
    ($SkipGitPush -or $remoteCommit -eq $commit)
) {
    $changePlan.TestProfile = 'Full'
}

foreach ($path in $runtimeSourcePaths) {
    & $gitPath @gitCommonArguments cat-file -e "${commit}:$path"
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
    worktreeClean = ($dirtyWorktree.Count -eq 0)
    runtimeSourceFileCount = $runtimeSourcePaths.Count
    persistentRuntimeExcluded = $true
    webBasePath = $webBasePath
    publicApiBaseUrl = $publicApiBaseUrl
    baseCommit = $changePlan.BaseCommit
    changedPathCount = $changePlan.ChangedPaths.Count
    deploymentComponents = $changePlan.Components
    runtimeDeploymentRequired = $changePlan.RuntimeChanged
    effectiveTestProfile = $changePlan.TestProfile
}
if ($Mode -eq 'Plan') {
    $plan | ConvertTo-Json
    return
}


if (-not $changePlan.RuntimeChanged) {
    if ($Mode -eq 'Publish' -and -not $SkipGitPush -and $remoteCommit -ne $commit) {
        $changedFiles = @(
            $changePlan.ChangedPaths |
                ForEach-Object { Join-Path $repoRoot $_ } |
                Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }
        )
        if ($changedFiles.Count -gt 0) {
            $null = Invoke-SensitiveScan -Files $changedFiles
        }
        Invoke-CheckedCommandWithRetry `
            -FilePath $gitPath `
            -Arguments ($gitCommonArguments + @(
                'push',
                $GitRemote,
                "${commit}:refs/heads/${GitBranch}"
            ))
    }
    [ordered]@{
        status = if ($Mode -eq 'Publish') {
            'OTA_SERVER_RELEASE_NOT_REQUIRED'
        }
        else {
            'OTA_SERVER_PACKAGE_NOT_REQUIRED'
        }
        commit = $commit
        baseCommit = $changePlan.BaseCommit
        changedPathCount = $changePlan.ChangedPaths.Count
        reason = 'NO_RUNTIME_COMPONENT_CHANGED'
    } | ConvertTo-Json -Depth 4
    return
}

if (-not (Test-Path -LiteralPath $distRoot -PathType Container)) {
    New-Item -ItemType Directory -Path $distRoot -Force | Out-Null
}
$verificationRoot = Join-Path $releaseCacheRoot 'verification'
New-Item -ItemType Directory -Path $verificationRoot -Force | Out-Null
$testCacheHit = $false
$testReceiptPath = $null
if ($changePlan.TestProfile -ne 'None') {
    $testReceiptPath = Join-Path $verificationRoot (
        '{0}-{1}.json' -f $commit, $changePlan.TestProfile.ToLowerInvariant()
    )
    $testCacheHit = -not $ForceRebuild -and (
        Test-JsonCacheReceipt `
            -Path $testReceiptPath `
            -Commit $commit `
            -Profile $changePlan.TestProfile
    )
    if (-not $testCacheHit -and $changePlan.TestProfile -eq 'Web') {
        $fullReceiptPath = Join-Path $verificationRoot "${commit}-full.json"
        $testCacheHit = -not $ForceRebuild -and (
            Test-JsonCacheReceipt `
                -Path $fullReceiptPath `
                -Commit $commit `
                -Profile 'Full'
        )
    }
}
if ($SkipTests) {
    Write-Warning 'SkipTests bypasses release verification and should be used only for controlled recovery.'
}
elseif (-not $testCacheHit) {
    $testRoots = @((Join-Path $webRoot 'tests'))
    if ($changePlan.TestProfile -eq 'Full') {
        $testRoots += Join-Path $repoRoot 'tools\uat\wecom\tests'
    }
    $testFiles = @(
        foreach ($testRoot in $testRoots) {
            if (-not (Test-Path -LiteralPath $testRoot -PathType Container)) {
                throw "RELEASE_TEST_ROOT_NOT_FOUND:$testRoot"
            }
            Get-ChildItem `
                -LiteralPath $testRoot `
                -Filter '*.test.mjs' `
                -File |
                ForEach-Object { $_.FullName }
        }
    ) | Select-Object -Unique
    if ($testFiles.Count -lt 1) {
        throw 'RELEASE_TEST_FILES_NOT_FOUND'
    }
    $previousNodePath = $env:NODE_PATH
    $runtimeNodeModules = Join-Path (
        Split-Path (Split-Path $nodePath -Parent) -Parent
    ) 'node_modules'
    $nodeModuleSearchPaths = @(
        (Join-Path $webRoot 'node_modules'),
        $runtimeNodeModules
    ) | Where-Object {
        Test-Path -LiteralPath $_ -PathType Container
    } | Select-Object -Unique
    if (-not [string]::IsNullOrWhiteSpace($previousNodePath)) {
        $nodeModuleSearchPaths += $previousNodePath.Split(
            [IO.Path]::PathSeparator,
            [StringSplitOptions]::RemoveEmptyEntries
        )
    }
    try {
        $env:NODE_PATH = (
            $nodeModuleSearchPaths | Select-Object -Unique
        ) -join [IO.Path]::PathSeparator
        Invoke-CheckedCommand `
            -FilePath $nodePath `
            -Arguments (@('--test') + $testFiles) `
            -WorkingDirectory $webRoot
    }
    finally {
        if ([string]::IsNullOrEmpty($previousNodePath)) {
            Remove-Item Env:NODE_PATH -ErrorAction SilentlyContinue
        }
        else {
            $env:NODE_PATH = $previousNodePath
        }
    }

    $testReceipt = [ordered]@{
        schemaVersion = 2
        status = 'PASS'
        commit = $commit
        profile = $changePlan.TestProfile
        testFileCount = $testFiles.Count
        verifiedAt = [DateTimeOffset]::Now.ToString('o')
    }
    [IO.File]::WriteAllText(
        $testReceiptPath,
        ($testReceipt | ConvertTo-Json) + [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false)
    )
}

$stamp = Get-Date -Format 'yyyyMMddTHHmmss'
$artifactCacheRoot = Join-Path $releaseCacheRoot "artifacts\$commit"
$cachedReleaseArchive = Join-Path $artifactCacheRoot 'release.tar.gz'
$cachedReleaseMetadata = Join-Path $artifactCacheRoot 'metadata.json'
$artifactCacheHit = $false
$webBuildCacheHit = $false
if (
    -not $ForceRebuild -and
    (Test-Path -LiteralPath $cachedReleaseArchive -PathType Leaf) -and
    (Test-Path -LiteralPath $cachedReleaseMetadata -PathType Leaf)
) {
    try {
        $artifactMetadata = Get-Content `
            -LiteralPath $cachedReleaseMetadata `
            -Raw | ConvertFrom-Json
        $cachedArchiveSha256 = (
            Get-FileHash -LiteralPath $cachedReleaseArchive -Algorithm SHA256
        ).Hash.ToLowerInvariant()
        $artifactCacheHit = (
            $artifactMetadata.schemaVersion -eq 2 -and
            $artifactMetadata.commit -eq $commit -and
            $artifactMetadata.archiveSha256 -eq $cachedArchiveSha256
        )
        if ($artifactCacheHit) {
            $releaseArchive = $cachedReleaseArchive
            $archiveSha256 = $cachedArchiveSha256
            $archiveBytes = (Get-Item -LiteralPath $releaseArchive).Length
            $payloadScan = [pscustomobject]@{
                Status = 'PASS'
                FilesScanned = [int]$artifactMetadata.filesScanned
                FindingGroups = 0
            }
        }
    }
    catch {
        $artifactCacheHit = $false
    }
}

if (-not $artifactCacheHit) {
$webTreeHash = (
    & $gitPath @gitCommonArguments rev-parse `
        "${commit}:apps/ota-standalone-web"
).Trim()
if ($LASTEXITCODE -ne 0 -or $webTreeHash -notmatch '^[0-9a-f]{40}$') {
    throw 'WEB_TREE_HASH_INVALID'
}
$webBuildCacheRoot = Join-Path $releaseCacheRoot "web\$webTreeHash"
$cachedDistRoot = Join-Path $webBuildCacheRoot 'dist'
$webBuildCacheHit = (
    -not $ForceRebuild -and
    (Test-Path `
        -LiteralPath (Join-Path $cachedDistRoot 'index.html') `
        -PathType Leaf)
)
$releaseDistRoot = $cachedDistRoot
if (-not $webBuildCacheHit) {
    Invoke-CheckedCommand `
        -FilePath $nodePath `
        -Arguments @($tscPath, '-b') `
        -WorkingDirectory $webRoot
    $previousWebBasePath = $env:OTA_WEB_BASE_PATH
    $previousPublicApiBaseUrl = $env:VITE_OTA_API_BASE_URL
    try {
        $env:OTA_WEB_BASE_PATH = $webBasePath
        $env:VITE_OTA_API_BASE_URL = $publicApiBaseUrl
        Invoke-CheckedCommand `
            -FilePath $nodePath `
            -Arguments @($vitePath, 'build', '--configLoader', 'runner') `
            -WorkingDirectory $webRoot
    }
    finally {
        if ($null -eq $previousWebBasePath) {
            Remove-Item Env:OTA_WEB_BASE_PATH -ErrorAction SilentlyContinue
        }
        else {
            $env:OTA_WEB_BASE_PATH = $previousWebBasePath
        }
        if ($null -eq $previousPublicApiBaseUrl) {
            Remove-Item Env:VITE_OTA_API_BASE_URL -ErrorAction SilentlyContinue
        }
        else {
            $env:VITE_OTA_API_BASE_URL = $previousPublicApiBaseUrl
        }
    }
    if (
        -not (Test-Path `
            -LiteralPath (Join-Path $distRoot 'index.html') `
            -PathType Leaf)
    ) {
        throw 'WEB_BUILD_OUTPUT_MISSING'
    }
    if (Test-Path -LiteralPath $webBuildCacheRoot) {
        Remove-Item -LiteralPath $webBuildCacheRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path $webBuildCacheRoot -Force | Out-Null
    Copy-Item `
        -LiteralPath $distRoot `
        -Destination $cachedDistRoot `
        -Recurse `
        -Force
}
if (
    -not (Test-Path `
        -LiteralPath (Join-Path $releaseDistRoot 'index.html') `
        -PathType Leaf)
) {
    throw 'WEB_BUILD_OUTPUT_MISSING'
}

$workRoot = Join-Path $releaseRoot "${commit}-${stamp}"
$stageRoot = Join-Path $workRoot 'stage'
$sourceArchive = Join-Path $workRoot 'source.tar'
$releaseArchive = Join-Path $workRoot "sifangguan-ota-${commit}.tar.gz"
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null

$archiveArguments = $gitCommonArguments + @(
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
    -LiteralPath $releaseDistRoot `
    -Destination (Join-Path $stagedDistParent 'dist') `
    -Recurse `
    -Force

$manifest = [ordered]@{
    schemaVersion = 1
    commit = $commit
    builtAt = [DateTimeOffset]::Now.ToString('o')
    payload = 'OTA_STANDALONE_MINIMAL_RUNTIME'
    persistentRuntimeIncluded = $false
    webBasePath = $webBasePath
    publicApiBaseUrl = $publicApiBaseUrl
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
    'review-auth-sessions.json',
    'security-audit.jsonl',
    'report-source-cookie-secrets.json',
    'pms-login-secrets.json',
    'luopan-session-secrets.json',
    'ota-source-secrets.json',
    'hot-selling-room-types.json',
    'occupancy-targets.json',
    'occupancy-history.json',
    'room-type-mappings.json',
    'ota-room-type-catalogs.json',
    'wecom-webhook-secrets.json',
    'wecom-repair-bot-secrets.json',
    'wecom-repair-bot-transaction.json',
    'trusted-device-registry.json',
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

if (Test-Path -LiteralPath $artifactCacheRoot) {
    Remove-Item -LiteralPath $artifactCacheRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $artifactCacheRoot -Force | Out-Null
Copy-Item `
    -LiteralPath $releaseArchive `
    -Destination $cachedReleaseArchive `
    -Force
$artifactMetadata = [ordered]@{
    schemaVersion = 2
    commit = $commit
    archiveSha256 = $archiveSha256
    archiveBytes = $archiveBytes
    filesScanned = $payloadScan.FilesScanned
    cachedAt = [DateTimeOffset]::Now.ToString('o')
}
[IO.File]::WriteAllText(
    $cachedReleaseMetadata,
    ($artifactMetadata | ConvertTo-Json) + [Environment]::NewLine,
    [Text.UTF8Encoding]::new($false)
)
$releaseArchive = $cachedReleaseArchive
}

if ($Mode -eq 'Package') {
    [ordered]@{
        status = 'OTA_SERVER_RELEASE_PACKAGE_READY'
        commit = $commit
        archivePath = $releaseArchive
        archiveSha256 = $archiveSha256
        archiveBytes = $archiveBytes
        sensitiveScan = $payloadScan
        testCacheHit = $testCacheHit
        webBuildCacheHit = $webBuildCacheHit
        artifactCacheHit = $artifactCacheHit
        deploymentComponents = $changePlan.Components
    } | ConvertTo-Json -Depth 4
    return
}

if (-not (Test-Path -LiteralPath $IdentityFile -PathType Leaf)) {
    throw 'SSH_IDENTITY_FILE_NOT_FOUND'
}
if (
    -not (Test-Path -LiteralPath $KnownHostsFile -PathType Leaf) -or
    ((Get-Item -LiteralPath $KnownHostsFile).Attributes -band
        [IO.FileAttributes]::ReparsePoint)
) {
    throw 'SSH_KNOWN_HOSTS_FILE_UNSAFE_OR_MISSING'
}
if (
    $RemoteHost -notmatch
        '^[A-Za-z_][A-Za-z0-9._-]{0,63}@(?<host>[A-Za-z0-9][A-Za-z0-9.-]{0,252})$'
) {
    throw 'SSH_REMOTE_HOST_INVALID'
}
$remoteHostName = $Matches.host
$knownHostMatches = @(
    & $sshKeygenPath -F $remoteHostName -f $KnownHostsFile 2>$null
)
if ($LASTEXITCODE -ne 0 -or $knownHostMatches.Count -lt 1) {
    throw 'SSH_REMOTE_HOST_KEY_NOT_PINNED'
}
$script:sshConnectionArguments = @(
    '-i',
    $IdentityFile,
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    "UserKnownHostsFile=$KnownHostsFile",
    '-o',
    'GlobalKnownHostsFile=none',
    '-o',
    'UpdateHostKeys=no'
)

if (-not $SkipGitPush) {
    if ($remoteCommit -ne $commit) {
        $changedFiles = @(
            $changePlan.ChangedPaths |
                ForEach-Object { Join-Path $repoRoot $_ } |
                Where-Object {
                    Test-Path -LiteralPath $_ -PathType Leaf
                }
        )
        if ($changedFiles.Count -gt 0) {
            $null = Invoke-SensitiveScan -Files $changedFiles
        }
        Invoke-CheckedCommandWithRetry `
            -FilePath $gitPath `
            -Arguments ($gitCommonArguments + @(
                'push',
                $GitRemote,
                "${commit}:refs/heads/${GitBranch}"
            ))
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

$archiveUploadArguments = $script:sshConnectionArguments + @(
    $releaseArchive,
    "${RemoteHost}:${remoteArchive}"
)
& $scpPath @archiveUploadArguments
if ($LASTEXITCODE -ne 0) {
    throw "RELEASE_UPLOAD_FAILED:EXIT_$LASTEXITCODE"
}
$localDeployScript = Join-Path $repoRoot (
    $deployScriptRelative.Replace('/', '\')
)
$deployUploadArguments = $script:sshConnectionArguments + @(
    $localDeployScript,
    "${RemoteHost}:${remoteDeployScript}"
)
& $scpPath @deployUploadArguments
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
  SFG_OTA_RELEASE_BASE_COMMIT='$($changePlan.BaseCommit)' \
  SFG_OTA_RELEASE_COMPONENTS='$($changePlan.Components -join ',')' \
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
    baseCommit = $changePlan.BaseCommit
    deploymentComponents = $changePlan.Components
    effectiveTestProfile = $changePlan.TestProfile
    testCacheHit = $testCacheHit
    webBuildCacheHit = $webBuildCacheHit
    artifactCacheHit = $artifactCacheHit
    serverRelease = "/opt/sifangguan-ota/releases/$commit"
    serverUiHttpStatusThroughTunnel = $uiStatus
    persistentRuntimePreserved = $true
} | ConvertTo-Json -Depth 4
