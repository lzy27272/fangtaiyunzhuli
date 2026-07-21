[CmdletBinding()]
param(
    [string]$BundlePath = '.uat-runtime/release/TECH-V0.2-EXTERNAL-EVIDENCE-BUNDLE.json',
    [string]$GateInputsPath = '',
    [switch]$AsLibrary
)

$ErrorActionPreference = 'Stop'
$script:TechV02EvidenceRepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Test-TechV02PathContainsReparsePoint([string]$candidate) {
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

function Resolve-TechV02WorkspacePath([string]$path) {
    if ([string]::IsNullOrWhiteSpace($path)) { return $null }
    $text = $path.Trim()
    if ($text -match '^[A-Za-z][A-Za-z0-9+.-]*://') { return $null }
    try {
        $candidate = if ([System.IO.Path]::IsPathRooted($text)) {
            [System.IO.Path]::GetFullPath($text)
        } else {
            [System.IO.Path]::GetFullPath((Join-Path $script:TechV02EvidenceRepoRoot $text))
        }
    } catch {
        return $null
    }
    $prefix = $script:TechV02EvidenceRepoRoot.TrimEnd('\') + '\'
    if (-not $candidate.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $null
    }
    if (Test-TechV02PathContainsReparsePoint $candidate) { return $null }
    return $candidate
}

function Get-TechV02RelativePath([string]$path) {
    if ([string]::IsNullOrWhiteSpace($path)) { return '' }
    $prefix = $script:TechV02EvidenceRepoRoot.TrimEnd('\') + '\'
    if ($path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $path.Substring($prefix.Length).Replace('\', '/')
    }
    return $path.Replace('\', '/')
}

function Get-TechV02Property($object, [string]$name, $defaultValue = $null) {
    if ($null -eq $object) { return $defaultValue }
    $property = $object.PSObject.Properties[$name]
    if ($null -eq $property) { return $defaultValue }
    return $property.Value
}

function Test-TechV02MeaningfulString($value) {
    if ($null -eq $value) { return $false }
    $text = $value.ToString().Trim()
    if ($text.Length -lt 2) { return $false }
    return $text -notmatch '^(?i:pending|todo|tbd|unknown|null|example|sample|name|title)$'
}

function Test-TechV02Sha256($value) {
    return $null -ne $value -and $value.ToString() -match '^[0-9a-fA-F]{64}$'
}

function Test-TechV02IsoTimestamp($value) {
    if (-not (Test-TechV02MeaningfulString $value)) { return $false }
    $text = $value.ToString()
    if ($text -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$') { return $false }
    $parsed = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse($text, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$parsed)) { return $false }
    return $parsed -le [DateTimeOffset]::UtcNow.AddMinutes(5)
}

function Test-TechV02True($value) {
    return $value -is [bool] -and $value
}

function Test-TechV02False($value) {
    return $value -is [bool] -and -not $value
}

function Test-TechV02Approved($value) {
    return $null -ne $value -and $value.ToString().Equals('APPROVED', [System.StringComparison]::Ordinal)
}

function Test-TechV02IntegerValue($value) {
    return (
        $value -is [byte] -or $value -is [sbyte] -or
        $value -is [int16] -or $value -is [uint16] -or
        $value -is [int32] -or $value -is [uint32] -or
        $value -is [int64] -or $value -is [uint64]
    )
}

function Test-TechV02ExactIntegerValue($value, [long]$expected) {
    return (Test-TechV02IntegerValue $value) -and [decimal]$value -eq [decimal]$expected
}

function Test-TechV02ExactStringValue($value, [string]$expected) {
    return $value -is [string] -and [string]::Equals($value, $expected, [System.StringComparison]::Ordinal)
}

function Test-TechV02ReleaseEnvelope($document, [string]$label, [string]$expectedReleaseVersion) {
    $reasons = @()
    if (-not (Test-TechV02ExactIntegerValue (Get-TechV02Property $document 'schemaVersion' $null) 1)) {
        $reasons += "$label schemaVersion must be integer 1"
    }
    if (-not (Test-TechV02ExactStringValue (Get-TechV02Property $document 'releaseVersion' $null) $expectedReleaseVersion)) {
        $reasons += "$label releaseVersion must be exactly $expectedReleaseVersion"
    }
    return [pscustomobject]@{ Reasons = $reasons }
}

function Test-TechV02CanonicalRcTag($value) {
    return $value -is [string] -and $value -cmatch '^TECH-V0\.2-rc\.[0-9]+$'
}

function Test-TechV02RequiredReleaseArtifactSet($artifacts, [string]$releaseVersion) {
    $reasons = @()
    $requiredNames = @(
        "hotel-ai-os-api-$releaseVersion.md",
        "hotel-ai-os-core-api-$releaseVersion.jar",
        "hotel-ai-os-db-v13-$releaseVersion.zip",
        "hotel-ai-os-openapi-$releaseVersion.yaml",
        "hotel-ai-os-web-$releaseVersion.zip"
    )
    $actualNames = @(@($artifacts) | ForEach-Object { (Get-TechV02Property $_ 'file' '').ToString() })
    if ($actualNames.Count -ne $requiredNames.Count) {
        $reasons += "artifact manifest must contain exactly five canonical release artifacts; found $($actualNames.Count)"
    }
    $caseInsensitiveNames = @($actualNames | ForEach-Object { $_.ToLowerInvariant() } | Select-Object -Unique)
    if ($caseInsensitiveNames.Count -ne $actualNames.Count) {
        $reasons += 'artifact manifest file names must be unique, including case-insensitive filesystem aliases'
    }
    foreach ($requiredName in $requiredNames) {
        $matches = @($actualNames | Where-Object { $_ -ceq $requiredName })
        if ($matches.Count -ne 1) {
            $reasons += "artifact manifest requires exactly one canonical artifact: $requiredName"
        }
    }
    return [pscustomobject]@{ Reasons = $reasons; RequiredNames = $requiredNames; ActualNames = $actualNames }
}

function Get-TechV02NormalizedIdentifier($value, [string]$label) {
    $reasons = @()
    if ($null -eq $value) {
        $reasons += "$label is missing"
        return [pscustomobject]@{ Valid = $false; Normalized = ''; Reasons = $reasons }
    }
    $raw = $value.ToString()
    $trimmed = $raw.Trim()
    if ($raw -ne $trimmed) { $reasons += "$label contains leading or trailing whitespace" }
    if (-not (Test-TechV02MeaningfulString $trimmed)) { $reasons += "$label is incomplete" }
    return [pscustomobject]@{
        Valid = $reasons.Count -eq 0
        Normalized = $trimmed.ToLowerInvariant()
        Reasons = $reasons
    }
}

function Get-TechV02FileSha256([string]$path) {
    $stream = [System.IO.File]::OpenRead($path)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
        $stream.Dispose()
    }
}

function Get-TechV02TextSha256([string]$text) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Get-TechV02BytesSha256([byte[]]$bytes) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Read-TechV02JsonReference([string]$path, [string]$label) {
    $reasons = @()
    $fullPath = Resolve-TechV02WorkspacePath $path
    if (-not $fullPath) {
        $reasons += "$label path is empty, remote, invalid, outside the workspace, or contains a reparse point"
        return [pscustomobject]@{ Ok = $false; Reasons = $reasons; FullPath = $null; RelativePath = ''; Sha256 = ''; SizeBytes = 0; Document = $null }
    }
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        $reasons += "$label file does not exist: $(Get-TechV02RelativePath $fullPath)"
        return [pscustomobject]@{ Ok = $false; Reasons = $reasons; FullPath = $fullPath; RelativePath = (Get-TechV02RelativePath $fullPath); Sha256 = ''; SizeBytes = 0; Document = $null }
    }
    $snapshotSha256 = ''
    $snapshotSizeBytes = 0
    try {
        $stream = New-Object System.IO.FileStream($fullPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
        try {
            $memory = New-Object System.IO.MemoryStream
            try {
                $stream.CopyTo($memory)
                $bytes = $memory.ToArray()
            } finally {
                $memory.Dispose()
            }
            $snapshotSizeBytes = $bytes.Length
            $snapshotSha256 = Get-TechV02BytesSha256 $bytes
            $strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
            $document = $strictUtf8.GetString($bytes) | ConvertFrom-Json
        } finally {
            $stream.Dispose()
        }
    } catch {
        $reasons += "$label is invalid JSON: $($_.Exception.Message)"
        return [pscustomobject]@{ Ok = $false; Reasons = $reasons; FullPath = $fullPath; RelativePath = (Get-TechV02RelativePath $fullPath); Sha256 = $snapshotSha256; SizeBytes = $snapshotSizeBytes; Document = $null }
    }
    return [pscustomobject]@{
        Ok = $true
        Reasons = @()
        FullPath = $fullPath
        RelativePath = Get-TechV02RelativePath $fullPath
        Sha256 = $snapshotSha256
        SizeBytes = $snapshotSizeBytes
        Document = $document
    }
}

function Resolve-TechV02EvidenceFile([string]$path, [string]$label) {
    $fullPath = Resolve-TechV02WorkspacePath $path
    if (-not $fullPath) {
        return [pscustomobject]@{ Ok = $false; Reason = "$label path is empty, remote, invalid, outside the workspace, or contains a reparse point"; FullPath = $null; Uri = ''; Sha256 = ''; SizeBytes = 0 }
    }
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        return [pscustomobject]@{ Ok = $false; Reason = "$label file does not exist: $(Get-TechV02RelativePath $fullPath)"; FullPath = $fullPath; Uri = (Get-TechV02RelativePath $fullPath); Sha256 = ''; SizeBytes = 0 }
    }
    try {
        $stream = New-Object System.IO.FileStream($fullPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
        try {
            $memory = New-Object System.IO.MemoryStream
            try {
                $stream.CopyTo($memory)
                $bytes = $memory.ToArray()
            } finally {
                $memory.Dispose()
            }
        } finally {
            $stream.Dispose()
        }
        return [pscustomobject]@{
            Ok = $true
            Reason = ''
            FullPath = $fullPath
            Uri = Get-TechV02RelativePath $fullPath
            Sha256 = Get-TechV02BytesSha256 $bytes
            SizeBytes = $bytes.Length
        }
    } catch {
        return [pscustomobject]@{
            Ok = $false
            Reason = "$label file could not be read as one locked byte snapshot: $($_.Exception.Message)"
            FullPath = $fullPath
            Uri = Get-TechV02RelativePath $fullPath
            Sha256 = ''
            SizeBytes = 0
        }
    }
}

function Resolve-TechV02EvidenceArtifacts($items, [string]$label, [bool]$required) {
    $reasons = @()
    $artifacts = @()
    $paths = @()
    foreach ($item in @($items)) {
        $itemPath = Get-TechV02Property $item 'path' ''
        $itemKind = Get-TechV02Property $item 'kind' 'supporting-evidence'
        $resolved = Resolve-TechV02EvidenceFile $itemPath "$label evidence"
        if (-not $resolved.Ok) {
            $reasons += $resolved.Reason
            continue
        }
        if ($paths -contains $resolved.Uri) {
            $reasons += "$label contains duplicate evidence path: $($resolved.Uri)"
            continue
        }
        $paths += $resolved.Uri
        $artifacts += [ordered]@{ kind = $itemKind; uri = $resolved.Uri; sha256 = $resolved.Sha256 }
    }
    if ($required -and $artifacts.Count -lt 1) {
        $reasons += "$label requires at least one locally hashable supporting evidence file"
    }
    return [pscustomobject]@{ Reasons = $reasons; Artifacts = $artifacts }
}

function Convert-TechV02SignatureAssurance($source, [string]$label) {
    $reasons = @()
    $output = [ordered]@{
        method = 'PENDING'
        provider = ''
        verificationId = ''
        verificationStatus = 'PENDING'
        verifiedAt = ''
        certificateSha256 = ''
        verificationEvidenceUri = ''
        verificationEvidenceSha256 = ''
    }
    $assurance = Get-TechV02Property $source 'signatureAssurance' $null
    if ($null -eq $assurance) {
        $reasons += "$label signatureAssurance object is missing"
        return [pscustomobject]@{ Reasons = $reasons; Output = $output }
    }
    foreach ($field in @('method','provider','verificationId','verificationStatus','verifiedAt','certificateSha256')) {
        $output[$field] = Get-TechV02Property $assurance $field $output[$field]
    }
    if ($output.method -cnotin @('CONTROLLED_SIGNING_PLATFORM_EXPORT','CERTIFICATE_SIGNATURE')) {
        $reasons += "$label signature assurance method is not controlled-platform export or certificate signature"
    }
    if ($output.verificationStatus -cne 'VERIFIED') { $reasons += "$label signature assurance status is not VERIFIED" }
    foreach ($field in @('provider','verificationId')) {
        if (-not (Test-TechV02MeaningfulString $output[$field])) { $reasons += "$label signature assurance $field is incomplete" }
    }
    if (-not (Test-TechV02IsoTimestamp $output.verifiedAt)) { $reasons += "$label signature assurance verifiedAt is missing or invalid" }
    if ($output.method -ceq 'CERTIFICATE_SIGNATURE' -and -not (Test-TechV02Sha256 $output.certificateSha256)) {
        $reasons += "$label certificateSha256 is missing or invalid"
    }
    $resolved = Resolve-TechV02EvidenceFile (Get-TechV02Property $assurance 'verificationEvidencePath' '') "$label signature verification evidence"
    if (-not $resolved.Ok) { $reasons += $resolved.Reason }
    $output.verificationEvidenceUri = $resolved.Uri
    $output.verificationEvidenceSha256 = $resolved.Sha256
    return [pscustomobject]@{ Reasons = $reasons; Output = $output }
}

function New-TechV02EmptyAcceptanceApproval([string]$roleCode) {
    return [ordered]@{
        roleCode = $roleCode
        signatureId = ''
        signerId = ''
        signerName = ''
        signerTitle = ''
        status = 'PENDING'
        decision = 'PENDING'
        signedAt = ''
        signedByHuman = $false
        delegated = $false
        openReservations = 0
        evidenceUri = ''
        evidenceSha256 = ''
        signatureAssurance = (Convert-TechV02SignatureAssurance $null "$roleCode approval").Output
    }
}

function Convert-TechV02AcceptanceApprovals($document, [string]$propertyName, [string[]]$requiredRoles, [string]$label) {
    $reasons = @()
    $outputs = @()
    $evidence = @()
    $signatureIds = @()
    $signerIds = @()
    $sourceApprovals = @(Get-TechV02Property $document $propertyName @())
    if ($sourceApprovals.Count -ne $requiredRoles.Count) {
        $reasons += "exactly $($requiredRoles.Count) $label approvals are required; found $($sourceApprovals.Count)"
    }
    foreach ($roleCode in $requiredRoles) {
        $matches = @($sourceApprovals | Where-Object { (Get-TechV02Property $_ 'roleCode' '') -ceq $roleCode })
        if ($matches.Count -ne 1) {
            $reasons += "exactly one $label approval is required for $roleCode"
            $outputs += New-TechV02EmptyAcceptanceApproval $roleCode
            continue
        }
        $source = $matches[0]
        $approval = New-TechV02EmptyAcceptanceApproval $roleCode
        foreach ($field in @('signatureId','signerId','signerName','signerTitle','status','decision','signedAt','signedByHuman','delegated','openReservations')) {
            $approval[$field] = Get-TechV02Property $source $field $approval[$field]
        }
        $support = Resolve-TechV02EvidenceFile (Get-TechV02Property $source 'supportingEvidencePath' '') "$label approval $roleCode supporting evidence"
        if (-not $support.Ok) { $reasons += $support.Reason }
        $approval.evidenceUri = $support.Uri
        $approval.evidenceSha256 = $support.Sha256
        if ($support.Ok) { $evidence += $support.Uri }
        $assuranceResult = Convert-TechV02SignatureAssurance $source "$label approval $roleCode"
        $reasons += $assuranceResult.Reasons
        $approval.signatureAssurance = $assuranceResult.Output
        if (Test-TechV02MeaningfulString $assuranceResult.Output.verificationEvidenceUri) {
            $evidence += $assuranceResult.Output.verificationEvidenceUri
        }
        if ($approval.status -cne 'SIGNED' -or $approval.decision -cne 'APPROVED') {
            $reasons += "$label approval $roleCode is not SIGNED/APPROVED"
        }
        $signatureIdCheck = Get-TechV02NormalizedIdentifier $approval.signatureId "$label $roleCode signatureId"
        $signerIdCheck = Get-TechV02NormalizedIdentifier $approval.signerId "$label $roleCode signerId"
        $reasons += $signatureIdCheck.Reasons
        $reasons += $signerIdCheck.Reasons
        if (-not (Test-TechV02MeaningfulString $approval.signerName) -or
            -not (Test-TechV02MeaningfulString $approval.signerTitle) -or
            -not (Test-TechV02IsoTimestamp $approval.signedAt) -or
            -not (Test-TechV02True $approval.signedByHuman) -or
            -not (Test-TechV02False $approval.delegated)) {
            $reasons += "$label approval $roleCode human identity/time is incomplete or delegated"
        }
        if (-not (Test-TechV02ExactIntegerValue $approval.openReservations 0)) {
            $reasons += "$label approval $roleCode has open reservations or a non-integer reservation count"
        }
        if ($signatureIdCheck.Valid) { $signatureIds += $signatureIdCheck.Normalized }
        if ($signerIdCheck.Valid) { $signerIds += $signerIdCheck.Normalized }
        $outputs += $approval
    }
    if (@($signatureIds | Select-Object -Unique).Count -ne $requiredRoles.Count) {
        $reasons += "$label signatureId values must be present and unique for all $($requiredRoles.Count) approvals"
    }
    if (@($signerIds | Select-Object -Unique).Count -ne $requiredRoles.Count) {
        $reasons += "$label signerId values must identify $($requiredRoles.Count) distinct human signers"
    }
    return [pscustomobject]@{ Reasons = $reasons; Approvals = $outputs; Evidence = @($evidence | Select-Object -Unique) }
}

function Test-TechV02ReferenceHeader($reference, [string]$expectedType, [string]$label) {
    $reasons = @()
    if (-not $reference.Ok -or $null -eq $reference.Document) { return $reference.Reasons }
    $envelope = Test-TechV02ReleaseEnvelope $reference.Document $label 'TECH-V0.2'
    $reasons += $envelope.Reasons
    if (-not (Test-TechV02ExactStringValue (Get-TechV02Property $reference.Document 'evidenceType' $null) $expectedType)) { $reasons += "$label evidenceType must be exactly $expectedType" }
    return $reasons
}

function New-TechV02EmptySsoOutput() {
    return [ordered]@{
        acceptanceId = ''
        status = 'PENDING'
        environmentType = 'TARGET_UAT'
        providerType = 'ENTERPRISE_SSO'
        issuer = ''
        claimsMappingApproved = $false
        sixRoleLoginPassed = $false
        accountLifecyclePassed = $false
        logoutInvalidationPassed = $false
        keyRotationPassed = $false
        negativeSecurityTestsPassed = $false
        tenantIsolationPassed = $false
        auditPassed = $false
        roleResults = @()
        approvals = @()
        evidenceUri = ''
        evidenceSha256 = ''
        evidenceArtifacts = @()
    }
}

function Convert-TechV02SsoEvidence($reference) {
    $reasons = @()
    $reasons += Test-TechV02ReferenceHeader $reference 'TARGET_SSO_ACCEPTANCE' 'target SSO evidence'
    $output = New-TechV02EmptySsoOutput
    if (-not $reference.Ok -or $null -eq $reference.Document) {
        return [pscustomobject]@{ Reasons = $reasons; Output = $output; Evidence = @() }
    }
    $document = $reference.Document
    foreach ($field in @('acceptanceId','status','environmentType','providerType','issuer','claimsMappingApproved','sixRoleLoginPassed','accountLifecyclePassed','logoutInvalidationPassed','keyRotationPassed','negativeSecurityTestsPassed','tenantIsolationPassed','auditPassed')) {
        $output[$field] = Get-TechV02Property $document $field $output[$field]
    }
    $output.evidenceUri = $reference.RelativePath
    $output.evidenceSha256 = $reference.Sha256
    if (-not (Test-TechV02Approved $output.status)) { $reasons += 'target SSO status is not APPROVED' }
    if ($output.environmentType -cnotin @('TARGET_UAT','TARGET_PRODUCTION')) { $reasons += 'target SSO environmentType is not TARGET_UAT or TARGET_PRODUCTION' }
    if ($output.providerType -cne 'ENTERPRISE_SSO') { $reasons += 'target SSO providerType is not ENTERPRISE_SSO' }
    $issuerUri = $null
    if (-not [Uri]::TryCreate($output.issuer, [UriKind]::Absolute, [ref]$issuerUri) -or
        $issuerUri.Scheme -ne 'https' -or
        $issuerUri.IsLoopback -or
        $issuerUri.Host -match '(^|\.)example\.(invalid|com)$') {
        $reasons += 'target SSO issuer must be a non-local HTTPS enterprise issuer'
    }
    foreach ($field in @('claimsMappingApproved','sixRoleLoginPassed','accountLifecyclePassed','logoutInvalidationPassed','keyRotationPassed','negativeSecurityTestsPassed','tenantIsolationPassed','auditPassed')) {
        if (-not (Test-TechV02True $output[$field])) { $reasons += "target SSO $field is not true" }
    }
    $requiredRoles = @('FRONT_DESK','FRONT_OFFICE_SUPERVISOR','HOUSEKEEPING_SUPERVISOR','ASSISTANT_GENERAL_MANAGER','GENERAL_MANAGER','REGIONAL_OPERATIONS')
    $sourceRoles = @(Get-TechV02Property $document 'roleResults' @())
    if ($sourceRoles.Count -ne $requiredRoles.Count) {
        $reasons += "target SSO requires exactly $($requiredRoles.Count) role results; found $($sourceRoles.Count)"
    }
    $roleOutputs = @()
    foreach ($roleCode in $requiredRoles) {
        $matches = @($sourceRoles | Where-Object { (Get-TechV02Property $_ 'roleCode' '') -ceq $roleCode })
        if ($matches.Count -ne 1) {
            $reasons += "target SSO requires exactly one role result for $roleCode"
            $roleOutputs += [ordered]@{ roleCode = $roleCode; status = 'PENDING'; evidenceUri = ''; evidenceSha256 = '' }
            continue
        }
        $role = $matches[0]
        $status = Get-TechV02Property $role 'status' 'PENDING'
        if ($status -cne 'PASS') { $reasons += "target SSO role $roleCode did not PASS" }
        $resolved = Resolve-TechV02EvidenceFile (Get-TechV02Property $role 'evidencePath' '') "target SSO role $roleCode"
        if (-not $resolved.Ok) { $reasons += $resolved.Reason }
        $roleOutputs += [ordered]@{ roleCode = $roleCode; status = $status; evidenceUri = $resolved.Uri; evidenceSha256 = $resolved.Sha256 }
    }
    $output.roleResults = $roleOutputs
    if (-not (Test-TechV02MeaningfulString $output.acceptanceId)) { $reasons += 'target SSO acceptanceId is incomplete' }
    $requiredApprovers = @(
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
    $approvalResult = Convert-TechV02AcceptanceApprovals $document 'approvals' $requiredApprovers 'target SSO'
    $reasons += $approvalResult.Reasons
    $output.approvals = $approvalResult.Approvals
    $artifactResult = Resolve-TechV02EvidenceArtifacts (Get-TechV02Property $document 'evidenceFiles' @()) 'target SSO' (Test-TechV02Approved $output.status)
    $reasons += $artifactResult.Reasons
    $output.evidenceArtifacts = $artifactResult.Artifacts
    return [pscustomobject]@{ Reasons = $reasons; Output = $output; Evidence = @($reference.RelativePath) + @($approvalResult.Evidence) + @($artifactResult.Artifacts | ForEach-Object { $_.uri }) }
}

function New-TechV02EmptySignature([string]$roleCode) {
    return [ordered]@{
        roleCode = $roleCode
        signatureId = ''
        signerId = ''
        signerName = ''
        signerTitle = ''
        status = 'PENDING'
        decision = 'PENDING'
        signedAt = ''
        signedByHuman = $false
        delegated = $false
        openReservations = 0
        evidenceUri = ''
        evidenceSha256 = ''
        declarationUri = ''
        declarationSha256 = ''
        signatureAssurance = (Convert-TechV02SignatureAssurance $null "release signoff $roleCode").Output
    }
}

function Convert-TechV02SignoffEvidence($bundle) {
    $reasons = @()
    $requiredRoles = @(
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
    $status = Get-TechV02Property $bundle 'releaseSignoffStatus' 'PENDING'
    if (-not (Test-TechV02Approved $status)) { $reasons += 'releaseSignoffStatus is not APPROVED' }
    $paths = @(Get-TechV02Property $bundle 'releaseSignoffPaths' @())
    if ($paths.Count -ne 10) { $reasons += "exactly 10 independent release signoff JSON paths are required; found $($paths.Count)" }
    $pathKeys = @($paths | ForEach-Object { $_.ToString().ToLowerInvariant() } | Select-Object -Unique)
    if ($pathKeys.Count -ne $paths.Count) { $reasons += 'release signoff JSON paths must be unique' }
    $records = @()
    foreach ($path in $paths) {
        $reference = Read-TechV02JsonReference $path 'release signoff'
        $recordReasons = @()
        $recordReasons += Test-TechV02ReferenceHeader $reference 'RELEASE_SIGNOFF' 'release signoff'
        $reasons += $recordReasons
        if ($reference.Ok -and $null -ne $reference.Document) {
            $records += [pscustomobject]@{ Reference = $reference; Document = $reference.Document }
        }
    }
    $outputs = @()
    $signatureIds = @()
    $signerIds = @()
    foreach ($roleCode in $requiredRoles) {
        $matches = @($records | Where-Object { (Get-TechV02Property $_.Document 'roleCode' '') -ceq $roleCode })
        if ($matches.Count -ne 1) {
            $reasons += "exactly one independent signoff JSON is required for $roleCode"
            $outputs += New-TechV02EmptySignature $roleCode
            continue
        }
        $record = $matches[0]
        $document = $record.Document
        $signature = New-TechV02EmptySignature $roleCode
        foreach ($field in @('signatureId','signerId','signerName','signerTitle','status','decision','signedAt','signedByHuman','delegated','openReservations')) {
            $signature[$field] = Get-TechV02Property $document $field $signature[$field]
        }
        $signature.declarationUri = $record.Reference.RelativePath
        $signature.declarationSha256 = $record.Reference.Sha256
        $support = Resolve-TechV02EvidenceFile (Get-TechV02Property $document 'supportingEvidencePath' '') "release signoff $roleCode supporting evidence"
        if (-not $support.Ok) { $reasons += $support.Reason }
        $signature.evidenceUri = $support.Uri
        $signature.evidenceSha256 = $support.Sha256
        $assuranceResult = Convert-TechV02SignatureAssurance $document "release signoff $roleCode"
        $reasons += $assuranceResult.Reasons
        $signature.signatureAssurance = $assuranceResult.Output
        if ($signature.status -cne 'SIGNED' -or $signature.decision -cne 'APPROVED') { $reasons += "$roleCode is not SIGNED/APPROVED" }
        $signatureIdCheck = Get-TechV02NormalizedIdentifier $signature.signatureId "$roleCode signatureId"
        $signerIdCheck = Get-TechV02NormalizedIdentifier $signature.signerId "$roleCode signerId"
        $reasons += $signatureIdCheck.Reasons
        $reasons += $signerIdCheck.Reasons
        if (-not (Test-TechV02MeaningfulString $signature.signerName) -or
            -not (Test-TechV02MeaningfulString $signature.signerTitle) -or
            -not (Test-TechV02IsoTimestamp $signature.signedAt) -or
            -not (Test-TechV02True $signature.signedByHuman) -or
            -not (Test-TechV02False $signature.delegated)) {
            $reasons += "$roleCode human signature identity/time is incomplete or delegated"
        }
        if (-not (Test-TechV02ExactIntegerValue $signature.openReservations 0)) { $reasons += "$roleCode has open reservations or a non-integer reservation count" }
        if ($signatureIdCheck.Valid) { $signatureIds += $signatureIdCheck.Normalized }
        if ($signerIdCheck.Valid) { $signerIds += $signerIdCheck.Normalized }
        $outputs += $signature
    }
    if (@($signatureIds | Select-Object -Unique).Count -ne 10) { $reasons += 'signatureId values must be present and unique for all 10 signatures' }
    if (@($signerIds | Select-Object -Unique).Count -ne 10) { $reasons += 'signerId values must identify 10 distinct human signers' }
    return [pscustomobject]@{ Reasons = $reasons; Output = [ordered]@{ status = $status; signatures = $outputs } }
}

function New-TechV02EmptyAttachmentOutput() {
    return [ordered]@{
        acceptanceId = ''
        status = 'PENDING'
        environmentType = 'TARGET_UAT'
        photo = [ordered]@{ sourceType = 'ON_SITE_ORIGINAL'; synthetic = $false; originalFileName = ''; originalFileUri = ''; originalFileSha256 = ''; originalFileSizeBytes = 0; sizeBytes = 0; sha256 = ''; hotelCode = ''; maskedRoom = ''; capturedAt = ''; capturedBy = ''; issueDescription = ''; privacyReviewPassed = $false }
        targetAttachmentChain = [ordered]@{ storageType = 'OBJECT_STORAGE'; objectStoragePersisted = $false; objectKey = ''; malwareScanStatus = 'PENDING'; authorizationPassed = $false; unauthorizedAccessDenied = $false; encryptionAtRestPassed = $false; lifecyclePolicyPassed = $false; backupRestorePassed = $false; uploadSha256 = ''; downloadSha256 = ''; restoreSha256 = '' }
        workflow = [ordered]@{ standardEvaluationPassed = $false; remediationTaskCompleted = $false; managerAcceptancePassed = $false }
        approvals = @()
        evidenceUri = ''
        evidenceSha256 = ''
        evidenceArtifacts = @()
    }
}

function Convert-TechV02AttachmentEvidence($reference) {
    $reasons = @()
    $evidence = @()
    $reasons += Test-TechV02ReferenceHeader $reference 'FIELD_PHOTO_AND_TARGET_ATTACHMENT_ACCEPTANCE' 'field photo/attachment evidence'
    $output = New-TechV02EmptyAttachmentOutput
    if (-not $reference.Ok -or $null -eq $reference.Document) { return [pscustomobject]@{ Reasons = $reasons; Output = $output } }
    $document = $reference.Document
    foreach ($field in @('acceptanceId','status','environmentType')) { $output[$field] = Get-TechV02Property $document $field $output[$field] }
    $output.evidenceUri = $reference.RelativePath
    $output.evidenceSha256 = $reference.Sha256
    if (-not (Test-TechV02Approved $output.status)) { $reasons += 'field photo/attachment status is not APPROVED' }
    if ($output.environmentType -cnotin @('TARGET_UAT','TARGET_PRODUCTION')) { $reasons += 'field photo/attachment environmentType is not TARGET_UAT or TARGET_PRODUCTION' }
    $photo = Get-TechV02Property $document 'photo' $null
    if ($null -eq $photo) {
        $reasons += 'field photo object is missing'
    } else {
        foreach ($field in @('sourceType','synthetic','originalFileName','sizeBytes','sha256','hotelCode','maskedRoom','capturedAt','capturedBy','issueDescription','privacyReviewPassed')) {
            $output.photo[$field] = Get-TechV02Property $photo $field $output.photo[$field]
        }
        $originalPhoto = Resolve-TechV02EvidenceFile (Get-TechV02Property $photo 'originalFilePath' '') 'original photo file'
        if (-not $originalPhoto.Ok) {
            $reasons += $originalPhoto.Reason
        } else {
            $output.photo.originalFileUri = $originalPhoto.Uri
            $output.photo.originalFileSha256 = $originalPhoto.Sha256
            $output.photo.originalFileSizeBytes = $originalPhoto.SizeBytes
            $evidence += $originalPhoto.Uri
            if ([string]::Equals($originalPhoto.FullPath, $reference.FullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
                $reasons += 'original photo file must be distinct from its acceptance JSON declaration'
            }
            if (-not [string]::Equals([System.IO.Path]::GetFileName($originalPhoto.FullPath), $output.photo.originalFileName.ToString(), [System.StringComparison]::Ordinal)) {
                $reasons += 'original photo file name does not match photo.originalFileName'
            }
            if ((Test-TechV02IntegerValue $output.photo.sizeBytes) -and [long]$output.photo.sizeBytes -ne [long]$originalPhoto.SizeBytes) {
                $reasons += 'original photo file size does not match photo.sizeBytes'
            }
            if ((Test-TechV02Sha256 $output.photo.sha256) -and $originalPhoto.Sha256 -ne $output.photo.sha256.ToString().ToLowerInvariant()) {
                $reasons += 'original photo file SHA-256 does not match photo.sha256'
            }
        }
        if ($output.photo.sourceType -cne 'ON_SITE_ORIGINAL') { $reasons += 'photo sourceType is not ON_SITE_ORIGINAL' }
        if (-not (Test-TechV02False $output.photo.synthetic)) { $reasons += 'photo synthetic must be boolean false' }
        if (-not (Test-TechV02IntegerValue $output.photo.sizeBytes) -or [decimal]$output.photo.sizeBytes -lt 1024) { $reasons += 'photo sizeBytes must be an integer of at least 1 KiB' }
        if (-not (Test-TechV02Sha256 $output.photo.sha256)) { $reasons += 'photo SHA-256 is missing or invalid' }
        foreach ($field in @('originalFileName','hotelCode','maskedRoom','capturedBy','issueDescription')) {
            if (-not (Test-TechV02MeaningfulString $output.photo[$field])) { $reasons += "photo $field is incomplete" }
        }
        if (-not (Test-TechV02IsoTimestamp $output.photo.capturedAt)) { $reasons += 'photo capturedAt is missing or invalid' }
        if (-not (Test-TechV02True $output.photo.privacyReviewPassed)) { $reasons += 'photo privacy review did not pass' }
    }
    $chain = Get-TechV02Property $document 'targetAttachmentChain' $null
    if ($null -eq $chain) {
        $reasons += 'targetAttachmentChain object is missing'
    } else {
        foreach ($field in @('storageType','objectStoragePersisted','objectKey','malwareScanStatus','authorizationPassed','unauthorizedAccessDenied','encryptionAtRestPassed','lifecyclePolicyPassed','backupRestorePassed','uploadSha256','downloadSha256','restoreSha256')) {
            $output.targetAttachmentChain[$field] = Get-TechV02Property $chain $field $output.targetAttachmentChain[$field]
        }
        if ($output.targetAttachmentChain.storageType -cne 'OBJECT_STORAGE') { $reasons += 'target attachment storageType must be OBJECT_STORAGE' }
        if (-not (Test-TechV02True $output.targetAttachmentChain.objectStoragePersisted)) { $reasons += 'target object storage persistence is not proven' }
        if (-not (Test-TechV02MeaningfulString $output.targetAttachmentChain.objectKey)) { $reasons += 'target object key is incomplete' }
        if ($output.targetAttachmentChain.malwareScanStatus -cne 'CLEAN') { $reasons += 'target malware scan status is not CLEAN' }
        foreach ($field in @('authorizationPassed','unauthorizedAccessDenied','encryptionAtRestPassed','lifecyclePolicyPassed','backupRestorePassed')) {
            if (-not (Test-TechV02True $output.targetAttachmentChain[$field])) { $reasons += "target attachment $field is not true" }
        }
        foreach ($field in @('uploadSha256','downloadSha256','restoreSha256')) {
            if (-not (Test-TechV02Sha256 $output.targetAttachmentChain[$field])) { $reasons += "target attachment $field is missing or invalid" }
            elseif (Test-TechV02Sha256 $output.photo.sha256) {
                if ($output.targetAttachmentChain[$field].ToString().ToLowerInvariant() -ne $output.photo.sha256.ToString().ToLowerInvariant()) { $reasons += "$field does not match the on-site photo SHA-256" }
            }
        }
    }
    $workflow = Get-TechV02Property $document 'workflow' $null
    foreach ($field in @('standardEvaluationPassed','remediationTaskCompleted','managerAcceptancePassed')) {
        if ($null -ne $workflow) { $output.workflow[$field] = Get-TechV02Property $workflow $field $false }
        if (-not (Test-TechV02True $output.workflow[$field])) { $reasons += "workflow $field is not true" }
    }
    $requiredApprovers = @('HOUSEKEEPING_SUPERVISOR','GENERAL_MANAGER','QA_OWNER','SECURITY_OPERATIONS_OWNER')
    $sourceApprovals = @(Get-TechV02Property $document 'approvals' @())
    if ($sourceApprovals.Count -ne $requiredApprovers.Count) {
        $reasons += "exactly $($requiredApprovers.Count) attachment approvals are required; found $($sourceApprovals.Count)"
    }
    $approvalOutputs = @()
    foreach ($roleCode in $requiredApprovers) {
        $matches = @($sourceApprovals | Where-Object { (Get-TechV02Property $_ 'roleCode' '') -ceq $roleCode })
        if ($matches.Count -ne 1) {
            $reasons += "exactly one attachment approval is required for $roleCode"
            $approvalOutputs += [ordered]@{ roleCode = $roleCode; status = 'PENDING'; signerName = ''; signedAt = ''; signedByHuman = $false; delegated = $false; evidenceUri = ''; evidenceSha256 = ''; signatureAssurance = (Convert-TechV02SignatureAssurance $null "attachment approval $roleCode").Output }
            continue
        }
        $approval = $matches[0]
        $resolved = Resolve-TechV02EvidenceFile (Get-TechV02Property $approval 'evidencePath' '') "attachment approval $roleCode"
        if (-not $resolved.Ok) { $reasons += $resolved.Reason }
        $approvalOutput = [ordered]@{
            roleCode = $roleCode
            status = Get-TechV02Property $approval 'status' 'PENDING'
            signerName = Get-TechV02Property $approval 'signerName' ''
            signedAt = Get-TechV02Property $approval 'signedAt' ''
            signedByHuman = Get-TechV02Property $approval 'signedByHuman' $false
            delegated = Get-TechV02Property $approval 'delegated' $false
            evidenceUri = $resolved.Uri
            evidenceSha256 = $resolved.Sha256
            signatureAssurance = $null
        }
        $assuranceResult = Convert-TechV02SignatureAssurance $approval "attachment approval $roleCode"
        $reasons += $assuranceResult.Reasons
        $approvalOutput.signatureAssurance = $assuranceResult.Output
        if (-not (Test-TechV02Approved $approvalOutput.status) -or
            -not (Test-TechV02MeaningfulString $approvalOutput.signerName) -or
            -not (Test-TechV02IsoTimestamp $approvalOutput.signedAt) -or
            -not (Test-TechV02True $approvalOutput.signedByHuman) -or
            -not (Test-TechV02False $approvalOutput.delegated)) {
            $reasons += "attachment approval $roleCode is incomplete, non-human, or delegated"
        }
        $approvalOutputs += $approvalOutput
    }
    $output.approvals = $approvalOutputs
    if (-not (Test-TechV02MeaningfulString $output.acceptanceId)) { $reasons += 'field photo/attachment acceptanceId is incomplete' }
    $artifactResult = Resolve-TechV02EvidenceArtifacts (Get-TechV02Property $document 'evidenceFiles' @()) 'field photo/attachment' (Test-TechV02Approved $output.status)
    $reasons += $artifactResult.Reasons
    $output.evidenceArtifacts = $artifactResult.Artifacts
    return [pscustomobject]@{ Reasons = $reasons; Output = $output; Evidence = @($evidence | Select-Object -Unique) }
}

function New-TechV02EmptyOperationsOutput() {
    return [ordered]@{
        acceptanceId = ''
        status = 'PENDING'
        environmentType = 'TARGET_UAT'
        persistentDatabase = $false
        databaseVersion = 'DB-V13'
        successfulMigrations = 0
        forcedRlsTables = 0
        dataChecksumsEnabled = $false
        equivalentIntegrityControlPassed = $false
        dataIntegrityStrategyApproved = $false
        scheduledBackupPassed = $false
        backupEncryptionPassed = $false
        backupRetentionPolicyApproved = $false
        approvedBackupRetentionDays = 0
        backupRetentionDays = 0
        restoreDrillPassed = $false
        rollbackDrillPassed = $false
        rpoRtoApproved = $false
        rpoMet = $false
        rtoMet = $false
        monitoringPassed = $false
        alertingPassed = $false
        workerHealthPassed = $false
        healthChecksPassed = $false
        rollbackRunbookApproved = $false
        deployedBackendArtifactSha256 = ''
        approvals = @()
        evidenceUri = ''
        evidenceSha256 = ''
        evidenceArtifacts = @()
    }
}

function Convert-TechV02OperationsEvidence($reference, [string]$expectedBackendSha256) {
    $reasons = @()
    $reasons += Test-TechV02ReferenceHeader $reference 'TARGET_OPERATIONS_ACCEPTANCE' 'target operations evidence'
    $output = New-TechV02EmptyOperationsOutput
    if (-not $reference.Ok -or $null -eq $reference.Document) { return [pscustomobject]@{ Reasons = $reasons; Output = $output; Evidence = @() } }
    $document = $reference.Document
    foreach ($field in @('acceptanceId','status','environmentType','persistentDatabase','databaseVersion','successfulMigrations','forcedRlsTables','dataChecksumsEnabled','equivalentIntegrityControlPassed','dataIntegrityStrategyApproved','scheduledBackupPassed','backupEncryptionPassed','backupRetentionPolicyApproved','approvedBackupRetentionDays','backupRetentionDays','restoreDrillPassed','rollbackDrillPassed','rpoRtoApproved','rpoMet','rtoMet','monitoringPassed','alertingPassed','workerHealthPassed','healthChecksPassed','rollbackRunbookApproved','deployedBackendArtifactSha256')) {
        $output[$field] = Get-TechV02Property $document $field $output[$field]
    }
    $output.evidenceUri = $reference.RelativePath
    $output.evidenceSha256 = $reference.Sha256
    if (-not (Test-TechV02Approved $output.status)) { $reasons += 'target operations status is not APPROVED' }
    if ($output.environmentType -cnotin @('TARGET_UAT','TARGET_PRODUCTION')) { $reasons += 'target operations environmentType is not TARGET_UAT or TARGET_PRODUCTION' }
    if (-not (Test-TechV02True $output.persistentDatabase)) { $reasons += 'persistent target database is not proven' }
    if ($output.databaseVersion -cne 'DB-V13' -or -not (Test-TechV02IntegerValue $output.successfulMigrations) -or [decimal]$output.successfulMigrations -lt 13) { $reasons += 'target database is not verified at DB-V13 with at least 13 migrations' }
    if (-not (Test-TechV02IntegerValue $output.forcedRlsTables) -or [decimal]$output.forcedRlsTables -lt 49) { $reasons += 'target database has fewer than 49 forced-RLS tables' }
    foreach ($field in @('dataIntegrityStrategyApproved','backupRetentionPolicyApproved','scheduledBackupPassed','backupEncryptionPassed','restoreDrillPassed','rollbackDrillPassed','rpoRtoApproved','rpoMet','rtoMet','monitoringPassed','alertingPassed','workerHealthPassed','healthChecksPassed','rollbackRunbookApproved')) {
        if (-not (Test-TechV02True $output[$field])) { $reasons += "target operations $field is not true" }
    }
    if (-not (Test-TechV02True $output.dataChecksumsEnabled) -and -not (Test-TechV02True $output.equivalentIntegrityControlPassed)) { $reasons += 'target operations has no accepted data-integrity control' }
    $approvedRetentionValid = (Test-TechV02IntegerValue $output.approvedBackupRetentionDays) -and [decimal]$output.approvedBackupRetentionDays -ge 1
    $actualRetentionValid = Test-TechV02IntegerValue $output.backupRetentionDays
    if (-not $approvedRetentionValid) { $reasons += 'approved backup retention is missing or not a positive integer' }
    if (-not $actualRetentionValid -or ($approvedRetentionValid -and [decimal]$output.backupRetentionDays -lt [decimal]$output.approvedBackupRetentionDays)) { $reasons += 'actual backup retention is invalid or below the approved policy' }
    if (-not (Test-TechV02Sha256 $output.deployedBackendArtifactSha256)) {
        $reasons += 'deployed backend artifact SHA-256 is missing or invalid'
    } elseif (Test-TechV02Sha256 $expectedBackendSha256) {
        if ($output.deployedBackendArtifactSha256.ToString().ToLowerInvariant() -ne $expectedBackendSha256.ToLowerInvariant()) { $reasons += 'deployed backend SHA-256 does not match the release manifest' }
    }
    if (-not (Test-TechV02MeaningfulString $output.acceptanceId)) { $reasons += 'target operations acceptanceId is incomplete' }
    $requiredApprovers = @(
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
    $approvalResult = Convert-TechV02AcceptanceApprovals $document 'approvals' $requiredApprovers 'target operations'
    $reasons += $approvalResult.Reasons
    $output.approvals = $approvalResult.Approvals
    $artifactResult = Resolve-TechV02EvidenceArtifacts (Get-TechV02Property $document 'evidenceFiles' @()) 'target operations' (Test-TechV02Approved $output.status)
    $reasons += $artifactResult.Reasons
    $output.evidenceArtifacts = $artifactResult.Artifacts
    return [pscustomobject]@{ Reasons = $reasons; Output = $output; Evidence = @($reference.RelativePath) + @($approvalResult.Evidence) + @($artifactResult.Artifacts | ForEach-Object { $_.uri }) }
}

function Resolve-TechV02Git() {
    $command = Get-Command git -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $bundled = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe'
    if (Test-Path -LiteralPath $bundled -PathType Leaf) { return $bundled }
    return $null
}

function Invoke-TechV02GitReadOnly([string]$gitPath, [string[]]$arguments) {
    $previousLocks = $env:GIT_OPTIONAL_LOCKS
    $env:GIT_OPTIONAL_LOCKS = '0'
    try {
        $oldPreference = $ErrorActionPreference
        $ErrorActionPreference = 'SilentlyContinue'
        try {
            $output = @(& $gitPath --no-optional-locks -C $script:TechV02EvidenceRepoRoot @arguments 2>&1 | ForEach-Object { $_.ToString() })
            $exitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $oldPreference
        }
        return [pscustomobject]@{ ExitCode = $exitCode; Output = ($output -join "`n").Trim() }
    } finally {
        $env:GIT_OPTIONAL_LOCKS = $previousLocks
    }
}

function Test-TechV02ControlledGitRemoteUrl($value) {
    if (-not (Test-TechV02MeaningfulString $value)) { return $false }
    $text = $value.ToString().Trim()
    if ($text -match '^[A-Za-z0-9._-]+@([A-Za-z0-9.-]+):[^\s]+$') {
        $hostName = $Matches[1].ToLowerInvariant()
        return $hostName.Contains('.') -and $hostName -notin @('localhost','127.0.0.1','::1') -and $hostName -notmatch '(^|\.)(example\.(com|org|net)|example|invalid|localhost|local)$'
    }
    $remoteUri = $null
    if (-not [Uri]::TryCreate($text, [UriKind]::Absolute, [ref]$remoteUri)) { return $false }
    if ($remoteUri.Scheme -notin @('https','ssh') -or $remoteUri.IsLoopback) { return $false }
    $normalizedHost = $remoteUri.Host.TrimEnd('.').ToLowerInvariant()
    if (-not $normalizedHost.Contains('.') -or $normalizedHost -match '^(?i:localhost|127\.0\.0\.1|::1)$' -or $normalizedHost -match '(^|\.)(example\.(com|org|net)|example|invalid|localhost|local)$') { return $false }
    if ($remoteUri.Scheme -eq 'https' -and -not [string]::IsNullOrWhiteSpace($remoteUri.UserInfo)) { return $false }
    if ($remoteUri.UserInfo -match ':') { return $false }
    return $true
}

function Test-TechV02GitIdentityEmail($value) {
    if (-not (Test-TechV02MeaningfulString $value)) { return $false }
    $text = $value.ToString().Trim()
    if ($text -notmatch '^[^\s@]+@(?<domain>[^\s@]+)$') { return $false }
    $domain = $Matches['domain'].TrimEnd('.').ToLowerInvariant()
    if (-not $domain.Contains('.') -or $domain -in @('localhost','local','invalid')) { return $false }
    return $domain -notmatch '(^|\.)(example\.(com|org|net)|example|invalid|localhost|local)$'
}

function Test-TechV02GitObjectId($value) {
    return $null -ne $value -and $value.ToString() -match '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'
}

function Test-TechV02PublicationTimeline($commitTime, $publishedTime, $approvedTime) {
    if (-not (Test-TechV02IsoTimestamp $commitTime) -or -not (Test-TechV02IsoTimestamp $publishedTime) -or -not (Test-TechV02IsoTimestamp $approvedTime)) {
        return $false
    }
    $commitAt = [DateTimeOffset]::MinValue
    $publishedAt = [DateTimeOffset]::MinValue
    $approvedAt = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse($commitTime.ToString(), [ref]$commitAt) -or
        -not [DateTimeOffset]::TryParse($publishedTime.ToString(), [ref]$publishedAt) -or
        -not [DateTimeOffset]::TryParse($approvedTime.ToString(), [ref]$approvedAt)) {
        return $false
    }
    return $publishedAt -ge $commitAt -and $publishedAt -le $approvedAt
}

function Test-TechV02SourceTraceability($trace) {
    $reasons = @()
    $evidence = @()
    $rcTag = Get-TechV02Property $trace 'rcTag' ''
    $manifestPathValue = Get-TechV02Property $trace 'artifactManifestPath' ''
    $sumsPathValue = Get-TechV02Property $trace 'sha256SumsPath' ''
    $remoteName = Get-TechV02Property $trace 'remoteName' ''
    $remoteUrl = Get-TechV02Property $trace 'remoteUrl' ''
    $remoteBranch = Get-TechV02Property $trace 'remoteBranch' ''
    $output = [ordered]@{
        rcTag = $rcTag
        remoteName = $remoteName
        remoteUrl = $remoteUrl
        remoteBranch = $remoteBranch
        commitAuthorName = Get-TechV02Property $trace 'commitAuthorName' ''
        commitAuthorEmail = Get-TechV02Property $trace 'commitAuthorEmail' ''
        commitCommitterName = Get-TechV02Property $trace 'commitCommitterName' ''
        commitCommitterEmail = Get-TechV02Property $trace 'commitCommitterEmail' ''
        repositoryApproval = New-TechV02EmptyAcceptanceApproval 'REPOSITORY_OWNER'
        artifactManifestPath = $manifestPathValue
        sha256SumsPath = $sumsPathValue
    }
    if (-not (Test-TechV02CanonicalRcTag $rcTag)) { $reasons += 'sourceTraceability.rcTag must exactly match TECH-V0.2-rc.N' }
    $remoteNameSafe = $remoteName -match '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    $remoteBranchSafe = (
        $remoteBranch -match '^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$' -and
        $remoteBranch -notmatch '(\.\.|@\{|//)' -and
        $remoteBranch -notmatch '[/.]$'
    )
    if (-not $remoteNameSafe -or -not $remoteBranchSafe -or -not (Test-TechV02ControlledGitRemoteUrl $remoteUrl)) {
        $reasons += 'controlled Git remote name, URL, or branch is missing or unsafe'
    }
    foreach ($field in @('commitAuthorName','commitCommitterName')) {
        if (-not (Test-TechV02MeaningfulString $output[$field])) { $reasons += "sourceTraceability.$field is incomplete" }
    }
    foreach ($field in @('commitAuthorEmail','commitCommitterEmail')) {
        if (-not (Test-TechV02GitIdentityEmail $output[$field])) { $reasons += "sourceTraceability.$field is missing or invalid" }
    }
    $repositoryApprovalSource = Get-TechV02Property $trace 'repositoryApproval' $null
    $repositoryApprovalItems = @()
    if ($null -ne $repositoryApprovalSource) { $repositoryApprovalItems = @($repositoryApprovalSource) }
    $repositoryApprovalDocument = [pscustomobject]@{ approvals = $repositoryApprovalItems }
    $repositoryApprovalResult = Convert-TechV02AcceptanceApprovals $repositoryApprovalDocument 'approvals' @('REPOSITORY_OWNER') 'repository'
    $reasons += $repositoryApprovalResult.Reasons
    $repositoryApprovalOutput = $repositoryApprovalResult.Approvals[0]
    foreach ($field in @('approvedRemoteUrl','approvedRemoteBranch','approvedHeadCommit','approvedRcTag','approvedArtifactManifestSha256','remotePublishedAt')) {
        $repositoryApprovalOutput[$field] = Get-TechV02Property $repositoryApprovalSource $field ''
    }
    $output.repositoryApproval = $repositoryApprovalOutput
    $evidence += $repositoryApprovalResult.Evidence
    if (-not (Test-TechV02ControlledGitRemoteUrl $repositoryApprovalOutput.approvedRemoteUrl) -or $repositoryApprovalOutput.approvedRemoteUrl -cne $remoteUrl) {
        $reasons += 'repository approval is not bound to the controlled Git remote URL'
    }
    if (-not (Test-TechV02MeaningfulString $repositoryApprovalOutput.approvedRemoteBranch) -or $repositoryApprovalOutput.approvedRemoteBranch -cne $remoteBranch) {
        $reasons += 'repository approval is not bound to the controlled Git remote branch'
    }
    if (-not (Test-TechV02GitObjectId $repositoryApprovalOutput.approvedHeadCommit)) {
        $reasons += 'repository approval approvedHeadCommit is missing or invalid'
    }
    if ($repositoryApprovalOutput.approvedRcTag -cne $rcTag) {
        $reasons += 'repository approval is not bound to sourceTraceability.rcTag'
    }
    if (-not (Test-TechV02Sha256 $repositoryApprovalOutput.approvedArtifactManifestSha256)) {
        $reasons += 'repository approval approvedArtifactManifestSha256 is missing or invalid'
    }
    if (-not (Test-TechV02IsoTimestamp $repositoryApprovalOutput.remotePublishedAt)) {
        $reasons += 'repository approval remotePublishedAt is missing or invalid'
    }
    $gitPath = Resolve-TechV02Git
    $headCommit = ''
    $tagCommitValue = ''
    $remoteCommitValue = ''
    $currentBranchValue = ''
    $headCommittedAtValue = ''
    $clean = $false
    $tagAnnotated = $false
    if (-not $gitPath) {
        $reasons += 'Git executable was not found'
    } else {
        $inside = Invoke-TechV02GitReadOnly $gitPath @('rev-parse','--is-inside-work-tree')
        if ($inside.ExitCode -ne 0 -or $inside.Output -ne 'true') {
            $reasons += 'workspace is not a valid Git work tree'
        } else {
            $head = Invoke-TechV02GitReadOnly $gitPath @('rev-parse','--verify','HEAD')
            if ($head.ExitCode -ne 0 -or -not (Test-TechV02GitObjectId $head.Output)) {
                $reasons += 'Git HEAD is missing or invalid'
            } else {
                $headCommit = $head.Output
                if ($repositoryApprovalOutput.approvedHeadCommit -cne $headCommit) { $reasons += 'repository approval approvedHeadCommit does not equal Git HEAD' }
            }
            if ($remoteNameSafe -and $remoteBranchSafe) {
                $branch = Invoke-TechV02GitReadOnly $gitPath @('rev-parse','--abbrev-ref','HEAD')
                if ($branch.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($branch.Output)) {
                    $reasons += 'controlled Git remote branch could not be resolved from HEAD'
                } else {
                    $currentBranchValue = $branch.Output
                    if ($currentBranchValue -cne $remoteBranch) { $reasons += 'current Git branch does not match sourceTraceability.remoteBranch' }
                }
                $fetchRemote = Invoke-TechV02GitReadOnly $gitPath @('remote','get-url','--all',$remoteName)
                $pushRemote = Invoke-TechV02GitReadOnly $gitPath @('remote','get-url','--push','--all',$remoteName)
                $fetchUrls = @($fetchRemote.Output -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
                $pushUrls = @($pushRemote.Output -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
                if ($fetchRemote.ExitCode -ne 0 -or $fetchUrls.Count -ne 1 -or -not (Test-TechV02ControlledGitRemoteUrl $fetchUrls[0])) {
                    $reasons += 'controlled Git remote must have exactly one permitted non-local fetch URL'
                } elseif ($fetchUrls[0] -cne $remoteUrl) {
                    $reasons += 'controlled Git fetch URL does not match sourceTraceability.remoteUrl'
                }
                if ($pushRemote.ExitCode -ne 0 -or $pushUrls.Count -ne 1 -or -not (Test-TechV02ControlledGitRemoteUrl $pushUrls[0])) {
                    $reasons += 'controlled Git remote must have exactly one permitted non-local push URL'
                } elseif ($pushUrls[0] -cne $remoteUrl) {
                    $reasons += 'controlled Git push URL does not match sourceTraceability.remoteUrl'
                }
                if ($fetchUrls.Count -eq 1 -and $pushUrls.Count -eq 1 -and $fetchUrls[0] -cne $pushUrls[0]) {
                    $reasons += 'controlled Git fetch and push URLs are not identical'
                }
                $remoteRef = "refs/remotes/$remoteName/$remoteBranch"
                $remoteCommit = Invoke-TechV02GitReadOnly $gitPath @('rev-parse','--verify',"$remoteRef^{commit}")
                if ($remoteCommit.ExitCode -ne 0 -or -not (Test-TechV02GitObjectId $remoteCommit.Output)) {
                    $reasons += 'controlled Git remote-tracking commit is missing or invalid'
                } else {
                    $remoteCommitValue = $remoteCommit.Output
                    if ($headCommit -and $remoteCommitValue -cne $headCommit) { $reasons += 'controlled Git remote-tracking commit does not equal HEAD' }
                }
            }
            if ($headCommit) {
                foreach ($identityCheck in @(
                    [ordered]@{ Argument = '%an'; Field = 'commitAuthorName' },
                    [ordered]@{ Argument = '%ae'; Field = 'commitAuthorEmail' },
                    [ordered]@{ Argument = '%cn'; Field = 'commitCommitterName' },
                    [ordered]@{ Argument = '%ce'; Field = 'commitCommitterEmail' }
                )) {
                    $identity = Invoke-TechV02GitReadOnly $gitPath @('show','-s',"--format=$($identityCheck.Argument)",'HEAD')
                    if ($identity.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($identity.Output)) {
                        $reasons += "Git HEAD $($identityCheck.Field) could not be read"
                    } elseif ($identity.Output -cne $output[$identityCheck.Field]) {
                        $reasons += "Git HEAD $($identityCheck.Field) does not match sourceTraceability"
                    }
                }
                $headCommittedAt = Invoke-TechV02GitReadOnly $gitPath @('show','-s','--format=%cI','HEAD')
                if ($headCommittedAt.ExitCode -ne 0 -or -not (Test-TechV02IsoTimestamp $headCommittedAt.Output)) {
                    $reasons += 'Git HEAD commit time is missing, invalid, or in the future'
                } else {
                    $headCommittedAtValue = $headCommittedAt.Output
                    if (-not (Test-TechV02PublicationTimeline $headCommittedAtValue $repositoryApprovalOutput.remotePublishedAt $repositoryApprovalOutput.signedAt)) {
                        $reasons += 'repository approval timeline must be HEAD commit <= remote publication <= owner approval'
                    }
                }
            }
            $status = Invoke-TechV02GitReadOnly $gitPath @('status','--porcelain=v1','--untracked-files=normal')
            if ($status.ExitCode -ne 0) { $reasons += 'Git work-tree cleanliness could not be verified' }
            elseif (-not [string]::IsNullOrWhiteSpace($status.Output)) { $reasons += 'Git work tree is not clean' }
            else { $clean = $true }
            $tagType = Invoke-TechV02GitReadOnly $gitPath @('cat-file','-t',"refs/tags/$rcTag")
            if ($tagType.ExitCode -ne 0) { $reasons += "RC tag does not exist: $rcTag" }
            elseif ($tagType.Output -ne 'tag') { $reasons += "RC tag is not annotated: $rcTag" }
            else { $tagAnnotated = $true }
            $tagCommit = Invoke-TechV02GitReadOnly $gitPath @('rev-list','-n','1',$rcTag)
            if ($tagCommit.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($tagCommit.Output)) { $reasons += "RC tag commit could not be resolved: $rcTag" }
            else {
                $tagCommitValue = $tagCommit.Output
                if ($headCommit -and $tagCommitValue -ne $headCommit) { $reasons += 'RC tag does not point to current HEAD' }
            }
        }
    }
    $manifestReference = Read-TechV02JsonReference $manifestPathValue 'artifact manifest'
    $reasons += $manifestReference.Reasons
    $backendSha = ''
    $manifest = $manifestReference.Document
    if ($manifestReference.Ok -and $null -ne $manifest) {
        $evidence += $manifestReference.RelativePath
        $output.artifactManifestPath = $manifestReference.RelativePath
        if ($repositoryApprovalOutput.approvedArtifactManifestSha256.ToString().ToLowerInvariant() -ne $manifestReference.Sha256) {
            $reasons += 'repository approval approvedArtifactManifestSha256 does not equal the consumed artifact manifest'
        }
        $manifestEnvelope = Test-TechV02ReleaseEnvelope $manifest 'artifact manifest' $rcTag
        $reasons += $manifestEnvelope.Reasons
        $source = Get-TechV02Property $manifest 'source' $null
        if (-not $headCommit -or (Get-TechV02Property $source 'commit' '') -ne $headCommit) { $reasons += 'artifact manifest source.commit does not equal Git HEAD' }
        if (-not (Test-TechV02False (Get-TechV02Property $source 'dirty' $null))) { $reasons += 'artifact manifest source.dirty is not boolean false' }
        $artifacts = @(Get-TechV02Property $manifest 'artifacts' @())
        $artifactContract = Test-TechV02RequiredReleaseArtifactSet $artifacts $rcTag
        $reasons += $artifactContract.Reasons
        $artifactDirectory = Split-Path -Parent $manifestReference.FullPath
        $fingerprintParts = @()
        foreach ($artifact in $artifacts) {
            $fileName = Get-TechV02Property $artifact 'file' ''
            $declaredSha = Get-TechV02Property $artifact 'sha256' ''
            if (-not (Test-TechV02MeaningfulString $fileName) -or [System.IO.Path]::GetFileName($fileName) -ne $fileName) {
                $reasons += 'artifact manifest contains an unsafe or empty filename'
                continue
            }
            if (-not (Test-TechV02Sha256 $declaredSha)) { $reasons += "artifact manifest SHA-256 is invalid for $fileName"; continue }
            $artifactPath = Join-Path $artifactDirectory $fileName
            $artifactSnapshot = Resolve-TechV02EvidenceFile $artifactPath "release artifact $fileName"
            if (-not $artifactSnapshot.Ok) { $reasons += $artifactSnapshot.Reason; continue }
            $actualSha = $artifactSnapshot.Sha256
            if ($actualSha -ne $declaredSha.ToString().ToLowerInvariant()) { $reasons += "release artifact SHA-256 mismatch: $fileName" }
            $declaredSizeBytes = Get-TechV02Property $artifact 'sizeBytes' $null
            if (-not (Test-TechV02IntegerValue $declaredSizeBytes) -or [decimal]$declaredSizeBytes -lt 0 -or $artifactSnapshot.SizeBytes -ne [long]$declaredSizeBytes) {
                $reasons += "release artifact size mismatch: $fileName"
            }
            if ($fileName -like '*.jar') { $backendSha = $actualSha }
            $fingerprintParts += "$fileName`:$($declaredSha.ToString().ToLowerInvariant())"
        }
        if ($fingerprintParts.Count -gt 0) {
            $actualFingerprint = Get-TechV02TextSha256 ($fingerprintParts -join "`n")
            $declaredFingerprint = Get-TechV02Property (Get-TechV02Property $manifest 'reproducibleBuild' $null) 'payloadFingerprintSha256' ''
            if ($actualFingerprint -ne $declaredFingerprint) { $reasons += 'artifact manifest payload fingerprint does not match its artifact entries' }
        }
    }
    $sumsFullPath = Resolve-TechV02WorkspacePath $sumsPathValue
    if (-not $sumsFullPath -or -not (Test-Path -LiteralPath $sumsFullPath -PathType Leaf)) {
        $reasons += 'sourceTraceability SHA256SUMS file is missing'
    } else {
        $output.sha256SumsPath = Get-TechV02RelativePath $sumsFullPath
        $evidence += $output.sha256SumsPath
        if ($null -ne $manifest) {
            $sumMap = @{}
            foreach ($line in Get-Content -LiteralPath $sumsFullPath -Encoding ASCII) {
                if ([string]::IsNullOrWhiteSpace($line)) { continue }
                if ($line -notmatch '^([0-9a-fA-F]{64})\s{2}(.+)$') { $reasons += "invalid SHA256SUMS line: $line"; continue }
                $sumMap[$Matches[2]] = $Matches[1].ToLowerInvariant()
            }
            foreach ($artifact in @(Get-TechV02Property $manifest 'artifacts' @())) {
                $fileName = Get-TechV02Property $artifact 'file' ''
                $declaredSha = Get-TechV02Property $artifact 'sha256' ''
                if (-not $sumMap.ContainsKey($fileName) -or $sumMap[$fileName] -ne $declaredSha.ToString().ToLowerInvariant()) { $reasons += "SHA256SUMS does not match manifest for $fileName" }
            }
        }
    }
    return [pscustomobject]@{
        Reasons = $reasons
        Output = $output
        BackendArtifactSha256 = $backendSha
        Evidence = $evidence
        Git = [ordered]@{ head = $headCommit; committedAt = $headCommittedAtValue; clean = $clean; rcTag = $rcTag; annotated = $tagAnnotated; tagCommit = $tagCommitValue; remoteName = $remoteName; branch = $currentBranchValue; remoteCommit = $remoteCommitValue }
    }
}

function Convert-TechV02LocalWorkerEvidence($bundle) {
    $reasons = @()
    $source = Get-TechV02Property $bundle 'localWorkerEvidence' $null
    $output = [ordered]@{ summaryPath = ''; runtimeStatePath = ''; workerRegressionXmlPath = '' }
    foreach ($field in @('summaryPath','runtimeStatePath','workerRegressionXmlPath')) {
        $value = Get-TechV02Property $source $field ''
        $resolved = Resolve-TechV02EvidenceFile $value "localWorkerEvidence.$field"
        if (-not $resolved.Ok) { $reasons += $resolved.Reason }
        $output[$field] = $resolved.Uri
    }
    return [pscustomobject]@{ Reasons = $reasons; Output = $output }
}

function Invoke-TechV02ExternalEvidenceBundleValidation {
    [CmdletBinding()]
    param(
        [string]$BundlePath,
        [string]$GateInputsPath = ''
    )
    $reasons = @()
    $evidence = @()
    $bundleReference = Read-TechV02JsonReference $BundlePath 'external evidence bundle'
    $reasons += $bundleReference.Reasons
    $bundle = $bundleReference.Document
    if ($bundleReference.Ok -and $null -ne $bundle) {
        $bundleEnvelope = Test-TechV02ReleaseEnvelope $bundle 'external evidence bundle' 'TECH-V0.2'
        $reasons += $bundleEnvelope.Reasons
        $evidence += $bundleReference.RelativePath
    }

    $workerResult = Convert-TechV02LocalWorkerEvidence $bundle
    $reasons += $workerResult.Reasons

    $traceResult = Test-TechV02SourceTraceability (Get-TechV02Property $bundle 'sourceTraceability' $null)
    $reasons += $traceResult.Reasons
    $evidence += $traceResult.Evidence

    $ssoReference = Read-TechV02JsonReference (Get-TechV02Property $bundle 'targetSsoAcceptancePath' '') 'target SSO acceptance'
    $ssoResult = Convert-TechV02SsoEvidence $ssoReference
    $reasons += $ssoResult.Reasons
    $evidence += $ssoResult.Evidence

    $signoffResult = Convert-TechV02SignoffEvidence $bundle
    $reasons += $signoffResult.Reasons

    $attachmentReference = Read-TechV02JsonReference (Get-TechV02Property $bundle 'fieldPhotoAndTargetAttachmentAcceptancePath' '') 'field photo/attachment acceptance'
    $attachmentResult = Convert-TechV02AttachmentEvidence $attachmentReference
    $reasons += $attachmentResult.Reasons
    if ($attachmentReference.RelativePath) { $evidence += $attachmentReference.RelativePath }
    $evidence += $attachmentResult.Evidence

    $operationsReference = Read-TechV02JsonReference (Get-TechV02Property $bundle 'targetOperationsAcceptancePath' '') 'target operations acceptance'
    $operationsResult = Convert-TechV02OperationsEvidence $operationsReference $traceResult.BackendArtifactSha256
    $reasons += $operationsResult.Reasons
    $evidence += $operationsResult.Evidence

    $gateInputs = [ordered]@{
        schemaVersion = 1
        releaseVersion = 'TECH-V0.2'
        localWorkerEvidence = $workerResult.Output
        targetSsoAcceptance = $ssoResult.Output
        releaseSignoffs = $signoffResult.Output
        fieldPhotoAndTargetAttachmentAcceptance = $attachmentResult.Output
        sourceTraceability = $traceResult.Output
        targetOperationsAcceptance = $operationsResult.Output
    }

    $gateInputsCompared = $false
    $gateInputsReference = $null
    if (-not [string]::IsNullOrWhiteSpace($GateInputsPath)) {
        $gateInputsReference = Read-TechV02JsonReference $GateInputsPath 'generated release gate inputs'
        $reasons += $gateInputsReference.Reasons
        if ($gateInputsReference.Ok -and $null -ne $gateInputsReference.Document) {
            $expectedJson = $gateInputs | ConvertTo-Json -Depth 30 -Compress
            $actualJson = $gateInputsReference.Document | ConvertTo-Json -Depth 30 -Compress
            if ($expectedJson -cne $actualJson) { $reasons += 'generated release gate inputs do not match the recomputed external evidence bundle' }
            else { $gateInputsCompared = $true }
            $evidence += $gateInputsReference.RelativePath
        }
    }

    $normalizedReasons = @($reasons | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
    return [pscustomobject][ordered]@{
        schemaVersion = 1
        releaseVersion = 'TECH-V0.2'
        evaluatedAt = [DateTimeOffset]::UtcNow.ToString('o')
        status = if ($normalizedReasons.Count -eq 0) { 'PASS' } else { 'BLOCKED' }
        bundlePath = $bundleReference.RelativePath
        bundleSha256 = $bundleReference.Sha256
        bundleSizeBytes = $bundleReference.SizeBytes
        gateInputsPath = if ($gateInputsReference) { $gateInputsReference.RelativePath } else { '' }
        gateInputsSha256 = if ($gateInputsReference) { $gateInputsReference.Sha256 } else { '' }
        gateInputsSizeBytes = if ($gateInputsReference) { $gateInputsReference.SizeBytes } else { 0 }
        reasons = $normalizedReasons
        evidence = @($evidence | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
        git = $traceResult.Git
        gateInputsCompared = $gateInputsCompared
        gateInputs = $gateInputs
        mutations = [ordered]@{ signaturesCreated = 0; approvalsCreated = 0; commitsCreated = 0; tagsCreated = 0; networkWrites = 0 }
    }
}

if (-not $AsLibrary) {
    $result = Invoke-TechV02ExternalEvidenceBundleValidation -BundlePath $BundlePath -GateInputsPath $GateInputsPath
    $result | ConvertTo-Json -Depth 30
    if ($result.status -eq 'PASS') { exit 0 }
    exit 1
}
