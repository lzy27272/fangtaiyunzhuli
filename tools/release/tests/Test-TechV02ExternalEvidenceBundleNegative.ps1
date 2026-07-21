[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$validatorPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'Test-TechV02ExternalEvidenceBundle.ps1'
. $validatorPath -AsLibrary

$failures = @()
$cases = @()

$caseA = Get-TechV02NormalizedIdentifier 'Signer-01' 'case A signerId'
$caseB = Get-TechV02NormalizedIdentifier 'signer-01' 'case B signerId'
$casePassed = $caseA.Valid -and $caseB.Valid -and $caseA.Normalized -eq $caseB.Normalized
if (-not $casePassed) { $failures += 'case-insensitive signerId normalization failed' }
$cases += [ordered]@{ name = 'case-insensitive-id-normalization'; passed = $casePassed }

$space = Get-TechV02NormalizedIdentifier 'Signer-01 ' 'space signerId'
$spacePassed = -not $space.Valid -and @($space.Reasons | Where-Object { $_ -match 'leading or trailing whitespace' }).Count -gt 0
if (-not $spacePassed) { $failures += 'leading/trailing whitespace was not rejected' }
$cases += [ordered]@{ name = 'identifier-whitespace-rejected'; passed = $spacePassed }

$assurance = Convert-TechV02SignatureAssurance ([pscustomobject]@{}) 'negative assurance'
$assurancePassed = $assurance.Reasons.Count -gt 0 -and $assurance.Output.verificationStatus -eq 'PENDING'
if (-not $assurancePassed) { $failures += 'missing signature assurance did not fail closed' }
$cases += [ordered]@{ name = 'missing-signature-assurance-blocked'; passed = $assurancePassed }

$lowercaseAssurance = Convert-TechV02SignatureAssurance ([pscustomobject]@{
    signatureAssurance = [pscustomobject]@{
        method = 'controlled_signing_platform_export'
        provider = 'Unit Test Signing Platform'
        verificationId = 'unit-lowercase-method'
        verificationStatus = 'VERIFIED'
        verifiedAt = '2025-07-18T07:00:00Z'
        certificateSha256 = ''
        verificationEvidencePath = 'docs/releases/TECH-V0.2-EXTERNAL-EVIDENCE-BUNDLE.md'
    }
}) 'lowercase assurance'
$lowercaseAssurancePassed = @($lowercaseAssurance.Reasons | Where-Object { $_ -eq 'lowercase assurance signature assurance method is not controlled-platform export or certificate signature' }).Count -eq 1
if (-not $lowercaseAssurancePassed) { $failures += 'a lowercase signature assurance method was accepted as canonical' }
$cases += [ordered]@{ name = 'signature-assurance-method-is-case-sensitive'; passed = $lowercaseAssurancePassed }

$exactStatusPassed = (Test-TechV02Approved 'APPROVED') -and -not (Test-TechV02Approved 'approved') -and -not (Test-TechV02Approved 'Approved')
if (-not $exactStatusPassed) { $failures += 'approval status comparison was not exact and case-sensitive' }
$cases += [ordered]@{ name = 'approval-status-is-exact'; passed = $exactStatusPassed }

$exactIntegerPassed = (
    (Test-TechV02ExactIntegerValue 0 0) -and
    -not (Test-TechV02ExactIntegerValue 0.1 0) -and
    -not (Test-TechV02ExactIntegerValue '0' 0) -and
    -not (Test-TechV02ExactIntegerValue $false 0)
)
if (-not $exactIntegerPassed) { $failures += 'exact integer validation accepted a fractional, string, or boolean lookalike' }
$cases += [ordered]@{ name = 'exact-integer-rejects-castable-lookalikes'; passed = $exactIntegerPassed }

$strictTimestampPassed = (
    (Test-TechV02IsoTimestamp '2025-07-18T07:00:00Z') -and
    (Test-TechV02IsoTimestamp '2025-07-18T15:00:00.1234567+08:00') -and
    -not (Test-TechV02IsoTimestamp '7/18/2025 07:00') -and
    -not (Test-TechV02IsoTimestamp '2025/07/18') -and
    -not (Test-TechV02IsoTimestamp 'July 18, 2025') -and
    -not (Test-TechV02IsoTimestamp '2025-07-18T07:00:00')
)
if (-not $strictTimestampPassed) { $failures += 'timestamp validation accepted a localized or timezone-ambiguous value' }
$cases += [ordered]@{ name = 'timestamps-require-explicit-iso-8601-offset'; passed = $strictTimestampPassed }

$envelopeCommand = Get-Command Test-TechV02ReleaseEnvelope -CommandType Function -ErrorAction SilentlyContinue
$strictEnvelopePassed = $false
if ($envelopeCommand) {
    $validEnvelope = Test-TechV02ReleaseEnvelope ([pscustomobject]@{ schemaVersion = 1; releaseVersion = 'TECH-V0.2' }) 'unit envelope' 'TECH-V0.2'
    $stringSchemaEnvelope = Test-TechV02ReleaseEnvelope ([pscustomobject]@{ schemaVersion = '1'; releaseVersion = 'TECH-V0.2' }) 'unit envelope' 'TECH-V0.2'
    $fractionalSchemaEnvelope = Test-TechV02ReleaseEnvelope ([pscustomobject]@{ schemaVersion = [decimal]1.0; releaseVersion = 'TECH-V0.2' }) 'unit envelope' 'TECH-V0.2'
    $lowercaseVersionEnvelope = Test-TechV02ReleaseEnvelope ([pscustomobject]@{ schemaVersion = 1; releaseVersion = 'tech-v0.2' }) 'unit envelope' 'TECH-V0.2'
    $strictEnvelopePassed = (
        $validEnvelope.Reasons.Count -eq 0 -and
        $stringSchemaEnvelope.Reasons.Count -gt 0 -and
        $fractionalSchemaEnvelope.Reasons.Count -gt 0 -and
        $lowercaseVersionEnvelope.Reasons.Count -gt 0
    )
}
if (-not $strictEnvelopePassed) { $failures += 'release envelope schemaVersion/releaseVersion validation was coercive or case-insensitive' }
$cases += [ordered]@{ name = 'release-envelope-schema-and-version-are-exact'; passed = $strictEnvelopePassed }

$reparseCandidate = $null
$nodeModules = Join-Path $script:TechV02EvidenceRepoRoot 'apps\web\node_modules'
if (Test-Path -LiteralPath $nodeModules -PathType Container) {
    $reparseCandidate = Get-ChildItem -LiteralPath $nodeModules -Force -ErrorAction SilentlyContinue |
        Where-Object { ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 } |
        Select-Object -First 1
}
if ($reparseCandidate) {
    $reparsePassed = (Test-TechV02PathContainsReparsePoint $reparseCandidate.FullName) -and -not (Resolve-TechV02WorkspacePath $reparseCandidate.FullName)
    if (-not $reparsePassed) { $failures += 'reparse-point evidence path was not rejected' }
    $cases += [ordered]@{ name = 'reparse-point-path-rejected'; passed = $reparsePassed; candidate = (Get-TechV02RelativePath $reparseCandidate.FullName) }
} else {
    $reparsePassed = $false
    $failures += 'reparse-point rejection coverage was unavailable; the security suite fails closed'
    $cases += [ordered]@{ name = 'reparse-point-path-rejected'; passed = $reparsePassed; skipped = $true; reason = 'no existing first-level node_modules reparse point was available' }
}

$ssoExamplePath = Join-Path $script:TechV02EvidenceRepoRoot 'docs\releases\external-evidence-examples\TECH-V0.2-TARGET-SSO.example.json'
$ssoExample = Read-TechV02JsonReference $ssoExamplePath 'SSO negative example'
$ssoResult = Convert-TechV02SsoEvidence $ssoExample
$ssoApprovalPassed = (
    @($ssoResult.Reasons | Where-Object { $_ -match '^target SSO approval .+ is not SIGNED/APPROVED$' }).Count -eq 10 -and
    $ssoResult.Output.Keys -contains 'approvals' -and
    @($ssoResult.Output.approvals).Count -eq 10
)
if (-not $ssoApprovalPassed) { $failures += 'target SSO evidence did not require the ten acceptance-specific human approvals' }
$cases += [ordered]@{ name = 'target-sso-requires-ten-specific-approvals'; passed = $ssoApprovalPassed }

$originalSsoRoleCode = $ssoExample.Document.roleResults[0].roleCode
$ssoExample.Document.roleResults[0].roleCode = $originalSsoRoleCode.ToLowerInvariant()
$lowercaseSsoRoleResult = Convert-TechV02SsoEvidence $ssoExample
$lowercaseSsoRolePassed = @($lowercaseSsoRoleResult.Reasons | Where-Object { $_ -eq "target SSO requires exactly one role result for $originalSsoRoleCode" }).Count -eq 1
if (-not $lowercaseSsoRolePassed) { $failures += 'a lowercase SSO role code was accepted as the canonical role' }
$cases += [ordered]@{ name = 'target-sso-role-code-is-case-sensitive'; passed = $lowercaseSsoRolePassed }
$ssoExample.Document.roleResults[0].roleCode = $originalSsoRoleCode

$originalSsoRoles = @($ssoExample.Document.roleResults)
$ssoExample.Document.roleResults = @($originalSsoRoles) + @([pscustomobject]@{ roleCode = 'UNRECOGNIZED_ROLE'; status = 'PASS'; evidencePath = $supportingEvidencePath })
$extraSsoRoleResult = Convert-TechV02SsoEvidence $ssoExample
$extraSsoRolePassed = @($extraSsoRoleResult.Reasons | Where-Object { $_ -eq 'target SSO requires exactly 6 role results; found 7' }).Count -eq 1
if (-not $extraSsoRolePassed) { $failures += 'an extra unknown SSO role result was ignored' }
$cases += [ordered]@{ name = 'target-sso-rejects-extra-role-results'; passed = $extraSsoRolePassed }
$ssoExample.Document.roleResults = $originalSsoRoles

$operationsExamplePath = Join-Path $script:TechV02EvidenceRepoRoot 'docs\releases\external-evidence-examples\TECH-V0.2-TARGET-OPERATIONS.example.json'
$operationsExample = Read-TechV02JsonReference $operationsExamplePath 'operations negative example'
$operationsResult = Convert-TechV02OperationsEvidence $operationsExample ('0' * 64)
$expectedOperationsRoles = @('BUSINESS_OWNER','PRODUCT_OWNER','OPERATIONS_OWNER','DBA_OWNER','OBJECT_STORAGE_OWNER','SECURITY_OWNER','MONITORING_ONCALL_OWNER','QA_OWNER','CTO','RELEASE_OWNER')
$operationsApprovalPassed = (
    @($operationsResult.Reasons | Where-Object { $_ -match '^target operations approval .+ is not SIGNED/APPROVED$' }).Count -eq 10 -and
    $operationsResult.Output.Keys -contains 'approvals' -and
    @($operationsResult.Output.approvals).Count -eq 10 -and
    ((@($operationsResult.Output.approvals | ForEach-Object { $_.roleCode }) -join '|') -ceq ($expectedOperationsRoles -join '|'))
)
if (-not $operationsApprovalPassed) { $failures += 'target operations evidence did not require the ten acceptance-specific human approvals' }
$cases += [ordered]@{ name = 'target-operations-requires-ten-specific-approvals'; passed = $operationsApprovalPassed }

$attachmentExamplePath = Join-Path $script:TechV02EvidenceRepoRoot 'docs\releases\external-evidence-examples\TECH-V0.2-FIELD-PHOTO-AND-TARGET-ATTACHMENT.example.json'
$attachmentExample = Read-TechV02JsonReference $attachmentExamplePath 'attachment negative example'
$attachmentResult = Convert-TechV02AttachmentEvidence $attachmentExample
$photoBindingPassed = (
    @($attachmentResult.Reasons | Where-Object { $_ -match 'original photo file path' }).Count -gt 0 -and
    $attachmentResult.Output.photo.Keys -contains 'originalFileUri' -and
    [string]::IsNullOrWhiteSpace($attachmentResult.Output.photo.originalFileUri)
)
if (-not $photoBindingPassed) { $failures += 'field-photo declaration was not required to bind the original photo file bytes' }
$cases += [ordered]@{ name = 'field-photo-requires-original-file-byte-binding'; passed = $photoBindingPassed }

$traceResult = Test-TechV02SourceTraceability $null
$traceGovernancePassed = (
    @($traceResult.Reasons | Where-Object { $_ -match 'controlled Git remote' }).Count -gt 0 -and
    @($traceResult.Reasons | Where-Object { $_ -match 'repository approval' }).Count -gt 0 -and
    @($traceResult.Reasons | Where-Object { $_ -match 'approvedHeadCommit' }).Count -gt 0 -and
    @($traceResult.Reasons | Where-Object { $_ -match 'approvedArtifactManifestSha256' }).Count -gt 0 -and
    @($traceResult.Reasons | Where-Object { $_ -match 'remotePublishedAt' }).Count -gt 0 -and
    $traceResult.Output.repositoryApproval.Keys -contains 'approvedRemoteUrl' -and
    $traceResult.Output.repositoryApproval.Keys -contains 'approvedHeadCommit'
)
if (-not $traceGovernancePassed) { $failures += 'source traceability did not require a controlled remote and repository-owner approval' }
$cases += [ordered]@{ name = 'source-traceability-requires-controlled-remote-and-owner-approval'; passed = $traceGovernancePassed }

$controlledRemotePassed = (
    (Test-TechV02ControlledGitRemoteUrl 'https://git.company.cn/hotel/hotel-ai-os.git') -and
    (Test-TechV02ControlledGitRemoteUrl 'git@git.company.cn:hotel/hotel-ai-os.git') -and
    -not (Test-TechV02ControlledGitRemoteUrl 'file:///c:/workspace/repo') -and
    -not (Test-TechV02ControlledGitRemoteUrl 'https://localhost/repo.git') -and
    -not (Test-TechV02ControlledGitRemoteUrl 'https://token@example.com/repo.git')
)
if (-not $controlledRemotePassed) { $failures += 'controlled Git remote URL allow/deny rules are incorrect' }
$cases += [ordered]@{ name = 'controlled-git-remote-url-policy'; passed = $controlledRemotePassed }

$canonicalRcTagCommand = Get-Command Test-TechV02CanonicalRcTag -CommandType Function -ErrorAction SilentlyContinue
$canonicalRcTagPassed = $canonicalRcTagCommand -and
    (Test-TechV02CanonicalRcTag 'TECH-V0.2-rc.3') -and
    -not (Test-TechV02CanonicalRcTag 'tech-v0.2-rc.3') -and
    -not (Test-TechV02CanonicalRcTag 'TECH-V0.2-RC.3') -and
    -not (Test-TechV02CanonicalRcTag 3)
if (-not $canonicalRcTagPassed) { $failures += 'RC tag validation accepted a non-canonical case or non-string value' }
$cases += [ordered]@{ name = 'rc-tag-case-and-type-are-canonical'; passed = $canonicalRcTagPassed }

$artifactContractCommand = Get-Command Test-TechV02RequiredReleaseArtifactSet -CommandType Function -ErrorAction SilentlyContinue
$artifactContractPassed = $false
if ($artifactContractCommand) {
    $artifactContractTag = 'TECH-V0.2-rc.3'
    $canonicalArtifacts = @(
        [pscustomobject]@{ file = "hotel-ai-os-api-$artifactContractTag.md" },
        [pscustomobject]@{ file = "hotel-ai-os-core-api-$artifactContractTag.jar" },
        [pscustomobject]@{ file = "hotel-ai-os-db-v13-$artifactContractTag.zip" },
        [pscustomobject]@{ file = "hotel-ai-os-openapi-$artifactContractTag.yaml" },
        [pscustomobject]@{ file = "hotel-ai-os-web-$artifactContractTag.zip" }
    )
    $duplicateArtifacts = @(1..5 | ForEach-Object { [pscustomobject]@{ file = "hotel-ai-os-core-api-$artifactContractTag.jar" } })
    $canonicalArtifactContract = Test-TechV02RequiredReleaseArtifactSet $canonicalArtifacts $artifactContractTag
    $duplicateArtifactContract = Test-TechV02RequiredReleaseArtifactSet $duplicateArtifacts $artifactContractTag
    $artifactContractPassed = $canonicalArtifactContract.Reasons.Count -eq 0 -and $duplicateArtifactContract.Reasons.Count -gt 0
}
if (-not $artifactContractPassed) { $failures += 'the artifact contract did not require the five unique canonical release artifacts' }
$cases += [ordered]@{ name = 'manifest-requires-five-unique-canonical-artifacts'; passed = $artifactContractPassed }

$supportingEvidencePath = 'tools/release/tests/Test-TechV02ExternalEvidenceBundleNegative.ps1'
$verificationEvidencePath = 'docs/releases/TECH-V0.2-EXTERNAL-EVIDENCE-BUNDLE.md'
$testSignedAt = [DateTimeOffset]::UtcNow.AddMinutes(-2).ToString('o')
$testApproverRoles = @(
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
$testApprovals = @()
for ($index = 0; $index -lt $testApproverRoles.Count; $index++) {
    $roleCode = $testApproverRoles[$index]
    $testApprovals += [pscustomobject][ordered]@{
        roleCode = $roleCode
        signatureId = "unit-signature-$index"
        signerId = "unit-signer-$index"
        signerName = "Unit Signer $index"
        signerTitle = "Unit $roleCode"
        status = 'SIGNED'
        decision = 'APPROVED'
        signedAt = $testSignedAt
        signedByHuman = $true
        delegated = $false
        openReservations = 0
        supportingEvidencePath = $supportingEvidencePath
        signatureAssurance = [pscustomobject][ordered]@{
            method = 'CONTROLLED_SIGNING_PLATFORM_EXPORT'
            provider = 'Unit Test Signing Platform'
            verificationId = "unit-verification-$index"
            verificationStatus = 'VERIFIED'
            verifiedAt = $testSignedAt
            certificateSha256 = ''
            verificationEvidencePath = $verificationEvidencePath
        }
    }
}
$positiveApprovalResult = Convert-TechV02AcceptanceApprovals ([pscustomobject]@{ approvals = $testApprovals }) 'approvals' $testApproverRoles 'unit acceptance'
$positiveApprovalPassed = $positiveApprovalResult.Reasons.Count -eq 0 -and @($positiveApprovalResult.Approvals).Count -eq 10
if (-not $positiveApprovalPassed) { $failures += 'a complete ten-human acceptance approval set was not accepted' }
$cases += [ordered]@{ name = 'complete-ten-human-approvals-accepted'; passed = $positiveApprovalPassed }

$releaseSignoffRoles = @(
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
$script:TechV02SignoffMockRecords = @{}
$releaseSignoffPaths = @()
for ($index = 0; $index -lt $releaseSignoffRoles.Count; $index++) {
    $roleCode = $releaseSignoffRoles[$index]
    $mockPath = "unit-release-signoff-$index.json"
    $releaseSignoffPaths += $mockPath
    $script:TechV02SignoffMockRecords[$mockPath] = [pscustomobject]@{
        Ok = $true
        Reasons = @()
        FullPath = $mockPath
        RelativePath = $mockPath
        Sha256 = ('{0:x64}' -f ($index + 1))
        SizeBytes = 1024
        Document = [pscustomobject][ordered]@{
            schemaVersion = 1
            releaseVersion = 'TECH-V0.2'
            evidenceType = 'RELEASE_SIGNOFF'
            roleCode = $roleCode
            signatureId = "unit-release-signature-$index"
            signerId = "unit-release-signer-$index"
            signerName = "Release Signer $index"
            signerTitle = "Release $roleCode"
            status = 'SIGNED'
            decision = 'APPROVED'
            signedAt = $testSignedAt
            signedByHuman = $true
            delegated = $false
            openReservations = 0
            supportingEvidencePath = $supportingEvidencePath
            signatureAssurance = [pscustomobject][ordered]@{
                method = 'CONTROLLED_SIGNING_PLATFORM_EXPORT'
                provider = 'Unit Test Signing Platform'
                verificationId = "unit-release-verification-$index"
                verificationStatus = 'VERIFIED'
                verifiedAt = $testSignedAt
                certificateSha256 = ''
                verificationEvidencePath = $verificationEvidencePath
            }
        }
    }
}
$releaseSignoffBundle = [pscustomobject]@{ releaseSignoffStatus = 'APPROVED'; releaseSignoffPaths = $releaseSignoffPaths }
$originalReadJsonFunction = (Get-Command Read-TechV02JsonReference -CommandType Function).ScriptBlock
try {
    Set-Item -Path Function:Read-TechV02JsonReference -Value {
        param($path, [string]$label)
        $key = $path.ToString()
        if ($script:TechV02SignoffMockRecords.ContainsKey($key)) { return $script:TechV02SignoffMockRecords[$key] }
        return [pscustomobject]@{ Ok = $false; Reasons = @("$label mock path was not registered"); FullPath = $null; RelativePath = ''; Sha256 = ''; SizeBytes = 0; Document = $null }
    }

    $completeSignoffResult = Convert-TechV02SignoffEvidence $releaseSignoffBundle
    $completeSignoffPassed = $completeSignoffResult.Reasons.Count -eq 0 -and @($completeSignoffResult.Output.signatures).Count -eq 10
    if (-not $completeSignoffPassed) { $failures += 'a complete ten-human release signoff set was not accepted' }
    $cases += [ordered]@{ name = 'complete-release-signoff-set-accepted'; passed = $completeSignoffPassed }

    foreach ($invalidReservationCase in @(
        [pscustomobject]@{ name = 'fractional'; value = [decimal]0.1 },
        [pscustomobject]@{ name = 'string'; value = '0' },
        [pscustomobject]@{ name = 'boolean'; value = $false }
    )) {
        $script:TechV02SignoffMockRecords[$releaseSignoffPaths[0]].Document.openReservations = $invalidReservationCase.value
        $invalidReservationResult = Convert-TechV02SignoffEvidence $releaseSignoffBundle
        $invalidReservationPassed = @($invalidReservationResult.Reasons | Where-Object { $_ -eq 'FRONT_DESK_REPRESENTATIVE has open reservations or a non-integer reservation count' }).Count -eq 1
        if (-not $invalidReservationPassed) { $failures += "$($invalidReservationCase.name) release-signoff reservation count was cast to zero and accepted" }
        $cases += [ordered]@{ name = "release-signoff-rejects-$($invalidReservationCase.name)-reservation-count"; passed = $invalidReservationPassed }
    }
    $script:TechV02SignoffMockRecords[$releaseSignoffPaths[0]].Document.openReservations = 0

    $script:TechV02SignoffMockRecords[$releaseSignoffPaths[0]].Document.roleCode = 'front_desk_representative'
    $lowercaseSignoffResult = Convert-TechV02SignoffEvidence $releaseSignoffBundle
    $lowercaseSignoffPassed = @($lowercaseSignoffResult.Reasons | Where-Object { $_ -eq 'exactly one independent signoff JSON is required for FRONT_DESK_REPRESENTATIVE' }).Count -eq 1
    if (-not $lowercaseSignoffPassed) { $failures += 'a lowercase release-signoff role code was accepted as canonical' }
    $cases += [ordered]@{ name = 'release-signoff-role-code-is-case-sensitive'; passed = $lowercaseSignoffPassed }
    $script:TechV02SignoffMockRecords[$releaseSignoffPaths[0]].Document.roleCode = 'FRONT_DESK_REPRESENTATIVE'
} finally {
    Set-Item -Path Function:Read-TechV02JsonReference -Value $originalReadJsonFunction
    Remove-Variable -Scope Script -Name TechV02SignoffMockRecords -ErrorAction SilentlyContinue
}

$testOperationsApprovals = @()
for ($index = 0; $index -lt $expectedOperationsRoles.Count; $index++) {
    $roleCode = $expectedOperationsRoles[$index]
    $testOperationsApprovals += [pscustomobject][ordered]@{
        roleCode = $roleCode
        signatureId = "unit-operations-signature-$index"
        signerId = "unit-operations-signer-$index"
        signerName = "Operations Signer $index"
        signerTitle = "Operations $roleCode"
        status = 'SIGNED'
        decision = 'APPROVED'
        signedAt = $testSignedAt
        signedByHuman = $true
        delegated = $false
        openReservations = 0
        supportingEvidencePath = $supportingEvidencePath
        signatureAssurance = [pscustomobject][ordered]@{
            method = 'CONTROLLED_SIGNING_PLATFORM_EXPORT'
            provider = 'Unit Test Signing Platform'
            verificationId = "unit-operations-verification-$index"
            verificationStatus = 'VERIFIED'
            verifiedAt = $testSignedAt
            certificateSha256 = ''
            verificationEvidencePath = $verificationEvidencePath
        }
    }
}
$positiveOperationsApprovalResult = Convert-TechV02AcceptanceApprovals ([pscustomobject]@{ approvals = $testOperationsApprovals }) 'approvals' $expectedOperationsRoles 'unit operations'
$positiveOperationsApprovalPassed = $positiveOperationsApprovalResult.Reasons.Count -eq 0 -and @($positiveOperationsApprovalResult.Approvals).Count -eq 10
if (-not $positiveOperationsApprovalPassed) { $failures += 'a complete target-operations specialty approval set was not accepted' }
$cases += [ordered]@{ name = 'complete-operations-approvals-accepted'; passed = $positiveOperationsApprovalPassed }

$timelineCommit = [DateTimeOffset]::UtcNow.AddMinutes(-10).ToString('o')
$timelinePublished = [DateTimeOffset]::UtcNow.AddMinutes(-5).ToString('o')
$timelineApproved = [DateTimeOffset]::UtcNow.AddMinutes(-1).ToString('o')
$timelinePassed = (
    (Test-TechV02PublicationTimeline $timelineCommit $timelinePublished $timelineApproved) -and
    -not (Test-TechV02PublicationTimeline $timelinePublished $timelineCommit $timelineApproved) -and
    -not (Test-TechV02PublicationTimeline $timelineCommit $timelineApproved $timelinePublished)
)
if (-not $timelinePassed) { $failures += 'repository publication timeline ordering is incorrect' }
$cases += [ordered]@{ name = 'repository-publication-timeline-policy'; passed = $timelinePassed }

$photoFixturePath = 'docs/uat/evidence/20260717-2231-s21/screenshots/tech-v0.2-uat-screen-001-a-housekeeping-supervisor-workbench-20260717t143510z.png'
$photoFixture = Resolve-TechV02EvidenceFile $photoFixturePath 'unit photo fixture'
$attachmentApprovals = @()
foreach ($roleCode in @('HOUSEKEEPING_SUPERVISOR','GENERAL_MANAGER','QA_OWNER','SECURITY_OPERATIONS_OWNER')) {
    $attachmentApprovals += [pscustomobject][ordered]@{
        roleCode = $roleCode
        status = 'APPROVED'
        signerName = "Unit $roleCode"
        signedAt = $testSignedAt
        signedByHuman = $true
        delegated = $false
        evidencePath = $supportingEvidencePath
        signatureAssurance = [pscustomobject][ordered]@{
            method = 'CONTROLLED_SIGNING_PLATFORM_EXPORT'
            provider = 'Unit Test Signing Platform'
            verificationId = "unit-attachment-$roleCode"
            verificationStatus = 'VERIFIED'
            verifiedAt = $testSignedAt
            certificateSha256 = ''
            verificationEvidencePath = $verificationEvidencePath
        }
    }
}
$positivePhotoDocument = [pscustomobject][ordered]@{
    schemaVersion = 1
    releaseVersion = 'TECH-V0.2'
    evidenceType = 'FIELD_PHOTO_AND_TARGET_ATTACHMENT_ACCEPTANCE'
    acceptanceId = 'unit-photo-byte-binding'
    status = 'APPROVED'
    environmentType = 'TARGET_UAT'
    photo = [pscustomobject][ordered]@{
        sourceType = 'ON_SITE_ORIGINAL'
        synthetic = $false
        originalFilePath = $photoFixturePath
        originalFileName = [System.IO.Path]::GetFileName($photoFixture.FullPath)
        sizeBytes = $photoFixture.SizeBytes
        sha256 = $photoFixture.Sha256
        hotelCode = 'UNIT-HOTEL'
        maskedRoom = '8**'
        capturedAt = $testSignedAt
        capturedBy = 'Unit Operator'
        issueDescription = 'Unit byte binding fixture only'
        privacyReviewPassed = $true
    }
    targetAttachmentChain = [pscustomobject][ordered]@{
        storageType = 'OBJECT_STORAGE'
        objectStoragePersisted = $true
        objectKey = 'unit/photo-fixture.png'
        malwareScanStatus = 'CLEAN'
        authorizationPassed = $true
        unauthorizedAccessDenied = $true
        encryptionAtRestPassed = $true
        lifecyclePolicyPassed = $true
        backupRestorePassed = $true
        uploadSha256 = $photoFixture.Sha256
        downloadSha256 = $photoFixture.Sha256
        restoreSha256 = $photoFixture.Sha256
    }
    workflow = [pscustomobject][ordered]@{ standardEvaluationPassed = $true; remediationTaskCompleted = $true; managerAcceptancePassed = $true }
    approvals = $attachmentApprovals
    evidenceFiles = @([pscustomobject]@{ kind = 'unit-test-support'; path = $supportingEvidencePath })
}
$positivePhotoReference = [pscustomobject]@{
    Ok = $true
    Reasons = @()
    FullPath = $attachmentExample.FullPath
    RelativePath = $attachmentExample.RelativePath
    Sha256 = $attachmentExample.Sha256
    SizeBytes = $attachmentExample.SizeBytes
    Document = $positivePhotoDocument
}
$positivePhotoResult = Convert-TechV02AttachmentEvidence $positivePhotoReference
$positivePhotoPassed = $photoFixture.Ok -and $positivePhotoResult.Reasons.Count -eq 0 -and $positivePhotoResult.Output.photo.originalFileSha256 -eq $photoFixture.Sha256
if (-not $positivePhotoPassed) { $failures += 'a complete photo declaration bound to the actual original bytes was not accepted' }
$cases += [ordered]@{ name = 'complete-original-photo-byte-binding-accepted'; passed = $positivePhotoPassed }

$positivePhotoDocument.targetAttachmentChain.storageType = 'FOO'
$unknownStorageResult = Convert-TechV02AttachmentEvidence $positivePhotoReference
$unknownStoragePassed = @($unknownStorageResult.Reasons | Where-Object { $_ -eq 'target attachment storageType must be OBJECT_STORAGE' }).Count -eq 1
if (-not $unknownStoragePassed) { $failures += 'an unknown attachment storageType was accepted as target object storage' }
$cases += [ordered]@{ name = 'target-attachment-storage-type-is-exact'; passed = $unknownStoragePassed }
$positivePhotoDocument.targetAttachmentChain.storageType = 'OBJECT_STORAGE'

$originalAttachmentRole = $positivePhotoDocument.approvals[0].roleCode
$positivePhotoDocument.approvals[0].roleCode = $originalAttachmentRole.ToLowerInvariant()
$lowercaseAttachmentRoleResult = Convert-TechV02AttachmentEvidence $positivePhotoReference
$lowercaseAttachmentRolePassed = @($lowercaseAttachmentRoleResult.Reasons | Where-Object { $_ -eq "exactly one attachment approval is required for $originalAttachmentRole" }).Count -eq 1
if (-not $lowercaseAttachmentRolePassed) { $failures += 'a lowercase attachment approval role code was accepted as canonical' }
$cases += [ordered]@{ name = 'attachment-approval-role-code-is-case-sensitive'; passed = $lowercaseAttachmentRolePassed }
$positivePhotoDocument.approvals[0].roleCode = $originalAttachmentRole

$originalAttachmentApprovals = @($positivePhotoDocument.approvals)
$positivePhotoDocument.approvals = @($originalAttachmentApprovals) + @([pscustomobject]@{ roleCode = 'UNRECOGNIZED_APPROVER' })
$extraAttachmentApprovalResult = Convert-TechV02AttachmentEvidence $positivePhotoReference
$extraAttachmentApprovalPassed = @($extraAttachmentApprovalResult.Reasons | Where-Object { $_ -eq 'exactly 4 attachment approvals are required; found 5' }).Count -eq 1
if (-not $extraAttachmentApprovalPassed) { $failures += 'an extra unknown attachment approval was ignored' }
$cases += [ordered]@{ name = 'attachment-rejects-extra-approvals'; passed = $extraAttachmentApprovalPassed }
$positivePhotoDocument.approvals = $originalAttachmentApprovals

$positivePhotoDocument.photo.originalFileName = 'different-unit-file.png'
$wrongPhotoNameResult = Convert-TechV02AttachmentEvidence $positivePhotoReference
$wrongPhotoNamePassed = @($wrongPhotoNameResult.Reasons | Where-Object { $_ -eq 'original photo file name does not match photo.originalFileName' }).Count -eq 1
if (-not $wrongPhotoNamePassed) { $failures += 'a mismatched original photo file name was not rejected' }
$cases += [ordered]@{ name = 'mismatched-original-photo-name-rejected'; passed = $wrongPhotoNamePassed }
$positivePhotoDocument.photo.originalFileName = [System.IO.Path]::GetFileName($photoFixture.FullPath)

$positivePhotoDocument.photo.sizeBytes = [long]$photoFixture.SizeBytes + 1
$wrongPhotoSizeResult = Convert-TechV02AttachmentEvidence $positivePhotoReference
$wrongPhotoSizePassed = @($wrongPhotoSizeResult.Reasons | Where-Object { $_ -eq 'original photo file size does not match photo.sizeBytes' }).Count -eq 1
if (-not $wrongPhotoSizePassed) { $failures += 'a mismatched original photo byte count was not rejected' }
$cases += [ordered]@{ name = 'mismatched-original-photo-size-rejected'; passed = $wrongPhotoSizePassed }
$positivePhotoDocument.photo.sizeBytes = $photoFixture.SizeBytes

$acceptanceFixture = Resolve-TechV02EvidenceFile $attachmentExample.RelativePath 'unit acceptance self-reference fixture'
$positivePhotoDocument.photo.originalFilePath = $attachmentExample.RelativePath
$positivePhotoDocument.photo.originalFileName = [System.IO.Path]::GetFileName($acceptanceFixture.FullPath)
$positivePhotoDocument.photo.sizeBytes = $acceptanceFixture.SizeBytes
$positivePhotoDocument.photo.sha256 = $acceptanceFixture.Sha256
$positivePhotoDocument.targetAttachmentChain.uploadSha256 = $acceptanceFixture.Sha256
$positivePhotoDocument.targetAttachmentChain.downloadSha256 = $acceptanceFixture.Sha256
$positivePhotoDocument.targetAttachmentChain.restoreSha256 = $acceptanceFixture.Sha256
$selfReferencedPhotoResult = Convert-TechV02AttachmentEvidence $positivePhotoReference
$selfReferencedPhotoPassed = @($selfReferencedPhotoResult.Reasons | Where-Object { $_ -eq 'original photo file must be distinct from its acceptance JSON declaration' }).Count -eq 1
if (-not $selfReferencedPhotoPassed) { $failures += 'an acceptance JSON self-reference was not rejected as an original photo' }
$cases += [ordered]@{ name = 'acceptance-json-cannot-be-original-photo'; passed = $selfReferencedPhotoPassed }

$positivePhotoDocument.photo.originalFilePath = $photoFixturePath
$positivePhotoDocument.photo.originalFileName = [System.IO.Path]::GetFileName($photoFixture.FullPath)
$positivePhotoDocument.photo.sizeBytes = $photoFixture.SizeBytes
$positivePhotoDocument.photo.sha256 = $photoFixture.Sha256
$positivePhotoDocument.targetAttachmentChain.uploadSha256 = $photoFixture.Sha256
$positivePhotoDocument.targetAttachmentChain.downloadSha256 = $photoFixture.Sha256
$positivePhotoDocument.targetAttachmentChain.restoreSha256 = $photoFixture.Sha256

$positivePhotoDocument.photo.sha256 = '0' * 64
$positivePhotoDocument.targetAttachmentChain.uploadSha256 = '0' * 64
$positivePhotoDocument.targetAttachmentChain.downloadSha256 = '0' * 64
$positivePhotoDocument.targetAttachmentChain.restoreSha256 = '0' * 64
$tamperedPhotoResult = Convert-TechV02AttachmentEvidence $positivePhotoReference
$tamperedPhotoPassed = @($tamperedPhotoResult.Reasons | Where-Object { $_ -eq 'original photo file SHA-256 does not match photo.sha256' }).Count -eq 1
if (-not $tamperedPhotoPassed) { $failures += 'a tampered declared photo SHA-256 was not rejected against the original file bytes' }
$cases += [ordered]@{ name = 'tampered-original-photo-sha-rejected'; passed = $tamperedPhotoPassed }

$result = [ordered]@{
    status = if ($failures.Count -eq 0) { 'PASS' } else { 'FAIL' }
    cases = $cases
    failures = $failures
    mutations = [ordered]@{ filesWritten = 0; signaturesCreated = 0; approvalsCreated = 0; commitsCreated = 0; tagsCreated = 0; networkWrites = 0 }
}
$result | ConvertTo-Json -Depth 10
if ($failures.Count -eq 0) { exit 0 }
exit 1
