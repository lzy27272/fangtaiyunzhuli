[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F-]{36}$')]
    [string]$HotelId
)

$ErrorActionPreference = 'Stop'
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$runtimeRoot = Join-Path $projectRoot '.uat-runtime\ota-review'
$secretKeyPath = Join-Path $runtimeRoot 'secret-key.dpapi'
$loginPath = Join-Path $PSScriptRoot 'luopan-local-assisted-login.mjs'
$nodeCandidates = @(
    'C:\Users\MSN\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe',
    'node.exe'
)
$node = $nodeCandidates | Where-Object {
    if ([IO.Path]::IsPathRooted($_)) { Test-Path -LiteralPath $_ -PathType Leaf }
    else { [bool](Get-Command $_ -ErrorAction SilentlyContinue) }
} | Select-Object -First 1
if (-not $node) { throw 'NODE_RUNTIME_NOT_FOUND' }
if (-not (Test-Path -LiteralPath $secretKeyPath -PathType Leaf)) {
    throw 'OTA_REVIEW_SECRET_KEY_FILE_MISSING'
}

function ConvertTo-PlainText([Security.SecureString]$SecureValue) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

$protectedValue = (Get-Content -LiteralPath $secretKeyPath -Raw -Encoding utf8).Trim()
if (-not $protectedValue) { throw 'OTA_REVIEW_SECRET_KEY_FILE_EMPTY' }
$secretKey = ConvertTo-PlainText (ConvertTo-SecureString -String $protectedValue)
$previousSecret = $env:OTA_REVIEW_SECRET_KEY
try {
    $env:OTA_REVIEW_SECRET_KEY = $secretKey
    Push-Location $projectRoot
    try { & $node $loginPath $HotelId }
    finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw "LUOPAN_LOCAL_ASSISTED_LOGIN_FAILED:$LASTEXITCODE" }
}
finally {
    $secretKey = $null
    $env:OTA_REVIEW_SECRET_KEY = $previousSecret
}
