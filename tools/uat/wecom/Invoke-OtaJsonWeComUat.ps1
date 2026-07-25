[CmdletBinding(DefaultParameterSetName = 'DryRun')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'DryRun')]
    [Parameter(Mandatory = $true, ParameterSetName = 'Send')]
    [Parameter(Mandatory = $true, ParameterSetName = 'InteractiveSend')]
    [string]$InputPath,

    [Parameter(Mandatory = $true, ParameterSetName = 'DryRun')]
    [Parameter(Mandatory = $true, ParameterSetName = 'Send')]
    [Parameter(Mandatory = $true, ParameterSetName = 'InteractiveSend')]
    [ValidateLength(1, 80)]
    [string]$HotelName,

    [Parameter(ParameterSetName = 'DryRun')]
    [switch]$DryRun,

    [Parameter(Mandatory = $true, ParameterSetName = 'Send')]
    [switch]$Send,

    [Parameter(Mandatory = $true, ParameterSetName = 'InteractiveSend')]
    [switch]$InteractiveSend,

    [Parameter(Mandatory = $true, ParameterSetName = 'InteractiveSend')]
    [ValidatePattern('^[a-fA-F0-9]{64}$')]
    [string]$ApprovedInputSha256,

    [Parameter(ParameterSetName = 'Send')]
    [Parameter(ParameterSetName = 'InteractiveSend')]
    [switch]$AllowTruncatedRootRecovery,

    [Parameter(Mandatory = $true, ParameterSetName = 'Fingerprint')]
    [switch]$FingerprintWebhook
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$unsafeChildEnvironmentVariables = @(
    'NODE_OPTIONS',
    'NODE_PATH',
    'NODE_EXTRA_CA_CERTS',
    'NODE_TLS_REJECT_UNAUTHORIZED',
    'NODE_USE_ENV_PROXY',
    'NODE_USE_SYSTEM_CA',
    'NODE_DEBUG',
    'NODE_DEBUG_NATIVE',
    'NODE_V8_COVERAGE',
    'NODE_COMPILE_CACHE',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'OPENSSL_CONF',
    'REQUESTS_CA_BUNDLE',
    'CURL_CA_BUNDLE'
)
foreach ($variableName in $unsafeChildEnvironmentVariables) {
    [Environment]::SetEnvironmentVariable(
        $variableName,
        $null,
        'Process'
    )
}
# The child is launched by absolute path and does not spawn other programs.
$env:PATH = ''

$cliPath = Join-Path -Path $PSScriptRoot -ChildPath 'Send-OtaJsonToWeCom.mjs'
$fingerprintCliPath = Join-Path `
    -Path $PSScriptRoot `
    -ChildPath 'Fingerprint-WeComWebhook.mjs'
$userProfilePath = $env:USERPROFILE
if (
    [string]::IsNullOrWhiteSpace($userProfilePath) -or
    $userProfilePath -notmatch '^[A-Za-z]:\\'
) {
    throw 'TRUSTED_NODE_PROFILE_PATH_INVALID'
}
$profileItem = Get-Item -LiteralPath $userProfilePath -Force
if (
    -not $profileItem.PSIsContainer -or
    ($profileItem.Attributes -band
        [IO.FileAttributes]::ReparsePoint) -ne 0
) {
    throw 'TRUSTED_NODE_PROFILE_PATH_INVALID'
}
$profileDrive = [IO.DriveInfo]::new(
    [IO.Path]::GetPathRoot($profileItem.FullName)
)
if ($profileDrive.DriveType -ne [IO.DriveType]::Fixed) {
    throw 'TRUSTED_NODE_PROFILE_DRIVE_NOT_FIXED'
}
$nodeExecutable = Join-Path -Path $userProfilePath -ChildPath (
    '.cache\codex-runtimes\codex-primary-runtime\' +
    'dependencies\node\bin\node.exe'
)
if (-not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) {
    throw 'TRUSTED_NODE_EXECUTABLE_NOT_FOUND'
}
$resolvedProfilePath = (Resolve-Path -LiteralPath $userProfilePath).Path
$resolvedNodePath = (Resolve-Path -LiteralPath $nodeExecutable).Path
if (
    -not $resolvedNodePath.StartsWith(
        $resolvedProfilePath + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase
    )
) {
    throw 'TRUSTED_NODE_REALPATH_INVALID'
}
$nodeItem = Get-Item -LiteralPath $resolvedNodePath -Force
if (
    ($nodeItem.Attributes -band
        [IO.FileAttributes]::ReparsePoint) -ne 0
) {
    throw 'TRUSTED_NODE_REPARSE_POINT_REJECTED'
}
$ancestor = $nodeItem.Directory
while (
    $null -ne $ancestor -and
    $ancestor.FullName.StartsWith(
        $resolvedProfilePath,
        [StringComparison]::OrdinalIgnoreCase
    )
) {
    if (
        ($ancestor.Attributes -band
            [IO.FileAttributes]::ReparsePoint) -ne 0
    ) {
        throw 'TRUSTED_NODE_REPARSE_POINT_REJECTED'
    }
    if (
        $ancestor.FullName.Equals(
            $resolvedProfilePath,
            [StringComparison]::OrdinalIgnoreCase
        )
    ) {
        break
    }
    $ancestor = $ancestor.Parent
}
$nodeExecutable = $resolvedNodePath
$nodeSignature = Get-AuthenticodeSignature -LiteralPath $nodeExecutable
if (
    $nodeSignature.Status -ne 'Valid' -or
    $null -eq $nodeSignature.SignerCertificate -or
    $nodeSignature.SignerCertificate.Subject -notmatch
        'CN=OpenJS Foundation(?:,|$)'
) {
    throw 'TRUSTED_NODE_SIGNATURE_INVALID'
}

$exitCode = 2
[Environment]::SetEnvironmentVariable(
    'WECOM_GROUP_ROBOT_WEBHOOK',
    $null,
    'Process'
)
[Environment]::SetEnvironmentVariable(
    'OTA_WECOM_UAT_WRAPPER_NONCE',
    $null,
    'Process'
)

try {
    if ($Send -or $InteractiveSend -or $FingerprintWebhook) {
        if ($env:OTA_WECOM_UAT_SEND_ENABLED -ne 'true') {
            if ($Send -or $InteractiveSend) {
                throw 'WECOM_UAT_SEND_GATE_DISABLED'
            }
        }
        if ($Send) {
            if (
                $env:WECOM_GROUP_ROBOT_ENDPOINT_SHA256 -notmatch
                    '^[a-fA-F0-9]{64}$'
            ) {
                throw 'WECOM_ENDPOINT_FINGERPRINT_REQUIRED'
            }
            if (
                [string]::IsNullOrWhiteSpace(
                    $env:WECOM_UAT_EXPECTED_HOTEL_NAME
                )
            ) {
                throw 'WECOM_UAT_EXPECTED_HOTEL_REQUIRED'
            }
        }

        $secureWebhook = Read-Host `
            ('请粘贴完整Webhook，必须以 ' +
            'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key= ' +
            '开头（不会回显）') `
            -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR(
            $secureWebhook
        )
        $plainWebhook = $null
        try {
            $plainWebhook = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
                $bstr
            )
            [Environment]::SetEnvironmentVariable(
                'WECOM_GROUP_ROBOT_WEBHOOK',
                $plainWebhook,
                'Process'
            )
        }
        finally {
            if ($bstr -ne [IntPtr]::Zero) {
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
            }
            $plainWebhook = $null
        }
    }

    if ($FingerprintWebhook) {
        & $nodeExecutable $fingerprintCliPath
    }
    elseif ($InteractiveSend) {
        $fingerprintOutput = & $nodeExecutable $fingerprintCliPath
        if ($LASTEXITCODE -ne 0) {
            throw 'WECOM_UAT_FINGERPRINT_FAILED'
        }
        $fingerprintDocument = $fingerprintOutput | ConvertFrom-Json
        $endpointSha256 = $fingerprintDocument.endpointSha256
        if ($endpointSha256 -notmatch '^[a-fA-F0-9]{64}$') {
            throw 'WECOM_UAT_FINGERPRINT_INVALID'
        }

        Write-Host ''
        Write-Host (
            '目标群 endpointSha256：{0}' -f $endpointSha256
        ) -ForegroundColor Cyan
        $confirmationCode = 'UAT-SEND-' + `
            $endpointSha256.Substring(56, 8).ToUpperInvariant()
        $operatorConfirmation = (
            Read-Host (
                '核对目标群无误后，输入 {0}' -f $confirmationCode
            )
        ).Trim()
        if ($operatorConfirmation -cne $confirmationCode) {
            Write-Output (
                '{"status":"ABORTED",' +
                '"reasonCode":"WECOM_UAT_OPERATOR_NOT_CONFIRMED"}'
            )
            $exitCode = 5
        }
        else {
            [Environment]::SetEnvironmentVariable(
                'WECOM_GROUP_ROBOT_ENDPOINT_SHA256',
                $endpointSha256,
                'Process'
            )
            [Environment]::SetEnvironmentVariable(
                'WECOM_UAT_EXPECTED_HOTEL_NAME',
                $HotelName,
                'Process'
            )
            [Environment]::SetEnvironmentVariable(
                'OTA_WECOM_UAT_APPROVED_INPUT_SHA256',
                $ApprovedInputSha256.ToLowerInvariant(),
                'Process'
            )

            $wrapperNonce = [Guid]::NewGuid().ToString('N')
            [Environment]::SetEnvironmentVariable(
                'OTA_WECOM_UAT_WRAPPER_NONCE',
                $wrapperNonce,
                'Process'
            )
            $cliArguments = @(
                $cliPath,
                '--input',
                $InputPath,
                '--hotel',
                $HotelName,
                '--send',
                '--wrapper-nonce',
                $wrapperNonce
            )
            if ($AllowTruncatedRootRecovery) {
                $cliArguments += '--allow-truncated-root-recovery'
            }
            & $nodeExecutable @cliArguments
            $exitCode = $LASTEXITCODE
        }
    }
    elseif ($Send) {
        $wrapperNonce = [Guid]::NewGuid().ToString('N')
        [Environment]::SetEnvironmentVariable(
            'OTA_WECOM_UAT_WRAPPER_NONCE',
            $wrapperNonce,
            'Process'
        )
        $cliArguments = @(
            $cliPath,
            '--input',
            $InputPath,
            '--hotel',
            $HotelName,
            '--send',
            '--wrapper-nonce',
            $wrapperNonce
        )
        if ($AllowTruncatedRootRecovery) {
            $cliArguments += '--allow-truncated-root-recovery'
        }
        & $nodeExecutable @cliArguments
    }
    else {
        & $nodeExecutable $cliPath `
            --input $InputPath `
            --hotel $HotelName `
            --dry-run
    }
    $exitCode = $LASTEXITCODE
}
finally {
    [Environment]::SetEnvironmentVariable(
        'WECOM_GROUP_ROBOT_WEBHOOK',
        $null,
        'Process'
    )
    [Environment]::SetEnvironmentVariable(
        'OTA_WECOM_UAT_WRAPPER_NONCE',
        $null,
        'Process'
    )
    foreach ($variableName in @(
        'WECOM_GROUP_ROBOT_ENDPOINT_SHA256',
        'WECOM_UAT_EXPECTED_HOTEL_NAME',
        'OTA_WECOM_UAT_APPROVED_INPUT_SHA256'
    )) {
        [Environment]::SetEnvironmentVariable(
            $variableName,
            $null,
            'Process'
        )
    }
}

exit $exitCode
