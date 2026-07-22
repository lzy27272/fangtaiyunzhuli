[CmdletBinding()]
param(
    [string]$RunId = (Get-Date -Format 'yyyyMMdd-HHmmss-tech-v02-rc'),
    [int]$OidcPort = 18081,
    [int]$WebPort = 5173,
    [switch]$SkipWeb
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$apiDir = Join-Path $repoRoot 'apps\core-api'
$webDir = Join-Path $repoRoot 'apps\web'
$runtimeRoot = Join-Path $repoRoot '.uat-runtime'
$identityRoot = Join-Path $runtimeRoot 'identity'
$tokenFile = Join-Path $identityRoot 'tokens.json'
$evidenceRuntime = Join-Path $repoRoot 'docs\uat\evidence\runtime'
$stateFile = Join-Path $evidenceRuntime 'uat-processes.json'
$readyFile = Join-Path $evidenceRuntime 'live-api-port.txt'
$stopFile = Join-Path $evidenceRuntime 'stop-live-server.flag'

New-Item -ItemType Directory -Force -Path $identityRoot, $evidenceRuntime | Out-Null
Remove-Item -LiteralPath $readyFile, $stopFile, $tokenFile -Force -ErrorAction SilentlyContinue

function Resolve-Python {
    $bundled = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
    if (Test-Path -LiteralPath $bundled) { return $bundled }
    $command = Get-Command python -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw 'Python with cryptography was not found. The signed-JWT UAT issuer cannot start.'
}

function Resolve-Java {
    $command = Get-Command java -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $candidate = Get-ChildItem -LiteralPath (Join-Path $repoRoot '.tooling\jdk') -Filter java.exe -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $candidate) { throw 'Java 21 was not found in PATH or .tooling/jdk.' }
    return $candidate.FullName
}

function Resolve-Maven {
    $command = Get-Command mvn -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $candidate = Get-ChildItem -LiteralPath (Join-Path $repoRoot '.tooling\maven') -Filter mvn.cmd -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $candidate) { throw 'Maven was not found in PATH or .tooling/maven.' }
    return $candidate.FullName
}

function Resolve-Pnpm {
    $nodeBin = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
    if (Test-Path -LiteralPath (Join-Path $nodeBin 'node.exe')) {
        $env:Path = "$nodeBin;$env:Path"
    }
    $command = Get-Command pnpm -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $candidate = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd'
    if (Test-Path -LiteralPath $candidate) { return $candidate }
    throw 'pnpm was not found in PATH or the bundled Codex Node runtime.'
}

function Assert-SignedJwtApi([string]$apiOrigin, [string]$tokensPath) {
    Add-Type -AssemblyName System.Net.Http
    $document = Get-Content -LiteralPath $tokensPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $token = [string]$document.tokens.'general-manager'
    if (-not $token) { throw 'General-manager signed UAT token is missing.' }
    $client = [System.Net.Http.HttpClient]::new()
    try {
        $anonymous = $client.GetAsync("$apiOrigin/api/v1/iam/me").GetAwaiter().GetResult()
        try {
            if ([int]$anonymous.StatusCode -ne 401) {
                throw "API is not enforcing Bearer JWT; anonymous /iam/me returned HTTP $([int]$anonymous.StatusCode)."
            }
        } finally { $anonymous.Dispose() }

        $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, "$apiOrigin/api/v1/iam/me")
        try {
            $request.Headers.TryAddWithoutValidation('Authorization', "Bearer $token") | Out-Null
            $response = $client.SendAsync($request).GetAwaiter().GetResult()
            try {
                if ([int]$response.StatusCode -ne 200) {
                    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                    throw "Signed role token was not accepted by /iam/me (HTTP $([int]$response.StatusCode)): $body"
                }
            } finally { $response.Dispose() }
        } finally { $request.Dispose() }
    } finally { $client.Dispose() }
}

function Wait-Http([string]$url, [int]$seconds = 120) {
    $deadline = (Get-Date).AddSeconds($seconds)
    do {
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    } while ((Get-Date) -lt $deadline)
    throw "Timed out waiting for $url"
}

function Wait-File([string]$path, [int]$seconds = 240) {
    $deadline = (Get-Date).AddSeconds($seconds)
    do {
        if (Test-Path -LiteralPath $path) { return }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "Timed out waiting for $path"
}

if (Test-Path -LiteralPath $stateFile) {
    $previous = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $liveProcesses = @($previous.apiPid, $previous.webPid, $previous.oidcPid) | Where-Object {
        $_ -and (Get-Process -Id $_ -ErrorAction SilentlyContinue)
    }
    if ($liveProcesses.Count -gt 0) {
        throw 'A managed UAT environment is already running. Stop it before starting a new signed-JWT run.'
    }
}

$python = Resolve-Python
$java = Resolve-Java
$maven = Resolve-Maven
$javaHome = Split-Path -Parent (Split-Path -Parent $java)
$env:JAVA_HOME = $javaHome
$env:Path = "$(Join-Path $javaHome 'bin');$env:Path"

$issuer = "http://127.0.0.1:$OidcPort"
$oidcOut = Join-Path $evidenceRuntime 'oidc.stdout.log'
$oidcErr = Join-Path $evidenceRuntime 'oidc.stderr.log'
$oidcScript = Join-Path $PSScriptRoot 'mock_oidc_server.py'
$oidcProcess = Start-Process -FilePath $python `
    -ArgumentList @(('"{0}"' -f $oidcScript), '--host', '127.0.0.1', '--port', $OidcPort, '--issuer', $issuer, '--audience', 'hotel-ai-os-api', '--token-file', ('"{0}"' -f $tokenFile)) `
    -WorkingDirectory $repoRoot -RedirectStandardOutput $oidcOut -RedirectStandardError $oidcErr `
    -WindowStyle Hidden -PassThru

$apiProcess = $null
$webProcess = $null
try {
    Wait-Http "$issuer/health" 60
    Wait-File $tokenFile 30

    $env:UAT_JWT_ISSUER_URI = $issuer
    $attachmentScannerDescription = 'externally configured fail-closed scanner'
    if (-not $env:UAT_ATTACHMENT_SCAN_COMMAND) {
        $clamScan = if ($env:UAT_CLAMSCAN_COMMAND) {
            $env:UAT_CLAMSCAN_COMMAND
        } else {
            'D:\CodexTools\clamav-1.5.3\clamav-1.5.3.win.x64\clamscan.exe'
        }
        $clamDatabase = if ($env:UAT_CLAMAV_DATABASE_DIR) {
            $env:UAT_CLAMAV_DATABASE_DIR
        } else {
            'D:\CodexTools\clamav-db'
        }
        if ((Test-Path -LiteralPath $clamScan) -and
            (Test-Path -LiteralPath (Join-Path $clamDatabase 'main.cvd')) -and
            (Test-Path -LiteralPath (Join-Path $clamDatabase 'daily.cvd'))) {
            $env:UAT_ATTACHMENT_SCAN_COMMAND = $clamScan
            $env:UAT_ATTACHMENT_SCAN_ARGUMENTS = "--database=$clamDatabase|--no-summary|{file}"
            $attachmentScannerDescription = 'ClamAV 1.5.3 with signed CVD database (fail closed)'
        } else {
            $scannerScript = Join-Path $PSScriptRoot 'Invoke-AmsiFileScan.ps1'
            if (-not (Test-Path -LiteralPath $scannerScript)) {
                throw "No ClamAV database or AMSI attachment scanner script is available."
            }
            $powerShellScanner = Join-Path $PSHOME 'powershell.exe'
            $env:UAT_ATTACHMENT_SCAN_COMMAND = $powerShellScanner
            $env:UAT_ATTACHMENT_SCAN_ARGUMENTS = "-NoProfile|-NonInteractive|-ExecutionPolicy|Bypass|-File|$scannerScript|-Path|{file}"
            $attachmentScannerDescription = 'Windows AMSI command adapter (fail closed)'
        }
    }

    $apiOut = Join-Path $evidenceRuntime 'core-api.stdout.log'
    $apiErr = Join-Path $evidenceRuntime 'core-api.stderr.log'
    $mavenRepo = Join-Path $repoRoot '.tooling\m2'
    $apiProcess = Start-Process -FilePath $maven `
        -ArgumentList @("-Dmaven.repo.local=$mavenRepo", '-Dtest=Sprint21LiveUatServerTest', '-Duat.live=true', "-Duat.run-id=$RunId", "-Duat.jwt.issuer-uri=$issuer", 'test') `
        -WorkingDirectory $apiDir -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr `
        -WindowStyle Hidden -PassThru

    Wait-File $readyFile 300
    $apiPort = [int](Get-Content -LiteralPath $readyFile -Raw -Encoding UTF8).Trim()
    $apiOrigin = "http://127.0.0.1:$apiPort"
    Wait-Http "$apiOrigin/actuator/health" 60
    Assert-SignedJwtApi -apiOrigin $apiOrigin -tokensPath $tokenFile

    $webUrl = "http://127.0.0.1:$WebPort"
    if (-not $SkipWeb) {
        $pnpm = Resolve-Pnpm
        $env:VITE_API_BASE = "$apiOrigin/api/v1"
        $env:VITE_AUTH_MODE = 'bearer'
        $env:VITE_ENABLE_DEMO_FALLBACK = 'false'
        Push-Location $webDir
        try {
            & $pnpm build
            if ($LASTEXITCODE -ne 0) { throw 'Frontend signed-JWT production build failed.' }
        } finally {
            Pop-Location
        }
        $webOut = Join-Path $evidenceRuntime 'web.stdout.log'
        $webErr = Join-Path $evidenceRuntime 'web.stderr.log'
        $webProcess = Start-Process -FilePath $pnpm `
            -ArgumentList @('preview', '--host', '127.0.0.1', '--port', $WebPort, '--strictPort') `
            -WorkingDirectory $webDir -RedirectStandardOutput $webOut -RedirectStandardError $webErr `
            -WindowStyle Hidden -PassThru
        Wait-Http $webUrl 120
    }

    $state = [ordered]@{
        createdAt = (Get-Date).ToString('o')
        expiresAt = (Get-Date).AddHours(12).ToString('o')
        purpose = 'ISOLATED_UAT'
        runId = $RunId
        environmentType = 'embedded-postgresql'
        authenticationMode = 'bearer-jwt'
        devHeaderAuthEnabled = $false
        scheduledAutomationWorkerEnabled = $true
        jwtIssuer = $issuer
        jwtAudience = 'hotel-ai-os-api'
        tokenRuntimeFile = '.uat-runtime/identity/tokens.json'
        oidcPid = $oidcProcess.Id
        apiPid = $apiProcess.Id
        webPid = if ($webProcess) { $webProcess.Id } else { $null }
        apiUrl = $apiOrigin
        webUrl = if (-not $SkipWeb) { $webUrl } else { $null }
        database = 'embedded PostgreSQL (real non-superuser runtime role)'
        attachmentScanner = $attachmentScannerDescription
        fixture = 'database/uat/001_sprint2_1_uat_fixture.sql'
    }
    $state | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8

    Write-Host ''
    Write-Host 'Sprint 2.1 signed-JWT Embedded PostgreSQL UAT environment is ready.'
    Write-Host "API: $apiOrigin"
    if (-not $SkipWeb) { Write-Host "Web: $webUrl" }
    Write-Host "OIDC issuer: $issuer"
    Write-Host "Runtime tokens (ignored): $tokenFile"
    Write-Host "Next: .\tools\uat\Invoke-UatApiSmoke.ps1 -ApiOrigin '$apiOrigin' -RunId '$RunId'"
} catch {
    if ($webProcess -and (Get-Process -Id $webProcess.Id -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $webProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($apiProcess -and (Get-Process -Id $apiProcess.Id -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $apiProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($oidcProcess -and (Get-Process -Id $oidcProcess.Id -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $oidcProcess.Id -Force -ErrorAction SilentlyContinue
    }
    throw
}
