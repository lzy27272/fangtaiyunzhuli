[CmdletBinding()]
param(
    [switch]$ResetDatabase,
    [switch]$Force,
    [switch]$SkipBuild,
    [switch]$SkipWeb
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    if ($SkipBuild) {
        Write-Warning '-SkipBuild is ignored by the embedded PostgreSQL live-test host.'
    }
    & (Join-Path $PSScriptRoot 'Start-EmbeddedUatEnvironment.ps1') -SkipWeb:$SkipWeb
    return
}

$composeDir = Join-Path $repoRoot 'infra\uat'
$composeFile = Join-Path $composeDir 'docker-compose.yml'
$envFile = Join-Path $composeDir '.env'
$envExample = Join-Path $composeDir '.env.example'
$apiDir = Join-Path $repoRoot 'apps\core-api'
$webDir = Join-Path $repoRoot 'apps\web'
$evidenceDir = Join-Path $repoRoot 'docs\uat\evidence\runtime'
$runtimeRoot = Join-Path $repoRoot '.uat-runtime'
$identityRoot = Join-Path $runtimeRoot 'identity'
$tokenFile = Join-Path $identityRoot 'tokens.json'
$stateFile = Join-Path $evidenceDir 'uat-processes.json'

New-Item -ItemType Directory -Force -Path $evidenceDir, $identityRoot | Out-Null

if (-not (Test-Path -LiteralPath $envFile)) {
    Copy-Item -LiteralPath $envExample -Destination $envFile
    Write-Host "Created $envFile from .env.example. These credentials are UAT-only."
}

function Import-DotEnv([string]$path) {
    foreach ($line in Get-Content -LiteralPath $path -Encoding UTF8) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $pair = $trimmed.Split('=', 2)
        if ($pair.Count -ne 2) { throw "Invalid env line: $line" }
        Set-Item -Path "Env:$($pair[0].Trim())" -Value $pair[1].Trim()
    }
}

function Require-Command([string]$name) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $command) { throw "Required command is not available: $name" }
    return $command.Source
}

function Assert-RequiredEnvironmentVariables([string[]]$names) {
    $missing = @()
    foreach ($name in $names) {
        $value = [Environment]::GetEnvironmentVariable($name, 'Process')
        if ([string]::IsNullOrWhiteSpace($value)) {
            $missing += $name
        }
    }
    if ($missing.Count -gt 0) {
        throw "Required UAT environment variables are missing or empty: $($missing -join ', ')."
    }
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

function Resolve-Python {
    $bundled = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
    if (Test-Path -LiteralPath $bundled) { return $bundled }
    $command = Get-Command python -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw 'Python with cryptography was not found. The signed-JWT UAT issuer cannot start.'
}

function Wait-Http([string]$url, [int]$seconds = 120) {
    $deadline = (Get-Date).AddSeconds($seconds)
    do {
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
        } catch {
            Start-Sleep -Seconds 2
        }
    } while ((Get-Date) -lt $deadline)
    throw "Timed out waiting for $url"
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

Import-DotEnv $envFile
Assert-RequiredEnvironmentVariables @(
    'UAT_DB_OWNER',
    'UAT_DB_OWNER_PASSWORD',
    'UAT_DB_RUNTIME_USER',
    'UAT_DB_RUNTIME_PASSWORD',
    'UAT_DB_NAME',
    'UAT_DB_PORT',
    'UAT_API_PORT'
)
$docker = Require-Command 'docker'
$composeArgs = @('compose', '--env-file', $envFile, '-f', $composeFile)

if ($ResetDatabase) {
    if (-not $Force) {
        throw 'ResetDatabase deletes the disposable hotel-ai-os-uat-postgres volume. Re-run with -Force.'
    }
    & $docker @composeArgs down --volumes --remove-orphans
    if ($LASTEXITCODE -ne 0) { throw 'Failed to reset the UAT compose project.' }
}

& $docker @composeArgs up -d postgres
if ($LASTEXITCODE -ne 0) { throw 'Failed to start UAT PostgreSQL.' }

$dbReady = $false
for ($attempt = 1; $attempt -le 60; $attempt++) {
    & $docker @composeArgs exec -T postgres pg_isready -U $env:UAT_DB_OWNER -d $env:UAT_DB_NAME | Out-Null
    if ($LASTEXITCODE -eq 0) { $dbReady = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $dbReady) { throw 'UAT PostgreSQL did not become ready.' }

$java = Resolve-Java
$maven = Resolve-Maven
$javaHome = Split-Path -Parent (Split-Path -Parent $java)
$env:JAVA_HOME = $javaHome
$env:Path = "$(Join-Path $javaHome 'bin');$env:Path"

if (-not $SkipBuild) {
    Push-Location $apiDir
    try {
        & $maven "-Dmaven.repo.local=$(Join-Path $repoRoot '.tooling\m2')" '-DskipTests' package
        if ($LASTEXITCODE -ne 0) { throw 'Backend package build failed.' }
    } finally {
        Pop-Location
    }
}

$jar = Get-ChildItem -LiteralPath (Join-Path $apiDir 'target') -Filter 'hotel-ai-os-core-api-*.jar' |
    Where-Object { $_.Name -notlike '*.original' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $jar) { throw 'Backend JAR was not found. Run without -SkipBuild first.' }

$oidcPort = if ($env:UAT_OIDC_PORT) { [int]$env:UAT_OIDC_PORT } else { 18081 }
$issuer = "http://127.0.0.1:$oidcPort"
$oidcProcess = $null
$oidcReady = $false
try {
    $response = Invoke-WebRequest -Uri "$issuer/health" -UseBasicParsing -TimeoutSec 2
    $oidcReady = $response.StatusCode -eq 200 -and (Test-Path -LiteralPath $tokenFile)
} catch { }
if (-not $oidcReady) {
    Remove-Item -LiteralPath $tokenFile -Force -ErrorAction SilentlyContinue
    $python = Resolve-Python
    $oidcOut = Join-Path $evidenceDir 'oidc.stdout.log'
    $oidcErr = Join-Path $evidenceDir 'oidc.stderr.log'
    $oidcScript = Join-Path $PSScriptRoot 'mock_oidc_server.py'
    $oidcProcess = Start-Process -FilePath $python `
        -ArgumentList @(('"{0}"' -f $oidcScript), '--host', '127.0.0.1', '--port', $oidcPort, '--issuer', $issuer, '--audience', 'hotel-ai-os-api', '--token-file', ('"{0}"' -f $tokenFile)) `
        -WorkingDirectory $repoRoot -RedirectStandardOutput $oidcOut -RedirectStandardError $oidcErr `
        -WindowStyle Hidden -PassThru
    Wait-Http "$issuer/health" 60
    if (-not (Test-Path -LiteralPath $tokenFile)) { throw 'OIDC issuer started without producing the runtime token file.' }
}

$env:DB_URL = "jdbc:postgresql://127.0.0.1:$($env:UAT_DB_PORT)/$($env:UAT_DB_NAME)"
$env:DB_USERNAME = $env:UAT_DB_RUNTIME_USER
$env:DB_PASSWORD = $env:UAT_DB_RUNTIME_PASSWORD
$env:DB_MIGRATION_USERNAME = $env:UAT_DB_OWNER
$env:DB_MIGRATION_PASSWORD = $env:UAT_DB_OWNER_PASSWORD
$env:PORT = $env:UAT_API_PORT
$env:DEV_HEADER_AUTH_ENABLED = 'false'
$env:JWT_ISSUER_URI = $issuer
$env:JWT_AUDIENCE = 'hotel-ai-os-api'
$env:DB_RLS_ENABLED = 'true'
$env:TASK_DEFAULT_ESCALATION_DELAY_HOURS = $env:UAT_TASK_ESCALATION_DELAY_HOURS
$env:WORK_EXPECTATION_SLA_SCHEDULER_ENABLED = 'false'
$env:ATTACHMENT_STORAGE_ROOT = Join-Path $evidenceDir 'attachments'
$env:ATTACHMENT_MAX_SIZE_BYTES = $env:UAT_ATTACHMENT_MAX_SIZE_BYTES
$defender = 'C:\Program Files\Windows Defender\MpCmdRun.exe'
if (Test-Path -LiteralPath $defender) { $env:ATTACHMENT_SCAN_COMMAND_PATH = $defender }
$env:WEB_ALLOWED_ORIGINS = "http://127.0.0.1:$($env:UAT_WEB_PORT),http://localhost:$($env:UAT_WEB_PORT)"

$apiHealth = "http://127.0.0.1:$($env:UAT_API_PORT)/actuator/health"
$apiProcess = $null
try { Invoke-WebRequest -Uri $apiHealth -UseBasicParsing -TimeoutSec 2 | Out-Null } catch {
    $apiOut = Join-Path $evidenceDir 'core-api.stdout.log'
    $apiErr = Join-Path $evidenceDir 'core-api.stderr.log'
    $apiProcess = Start-Process -FilePath $java -ArgumentList @('-jar', $jar.FullName) `
        -WorkingDirectory $apiDir -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr `
        -WindowStyle Hidden -PassThru
}
Wait-Http $apiHealth 180

& $docker @composeArgs exec -T postgres psql -v ON_ERROR_STOP=1 -U $env:UAT_DB_OWNER -d $env:UAT_DB_NAME `
    -f /uat-fixtures/001_sprint2_1_uat_fixture.sql
if ($LASTEXITCODE -ne 0) { throw 'UAT fixture import failed.' }

$fixtureEvidence = Join-Path $evidenceDir 'fixture-verification.txt'
& $docker @composeArgs exec -T postgres psql -v ON_ERROR_STOP=1 -U $env:UAT_DB_OWNER -d $env:UAT_DB_NAME `
    -f /uat-fixtures/002_verify_sprint2_1_uat_fixture.sql | Tee-Object -FilePath $fixtureEvidence
if ($LASTEXITCODE -ne 0) { throw 'UAT fixture verification failed.' }

Assert-SignedJwtApi -apiOrigin "http://127.0.0.1:$($env:UAT_API_PORT)" -tokensPath $tokenFile

$webProcess = $null
if (-not $SkipWeb) {
    $nodeBin = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
    if (Test-Path -LiteralPath (Join-Path $nodeBin 'node.exe')) { $env:Path = "$nodeBin;$env:Path" }
    $pnpm = Require-Command 'pnpm'
    $env:VITE_API_BASE = "http://127.0.0.1:$($env:UAT_API_PORT)/api/v1"
    $env:VITE_AUTH_MODE = 'bearer'
    $env:VITE_ENABLE_DEMO_FALLBACK = 'false'
    if (-not $SkipBuild) {
        Push-Location $webDir
        try {
            & $pnpm build
            if ($LASTEXITCODE -ne 0) { throw 'Frontend production build failed.' }
        } finally {
            Pop-Location
        }
    }
    $webUrl = "http://127.0.0.1:$($env:UAT_WEB_PORT)"
    try { Invoke-WebRequest -Uri $webUrl -UseBasicParsing -TimeoutSec 2 | Out-Null } catch {
        $webOut = Join-Path $evidenceDir 'web.stdout.log'
        $webErr = Join-Path $evidenceDir 'web.stderr.log'
        $webProcess = Start-Process -FilePath $pnpm -ArgumentList @('preview', '--', '--host', '127.0.0.1', '--port', $env:UAT_WEB_PORT, '--strictPort') `
            -WorkingDirectory $webDir -RedirectStandardOutput $webOut -RedirectStandardError $webErr `
            -WindowStyle Hidden -PassThru
    }
    Wait-Http $webUrl 120
}

$state = [ordered]@{
    createdAt = (Get-Date).ToString('o')
    expiresAt = (Get-Date).AddHours(12).ToString('o')
    purpose = 'ISOLATED_UAT'
    authenticationMode = 'bearer-jwt'
    devHeaderAuthEnabled = $false
    jwtIssuer = $issuer
    jwtAudience = 'hotel-ai-os-api'
    tokenRuntimeFile = '.uat-runtime/identity/tokens.json'
    oidcPid = if ($oidcProcess) { $oidcProcess.Id } else { $null }
    apiPid = if ($apiProcess) { $apiProcess.Id } else { $null }
    webPid = if ($webProcess) { $webProcess.Id } else { $null }
    apiUrl = "http://127.0.0.1:$($env:UAT_API_PORT)"
    webUrl = "http://127.0.0.1:$($env:UAT_WEB_PORT)"
    database = "127.0.0.1:$($env:UAT_DB_PORT)/$($env:UAT_DB_NAME)"
    jar = $jar.FullName
    fixture = 'database/uat/001_sprint2_1_uat_fixture.sql'
}
$state | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8

Write-Host ''
Write-Host 'Sprint 2.1 UAT environment is ready.'
Write-Host "API: http://127.0.0.1:$($env:UAT_API_PORT)"
if (-not $SkipWeb) { Write-Host "Web: http://127.0.0.1:$($env:UAT_WEB_PORT)" }
Write-Host "Evidence: $evidenceDir"
Write-Host "OIDC issuer: $issuer"
Write-Host 'Next: .\tools\uat\Invoke-UatApiSmoke.ps1 (signed Bearer JWT)'
