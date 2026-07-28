[CmdletBinding()]
param(
    [string]$BaseUrl,

    [string]$Model,

    [ValidateRange(1000, 15000)]
    [int]$TimeoutMs = 8000,

    [string]$RemoteHost = 'ubuntu@43.136.184.38',

    [string]$IdentityFile = (
        Join-Path $env:USERPROFILE `
            '.ssh\sifangguan_tencent_ota_ed25519'
    ),

    [switch]$Disable
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ssh = (Get-Command 'ssh.exe' -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath $IdentityFile -PathType Leaf)) {
    throw 'SSH_IDENTITY_FILE_NOT_FOUND'
}

$action = if ($Disable) { 'DISABLE' } else { 'ENABLE' }
$baseUrlEncoded = ''
$modelEncoded = ''
$apiKeyEncoded = ''
$bstr = [IntPtr]::Zero

try {
    if (-not $Disable) {
        $uri = $null
        if (
            -not [Uri]::TryCreate(
                $BaseUrl,
                [UriKind]::Absolute,
                [ref]$uri
            ) -or
            $uri.Scheme -ne 'https' -or
            $uri.Port -ne 443 -or
            $uri.UserInfo -or
            $uri.Query -or
            $uri.Fragment
        ) {
            throw 'AI_BASE_URL_INVALID'
        }
        if ($Model -notmatch '^[A-Za-z0-9._:/-]{1,120}$') {
            throw 'AI_MODEL_INVALID'
        }
        $secureKey = Read-Host `
            '请输入大模型 API Key（输入内容不会显示）' `
            -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR(
            $secureKey
        )
        $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
            $bstr
        )
        if (
            [string]::IsNullOrWhiteSpace($plainKey) -or
            $plainKey.Length -lt 8 -or
            $plainKey.Length -gt 1024
        ) {
            throw 'AI_API_KEY_INVALID'
        }
        $baseUrlEncoded = [Convert]::ToBase64String(
            [Text.Encoding]::UTF8.GetBytes($uri.AbsoluteUri.TrimEnd('/'))
        )
        $modelEncoded = [Convert]::ToBase64String(
            [Text.Encoding]::UTF8.GetBytes($Model)
        )
        $apiKeyEncoded = [Convert]::ToBase64String(
            [Text.Encoding]::UTF8.GetBytes($plainKey)
        )
        $plainKey = $null
    }

    $payload = @(
        $action
        $baseUrlEncoded
        $modelEncoded
        $apiKeyEncoded
        $TimeoutMs
    ) -join "`n"
    $payload | & $ssh `
        -i $IdentityFile `
        -o BatchMode=yes `
        -o StrictHostKeyChecking=accept-new `
        $RemoteHost `
        'sudo bash /opt/sifangguan-ota/current/infra/ota-standalone-server/scripts/configure-ai-runtime.sh'
    if ($LASTEXITCODE -ne 0) {
        throw "AI_REMOTE_CONFIGURATION_FAILED:EXIT_$LASTEXITCODE"
    }
}
finally {
    if ($bstr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    $apiKeyEncoded = $null
    $payload = $null
}
