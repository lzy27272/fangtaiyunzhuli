[CmdletBinding()]
param(
    [int]$ApiPort = 8091,
    [int]$WebPort = 5180
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$webRoot = Join-Path $repoRoot 'apps\ota-standalone-web'
$runtimeRoot = Join-Path $repoRoot '.uat-runtime\ota-review'
$statePath = Join-Path $runtimeRoot 'state.json'
$credentialsPath = Join-Path $runtimeRoot 'credentials.json'
$dataPath = Join-Path $runtimeRoot 'report-sources.json'
$cookieSecretsPath = Join-Path $runtimeRoot 'report-source-cookie-secrets.json'
$secretKeyPath = Join-Path $runtimeRoot 'secret-key.dpapi'
$stopScript = Join-Path $PSScriptRoot 'Stop-OtaStandaloneReview.ps1'
$apiScript = Join-Path $PSScriptRoot 'ota-standalone-review-api.mjs'
$node = Join-Path $env:USERPROFILE (
    '.cache\codex-runtimes\codex-primary-runtime\' +
    'dependencies\node\bin\node.exe'
)
$vite = Join-Path $webRoot 'node_modules\vite\bin\vite.js'

if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
    throw 'BUNDLED_NODE_NOT_FOUND'
}
if (-not (Test-Path -LiteralPath $vite -PathType Leaf)) {
    throw 'OTA_REVIEW_WEB_DEPENDENCIES_NOT_INSTALLED'
}
if (-not (Test-Path -LiteralPath $apiScript -PathType Leaf)) {
    throw 'OTA_REVIEW_API_SCRIPT_NOT_FOUND'
}

foreach ($port in @($ApiPort, $WebPort)) {
    if (
        Get-NetTCPConnection `
            -State Listen `
            -LocalPort $port `
            -ErrorAction SilentlyContinue
    ) {
        throw "OTA_REVIEW_PORT_ALREADY_IN_USE:$port"
    }
}

if (Test-Path -LiteralPath $statePath -PathType Leaf) {
    $previous = Get-Content -LiteralPath $statePath -Raw -Encoding utf8 |
        ConvertFrom-Json
    $live = @(
        @($previous.apiPid, $previous.webPid) |
            Where-Object {
            $_ -and (Get-Process -Id $_ -ErrorAction SilentlyContinue)
        }
    )
    if ($live.Count -gt 0) {
        throw 'OTA_REVIEW_ALREADY_RUNNING'
    }
}

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

function New-RandomUrlToken([int]$byteCount) {
    $bytes = [byte[]]::new($byteCount)
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }
    return [Convert]::ToBase64String($bytes).
        TrimEnd('=').
        Replace('+', '-').
        Replace('/', '_')
}

function ConvertTo-PlainText([Security.SecureString]$SecureValue) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR(
        $SecureValue
    )
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Get-OrCreateReviewSecretKey([string]$Path) {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        $protectedValue = (
            Get-Content -LiteralPath $Path -Raw -Encoding utf8
        ).Trim()
        if (-not $protectedValue) {
            throw 'OTA_REVIEW_SECRET_KEY_FILE_EMPTY'
        }
        return ConvertTo-PlainText (
            ConvertTo-SecureString -String $protectedValue
        )
    }

    $plainValue = New-RandomUrlToken 32
    $secureValue = ConvertTo-SecureString `
        -String $plainValue `
        -AsPlainText `
        -Force
    $protectedValue = ConvertFrom-SecureString -SecureString $secureValue
    [IO.File]::WriteAllText(
        $Path,
        $protectedValue + [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false)
    )
    return $plainValue
}

function Wait-Http([string]$Url, [int]$Seconds = 60) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        try {
            $response = Invoke-WebRequest `
                -Uri $Url `
                -UseBasicParsing `
                -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                return
            }
        }
        catch {
            Start-Sleep -Milliseconds 300
        }
    } while ((Get-Date) -lt $deadline)
    throw "OTA_REVIEW_START_TIMEOUT:$Url"
}

$reviewUsername = 'review-admin'
$reviewPassword = 'Review-' + (New-RandomUrlToken 9)
$reviewToken = New-RandomUrlToken 32
$reviewSecretKey = Get-OrCreateReviewSecretKey $secretKeyPath
$apiOut = Join-Path $runtimeRoot 'api.stdout.log'
$apiErr = Join-Path $runtimeRoot 'api.stderr.log'
$webOut = Join-Path $runtimeRoot 'web.stdout.log'
$webErr = Join-Path $runtimeRoot 'web.stderr.log'
$apiProcess = $null
$webProcess = $null

$previousApiPort = $env:OTA_REVIEW_API_PORT
$previousUsername = $env:OTA_REVIEW_USERNAME
$previousPassword = $env:OTA_REVIEW_PASSWORD
$previousToken = $env:OTA_REVIEW_ACCESS_TOKEN
$previousDataPath = $env:OTA_REVIEW_DATA_PATH
$previousCookieSecretsPath = $env:OTA_REVIEW_COOKIE_SECRETS_PATH
$previousSecretKey = $env:OTA_REVIEW_SECRET_KEY
$previousAutoCollection = $env:OTA_REVIEW_AUTO_COLLECTION_ENABLED
$previousProxy = $env:OTA_API_PROXY_TARGET

try {
    $env:OTA_REVIEW_API_PORT = [string]$ApiPort
    $env:OTA_REVIEW_USERNAME = $reviewUsername
    $env:OTA_REVIEW_PASSWORD = $reviewPassword
    $env:OTA_REVIEW_ACCESS_TOKEN = $reviewToken
    $env:OTA_REVIEW_DATA_PATH = $dataPath
    $env:OTA_REVIEW_COOKIE_SECRETS_PATH = $cookieSecretsPath
    $env:OTA_REVIEW_SECRET_KEY = $reviewSecretKey
    $env:OTA_REVIEW_AUTO_COLLECTION_ENABLED = 'true'

    $apiProcess = Start-Process `
        -FilePath $node `
        -ArgumentList @($apiScript) `
        -WorkingDirectory $repoRoot `
        -RedirectStandardOutput $apiOut `
        -RedirectStandardError $apiErr `
        -WindowStyle Hidden `
        -PassThru
    Wait-Http "http://127.0.0.1:$ApiPort/health" 30

    # The web process never needs API credentials or the Cookie encryption key.
    # Restore them before Vite is spawned so only the review API inherits them.
    $env:OTA_REVIEW_USERNAME = $previousUsername
    $env:OTA_REVIEW_PASSWORD = $previousPassword
    $env:OTA_REVIEW_ACCESS_TOKEN = $previousToken
    $env:OTA_REVIEW_DATA_PATH = $previousDataPath
    $env:OTA_REVIEW_COOKIE_SECRETS_PATH = $previousCookieSecretsPath
    $env:OTA_REVIEW_SECRET_KEY = $previousSecretKey
    $env:OTA_REVIEW_AUTO_COLLECTION_ENABLED = $previousAutoCollection

    $env:OTA_API_PROXY_TARGET = "http://127.0.0.1:$ApiPort"
    $webProcess = Start-Process `
        -FilePath $node `
        -ArgumentList @(
            $vite,
            '--configLoader',
            'runner',
            '--host',
            '127.0.0.1',
            '--port',
            [string]$WebPort,
            '--strictPort'
        ) `
        -WorkingDirectory $webRoot `
        -RedirectStandardOutput $webOut `
        -RedirectStandardError $webErr `
        -WindowStyle Hidden `
        -PassThru
    Wait-Http "http://127.0.0.1:$WebPort" 60

    $state = [ordered]@{
        status = 'RUNNING'
        mode = 'LOCAL_LIVE_PILOT'
        startedAt = [DateTimeOffset]::Now.ToString('o')
        expiresAt = [DateTimeOffset]::Now.AddHours(4).ToString('o')
        webUrl = "http://127.0.0.1:$WebPort"
        apiUrl = "http://127.0.0.1:$ApiPort"
        apiPid = $apiProcess.Id
        webPid = $webProcess.Id
        username = $reviewUsername
        realExternalConnections = $true
        automaticHourlyCollection = $true
        realWeComDelivery = $false
        cookieSecretStorage = 'WINDOWS_DPAPI_AES256_GCM'
    }
    [IO.File]::WriteAllText(
        $statePath,
        ($state | ConvertTo-Json) + [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false)
    )
    $watchdog = Start-Process `
        -FilePath (Join-Path $PSHOME 'powershell.exe') `
        -ArgumentList @(
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            $stopScript,
            '-DelaySeconds',
            '14400'
        ) `
        -WorkingDirectory $repoRoot `
        -WindowStyle Hidden `
        -PassThru
    $state['watchdogPid'] = $watchdog.Id
    [IO.File]::WriteAllText(
        $statePath,
        ($state | ConvertTo-Json) + [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false)
    )

    $credentials = [ordered]@{
        username = $reviewUsername
        password = $reviewPassword
        expiresAt = $state.expiresAt
    }
    [IO.File]::WriteAllText(
        $credentialsPath,
        ($credentials | ConvertTo-Json) + [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false)
    )

    $result = [ordered]@{
        status = 'READY'
        mode = 'LOCAL_LIVE_PILOT'
        webUrl = $state.webUrl
        apiUrl = $state.apiUrl
        username = $reviewUsername
        password = $reviewPassword
        apiPid = $apiProcess.Id
        webPid = $webProcess.Id
        watchdogPid = $watchdog.Id
        expiresAt = $state.expiresAt
    } | ConvertTo-Json
    Write-Output $result
}
catch {
    if (
        $webProcess -and
        (Get-Process -Id $webProcess.Id -ErrorAction SilentlyContinue)
    ) {
        Stop-Process -Id $webProcess.Id -Force
    }
    if (
        $apiProcess -and
        (Get-Process -Id $apiProcess.Id -ErrorAction SilentlyContinue)
    ) {
        Stop-Process -Id $apiProcess.Id -Force
    }
    throw
}
finally {
    $env:OTA_REVIEW_API_PORT = $previousApiPort
    $env:OTA_REVIEW_USERNAME = $previousUsername
    $env:OTA_REVIEW_PASSWORD = $previousPassword
    $env:OTA_REVIEW_ACCESS_TOKEN = $previousToken
    $env:OTA_REVIEW_DATA_PATH = $previousDataPath
    $env:OTA_REVIEW_COOKIE_SECRETS_PATH = $previousCookieSecretsPath
    $env:OTA_REVIEW_SECRET_KEY = $previousSecretKey
    $env:OTA_REVIEW_AUTO_COLLECTION_ENABLED = $previousAutoCollection
    $env:OTA_API_PROXY_TARGET = $previousProxy
}
