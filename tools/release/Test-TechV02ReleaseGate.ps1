[CmdletBinding()]
param(
    [string]$InputsPath = '.uat-runtime/release/TECH-V0.2-RELEASE-GATE-INPUTS.json'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$evaluatedAt = (Get-Date).ToUniversalTime().ToString('o')
$script:TechV02FinalEvidenceReferences = @()

function Resolve-WorkspacePath([string]$path) {
    if ([string]::IsNullOrWhiteSpace($path)) { return $null }
    $candidate = if ([System.IO.Path]::IsPathRooted($path)) {
        [System.IO.Path]::GetFullPath($path)
    } else {
        [System.IO.Path]::GetFullPath((Join-Path $repoRoot $path))
    }
    $prefix = $repoRoot.TrimEnd('\') + '\'
    if (-not $candidate.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $null
    }
    return $candidate
}

function Get-RelativePath([string]$path) {
    if ([string]::IsNullOrWhiteSpace($path)) { return $null }
    $prefix = $repoRoot.TrimEnd('\') + '\'
    if ($path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $path.Substring($prefix.Length).Replace('\', '/')
    }
    return $path
}

function Read-Json([string]$path, [ref]$errorMessage) {
    if ([string]::IsNullOrWhiteSpace($path)) {
        $errorMessage.Value = 'path is empty'
        return $null
    }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        $errorMessage.Value = "file does not exist: $(Get-RelativePath $path)"
        return $null
    }
    try {
        return Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        $errorMessage.Value = "invalid JSON: $($_.Exception.Message)"
        return $null
    }
}

function Test-MeaningfulString($value) {
    if ($null -eq $value) { return $false }
    $text = $value.ToString().Trim()
    if ($text.Length -lt 2) { return $false }
    # Keep the script ASCII-only so Windows PowerShell 5.1 does not corrupt
    # UTF-8-without-BOM source text. These escapes mean: pending Chinese
    # placeholders such as "to be filled", "not filled", and "none".
    return $text -notmatch '^(?i:pending|todo|tbd|unknown|null|example|sample|name|title|\u5f85\u586b\u5199|\u5f85\u586b|\u672a\u586b\u5199|\u65e0)$'
}

function Test-Sha256($value) {
    return $null -ne $value -and $value.ToString() -match '^[0-9a-fA-F]{64}$'
}

function Test-IsoTimestamp($value) {
    if (-not (Test-MeaningfulString $value)) { return $false }
    $text = $value.ToString()
    if ($text -cnotmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,7})?(?:Z|[+-][0-9]{2}:[0-9]{2})$') { return $false }
    $parsed = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse(
        $text,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::RoundtripKind,
        [ref]$parsed
    )) { return $false }
    return $parsed -le [DateTimeOffset]::UtcNow.AddMinutes(5)
}

function Test-True($value) {
    return $value -is [bool] -and $value
}

function Test-False($value) {
    return $value -is [bool] -and -not $value
}

function Test-Approved($value) {
    return $null -ne $value -and $value.ToString() -ceq 'APPROVED'
}

function New-Check([string]$id, [string]$name, [array]$reasons, [array]$evidence, $metrics) {
    $normalizedReasons = @($reasons | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    return [ordered]@{
        id = $id
        name = $name
        status = if ($normalizedReasons.Count -eq 0) { 'PASS' } else { 'BLOCKED' }
        reasons = $normalizedReasons
        evidence = @($evidence | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        metrics = if ($metrics) { $metrics } else { [ordered]@{} }
    }
}

function Resolve-Git {
    $command = Get-Command git -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $bundled = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe'
    if (Test-Path -LiteralPath $bundled -PathType Leaf) { return $bundled }
    return $null
}

function Invoke-GitReadOnly([string]$gitPath, [string[]]$arguments) {
    $previousLocks = $env:GIT_OPTIONAL_LOCKS
    $env:GIT_OPTIONAL_LOCKS = '0'
    try {
        $oldPreference = $ErrorActionPreference
        $ErrorActionPreference = 'SilentlyContinue'
        try {
            $output = @(& $gitPath --no-optional-locks -C $repoRoot @arguments 2>&1 | ForEach-Object { $_.ToString() })
            $exitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $oldPreference
        }
        return [pscustomobject]@{
            ExitCode = $exitCode
            Output = ($output -join "`n").Trim()
        }
    } finally {
        $env:GIT_OPTIONAL_LOCKS = $previousLocks
    }
}

function Get-Sha256Text([string]$text) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Get-Sha256Bytes([byte[]]$bytes) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function ConvertFrom-StrictUtf8Bytes([byte[]]$bytes) {
    if ($null -eq $bytes) { throw 'UTF-8 byte array is null.' }
    $offset = 0
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        $offset = 3
    }
    $strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
    return $strictUtf8.GetString($bytes, $offset, $bytes.Length - $offset)
}

function Test-PathContainsReparsePoint([string]$candidate) {
    if ([string]::IsNullOrWhiteSpace($candidate)) { return $true }
    try {
        $fullPath = [System.IO.Path]::GetFullPath($candidate)
        $root = [System.IO.Path]::GetPathRoot($fullPath)
        if ([string]::IsNullOrWhiteSpace($root)) { return $true }
        $current = $root
        $remaining = $fullPath.Substring($root.Length)
        foreach ($segment in @($remaining -split '[\\/]' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })) {
            $current = Join-Path $current $segment
            if (-not (Test-Path -LiteralPath $current)) { break }
            $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return $true }
        }
        return $false
    } catch {
        return $true
    }
}

function Read-FileSnapshot([string]$path, [string]$label, [bool]$includeBytes = $false) {
    $fullPath = Resolve-WorkspacePath $path
    if (-not $fullPath) {
        return [pscustomobject]@{ Ok = $false; Reason = "$label path is empty, invalid, or outside the workspace"; RelativePath = ''; Sha256 = ''; SizeBytes = 0; Bytes = $null }
    }
    if (Test-PathContainsReparsePoint $fullPath) {
        return [pscustomobject]@{ Ok = $false; Reason = "$label path contains a symbolic link, junction, or other reparse point"; RelativePath = (Get-RelativePath $fullPath); Sha256 = ''; SizeBytes = 0; Bytes = $null }
    }
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        return [pscustomobject]@{ Ok = $false; Reason = "$label file does not exist"; RelativePath = (Get-RelativePath $fullPath); Sha256 = ''; SizeBytes = 0; Bytes = $null }
    }
    $stream = $null
    try {
        $stream = New-Object System.IO.FileStream(
            $fullPath,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::Read
        )
        $bytes = $null
        if ($includeBytes) {
            $memory = New-Object System.IO.MemoryStream
            try {
                $stream.CopyTo($memory)
                $bytes = $memory.ToArray()
                $hash = Get-Sha256Bytes $bytes
            } finally {
                $memory.Dispose()
            }
        } else {
            $sha = [System.Security.Cryptography.SHA256]::Create()
            try {
                $hash = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
            } finally {
                $sha.Dispose()
            }
        }
        return [pscustomobject]@{
            Ok = $true
            Reason = ''
            RelativePath = Get-RelativePath $fullPath
            Sha256 = $hash
            SizeBytes = $stream.Length
            Bytes = $bytes
        }
    } catch {
        return [pscustomobject]@{ Ok = $false; Reason = "$label file could not be read: $($_.Exception.Message)"; RelativePath = (Get-RelativePath $fullPath); Sha256 = ''; SizeBytes = 0; Bytes = $null }
    } finally {
        if ($stream) { $stream.Dispose() }
    }
}

function Register-FinalEvidenceSnapshot($snapshot, [string]$label, [string]$gateId) {
    if ($null -eq $snapshot -or -not $snapshot.Ok) { return }
    $script:TechV02FinalEvidenceReferences += [pscustomobject]@{
        GateId = $gateId
        Label = $label
        Uri = $snapshot.RelativePath
        ExpectedSha256 = $snapshot.Sha256
        InitialSha256 = $snapshot.Sha256
        InitialSizeBytes = $snapshot.SizeBytes
    }
}

function Test-EvidenceReference($uri, $expectedSha256, [string]$label, [string]$gateId) {
    $reasons = @()
    $evidence = @()
    if (-not (Test-MeaningfulString $uri) -or -not (Test-Sha256 $expectedSha256)) {
        return [pscustomobject]@{ Reasons = @("$label URI/SHA-256 is incomplete"); Evidence = @(); Snapshot = $null }
    }
    $snapshot = Read-FileSnapshot $uri.ToString() $label
    if (-not $snapshot.Ok) {
        $reasons += $snapshot.Reason
    } else {
        if ($snapshot.RelativePath -cne $uri.ToString().Replace('\', '/')) {
            $reasons += "$label URI is not the canonical workspace-relative path"
        }
        if ($snapshot.Sha256 -cne $expectedSha256.ToString().ToLowerInvariant()) {
            $reasons += "$label SHA-256 does not match the locked evidence file bytes"
        }
        $evidence += $snapshot.RelativePath
        $script:TechV02FinalEvidenceReferences += [pscustomobject]@{
            GateId = $gateId
            Label = $label
            Uri = $snapshot.RelativePath
            ExpectedSha256 = $expectedSha256.ToString().ToLowerInvariant()
            InitialSha256 = $snapshot.Sha256
            InitialSizeBytes = $snapshot.SizeBytes
        }
    }
    return [pscustomobject]@{ Reasons = $reasons; Evidence = $evidence; Snapshot = $snapshot }
}

function Test-EvidenceArtifacts($items, [string]$label, [string]$gateId, [bool]$required) {
    $reasons = @()
    $evidence = @()
    $artifacts = @($items)
    if ($required -and $artifacts.Count -lt 1) { $reasons += "$label requires at least one evidence artifact" }
    $uris = @()
    foreach ($artifact in $artifacts) {
        if (-not (Test-MeaningfulString $artifact.kind)) { $reasons += "$label evidence artifact kind is incomplete" }
        $reference = Test-EvidenceReference $artifact.uri $artifact.sha256 "$label evidence artifact" $gateId
        $reasons += $reference.Reasons
        $evidence += $reference.Evidence
        if (Test-MeaningfulString $artifact.uri) { $uris += $artifact.uri.ToString().ToLowerInvariant() }
    }
    if (@($uris | Select-Object -Unique).Count -ne $artifacts.Count) { $reasons += "$label evidence artifact URIs must be unique" }
    return [pscustomobject]@{ Reasons = $reasons; Evidence = @($evidence | Select-Object -Unique) }
}

function Test-ExactIntegerValue($value, [long]$expected) {
    $isInteger = $value -is [sbyte] -or $value -is [byte] -or
        $value -is [int16] -or $value -is [uint16] -or
        $value -is [int32] -or $value -is [uint32] -or
        $value -is [int64] -or $value -is [uint64]
    if (-not $isInteger) { return $false }
    try { return [long]$value -eq $expected } catch { return $false }
}

function Test-IntegralAtLeast($value, [long]$minimum) {
    $isInteger = $value -is [sbyte] -or $value -is [byte] -or
        $value -is [int16] -or $value -is [uint16] -or
        $value -is [int32] -or $value -is [uint32] -or
        $value -is [int64] -or $value -is [uint64]
    if (-not $isInteger) { return $false }
    try { return [long]$value -ge $minimum } catch { return $false }
}

function Test-ExactIntegerTextValue($value, [long]$expected) {
    if ($null -eq $value) { return $false }
    $text = $value.ToString()
    if ($text -cnotmatch '^(?:0|[1-9][0-9]*)$') { return $false }
    $parsed = [long]0
    if (-not [long]::TryParse(
        $text,
        [System.Globalization.NumberStyles]::None,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [ref]$parsed
    )) { return $false }
    return $parsed -eq $expected
}

function Test-IntegerTextAtLeast($value, [long]$minimum) {
    if ($null -eq $value) { return $false }
    $text = $value.ToString()
    if ($text -cnotmatch '^(?:0|[1-9][0-9]*)$') { return $false }
    $parsed = [long]0
    if (-not [long]::TryParse(
        $text,
        [System.Globalization.NumberStyles]::None,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [ref]$parsed
    )) { return $false }
    return $parsed -ge $minimum
}

function Test-LeadingJsonExactIntegerProperty([string]$jsonText, [string]$propertyName, [long]$expected) {
    if ([string]::IsNullOrWhiteSpace($jsonText)) { return $false }
    $escapedPropertyName = [System.Text.RegularExpressions.Regex]::Escape($propertyName)
    $pattern = '^\s*\{\s*"' + $escapedPropertyName + '"\s*:\s*(?<token>[^,\}\s]+)'
    $match = [System.Text.RegularExpressions.Regex]::Match(
        $jsonText,
        $pattern,
        [System.Text.RegularExpressions.RegexOptions]::CultureInvariant
    )
    if (-not $match.Success) { return $false }
    return $match.Groups['token'].Value -ceq $expected.ToString([System.Globalization.CultureInfo]::InvariantCulture)
}

function Test-ControlledIdentityEmail($value) {
    if (-not (Test-MeaningfulString $value)) { return $false }
    $text = $value.ToString().Trim()
    if ($text -notmatch '^[^@\s]+@(?<domain>[^@\s]+)$') { return $false }
    $domain = $Matches['domain'].TrimEnd('.').ToLowerInvariant()
    if ($domain -in @('localhost', 'local', 'invalid')) { return $false }
    if ($domain -match '(^|\.)(example\.(com|org|net)|example|invalid|localhost|local)$') { return $false }
    return $domain.Contains('.')
}

function Test-ControlledGitRemoteUrl($value) {
    if (-not (Test-MeaningfulString $value)) { return $false }
    $text = $value.ToString().Trim()
    $remoteHost = ''
    $uri = $null
    if ([Uri]::TryCreate($text, [UriKind]::Absolute, [ref]$uri)) {
        if ($uri.Scheme -notin @('https', 'ssh') -or $uri.IsLoopback -or [string]::IsNullOrWhiteSpace($uri.Host)) { return $false }
        if ($uri.Scheme -eq 'https' -and -not [string]::IsNullOrWhiteSpace($uri.UserInfo)) { return $false }
        $remoteHost = $uri.Host
    } elseif ($text -match '^[^@\s]+@(?<host>[^:\s]+):(?<path>[^\s]+)$') {
        $remoteHost = $Matches['host']
        if ([string]::IsNullOrWhiteSpace($Matches['path'])) { return $false }
    } else {
        return $false
    }
    $normalizedHost = $remoteHost.Trim('[', ']').TrimEnd('.').ToLowerInvariant()
    if ($normalizedHost -in @('localhost', '127.0.0.1', '::1')) { return $false }
    if ($normalizedHost -match '(^|\.)(example\.(com|org|net)|example|invalid|localhost|local)$') { return $false }
    return $normalizedHost.Contains('.')
}

function Test-SignatureAssurance($assurance, [string]$label, [string]$gateId) {
    $reasons = @()
    $evidence = @()
    if (-not $assurance) {
        return [pscustomobject]@{ Reasons = @("$label signatureAssurance is missing"); Evidence = @() }
    }
    if ($assurance.method -cnotin @('CONTROLLED_SIGNING_PLATFORM_EXPORT', 'CERTIFICATE_SIGNATURE')) {
        $reasons += "$label signature assurance method is not approved"
    }
    if ($assurance.verificationStatus -cne 'VERIFIED') {
        $reasons += "$label signature assurance verificationStatus is not VERIFIED"
    }
    foreach ($field in @('provider', 'verificationId')) {
        if (-not (Test-MeaningfulString $assurance.$field)) { $reasons += "$label signature assurance $field is incomplete" }
    }
    if (-not (Test-IsoTimestamp $assurance.verifiedAt)) { $reasons += "$label signature assurance verifiedAt is missing or invalid" }
    if ($assurance.method -ceq 'CERTIFICATE_SIGNATURE' -and -not (Test-Sha256 $assurance.certificateSha256)) {
        $reasons += "$label certificateSha256 is missing or invalid"
    }
    $verificationReference = Test-EvidenceReference $assurance.verificationEvidenceUri $assurance.verificationEvidenceSha256 "$label signature verification evidence" $gateId
    $reasons += $verificationReference.Reasons
    $evidence += $verificationReference.Evidence
    return [pscustomobject]@{ Reasons = $reasons; Evidence = $evidence }
}

function Test-SpecifiedApprovals($sourceApprovals, [string[]]$requiredRoles, [string]$label, [string]$gateId) {
    $reasons = @()
    $evidence = @()
    $approvals = @($sourceApprovals)
    $signatureIds = @()
    $signerIds = @()
    $approvedCount = 0
    if ($approvals.Count -ne $requiredRoles.Count) {
        $reasons += "exactly $($requiredRoles.Count) $label approvals are required; found $($approvals.Count)"
    }
    foreach ($roleCode in $requiredRoles) {
        $matches = @($approvals | Where-Object { $_.roleCode -ceq $roleCode })
        if ($matches.Count -ne 1) {
            $reasons += "exactly one $label approval is required for $roleCode"
            continue
        }
        $approval = $matches[0]
        if ($approval.status -cne 'SIGNED' -or $approval.decision -cne 'APPROVED') {
            $reasons += "$label approval $roleCode is not SIGNED/APPROVED"
        } else {
            $approvedCount += 1
        }
        foreach ($field in @('signatureId', 'signerId', 'signerName', 'signerTitle')) {
            if (-not (Test-MeaningfulString $approval.$field)) { $reasons += "$label approval $roleCode $field is incomplete" }
        }
        if (-not (Test-IsoTimestamp $approval.signedAt) -or
            -not (Test-True $approval.signedByHuman) -or
            -not (Test-False $approval.delegated)) {
            $reasons += "$label approval $roleCode human identity/time is incomplete or delegated"
        }
        if (-not (Test-ExactIntegerValue $approval.openReservations 0)) {
            $reasons += "$label approval $roleCode has open reservations or a non-integer reservation count"
        }
        $approvalReference = Test-EvidenceReference $approval.evidenceUri $approval.evidenceSha256 "$label approval $roleCode evidence" $gateId
        $reasons += $approvalReference.Reasons
        $evidence += $approvalReference.Evidence
        $assuranceResult = Test-SignatureAssurance $approval.signatureAssurance "$label approval $roleCode" $gateId
        $reasons += $assuranceResult.Reasons
        $evidence += $assuranceResult.Evidence
        if (Test-MeaningfulString $approval.signatureId) {
            $text = $approval.signatureId.ToString()
            if ($text -cne $text.Trim()) { $reasons += "$label approval $roleCode signatureId has leading or trailing whitespace" }
            else { $signatureIds += $text.ToLowerInvariant() }
        }
        if (Test-MeaningfulString $approval.signerId) {
            $text = $approval.signerId.ToString()
            if ($text -cne $text.Trim()) { $reasons += "$label approval $roleCode signerId has leading or trailing whitespace" }
            else { $signerIds += $text.ToLowerInvariant() }
        }
    }
    if (@($signatureIds | Select-Object -Unique).Count -ne $requiredRoles.Count) {
        $reasons += "$label signatureId values must be present and unique for all $($requiredRoles.Count) approvals"
    }
    if (@($signerIds | Select-Object -Unique).Count -ne $requiredRoles.Count) {
        $reasons += "$label signerId values must identify $($requiredRoles.Count) distinct human signers"
    }
    return [pscustomobject]@{
        Reasons = $reasons
        Evidence = @($evidence | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
        ApprovedCount = $approvedCount
    }
}

$inputsFullPath = Resolve-WorkspacePath $InputsPath
$inputsError = $null
$inputs = $null
$inputsStream = $null
$consumedInputsSha256 = $null
$consumedInputsSizeBytes = $null
$consumedInputsText = $null
if (-not $inputsFullPath) {
    $inputsError = 'InputsPath must resolve to a file inside the workspace.'
} elseif (-not (Test-Path -LiteralPath $inputsFullPath -PathType Leaf)) {
    $inputsError = "file does not exist: $(Get-RelativePath $inputsFullPath)"
} else {
    try {
        $inputsStream = New-Object System.IO.FileStream(
            $inputsFullPath,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::Read
        )
        $memory = New-Object System.IO.MemoryStream
        try {
            $inputsStream.CopyTo($memory)
            $inputBytes = $memory.ToArray()
        } finally {
            $memory.Dispose()
        }
        $consumedInputsSizeBytes = $inputBytes.Length
        $consumedInputsSha256 = Get-Sha256Bytes $inputBytes
        $consumedInputsText = ConvertFrom-StrictUtf8Bytes $inputBytes
        $inputs = $consumedInputsText | ConvertFrom-Json
    } catch {
        $inputsError = "invalid or unreadable locked input JSON: $($_.Exception.Message)"
        $inputs = $null
    }
}
if ($inputs -and (-not (Test-ExactIntegerValue $inputs.schemaVersion 1) -or -not (Test-LeadingJsonExactIntegerProperty $consumedInputsText 'schemaVersion' 1))) {
    $inputsError = "inputs schemaVersion must be exact integer 1, got: $($inputs.schemaVersion)"
}
if ($inputs -and $inputs.releaseVersion -cne 'TECH-V0.2') {
    $inputsError = "inputs releaseVersion must exactly equal TECH-V0.2, got: $($inputs.releaseVersion)"
}

$checks = @()

# REL-P0-01: local worker evidence. This is intentionally a local technical gate.
$workerSummaryPath = Resolve-WorkspacePath 'docs/uat/evidence/20260718-0154-tech-v02-rc2/api/summary.json'
$workerRuntimePath = Resolve-WorkspacePath 'docs/uat/evidence/20260718-0154-tech-v02-rc2/runtime/uat-processes.json'
$workerRegressionPath = Resolve-WorkspacePath 'docs/uat/evidence/20260718-0154-tech-v02-rc2/regression/TEST-cn.sifangguan.hotelaios.shared.events.ManagementAutomationWorkerIntegrationTest.xml'
if ($inputs -and $inputs.localWorkerEvidence) {
    if (Test-MeaningfulString $inputs.localWorkerEvidence.summaryPath) {
        $workerSummaryPath = Resolve-WorkspacePath $inputs.localWorkerEvidence.summaryPath
    }
    if (Test-MeaningfulString $inputs.localWorkerEvidence.runtimeStatePath) {
        $workerRuntimePath = Resolve-WorkspacePath $inputs.localWorkerEvidence.runtimeStatePath
    }
    if (Test-MeaningfulString $inputs.localWorkerEvidence.workerRegressionXmlPath) {
        $workerRegressionPath = Resolve-WorkspacePath $inputs.localWorkerEvidence.workerRegressionXmlPath
    }
}
$workerReasons = @()
$workerEvidence = @()
$workerMetrics = [ordered]@{}
$workerSummary = $null
$workerRuntime = $null
$workerSummarySnapshot = Read-FileSnapshot $workerSummaryPath 'local worker summary' $true
if (-not $workerSummarySnapshot.Ok) {
    $workerReasons += $workerSummarySnapshot.Reason
} else {
    $workerEvidence += $workerSummarySnapshot.RelativePath
    Register-FinalEvidenceSnapshot $workerSummarySnapshot 'local worker summary' 'REL-P0-01'
    try {
        $workerSummary = ConvertFrom-StrictUtf8Bytes $workerSummarySnapshot.Bytes | ConvertFrom-Json
    } catch {
        $workerReasons += "local worker summary is invalid JSON: $($_.Exception.Message)"
    }
}
if ($workerSummary) {
    if ($workerSummary.automation.mode -ne 'scheduled-worker') { $workerReasons += 'automation.mode is not scheduled-worker' }
    $manualSlaCountValid = Test-ExactIntegerValue $workerSummary.automation.manualSlaProcessRequestCount 0
    $manualOutboxCountValid = Test-ExactIntegerValue $workerSummary.automation.manualOutboxRecoveryRequestCount 0
    $failedRequestCountValid = Test-ExactIntegerValue $workerSummary.failedRequestCount 0
    $scenarioCountValid = Test-IntegralAtLeast $workerSummary.scenarioCount 3
    if (-not $manualSlaCountValid) { $workerReasons += 'manual SLA process request count is not exact integer zero' }
    if (-not $manualOutboxCountValid) { $workerReasons += 'manual outbox recovery request count is not exact integer zero' }
    if (-not $failedRequestCountValid) { $workerReasons += 'failed request count is not exact integer zero' }
    if (-not $scenarioCountValid) { $workerReasons += 'scenario count is not an integer of at least 3' }
    $workerMetrics.runId = $workerSummary.runId
    if ($failedRequestCountValid) { $workerMetrics.failedRequestCount = [long]$workerSummary.failedRequestCount }
    if ($scenarioCountValid) { $workerMetrics.scenarioCount = [long]$workerSummary.scenarioCount }
}
$workerRuntimeSnapshot = Read-FileSnapshot $workerRuntimePath 'local worker runtime state' $true
if (-not $workerRuntimeSnapshot.Ok) {
    $workerReasons += $workerRuntimeSnapshot.Reason
} else {
    $workerEvidence += $workerRuntimeSnapshot.RelativePath
    Register-FinalEvidenceSnapshot $workerRuntimeSnapshot 'local worker runtime state' 'REL-P0-01'
    try {
        $workerRuntime = ConvertFrom-StrictUtf8Bytes $workerRuntimeSnapshot.Bytes | ConvertFrom-Json
    } catch {
        $workerReasons += "local worker runtime state is invalid JSON: $($_.Exception.Message)"
    }
}
if ($workerRuntime) {
    if (-not (Test-True $workerRuntime.scheduledAutomationWorkerEnabled)) { $workerReasons += 'scheduled automation worker was not enabled' }
    if (-not (Test-False $workerRuntime.devHeaderAuthEnabled)) { $workerReasons += 'development-header authentication was not disabled' }
    if ($workerSummary -and $workerRuntime.runId -ne $workerSummary.runId) { $workerReasons += 'summary and runtime runId values differ' }
    $workerMetrics.environmentType = $workerRuntime.environmentType
}
$workerRegressionSnapshot = Read-FileSnapshot $workerRegressionPath 'local worker regression XML' $true
if (-not $workerRegressionSnapshot.Ok) {
    $workerReasons += $workerRegressionSnapshot.Reason
} else {
    $workerEvidence += $workerRegressionSnapshot.RelativePath
    Register-FinalEvidenceSnapshot $workerRegressionSnapshot 'local worker regression XML' 'REL-P0-01'
    try {
        [xml]$workerXml = ConvertFrom-StrictUtf8Bytes $workerRegressionSnapshot.Bytes
        $workerTestsValid = Test-IntegerTextAtLeast $workerXml.testsuite.tests 1
        $workerFailuresValid = Test-ExactIntegerTextValue $workerXml.testsuite.failures 0
        $workerErrorsValid = Test-ExactIntegerTextValue $workerXml.testsuite.errors 0
        $workerSkippedValid = Test-ExactIntegerTextValue $workerXml.testsuite.skipped 0
        if (-not $workerTestsValid) { $workerReasons += 'worker regression tests count is not an integer of at least 1' }
        if (-not $workerFailuresValid) { $workerReasons += 'worker regression failures count is not exact integer zero' }
        if (-not $workerErrorsValid) { $workerReasons += 'worker regression errors count is not exact integer zero' }
        if (-not $workerSkippedValid) { $workerReasons += 'worker regression skipped count is not exact integer zero' }
        if ($workerTestsValid) { $workerMetrics.regressionTests = [long]$workerXml.testsuite.tests.ToString() }
    } catch {
        $workerReasons += "worker regression XML is invalid: $($_.Exception.Message)"
    }
}
$checks += New-Check 'REL-P0-01' 'Local background Worker evidence' $workerReasons $workerEvidence $workerMetrics

# REL-P0-02: target enterprise SSO acceptance.
$ssoReasons = @()
$ssoEvidence = @()
$ssoMetrics = [ordered]@{}
$sso = if ($inputs) { $inputs.targetSsoAcceptance } else { $null }
if ($inputsError) { $ssoReasons += "release inputs unavailable: $inputsError" }
if (-not $sso) {
    $ssoReasons += 'targetSsoAcceptance JSON object is missing'
} else {
    if (-not (Test-Approved $sso.status)) { $ssoReasons += 'target SSO status is not APPROVED' }
    if ($sso.environmentType -cnotin @('TARGET_UAT', 'TARGET_PRODUCTION')) { $ssoReasons += 'SSO was not accepted in a target environment' }
    if ($sso.providerType -cne 'ENTERPRISE_SSO') { $ssoReasons += 'providerType is not ENTERPRISE_SSO' }
    $issuerUri = $null
    if (-not [Uri]::TryCreate($sso.issuer, [UriKind]::Absolute, [ref]$issuerUri) -or
        $issuerUri.Scheme -ne 'https' -or
        $issuerUri.Host -in @('localhost', '127.0.0.1', '::1')) {
        $ssoReasons += 'issuer must be a non-local HTTPS enterprise issuer'
    }
    foreach ($field in @('claimsMappingApproved', 'sixRoleLoginPassed', 'accountLifecyclePassed', 'logoutInvalidationPassed', 'keyRotationPassed', 'negativeSecurityTestsPassed', 'tenantIsolationPassed', 'auditPassed')) {
        if (-not (Test-True $sso.$field)) { $ssoReasons += "$field is not true" }
    }
    $requiredSsoRoles = @('FRONT_DESK', 'FRONT_OFFICE_SUPERVISOR', 'HOUSEKEEPING_SUPERVISOR', 'ASSISTANT_GENERAL_MANAGER', 'GENERAL_MANAGER', 'REGIONAL_OPERATIONS')
    $roleResults = @($sso.roleResults)
    if ($roleResults.Count -ne $requiredSsoRoles.Count) {
        $ssoReasons += "target SSO must contain exactly $($requiredSsoRoles.Count) role results; found $($roleResults.Count)"
    }
    foreach ($roleCode in $requiredSsoRoles) {
        $roleResult = @($roleResults | Where-Object { $_.roleCode -ceq $roleCode })
        if ($roleResult.Count -ne 1) {
            $ssoReasons += "target SSO must contain exactly one role result for $roleCode"
            continue
        }
        if ($roleResult[0].status -cne 'PASS') { $ssoReasons += "target SSO role $roleCode did not PASS" }
        $roleEvidenceReference = Test-EvidenceReference $roleResult[0].evidenceUri $roleResult[0].evidenceSha256 "target SSO role $roleCode evidence" 'REL-P0-02'
        $ssoReasons += $roleEvidenceReference.Reasons
        $ssoEvidence += $roleEvidenceReference.Evidence
    }
    $requiredSsoApprovers = @(
        'FRONT_DESK_REPRESENTATIVE',
        'FRONT_OFFICE_SUPERVISOR_REPRESENTATIVE',
        'HOUSEKEEPING_SUPERVISOR_REPRESENTATIVE',
        'ASSISTANT_GENERAL_MANAGER_REPRESENTATIVE',
        'GENERAL_MANAGER_REPRESENTATIVE',
        'REGIONAL_OPERATIONS_REPRESENTATIVE',
        'IDENTITY_OWNER',
        'SECURITY_OWNER',
        'QA_OWNER',
        'CTO'
    )
    $ssoApprovalResult = Test-SpecifiedApprovals $sso.approvals $requiredSsoApprovers 'target SSO' 'REL-P0-02'
    $ssoReasons += $ssoApprovalResult.Reasons
    $ssoEvidence += $ssoApprovalResult.Evidence
    $ssoAcceptanceReference = Test-EvidenceReference $sso.evidenceUri $sso.evidenceSha256 'target SSO acceptance declaration' 'REL-P0-02'
    $ssoReasons += $ssoAcceptanceReference.Reasons
    $ssoEvidence += $ssoAcceptanceReference.Evidence
    $ssoArtifactResult = Test-EvidenceArtifacts $sso.evidenceArtifacts 'target SSO' 'REL-P0-02' (Test-Approved $sso.status)
    $ssoReasons += $ssoArtifactResult.Reasons
    $ssoEvidence += $ssoArtifactResult.Evidence
    $ssoMetrics.acceptedRoleCount = @($roleResults | Where-Object { $_.status -ceq 'PASS' }).Count
    $ssoMetrics.approvedHumanCount = $ssoApprovalResult.ApprovedCount
    $ssoMetrics.environmentType = $sso.environmentType
}
$checks += New-Check 'REL-P0-02' 'Target enterprise SSO acceptance' $ssoReasons $ssoEvidence $ssoMetrics

# REL-P0-03: ten human release signoffs.
$signoffReasons = @()
$signoffEvidence = @()
$signoffMetrics = [ordered]@{}
$signoff = if ($inputs) { $inputs.releaseSignoffs } else { $null }
if ($inputsError) { $signoffReasons += "release inputs unavailable: $inputsError" }
$requiredSignoffRoles = @(
    'FRONT_DESK_REPRESENTATIVE',
    'FRONT_OFFICE_SUPERVISOR_REPRESENTATIVE',
    'HOUSEKEEPING_SUPERVISOR_REPRESENTATIVE',
    'ASSISTANT_GENERAL_MANAGER_REPRESENTATIVE',
    'GENERAL_MANAGER_REPRESENTATIVE',
    'REGIONAL_OPERATIONS_REPRESENTATIVE',
    'PRODUCT_OWNER',
    'QA_OWNER',
    'CTO',
    'RELEASE_OWNER'
)
if (-not $signoff) {
    $signoffReasons += 'releaseSignoffs JSON object is missing'
} else {
    if (-not (Test-Approved $signoff.status)) { $signoffReasons += 'release signoff status is not APPROVED' }
    $signatures = @($signoff.signatures)
    if ($signatures.Count -ne 10) { $signoffReasons += "exactly 10 signatures are required; found $($signatures.Count)" }
    $signatureIds = @()
    $signerIds = @()
    foreach ($roleCode in $requiredSignoffRoles) {
        $matches = @($signatures | Where-Object { $_.roleCode -ceq $roleCode })
        if ($matches.Count -ne 1) {
            $signoffReasons += "exactly one signature is required for $roleCode"
            continue
        }
        $signature = $matches[0]
        if ($signature.status -cne 'SIGNED' -or $signature.decision -cne 'APPROVED') {
            $signoffReasons += "$roleCode is not SIGNED/APPROVED"
        }
        if (-not (Test-MeaningfulString $signature.signatureId) -or
            -not (Test-MeaningfulString $signature.signerId) -or
            -not (Test-MeaningfulString $signature.signerName) -or
            -not (Test-MeaningfulString $signature.signerTitle) -or
            -not (Test-IsoTimestamp $signature.signedAt) -or
            -not (Test-True $signature.signedByHuman) -or
            -not (Test-False $signature.delegated)) {
            $signoffReasons += "$roleCode human signature identity/time is incomplete or delegated"
        }
        $signoffSupportReference = Test-EvidenceReference $signature.evidenceUri $signature.evidenceSha256 "$roleCode signoff supporting evidence" 'REL-P0-03'
        $signoffReasons += $signoffSupportReference.Reasons
        $signoffEvidence += $signoffSupportReference.Evidence
        $signoffDeclarationReference = Test-EvidenceReference $signature.declarationUri $signature.declarationSha256 "$roleCode signoff declaration" 'REL-P0-03'
        $signoffReasons += $signoffDeclarationReference.Reasons
        $signoffEvidence += $signoffDeclarationReference.Evidence
        $signoffAssuranceResult = Test-SignatureAssurance $signature.signatureAssurance "$roleCode signoff" 'REL-P0-03'
        $signoffReasons += $signoffAssuranceResult.Reasons
        $signoffEvidence += $signoffAssuranceResult.Evidence
        if (-not (Test-ExactIntegerValue $signature.openReservations 0)) {
            $signoffReasons += "$roleCode has open reservations or a non-integer reservation count"
        }
        $signatureIds += $signature.signatureId
        $signerIds += $signature.signerId
    }
    if (@($signatureIds | Where-Object { Test-MeaningfulString $_ } | Select-Object -Unique).Count -ne 10) {
        $signoffReasons += 'signatureId values must be present and unique for all 10 signatures'
    }
    if (@($signerIds | Where-Object { Test-MeaningfulString $_ } | Select-Object -Unique).Count -ne 10) {
        $signoffReasons += '10 distinct human signerId values are required; shared or delegated signers are not accepted'
    }
    $signoffMetrics.signedApprovedCount = @($signatures | Where-Object { $_.status -ceq 'SIGNED' -and $_.decision -ceq 'APPROVED' }).Count
    $signoffMetrics.requiredCount = 10
}
$checks += New-Check 'REL-P0-03' 'Ten-party human release signoff' $signoffReasons $signoffEvidence $signoffMetrics

# REL-P0-04: real on-site photo and target attachment-chain acceptance.
$attachmentReasons = @()
$attachmentEvidence = @()
$attachmentMetrics = [ordered]@{}
$attachment = if ($inputs) { $inputs.fieldPhotoAndTargetAttachmentAcceptance } else { $null }
if ($inputsError) { $attachmentReasons += "release inputs unavailable: $inputsError" }
if (-not $attachment) {
    $attachmentReasons += 'fieldPhotoAndTargetAttachmentAcceptance JSON object is missing'
} else {
    if (-not (Test-Approved $attachment.status)) { $attachmentReasons += 'field photo/attachment status is not APPROVED' }
    if ($attachment.environmentType -cnotin @('TARGET_UAT', 'TARGET_PRODUCTION')) { $attachmentReasons += 'attachment chain was not accepted in a target environment' }
    $photo = $attachment.photo
    if (-not $photo) { $attachmentReasons += 'photo acceptance object is missing' } else {
        if ($photo.sourceType -cne 'ON_SITE_ORIGINAL') { $attachmentReasons += 'photo sourceType is not ON_SITE_ORIGINAL' }
        if (-not (Test-False $photo.synthetic)) { $attachmentReasons += 'photo must explicitly declare synthetic=false' }
        if (-not (Test-IntegralAtLeast $photo.sizeBytes 1024)) { $attachmentReasons += 'photo sizeBytes must be an integer of at least 1 KiB and cannot be the technical 1x1 fixture' }
        if (-not (Test-Sha256 $photo.sha256)) { $attachmentReasons += 'photo SHA-256 is missing or invalid' }
        if (-not (Test-True $photo.privacyReviewPassed)) { $attachmentReasons += 'photo privacy review did not pass' }
        foreach ($field in @('originalFileName', 'hotelCode', 'maskedRoom', 'capturedBy', 'issueDescription')) {
            if (-not (Test-MeaningfulString $photo.$field)) { $attachmentReasons += "photo.$field is incomplete" }
        }
        if (-not (Test-IsoTimestamp $photo.capturedAt)) { $attachmentReasons += 'photo.capturedAt is missing or invalid' }
        $photoReference = Test-EvidenceReference $photo.originalFileUri $photo.originalFileSha256 'on-site original photo' 'REL-P0-04'
        $attachmentReasons += $photoReference.Reasons
        $attachmentEvidence += $photoReference.Evidence
        $photoSnapshot = $photoReference.Snapshot
        if (-not $photoSnapshot.Ok) {
            if ($null -eq $photoSnapshot) { $attachmentReasons += 'on-site original photo byte snapshot is unavailable' }
        } else {
            if (-not (Test-IntegralAtLeast $photo.originalFileSizeBytes 1024)) {
                $attachmentReasons += 'photo originalFileSizeBytes must be an integer of at least 1 KiB'
            } elseif ([long]$photo.originalFileSizeBytes -ne $photoSnapshot.SizeBytes) {
                $attachmentReasons += 'photo originalFileSizeBytes does not match the locked original photo file size'
            }
            if ((Test-Sha256 $photo.sha256) -and $photo.sha256.ToString().ToLowerInvariant() -ne $photoSnapshot.Sha256) {
                $attachmentReasons += 'photo sha256 does not match the locked original photo file bytes'
            }
            if ((Test-IntegralAtLeast $photo.sizeBytes 1024) -and [long]$photo.sizeBytes -ne $photoSnapshot.SizeBytes) {
                $attachmentReasons += 'photo sizeBytes does not match the locked original photo file size'
            }
            $boundPhotoPath = Resolve-WorkspacePath $photo.originalFileUri
            if ($boundPhotoPath -and (Test-MeaningfulString $photo.originalFileName) -and
                -not [System.IO.Path]::GetFileName($boundPhotoPath).Equals($photo.originalFileName.ToString(), [System.StringComparison]::Ordinal)) {
                $attachmentReasons += 'photo originalFileName does not match the bound original photo file'
            }
        }
    }
    $chain = $attachment.targetAttachmentChain
    if (-not $chain) { $attachmentReasons += 'targetAttachmentChain object is missing' } else {
        if ($chain.storageType -cne 'OBJECT_STORAGE') { $attachmentReasons += 'target attachment storageType is not OBJECT_STORAGE' }
        if (-not (Test-True $chain.objectStoragePersisted)) { $attachmentReasons += 'target object storage persistence is not proven' }
        if (-not (Test-MeaningfulString $chain.objectKey)) { $attachmentReasons += 'target object key is missing' }
        if ($chain.malwareScanStatus -cne 'CLEAN') { $attachmentReasons += 'target malware scan status is not CLEAN' }
        foreach ($field in @('authorizationPassed', 'unauthorizedAccessDenied', 'encryptionAtRestPassed', 'lifecyclePolicyPassed', 'backupRestorePassed')) {
            if (-not (Test-True $chain.$field)) { $attachmentReasons += "target attachment $field is not true" }
        }
        foreach ($field in @('uploadSha256', 'downloadSha256', 'restoreSha256')) {
            if (-not (Test-Sha256 $chain.$field)) { $attachmentReasons += "target attachment $field is missing or invalid" }
        }
        if ($photo -and (Test-Sha256 $photo.sha256)) {
            foreach ($field in @('uploadSha256', 'downloadSha256', 'restoreSha256')) {
                if ($chain.$field -ne $photo.sha256) { $attachmentReasons += "$field does not match the on-site photo SHA-256" }
            }
        }
    }
    $workflow = $attachment.workflow
    foreach ($field in @('standardEvaluationPassed', 'remediationTaskCompleted', 'managerAcceptancePassed')) {
        if (-not $workflow -or -not (Test-True $workflow.$field)) { $attachmentReasons += "workflow.$field is not true" }
    }
    $requiredAttachmentApprovers = @('HOUSEKEEPING_SUPERVISOR', 'GENERAL_MANAGER', 'QA_OWNER', 'SECURITY_OPERATIONS_OWNER')
    $approvals = @($attachment.approvals)
    if ($approvals.Count -ne $requiredAttachmentApprovers.Count) {
        $attachmentReasons += "exactly $($requiredAttachmentApprovers.Count) attachment approvals are required; found $($approvals.Count)"
    }
    foreach ($roleCode in $requiredAttachmentApprovers) {
        $approvalMatches = @($approvals | Where-Object { $_.roleCode -ceq $roleCode })
        if ($approvalMatches.Count -ne 1) {
            $attachmentReasons += "exactly one attachment approval is required for $roleCode"
            continue
        }
        $approval = $approvalMatches[0]
        if (-not (Test-Approved $approval.status) -or -not (Test-MeaningfulString $approval.signerName) -or
            -not (Test-IsoTimestamp $approval.signedAt) -or -not (Test-True $approval.signedByHuman) -or
            -not (Test-False $approval.delegated)) {
            $attachmentReasons += "$roleCode attachment approval is incomplete, non-human or delegated"
        }
        $attachmentApprovalReference = Test-EvidenceReference $approval.evidenceUri $approval.evidenceSha256 "attachment approval $roleCode evidence" 'REL-P0-04'
        $attachmentReasons += $attachmentApprovalReference.Reasons
        $attachmentEvidence += $attachmentApprovalReference.Evidence
        $attachmentAssuranceResult = Test-SignatureAssurance $approval.signatureAssurance "attachment approval $roleCode" 'REL-P0-04'
        $attachmentReasons += $attachmentAssuranceResult.Reasons
        $attachmentEvidence += $attachmentAssuranceResult.Evidence
    }
    $attachmentAcceptanceReference = Test-EvidenceReference $attachment.evidenceUri $attachment.evidenceSha256 'field photo/attachment acceptance declaration' 'REL-P0-04'
    $attachmentReasons += $attachmentAcceptanceReference.Reasons
    $attachmentEvidence += $attachmentAcceptanceReference.Evidence
    $attachmentArtifactResult = Test-EvidenceArtifacts $attachment.evidenceArtifacts 'field photo/attachment' 'REL-P0-04' (Test-Approved $attachment.status)
    $attachmentReasons += $attachmentArtifactResult.Reasons
    $attachmentEvidence += $attachmentArtifactResult.Evidence
    $attachmentMetrics.photoSizeBytes = if ($photo -and (Test-IntegralAtLeast $photo.sizeBytes 0)) { [long]$photo.sizeBytes } else { 0 }
    $attachmentMetrics.originalFileSizeBytes = if ($photoSnapshot -and $photoSnapshot.Ok) { [long]$photoSnapshot.SizeBytes } else { 0 }
    $attachmentMetrics.originalFileSha256 = if ($photoSnapshot -and $photoSnapshot.Ok) { $photoSnapshot.Sha256 } else { '' }
    $attachmentMetrics.approvedRoleCount = @($approvals | Where-Object { $_.status -ceq 'APPROVED' }).Count
}
$checks += New-Check 'REL-P0-04' 'On-site photo and target attachment-chain acceptance' $attachmentReasons $attachmentEvidence $attachmentMetrics

# REL-P0-05: Git HEAD/tag and source-to-artifact integrity.
$traceReasons = @()
$traceEvidence = @()
$traceMetrics = [ordered]@{}
$trace = if ($inputs) { $inputs.sourceTraceability } else { $null }
if ($inputsError) { $traceReasons += "release inputs unavailable: $inputsError" }
if (-not $trace) { $traceReasons += 'sourceTraceability JSON object is missing' }
$rcTagValue = if ($trace) { $trace.rcTag } else { $null }
$rcTag = if ($rcTagValue -is [string]) { $rcTagValue } else { '' }
$manifestPath = Resolve-WorkspacePath $(if ($trace -and (Test-MeaningfulString $trace.artifactManifestPath)) { $trace.artifactManifestPath } else { '.uat-runtime/release-artifacts/reproducibility-rc3-formal/build-1/manifest.json' })
$sumsPath = Resolve-WorkspacePath $(if ($trace -and (Test-MeaningfulString $trace.sha256SumsPath)) { $trace.sha256SumsPath } else { '.uat-runtime/release-artifacts/reproducibility-rc3-formal/build-1/SHA256SUMS.txt' })
if ($rcTagValue -isnot [string] -or $rcTag -cnotmatch '^TECH-V0\.2-rc\.[0-9]+$') { $traceReasons += 'rcTag must be a canonical string matching TECH-V0.2-rc.N' }

$gitPath = Resolve-Git
$headCommit = $null
$actualRemoteName = ''
$actualRemoteUrl = ''
$actualRemoteBranch = ''
$headCommitterTimestamp = $null
if (-not $gitPath) {
    $traceReasons += 'Git executable was not found'
} else {
    $inside = Invoke-GitReadOnly $gitPath @('rev-parse', '--is-inside-work-tree')
    if ($inside.ExitCode -ne 0 -or $inside.Output -ne 'true') {
        $traceReasons += 'workspace is not a valid Git work tree'
    } else {
        $head = Invoke-GitReadOnly $gitPath @('rev-parse', '--verify', 'HEAD')
        if ($head.ExitCode -ne 0 -or $head.Output -notmatch '^(?:[0-9a-f]{40}|[0-9a-f]{64})$') {
            $traceReasons += 'Git HEAD is missing or invalid'
        } else {
            $headCommit = $head.Output
            $traceMetrics.headCommit = $headCommit
        }
        $status = Invoke-GitReadOnly $gitPath @('status', '--porcelain=v1', '--untracked-files=normal')
        if ($status.ExitCode -ne 0) {
            $traceReasons += 'Git work-tree cleanliness could not be verified'
        } elseif (-not [string]::IsNullOrWhiteSpace($status.Output)) {
            $traceReasons += 'Git work tree is not clean'
        }
        $tagType = Invoke-GitReadOnly $gitPath @('cat-file', '-t', "refs/tags/$rcTag")
        if ($tagType.ExitCode -ne 0) {
            $traceReasons += "RC tag does not exist: $rcTag"
        } elseif ($tagType.Output -ne 'tag') {
            $traceReasons += "RC tag is not annotated: $rcTag"
        }
        $tagCommit = Invoke-GitReadOnly $gitPath @('rev-list', '-n', '1', $rcTag)
        if ($tagCommit.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($tagCommit.Output)) {
            $traceReasons += "RC tag commit could not be resolved: $rcTag"
        } elseif ($headCommit -and $tagCommit.Output -ne $headCommit) {
            $traceReasons += 'RC tag does not point to the current HEAD commit'
        }

        $upstream = Invoke-GitReadOnly $gitPath @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}')
        if ($upstream.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($upstream.Output)) {
            $traceReasons += 'Git HEAD has no remote-tracking upstream'
        } elseif ($upstream.Output -notmatch '^(?<remote>[^/]+)/(?<branch>.+)$') {
            $traceReasons += 'Git remote-tracking upstream could not be parsed'
        } else {
            $actualRemoteName = $Matches['remote']
            $actualRemoteBranch = $Matches['branch']
            if (-not (Test-MeaningfulString $trace.remoteName) -or $trace.remoteName.ToString() -cne $actualRemoteName) {
                $traceReasons += 'sourceTraceability.remoteName does not equal the Git HEAD upstream remote'
            }
            if (-not (Test-MeaningfulString $trace.remoteBranch) -or $trace.remoteBranch.ToString() -cne $actualRemoteBranch) {
                $traceReasons += 'sourceTraceability.remoteBranch does not equal the Git HEAD upstream branch'
            }
            $upstreamCommit = Invoke-GitReadOnly $gitPath @('rev-parse', '--verify', '@{upstream}^{commit}')
            if ($upstreamCommit.ExitCode -ne 0 -or $upstreamCommit.Output -notmatch '^(?:[0-9a-f]{40}|[0-9a-f]{64})$') {
                $traceReasons += 'Git remote-tracking upstream commit could not be resolved'
            } elseif ($headCommit -and $upstreamCommit.Output -ne $headCommit) {
                $traceReasons += 'Git HEAD does not equal its remote-tracking upstream commit'
            }
            $remoteFetchUrlsResult = Invoke-GitReadOnly $gitPath @('remote', 'get-url', '--all', $actualRemoteName)
            $remotePushUrlsResult = Invoke-GitReadOnly $gitPath @('remote', 'get-url', '--push', '--all', $actualRemoteName)
            $remoteFetchUrls = if ($remoteFetchUrlsResult.ExitCode -eq 0) { @($remoteFetchUrlsResult.Output -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) } else { @() }
            $remotePushUrls = if ($remotePushUrlsResult.ExitCode -eq 0) { @($remotePushUrlsResult.Output -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) } else { @() }
            if ($remoteFetchUrls.Count -ne 1) {
                $traceReasons += "controlled Git remote must have exactly one fetch URL; found $($remoteFetchUrls.Count)"
            }
            if ($remotePushUrls.Count -ne 1) {
                $traceReasons += "controlled Git remote must have exactly one push URL; found $($remotePushUrls.Count)"
            }
            if ($remoteFetchUrls.Count -eq 1 -and $remotePushUrls.Count -eq 1 -and
                (-not (Test-ControlledGitRemoteUrl $remoteFetchUrls[0]) -or
                -not (Test-ControlledGitRemoteUrl $remotePushUrls[0]) -or
                $remoteFetchUrls[0] -cne $remotePushUrls[0])) {
                $traceReasons += 'controlled Git remote fetch and push URLs must be the same controlled HTTPS/SSH URL'
            }
            if ($remoteFetchUrls.Count -eq 1 -and $remotePushUrls.Count -eq 1 -and
                (Test-ControlledGitRemoteUrl $remoteFetchUrls[0]) -and
                (Test-ControlledGitRemoteUrl $remotePushUrls[0]) -and
                $remoteFetchUrls[0] -ceq $remotePushUrls[0]) {
                $actualRemoteUrl = $remoteFetchUrls[0]
                if (-not (Test-MeaningfulString $trace.remoteUrl) -or $trace.remoteUrl.ToString() -cne $actualRemoteUrl) {
                    $traceReasons += 'sourceTraceability.remoteUrl does not equal both controlled Git fetch and push URLs'
                }
                $traceMetrics.remoteName = $actualRemoteName
                $traceMetrics.remoteBranch = $actualRemoteBranch
            } else {
                $traceReasons += 'Git HEAD upstream is not backed by one consistent controlled fetch/push remote URL'
            }
        }

        $identity = Invoke-GitReadOnly $gitPath @('show', '-s', '--format=%an%x1f%ae%x1f%cn%x1f%ce', 'HEAD')
        $identityParts = if ($identity.ExitCode -eq 0) { @($identity.Output -split [regex]::Escape(([string][char]0x1f))) } else { @() }
        if ($identityParts.Count -ne 4) {
            $traceReasons += 'Git HEAD author and committer identities could not be resolved'
        } else {
            $actualAuthorName = $identityParts[0]
            $actualAuthorEmail = $identityParts[1]
            $actualCommitterName = $identityParts[2]
            $actualCommitterEmail = $identityParts[3]
            if (-not (Test-MeaningfulString $actualAuthorName) -or -not (Test-ControlledIdentityEmail $actualAuthorEmail)) {
                $traceReasons += 'Git HEAD author identity is incomplete or not controlled'
            }
            if (-not (Test-MeaningfulString $actualCommitterName) -or -not (Test-ControlledIdentityEmail $actualCommitterEmail)) {
                $traceReasons += 'Git HEAD committer identity is incomplete or not controlled'
            }
            if (-not (Test-MeaningfulString $trace.commitAuthorName) -or $trace.commitAuthorName.ToString() -cne $actualAuthorName -or
                -not (Test-ControlledIdentityEmail $trace.commitAuthorEmail) -or $trace.commitAuthorEmail.ToString() -cne $actualAuthorEmail) {
                $traceReasons += 'sourceTraceability commit author identity does not equal Git HEAD'
            }
            if (-not (Test-MeaningfulString $trace.commitCommitterName) -or $trace.commitCommitterName.ToString() -cne $actualCommitterName -or
                -not (Test-ControlledIdentityEmail $trace.commitCommitterEmail) -or $trace.commitCommitterEmail.ToString() -cne $actualCommitterEmail) {
                $traceReasons += 'sourceTraceability commit committer identity does not equal Git HEAD'
            }
            $committerTimestamp = Invoke-GitReadOnly $gitPath @('show', '-s', '--format=%cI', 'HEAD')
            $parsedCommitterTimestamp = [DateTimeOffset]::MinValue
            if ($committerTimestamp.ExitCode -ne 0 -or
                -not [DateTimeOffset]::TryParse($committerTimestamp.Output, [ref]$parsedCommitterTimestamp)) {
                $traceReasons += 'Git HEAD committer timestamp could not be resolved'
            } else {
                $headCommitterTimestamp = $parsedCommitterTimestamp
            }
        }
    }
}

$repositoryApprovalResult = Test-SpecifiedApprovals @($trace.repositoryApproval) @('REPOSITORY_OWNER') 'repository ownership' 'REL-P0-05'
$traceReasons += $repositoryApprovalResult.Reasons
$traceEvidence += $repositoryApprovalResult.Evidence
$traceMetrics.repositoryOwnerApprovalCount = $repositoryApprovalResult.ApprovedCount

$manifestSnapshotBefore = Read-FileSnapshot $manifestPath 'artifact manifest' $true
if (-not $manifestSnapshotBefore.Ok) { $traceReasons += $manifestSnapshotBefore.Reason }
$manifestError = $null
$manifestText = $null
$manifest = $null
if ($manifestSnapshotBefore.Ok) {
    try {
        $manifestText = ConvertFrom-StrictUtf8Bytes $manifestSnapshotBefore.Bytes
        $manifest = $manifestText | ConvertFrom-Json
    } catch {
        $manifestError = "invalid JSON: $($_.Exception.Message)"
    }
} else {
    $manifestError = $manifestSnapshotBefore.Reason
}
$backendArtifactSha = $null
if ($manifestError) {
    $traceReasons += "artifact manifest: $manifestError"
} else {
    $traceEvidence += Get-RelativePath $manifestPath
    if (-not (Test-ExactIntegerValue $manifest.schemaVersion 1) -or -not (Test-LeadingJsonExactIntegerProperty $manifestText 'schemaVersion' 1)) { $traceReasons += 'manifest schemaVersion must be exact integer 1' }
    if ($manifest.releaseVersion -cne $rcTag) { $traceReasons += "manifest releaseVersion does not exactly equal rcTag ($rcTag)" }
    if ($manifest.versions.database -ne 'DB-V13') { $traceReasons += 'manifest database version is not DB-V13' }
    if ($manifest.versions.apiBase -ne '/api/v1') { $traceReasons += 'manifest API base is not /api/v1' }
    if (-not $headCommit -or $manifest.source.commit -ne $headCommit) { $traceReasons += 'manifest source.commit does not equal Git HEAD' }
    if (-not (Test-False $manifest.source.dirty)) { $traceReasons += 'manifest source.dirty is not boolean false' }
    $artifacts = @($manifest.artifacts)
    $requiredArtifactNames = @(
        "hotel-ai-os-core-api-$rcTag.jar",
        "hotel-ai-os-web-$rcTag.zip",
        "hotel-ai-os-db-v13-$rcTag.zip",
        "hotel-ai-os-openapi-$rcTag.yaml",
        "hotel-ai-os-api-$rcTag.md"
    )
    if ($artifacts.Count -ne $requiredArtifactNames.Count) {
        $traceReasons += "manifest must contain exactly $($requiredArtifactNames.Count) release artifacts; found $($artifacts.Count)"
    }
    $artifactFileNames = @()
    foreach ($artifact in $artifacts) {
        if ($artifact.file -is [string]) { $artifactFileNames += $artifact.file } else { $artifactFileNames += '' }
    }
    $normalizedArtifactFileNames = @($artifactFileNames | ForEach-Object { $_.ToLowerInvariant() })
    if (@($normalizedArtifactFileNames | Select-Object -Unique).Count -ne $artifactFileNames.Count) {
        $traceReasons += 'artifact filenames must be unique'
    }
    foreach ($requiredArtifactName in $requiredArtifactNames) {
        if (@($artifactFileNames | Where-Object { $_ -ceq $requiredArtifactName }).Count -ne 1) {
            $traceReasons += "exactly one required release artifact is required: $requiredArtifactName"
        }
    }
    $artifactDirectory = Split-Path -Parent $manifestPath
    $fingerprintParts = @()
    foreach ($artifact in $artifacts) {
        $fileName = $artifact.file
        if ($fileName -isnot [string] -or -not (Test-MeaningfulString $fileName) -or [System.IO.Path]::GetFileName($fileName) -cne $fileName) {
            $traceReasons += 'manifest contains an unsafe or empty artifact filename'
            continue
        }
        if (-not (Test-Sha256 $artifact.sha256)) {
            $traceReasons += "manifest SHA-256 is invalid for $fileName"
            continue
        }
        $artifactPath = Join-Path $artifactDirectory $fileName
        $artifactSnapshot = Read-FileSnapshot $artifactPath "release artifact $fileName"
        if (-not $artifactSnapshot.Ok) {
            $traceReasons += $artifactSnapshot.Reason
            continue
        }
        $traceEvidence += $artifactSnapshot.RelativePath
        $actualHash = $artifactSnapshot.Sha256
        $script:TechV02FinalEvidenceReferences += [pscustomobject]@{
            GateId = 'REL-P0-05'
            Label = "release artifact $fileName"
            Uri = $artifactSnapshot.RelativePath
            ExpectedSha256 = $artifact.sha256.ToString().ToLowerInvariant()
            InitialSha256 = $artifactSnapshot.Sha256
            InitialSizeBytes = $artifactSnapshot.SizeBytes
        }
        if ($actualHash -ne $artifact.sha256.ToString().ToLowerInvariant()) {
            $traceReasons += "artifact SHA-256 mismatch: $fileName"
        }
        if (-not (Test-IntegralAtLeast $artifact.sizeBytes 0) -or $artifactSnapshot.SizeBytes -ne [long]$artifact.sizeBytes) {
            $traceReasons += "artifact size mismatch: $fileName"
        }
        if ($fileName -ceq "hotel-ai-os-core-api-$rcTag.jar") { $backendArtifactSha = $actualHash }
        $fingerprintParts += "$fileName`:$($artifact.sha256.ToString().ToLowerInvariant())"
    }
    if ($fingerprintParts.Count -gt 0) {
        $payloadFingerprint = Get-Sha256Text ($fingerprintParts -join "`n")
        if ($payloadFingerprint -ne $manifest.reproducibleBuild.payloadFingerprintSha256) {
            $traceReasons += 'manifest payload fingerprint does not match artifact entries'
        }
        $traceMetrics.payloadFingerprintSha256 = $payloadFingerprint
    }
    $traceMetrics.artifactCount = $artifacts.Count
}

if (-not $sumsPath -or -not (Test-Path -LiteralPath $sumsPath -PathType Leaf)) {
    $traceReasons += 'SHA256SUMS.txt is missing'
} elseif ($manifest) {
    $sumsSnapshot = Read-FileSnapshot $sumsPath 'SHA256SUMS' $true
    if (-not $sumsSnapshot.Ok) {
        $traceReasons += $sumsSnapshot.Reason
    } else {
        $traceEvidence += $sumsSnapshot.RelativePath
        Register-FinalEvidenceSnapshot $sumsSnapshot 'SHA256SUMS' 'REL-P0-05'
        $sumMap = @{}
        $sumsText = [System.Text.Encoding]::ASCII.GetString($sumsSnapshot.Bytes)
        foreach ($line in @($sumsText -split "\r?\n")) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            if ($line -notmatch '^([0-9a-fA-F]{64})\s{2}(.+)$') {
                $traceReasons += "invalid SHA256SUMS line: $line"
                continue
            }
            $sumMap[$Matches[2]] = $Matches[1].ToLowerInvariant()
        }
        foreach ($artifact in @($manifest.artifacts)) {
            if (-not $sumMap.ContainsKey($artifact.file) -or $sumMap[$artifact.file] -ne $artifact.sha256.ToString().ToLowerInvariant()) {
                $traceReasons += "SHA256SUMS does not match manifest for $($artifact.file)"
            }
        }
    }
}
$manifestSnapshotAfter = Read-FileSnapshot $manifestPath 'artifact manifest'
$manifestActualSha256 = ''
if (-not $manifestSnapshotAfter.Ok) {
    $traceReasons += $manifestSnapshotAfter.Reason
} elseif ($manifestSnapshotBefore.Ok -and
    ($manifestSnapshotBefore.Sha256 -ne $manifestSnapshotAfter.Sha256 -or $manifestSnapshotBefore.SizeBytes -ne $manifestSnapshotAfter.SizeBytes)) {
    $traceReasons += 'artifact manifest changed while the release gate was evaluating it'
} else {
    $manifestActualSha256 = $manifestSnapshotAfter.Sha256
    $script:TechV02FinalEvidenceReferences += [pscustomobject]@{
        GateId = 'REL-P0-05'
        Label = 'artifact manifest'
        Uri = $manifestSnapshotAfter.RelativePath
        ExpectedSha256 = $manifestSnapshotAfter.Sha256
        InitialSha256 = $manifestSnapshotAfter.Sha256
        InitialSizeBytes = $manifestSnapshotAfter.SizeBytes
    }
}

$repositoryApproval = if ($trace) { $trace.repositoryApproval } else { $null }
if (-not $repositoryApproval) {
    foreach ($field in @('approvedRemoteUrl', 'approvedRemoteBranch', 'approvedHeadCommit', 'approvedRcTag', 'approvedArtifactManifestSha256', 'remotePublishedAt')) {
        $traceReasons += "repository approval $field is missing"
    }
} else {
    if (-not (Test-ControlledGitRemoteUrl $repositoryApproval.approvedRemoteUrl) -or
        [string]::IsNullOrWhiteSpace($actualRemoteUrl) -or
        $repositoryApproval.approvedRemoteUrl.ToString() -cne $actualRemoteUrl) {
        $traceReasons += 'repository approval approvedRemoteUrl does not equal the controlled Git remote URL'
    }
    if (-not (Test-MeaningfulString $repositoryApproval.approvedRemoteBranch) -or
        [string]::IsNullOrWhiteSpace($actualRemoteBranch) -or
        $repositoryApproval.approvedRemoteBranch.ToString() -cne $actualRemoteBranch) {
        $traceReasons += 'repository approval approvedRemoteBranch does not equal the Git HEAD upstream branch'
    }
    if ($repositoryApproval.approvedHeadCommit -notmatch '^(?:[0-9a-f]{40}|[0-9a-f]{64})$' -or
        [string]::IsNullOrWhiteSpace($headCommit) -or
        $repositoryApproval.approvedHeadCommit.ToString() -cne $headCommit) {
        $traceReasons += 'repository approval approvedHeadCommit does not equal Git HEAD'
    }
    if (-not (Test-MeaningfulString $repositoryApproval.approvedRcTag) -or
        $repositoryApproval.approvedRcTag.ToString() -cne $rcTag) {
        $traceReasons += 'repository approval approvedRcTag does not equal the evaluated annotated RC tag'
    }
    if (-not (Test-Sha256 $repositoryApproval.approvedArtifactManifestSha256) -or
        [string]::IsNullOrWhiteSpace($manifestActualSha256) -or
        $repositoryApproval.approvedArtifactManifestSha256.ToString().ToLowerInvariant() -cne $manifestActualSha256) {
        $traceReasons += 'repository approval approvedArtifactManifestSha256 does not equal the locked artifact manifest bytes'
    }
    $remotePublishedAt = [DateTimeOffset]::MinValue
    $repositorySignedAt = [DateTimeOffset]::MinValue
    if (-not (Test-IsoTimestamp $repositoryApproval.remotePublishedAt) -or
        -not [DateTimeOffset]::TryParse($repositoryApproval.remotePublishedAt.ToString(), [ref]$remotePublishedAt)) {
        $traceReasons += 'repository approval remotePublishedAt is missing or invalid'
    } else {
        if ($headCommitterTimestamp -and $remotePublishedAt -lt $headCommitterTimestamp) {
            $traceReasons += 'repository approval remotePublishedAt predates the Git HEAD committer timestamp'
        }
        if ((Test-IsoTimestamp $repositoryApproval.signedAt) -and
            [DateTimeOffset]::TryParse($repositoryApproval.signedAt.ToString(), [ref]$repositorySignedAt) -and
            $remotePublishedAt -gt $repositorySignedAt) {
            $traceReasons += 'repository approval was signed before remotePublishedAt'
        }
    }
}
$traceMetrics.rcTag = $rcTag
$traceMetrics.backendArtifactSha256 = $backendArtifactSha
$traceMetrics.artifactManifestSha256 = $manifestActualSha256
$checks += New-Check 'REL-P0-05' 'Git and source-to-artifact traceability' $traceReasons $traceEvidence $traceMetrics

# REL-P0-06: persistent target environment operations acceptance.
$operationsReasons = @()
$operationsEvidence = @()
$operationsMetrics = [ordered]@{}
$operations = if ($inputs) { $inputs.targetOperationsAcceptance } else { $null }
if ($inputsError) { $operationsReasons += "release inputs unavailable: $inputsError" }
if (-not $operations) {
    $operationsReasons += 'targetOperationsAcceptance JSON object is missing'
} else {
    if (-not (Test-Approved $operations.status)) { $operationsReasons += 'target operations status is not APPROVED' }
    if ($operations.environmentType -cnotin @('TARGET_UAT', 'TARGET_PRODUCTION')) { $operationsReasons += 'operations were not accepted in a target environment' }
    if (-not (Test-True $operations.persistentDatabase)) { $operationsReasons += 'persistent target database is not proven' }
    if ($operations.databaseVersion -ne 'DB-V13' -or -not (Test-IntegralAtLeast $operations.successfulMigrations 13)) {
        $operationsReasons += 'target database is not verified at DB-V13 / 13 successful migrations'
    }
    if (-not (Test-IntegralAtLeast $operations.forcedRlsTables 49)) { $operationsReasons += 'target database has fewer than 49 forced-RLS tables or the count is not an integer' }
    foreach ($field in @('dataIntegrityStrategyApproved', 'backupRetentionPolicyApproved', 'scheduledBackupPassed', 'backupEncryptionPassed', 'restoreDrillPassed', 'rollbackDrillPassed', 'rpoRtoApproved', 'rpoMet', 'rtoMet', 'monitoringPassed', 'alertingPassed', 'workerHealthPassed', 'healthChecksPassed', 'rollbackRunbookApproved')) {
        if (-not (Test-True $operations.$field)) { $operationsReasons += "$field is not true" }
    }
    if (-not (Test-True $operations.dataChecksumsEnabled) -and -not (Test-True $operations.equivalentIntegrityControlPassed)) {
        $operationsReasons += 'neither PostgreSQL data checksums nor an approved equivalent integrity control passed'
    }
    $approvedRetentionValid = Test-IntegralAtLeast $operations.approvedBackupRetentionDays 1
    $actualRetentionValid = Test-IntegralAtLeast $operations.backupRetentionDays 0
    $approvedRetentionDays = if ($approvedRetentionValid) { [long]$operations.approvedBackupRetentionDays } else { 0 }
    $actualRetentionDays = if ($actualRetentionValid) { [long]$operations.backupRetentionDays } else { 0 }
    if (-not $approvedRetentionValid) { $operationsReasons += 'approved backup retention policy is missing or is not an integer' }
    if (-not $actualRetentionValid -or ($approvedRetentionValid -and $actualRetentionDays -lt $approvedRetentionDays)) { $operationsReasons += 'actual backup retention is invalid or below the approved policy' }
    if (-not (Test-Sha256 $operations.deployedBackendArtifactSha256)) {
        $operationsReasons += 'deployed backend artifact SHA-256 is missing or invalid'
    } elseif ($backendArtifactSha -and $operations.deployedBackendArtifactSha256.ToLowerInvariant() -ne $backendArtifactSha) {
        $operationsReasons += 'target deployed backend SHA-256 does not match the release manifest'
    }
    $requiredOperationsApprovers = @(
        'BUSINESS_OWNER',
        'PRODUCT_OWNER',
        'OPERATIONS_OWNER',
        'DBA_OWNER',
        'OBJECT_STORAGE_OWNER',
        'SECURITY_OWNER',
        'MONITORING_ONCALL_OWNER',
        'QA_OWNER',
        'CTO',
        'RELEASE_OWNER'
    )
    $operationsApprovalResult = Test-SpecifiedApprovals $operations.approvals $requiredOperationsApprovers 'target operations' 'REL-P0-06'
    $operationsReasons += $operationsApprovalResult.Reasons
    $operationsEvidence += $operationsApprovalResult.Evidence
    $operationsAcceptanceReference = Test-EvidenceReference $operations.evidenceUri $operations.evidenceSha256 'target operations acceptance declaration' 'REL-P0-06'
    $operationsReasons += $operationsAcceptanceReference.Reasons
    $operationsEvidence += $operationsAcceptanceReference.Evidence
    $operationsArtifactResult = Test-EvidenceArtifacts $operations.evidenceArtifacts 'target operations' 'REL-P0-06' (Test-Approved $operations.status)
    $operationsReasons += $operationsArtifactResult.Reasons
    $operationsEvidence += $operationsArtifactResult.Evidence
    $operationsMetrics.environmentType = $operations.environmentType
    $operationsMetrics.databaseVersion = $operations.databaseVersion
    $operationsMetrics.approvedBackupRetentionDays = $approvedRetentionDays
    $operationsMetrics.backupRetentionDays = $actualRetentionDays
    $operationsMetrics.approvedHumanCount = $operationsApprovalResult.ApprovedCount
}
$checks += New-Check 'REL-P0-06' 'Persistent target environment and operations acceptance' $operationsReasons $operationsEvidence $operationsMetrics

$finalEvidenceReferencesRevalidated = 0
foreach ($reference in @($script:TechV02FinalEvidenceReferences)) {
    $finalReasons = @()
    $finalSnapshot = Read-FileSnapshot $reference.Uri "$($reference.Label) final revalidation"
    if (-not $finalSnapshot.Ok) {
        $finalReasons += $finalSnapshot.Reason
    } else {
        if ($finalSnapshot.Sha256 -cne $reference.ExpectedSha256) {
            $finalReasons += "$($reference.Label) SHA-256 changed before final gate decision"
        }
        if ($finalSnapshot.Sha256 -cne $reference.InitialSha256 -or $finalSnapshot.SizeBytes -ne $reference.InitialSizeBytes) {
            $finalReasons += "$($reference.Label) file bytes or size changed during final gate evaluation"
        }
        $finalEvidenceReferencesRevalidated += 1
    }
    if ($finalReasons.Count -gt 0) {
        $targetChecks = @($checks | Where-Object { $_.id -ceq $reference.GateId })
        if ($targetChecks.Count -eq 1) {
            $targetChecks[0].reasons = @($targetChecks[0].reasons) + $finalReasons
            $targetChecks[0].status = 'BLOCKED'
        }
    }
}

$passed = @($checks | Where-Object { $_.status -ceq 'PASS' }).Count
$blocked = @($checks | Where-Object { $_.status -ceq 'BLOCKED' }).Count
$result = [ordered]@{
    schemaVersion = 1
    releaseVersion = 'TECH-V0.2'
    evaluatedAt = $evaluatedAt
    evaluator = 'read-only-release-gate'
    inputsPath = if ($inputsFullPath) { Get-RelativePath $inputsFullPath } else { $InputsPath }
    consumedInputsSha256 = $consumedInputsSha256
    consumedInputsSizeBytes = $consumedInputsSizeBytes
    inputsStatus = if ($inputsError) { 'BLOCKED' } else { 'LOADED' }
    inputsError = $inputsError
    status = if ($blocked -eq 0 -and $passed -eq 6) { 'PASS' } else { 'BLOCKED' }
    summary = [ordered]@{
        total = 6
        passed = $passed
        blocked = $blocked
    }
    checks = $checks
    safeguards = [ordered]@{
        readOnly = $true
        inputBytesLockedDuringEvaluation = $null -ne $inputsStream
        finalEvidenceReferencesRevalidated = $finalEvidenceReferencesRevalidated
        signaturesCreated = 0
        approvalsCreated = 0
        commitsCreated = 0
        tagsCreated = 0
        releaseStatusModified = $false
        networkWrites = 0
        failClosed = $true
    }
}

$resultJson = $result | ConvertTo-Json -Depth 14
if ($inputsStream) { $inputsStream.Dispose() }
$resultJson
if ($result.status -ceq 'PASS') { exit 0 }
exit 2
