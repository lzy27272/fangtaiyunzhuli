[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$gatePath = Join-Path $repoRoot 'tools\release\Test-TechV02ReleaseGate.ps1'
$exampleInputsPath = Join-Path $repoRoot 'docs\releases\TECH-V0.2-RELEASE-GATE-INPUTS.example.json'
$cases = New-Object 'System.Collections.Generic.List[object]'
$failures = New-Object 'System.Collections.Generic.List[string]'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Add-Case([string]$name, [bool]$passed, [string]$detail) {
    $cases.Add([pscustomobject][ordered]@{ name = $name; passed = $passed; detail = $detail })
    if (-not $passed) { $failures.Add("$name`: $detail") }
}

function Get-BytesSha256([byte[]]$bytes) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Get-TextSha256([string]$value) {
    return Get-BytesSha256 ([System.Text.Encoding]::UTF8.GetBytes($value))
}

function Get-FileSha256([string]$path) {
    $stream = New-Object System.IO.FileStream($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    try {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
        } finally {
            $sha.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

function Get-WorkspaceRelativePath([string]$path) {
    $fullPath = [System.IO.Path]::GetFullPath($path)
    $prefix = $repoRoot.TrimEnd('\') + '\'
    if (-not $fullPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Test path is outside the workspace: $path"
    }
    return $fullPath.Substring($prefix.Length).Replace('\', '/')
}

function Get-PowerShellExecutable {
    $currentProcess = Get-Process -Id $PID
    if ($currentProcess.Path -and (Test-Path -LiteralPath $currentProcess.Path -PathType Leaf)) { return $currentProcess.Path }
    foreach ($name in @('powershell.exe', 'pwsh.exe')) {
        $candidate = Join-Path $PSHOME $name
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    throw 'Unable to resolve a PowerShell executable for the evidence-binding regression test.'
}

function Quote-ProcessArgument([string]$value) {
    if ($value.IndexOf('"') -ge 0 -or $value.IndexOf("`r") -ge 0 -or $value.IndexOf("`n") -ge 0 -or $value.IndexOf([char]0) -ge 0) {
        throw 'Unsupported child-process argument character.'
    }
    return '"' + $value + '"'
}

function Invoke-Gate([string]$inputsPath, [scriptblock]$mutation = $null, [int]$mutationDelayMilliseconds = 0) {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = Get-PowerShellExecutable
    $startInfo.Arguments = @(
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        (Quote-ProcessArgument $gatePath),
        '-InputsPath',
        (Quote-ProcessArgument $inputsPath)
    ) -join ' '
    $startInfo.WorkingDirectory = $repoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw 'Failed to start the release gate child process.' }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $inputLockObserved = $false
    if ($null -ne $mutation) {
        try {
            $lockDeadline = [DateTimeOffset]::UtcNow.AddSeconds(5)
            while (-not $process.HasExited -and [DateTimeOffset]::UtcNow -lt $lockDeadline) {
                $probe = $null
                try {
                    $probe = New-Object System.IO.FileStream($inputsPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
                } catch [System.IO.IOException] {
                    $inputLockObserved = $true
                    break
                } finally {
                    if ($probe) { $probe.Dispose() }
                }
                Start-Sleep -Milliseconds 10
            }
            if (-not $inputLockObserved) { throw 'The gate input lock was not observed before the mutation deadline.' }
            if ($mutationDelayMilliseconds -gt 0) { Start-Sleep -Milliseconds $mutationDelayMilliseconds }
            & $mutation
        } catch {
            if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
            $process.Dispose()
            throw
        }
    }
    $process.WaitForExit()
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    $exitCode = $process.ExitCode
    $process.Dispose()

    $document = $null
    $parseError = $null
    try { $document = $stdout | ConvertFrom-Json }
    catch { $parseError = $_.Exception.Message }
    return [pscustomobject][ordered]@{
        ExitCode = $exitCode
        Stderr = $stderr
        ParseError = $parseError
        Document = $document
        InputLockObserved = $inputLockObserved
    }
}

function Test-GateReadOnlyContract($gate) {
    if ($null -eq $gate.Document -or -not [string]::IsNullOrWhiteSpace($gate.ParseError)) { return $false }
    $safeguards = $gate.Document.safeguards
    return (
        $gate.ExitCode -eq 2 -and
        [string]::IsNullOrWhiteSpace($gate.Stderr) -and
        $gate.Document.status -ceq 'BLOCKED' -and
        [int]$gate.Document.summary.total -eq 6 -and
        $safeguards.readOnly -is [bool] -and $safeguards.readOnly -and
        $safeguards.inputBytesLockedDuringEvaluation -is [bool] -and $safeguards.inputBytesLockedDuringEvaluation -and
        [int]$safeguards.signaturesCreated -eq 0 -and
        [int]$safeguards.approvalsCreated -eq 0 -and
        [int]$safeguards.commitsCreated -eq 0 -and
        [int]$safeguards.tagsCreated -eq 0 -and
        [int]$safeguards.networkWrites -eq 0
    )
}

function Get-GateCheck($gate, [string]$gateId) {
    if ($null -eq $gate.Document) { return $null }
    $matches = @($gate.Document.checks | Where-Object { $_.id -ceq $gateId })
    if ($matches.Count -ne 1) { return $null }
    return $matches[0]
}

function New-GateInputsDocument {
    return Get-Content -LiteralPath $exampleInputsPath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Write-GateInputs($document, [string]$path) {
    $json = $document | ConvertTo-Json -Depth 50
    [System.IO.File]::WriteAllText($path, $json, $utf8NoBom)
}

function Write-Utf8BomText([string]$path, [string]$text) {
    $payload = $utf8NoBom.GetBytes($text)
    $bytes = New-Object byte[] ($payload.Length + 3)
    $bytes[0] = 0xEF
    $bytes[1] = 0xBB
    $bytes[2] = 0xBF
    [System.Array]::Copy($payload, 0, $bytes, 3, $payload.Length)
    [System.IO.File]::WriteAllBytes($path, $bytes)
}

function Wait-ForReadLock([string]$path, [int]$timeoutSeconds = 10) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($timeoutSeconds)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $probe = $null
        try {
            $probe = New-Object System.IO.FileStream($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        } catch [System.IO.IOException] {
            return $true
        } finally {
            if ($probe) { $probe.Dispose() }
        }
        Start-Sleep -Milliseconds 5
    }
    return $false
}

function Get-GitGovernanceFingerprint {
    $parts = New-Object 'System.Collections.Generic.List[string]'
    foreach ($relativePath in @('.git\HEAD', '.git\config', '.git\packed-refs')) {
        $fullPath = Join-Path $repoRoot $relativePath
        if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
            $parts.Add("file:$($relativePath.Replace('\','/')):$(Get-FileSha256 $fullPath)")
        } else {
            $parts.Add("file:$($relativePath.Replace('\','/')):MISSING")
        }
    }
    foreach ($relativeDirectory in @('.git\refs\heads', '.git\refs\tags')) {
        $fullDirectory = Join-Path $repoRoot $relativeDirectory
        if (-not (Test-Path -LiteralPath $fullDirectory -PathType Container)) {
            $parts.Add("dir:$($relativeDirectory.Replace('\','/')):MISSING")
            continue
        }
        foreach ($file in @(Get-ChildItem -LiteralPath $fullDirectory -File -Recurse -Force | Sort-Object FullName)) {
            $relativeFile = Get-WorkspaceRelativePath $file.FullName
            $parts.Add("ref:$relativeFile`:$(Get-FileSha256 $file.FullName)")
        }
    }
    return Get-TextSha256 ((@($parts) | Sort-Object) -join "`n")
}

$testParent = [System.IO.Path]::GetFullPath((Join-Path $repoRoot '.uat-runtime\release\tests'))
$runRoot = [System.IO.Path]::GetFullPath((Join-Path $testParent ('gate-evidence-binding-' + [Guid]::NewGuid().ToString('N'))))
$testParentPrefix = $testParent.TrimEnd('\') + '\'
if (-not $runRoot.StartsWith($testParentPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    [System.IO.Path]::GetFileName($runRoot) -notlike 'gate-evidence-binding-*') {
    throw 'Evidence-binding test directory did not resolve beneath the controlled workspace test directory.'
}

$governanceBefore = Get-GitGovernanceFingerprint
$cleanupError = $null
[void][System.IO.Directory]::CreateDirectory($runRoot)
try {
    # Case 1: a stable acceptance evidence file is re-read without a false hash mismatch.
    $stableDirectory = Join-Path $runRoot 'stable-acceptance'
    [void][System.IO.Directory]::CreateDirectory($stableDirectory)
    $stableEvidencePath = Join-Path $stableDirectory 'sso-acceptance-evidence.bin'
    $stableBytes = [System.Text.Encoding]::UTF8.GetBytes('stable-acceptance-evidence-v1')
    [System.IO.File]::WriteAllBytes($stableEvidencePath, $stableBytes)
    $stableEvidenceSha = Get-BytesSha256 $stableBytes
    $stableInputs = New-GateInputsDocument
    $stableInputs.targetSsoAcceptance.evidenceUri = Get-WorkspaceRelativePath $stableEvidencePath
    $stableInputs.targetSsoAcceptance.evidenceSha256 = $stableEvidenceSha
    $stableInputsPath = Join-Path $stableDirectory 'gate-inputs.json'
    Write-GateInputs $stableInputs $stableInputsPath
    $stableGate = Invoke-Gate $stableInputsPath
    $stableCheck = Get-GateCheck $stableGate 'REL-P0-02'
    $stableMismatchReasons = if ($null -eq $stableCheck) { @('missing check') } else { @($stableCheck.reasons | Where-Object { $_ -match 'target SSO acceptance declaration.*SHA-256' }) }
    $stableEvidenceListed = $null -ne $stableCheck -and @($stableCheck.evidence | Where-Object { $_ -ceq (Get-WorkspaceRelativePath $stableEvidencePath) }).Count -eq 1
    $stablePassed = (
        (Test-GateReadOnlyContract $stableGate) -and
        $null -ne $stableCheck -and
        @($stableMismatchReasons).Count -eq 0 -and
        $stableEvidenceListed -and
        [int]$stableGate.Document.safeguards.finalEvidenceReferencesRevalidated -ge 1
    )
    Add-Case 'stable-evidence-reference-rehashes-without-false-mismatch' $stablePassed "exit=$($stableGate.ExitCode), mismatches=$(@($stableMismatchReasons).Count), finalRefs=$($stableGate.Document.safeguards.finalEvidenceReferencesRevalidated)"

    # Case 2: replacing evidence bytes after gate-input creation must be detected by REL-P0-02.
    $mutatedDirectory = Join-Path $runRoot 'mutated-acceptance'
    [void][System.IO.Directory]::CreateDirectory($mutatedDirectory)
    $mutatedEvidencePath = Join-Path $mutatedDirectory 'sso-acceptance-evidence.bin'
    $mutatedOriginalBytes = [System.Text.Encoding]::UTF8.GetBytes('acceptance-evidence-before-gate-input')
    [System.IO.File]::WriteAllBytes($mutatedEvidencePath, $mutatedOriginalBytes)
    $mutatedInputs = New-GateInputsDocument
    $mutatedInputs.targetSsoAcceptance.evidenceUri = Get-WorkspaceRelativePath $mutatedEvidencePath
    $mutatedInputs.targetSsoAcceptance.evidenceSha256 = Get-BytesSha256 $mutatedOriginalBytes
    $mutatedInputsPath = Join-Path $mutatedDirectory 'gate-inputs.json'
    Write-GateInputs $mutatedInputs $mutatedInputsPath
    [System.IO.File]::WriteAllBytes($mutatedEvidencePath, [System.Text.Encoding]::UTF8.GetBytes('acceptance-evidence-replaced-after-gate-input'))
    $mutatedGate = Invoke-Gate $mutatedInputsPath
    $mutatedCheck = Get-GateCheck $mutatedGate 'REL-P0-02'
    $mutatedMismatchReasons = if ($null -eq $mutatedCheck) { @() } else { @($mutatedCheck.reasons | Where-Object { $_ -match 'target SSO acceptance declaration SHA-256 does not match the locked evidence file bytes' }) }
    $mutatedPassed = (
        (Test-GateReadOnlyContract $mutatedGate) -and
        $null -ne $mutatedCheck -and
        $mutatedCheck.status -ceq 'BLOCKED' -and
        @($mutatedMismatchReasons).Count -eq 1 -and
        [int]$mutatedGate.Document.safeguards.finalEvidenceReferencesRevalidated -ge 1
    )
    Add-Case 'post-input-evidence-byte-replacement-is-blocked' $mutatedPassed "exit=$($mutatedGate.ExitCode), mismatchReasons=$(@($mutatedMismatchReasons).Count), finalRefs=$($mutatedGate.Document.safeguards.finalEvidenceReferencesRevalidated)"

    # Case 3: signature-assurance verification evidence is subject to the same byte rehash.
    $assuranceDirectory = Join-Path $runRoot 'mutated-signature-assurance'
    [void][System.IO.Directory]::CreateDirectory($assuranceDirectory)
    $assuranceEvidencePath = Join-Path $assuranceDirectory 'verification-export.bin'
    $assuranceOriginalBytes = [System.Text.Encoding]::UTF8.GetBytes('controlled-signing-export-before-input')
    [System.IO.File]::WriteAllBytes($assuranceEvidencePath, $assuranceOriginalBytes)
    $assuranceInputs = New-GateInputsDocument
    $assurance = $assuranceInputs.releaseSignoffs.signatures[0].signatureAssurance
    $assurance.method = 'CONTROLLED_SIGNING_PLATFORM_EXPORT'
    $assurance.provider = 'controlled-test-signing-platform'
    $assurance.verificationId = 'test-verification-001'
    $assurance.verificationStatus = 'VERIFIED'
    $assurance.verifiedAt = [DateTimeOffset]::UtcNow.AddMinutes(-1).ToString('o')
    $assurance.verificationEvidenceUri = Get-WorkspaceRelativePath $assuranceEvidencePath
    $assurance.verificationEvidenceSha256 = Get-BytesSha256 $assuranceOriginalBytes
    $assuranceInputsPath = Join-Path $assuranceDirectory 'gate-inputs.json'
    Write-GateInputs $assuranceInputs $assuranceInputsPath
    [System.IO.File]::WriteAllBytes($assuranceEvidencePath, [System.Text.Encoding]::UTF8.GetBytes('controlled-signing-export-replaced-after-input'))
    $assuranceGate = Invoke-Gate $assuranceInputsPath
    $assuranceCheck = Get-GateCheck $assuranceGate 'REL-P0-03'
    $assuranceMismatchReasons = if ($null -eq $assuranceCheck) { @() } else { @($assuranceCheck.reasons | Where-Object { $_ -match 'FRONT_DESK_REPRESENTATIVE signoff signature verification evidence SHA-256 does not match the locked evidence file bytes' }) }
    $assurancePassed = (
        (Test-GateReadOnlyContract $assuranceGate) -and
        $null -ne $assuranceCheck -and
        $assuranceCheck.status -ceq 'BLOCKED' -and
        @($assuranceMismatchReasons).Count -eq 1 -and
        [int]$assuranceGate.Document.safeguards.finalEvidenceReferencesRevalidated -ge 1
    )
    Add-Case 'signature-assurance-verification-export-is-rehashed' $assurancePassed "exit=$($assuranceGate.ExitCode), mismatchReasons=$(@($assuranceMismatchReasons).Count), finalRefs=$($assuranceGate.Document.safeguards.finalEvidenceReferencesRevalidated)"

    # Case 4: all five manifest artifacts and the manifest itself reach final revalidation.
    $artifactDirectory = Join-Path $runRoot 'manifest-artifacts'
    [void][System.IO.Directory]::CreateDirectory($artifactDirectory)
    $artifactEntries = @()
    $fingerprintParts = @()
    $sumLines = @()
    foreach ($fileName in @(
        'hotel-ai-os-core-api-TECH-V0.2-rc.3.jar',
        'hotel-ai-os-web-TECH-V0.2-rc.3.zip',
        'hotel-ai-os-db-v13-TECH-V0.2-rc.3.zip',
        'hotel-ai-os-openapi-TECH-V0.2-rc.3.yaml',
        'hotel-ai-os-api-TECH-V0.2-rc.3.md'
    )) {
        $artifactPath = Join-Path $artifactDirectory $fileName
        $artifactBytes = [System.Text.Encoding]::UTF8.GetBytes("controlled-artifact-$fileName")
        [System.IO.File]::WriteAllBytes($artifactPath, $artifactBytes)
        $artifactSha = Get-BytesSha256 $artifactBytes
        $artifactEntries += [ordered]@{ file = $fileName; sizeBytes = $artifactBytes.Length; sha256 = $artifactSha }
        $fingerprintParts += "$fileName`:$artifactSha"
        $sumLines += "$artifactSha  $fileName"
    }
    $manifest = [ordered]@{
        schemaVersion = 1
        releaseVersion = 'TECH-V0.2-rc.3'
        versions = [ordered]@{ database = 'DB-V13'; apiBase = '/api/v1' }
        source = [ordered]@{ commit = ('0' * 40); dirty = $false }
        artifacts = $artifactEntries
        reproducibleBuild = [ordered]@{ payloadFingerprintSha256 = Get-TextSha256 ($fingerprintParts -join "`n") }
    }
    $manifestPath = Join-Path $artifactDirectory 'manifest.json'
    Write-Utf8BomText $manifestPath ($manifest | ConvertTo-Json -Depth 20)
    $sumsPath = Join-Path $artifactDirectory 'SHA256SUMS.txt'
    [System.IO.File]::WriteAllText($sumsPath, (($sumLines -join "`r`n") + "`r`n"), [System.Text.Encoding]::ASCII)
    $artifactInputs = New-GateInputsDocument
    $artifactInputs.sourceTraceability.rcTag = 'TECH-V0.2-rc.3'
    $artifactInputs.sourceTraceability.artifactManifestPath = Get-WorkspaceRelativePath $manifestPath
    $artifactInputs.sourceTraceability.sha256SumsPath = Get-WorkspaceRelativePath $sumsPath
    $artifactInputsPath = Join-Path $artifactDirectory 'gate-inputs.json'
    Write-GateInputs $artifactInputs $artifactInputsPath
    $artifactGate = Invoke-Gate $artifactInputsPath
    $artifactCheck = Get-GateCheck $artifactGate 'REL-P0-05'
    $artifactDriftReasons = if ($null -eq $artifactCheck) { @('missing check') } else { @($artifactCheck.reasons | Where-Object { $_ -match 'release artifact .*changed|artifact manifest .*changed|artifact SHA-256 mismatch|artifact size mismatch' }) }
    $expectedArtifactEvidence = @($artifactEntries | ForEach-Object { Get-WorkspaceRelativePath (Join-Path $artifactDirectory $_.file) }) + @(
        Get-WorkspaceRelativePath $manifestPath
        Get-WorkspaceRelativePath $sumsPath
    )
    $artifactEvidencePresent = $null -ne $artifactCheck -and @($expectedArtifactEvidence | Where-Object { $artifactCheck.evidence -notcontains $_ }).Count -eq 0
    $artifactPassed = (
        (Test-GateReadOnlyContract $artifactGate) -and
        $null -ne $artifactCheck -and
        @($artifactDriftReasons).Count -eq 0 -and
        $artifactEvidencePresent -and
        [int]$artifactGate.Document.safeguards.finalEvidenceReferencesRevalidated -ge 7
    )
    Add-Case 'manifest-and-five-artifacts-reach-final-revalidation' $artifactPassed "exit=$($artifactGate.ExitCode), driftReasons=$(@($artifactDriftReasons).Count), finalRefs=$($artifactGate.Document.safeguards.finalEvidenceReferencesRevalidated)"
    $manifestBomBytes = [System.IO.File]::ReadAllBytes($manifestPath)
    $manifestBomPresent = $manifestBomBytes.Length -ge 3 -and $manifestBomBytes[0] -eq 0xEF -and $manifestBomBytes[1] -eq 0xBB -and $manifestBomBytes[2] -eq 0xBF
    Add-Case 'locked-manifest-allows-one-leading-utf8-bom' ($artifactPassed -and $manifestBomPresent) "bomPresent=$manifestBomPresent"

    $rcTagResults = @()
    foreach ($variant in @(
        [pscustomobject]@{ Name = 'lowercase-prefix'; Value = 'tech-v0.2-rc.3' },
        [pscustomobject]@{ Name = 'uppercase-rc'; Value = 'TECH-V0.2-RC.3' },
        [pscustomobject]@{ Name = 'integer'; Value = 3 },
        [pscustomobject]@{ Name = 'boolean'; Value = $true }
    )) {
        $rcTagInputs = New-GateInputsDocument
        $rcTagInputs.sourceTraceability.rcTag = $variant.Value
        $rcTagInputs.sourceTraceability.artifactManifestPath = Get-WorkspaceRelativePath $manifestPath
        $rcTagInputs.sourceTraceability.sha256SumsPath = Get-WorkspaceRelativePath $sumsPath
        $rcTagInputsPath = Join-Path $artifactDirectory ("gate-inputs-rctag-$($variant.Name).json")
        Write-GateInputs $rcTagInputs $rcTagInputsPath
        $rcTagGate = Invoke-Gate $rcTagInputsPath
        $rcTagCheck = Get-GateCheck $rcTagGate 'REL-P0-05'
        $rcTagReasonCount = if ($null -eq $rcTagCheck) { 0 } else { @($rcTagCheck.reasons | Where-Object { $_ -match 'rcTag must be a canonical string matching TECH-V0.2-rc.N' }).Count }
        $rcTagResults += [pscustomobject]@{
            Name = $variant.Name
            Passed = (Test-GateReadOnlyContract $rcTagGate) -and $rcTagReasonCount -eq 1
            ReasonCount = $rcTagReasonCount
        }
    }
    $rcTagPassed = @($rcTagResults | Where-Object { -not $_.Passed }).Count -eq 0
    Add-Case 'rc-tag-requires-canonical-case-and-string-type' $rcTagPassed (($rcTagResults | ForEach-Object { "$($_.Name)=$($_.ReasonCount)" }) -join ', ')

    # Case 5: manifest schema and release identifiers are type- and case-exact.
    $manifestSchemaResults = @()
    foreach ($variant in @(
        [pscustomobject]@{ Name = 'string'; Value = '1' },
        [pscustomobject]@{ Name = 'decimal'; Value = [decimal]1.0 },
        [pscustomobject]@{ Name = 'boolean'; Value = $true }
    )) {
        $variantManifest = $manifest | ConvertTo-Json -Depth 20 | ConvertFrom-Json
        $variantManifest.schemaVersion = $variant.Value
        $variantManifestJson = $variantManifest | ConvertTo-Json -Depth 20
        if ($variant.Name -ceq 'decimal') {
            $schemaTokenPattern = New-Object System.Text.RegularExpressions.Regex('"schemaVersion"\s*:\s*1(?=\s*,)')
            $variantManifestJson = $schemaTokenPattern.Replace($variantManifestJson, '"schemaVersion": 1.0', 1)
        }
        [System.IO.File]::WriteAllText($manifestPath, $variantManifestJson, $utf8NoBom)
        $manifestSchemaGate = Invoke-Gate $artifactInputsPath
        $manifestSchemaCheck = Get-GateCheck $manifestSchemaGate 'REL-P0-05'
        $manifestSchemaReasonCount = if ($null -eq $manifestSchemaCheck) { 0 } else { @($manifestSchemaCheck.reasons | Where-Object { $_ -match 'manifest schemaVersion must be exact integer 1' }).Count }
        $manifestSchemaResults += [pscustomobject]@{
            Name = $variant.Name
            Passed = (Test-GateReadOnlyContract $manifestSchemaGate) -and $manifestSchemaReasonCount -eq 1
            ReasonCount = $manifestSchemaReasonCount
        }
    }
    [System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 20), $utf8NoBom)
    $manifestSchemaPassed = @($manifestSchemaResults | Where-Object { -not $_.Passed }).Count -eq 0
    Add-Case 'manifest-schema-version-requires-exact-integer-one' $manifestSchemaPassed (($manifestSchemaResults | ForEach-Object { "$($_.Name)=$($_.ReasonCount)" }) -join ', ')

    $manifestReleaseVariant = $manifest | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $manifestReleaseVariant.releaseVersion = 'tech-v0.2-rc.3'
    [System.IO.File]::WriteAllText($manifestPath, ($manifestReleaseVariant | ConvertTo-Json -Depth 20), $utf8NoBom)
    $manifestReleaseGate = Invoke-Gate $artifactInputsPath
    $manifestReleaseCheck = Get-GateCheck $manifestReleaseGate 'REL-P0-05'
    $manifestReleaseReasons = if ($null -eq $manifestReleaseCheck) { @() } else { @($manifestReleaseCheck.reasons | Where-Object { $_ -match 'manifest releaseVersion does not exactly equal rcTag' }) }
    $manifestReleasePassed = (Test-GateReadOnlyContract $manifestReleaseGate) -and @($manifestReleaseReasons).Count -eq 1
    Add-Case 'manifest-release-version-is-case-exact' $manifestReleasePassed "reasonCount=$(@($manifestReleaseReasons).Count)"
    [System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 20), $utf8NoBom)

    # Case 6: top-level release inputs reject coercible schema and release values.
    $inputContractDirectory = Join-Path $runRoot 'strict-input-contract'
    [void][System.IO.Directory]::CreateDirectory($inputContractDirectory)
    $inputSchemaResults = @()
    foreach ($variant in @(
        [pscustomobject]@{ Name = 'string'; Value = '1' },
        [pscustomobject]@{ Name = 'decimal'; Value = [decimal]1.0 },
        [pscustomobject]@{ Name = 'boolean'; Value = $true }
    )) {
        $inputSchemaDocument = New-GateInputsDocument
        $inputSchemaDocument.schemaVersion = $variant.Value
        $inputSchemaPath = Join-Path $inputContractDirectory ("gate-inputs-schema-$($variant.Name).json")
        Write-GateInputs $inputSchemaDocument $inputSchemaPath
        if ($variant.Name -ceq 'decimal') {
            $inputSchemaJson = [System.IO.File]::ReadAllText($inputSchemaPath, [System.Text.Encoding]::UTF8)
            $schemaTokenPattern = New-Object System.Text.RegularExpressions.Regex('"schemaVersion"\s*:\s*1(?=\s*,)')
            $inputSchemaJson = $schemaTokenPattern.Replace($inputSchemaJson, '"schemaVersion": 1.0', 1)
            [System.IO.File]::WriteAllText($inputSchemaPath, $inputSchemaJson, $utf8NoBom)
        }
        $inputSchemaGate = Invoke-Gate $inputSchemaPath
        $inputSchemaReasonCount = if ($null -eq $inputSchemaGate.Document) { 0 } else { @($inputSchemaGate.Document.inputsError | Where-Object { $_ -match 'inputs schemaVersion must be exact integer 1' }).Count }
        $inputSchemaResults += [pscustomobject]@{
            Name = $variant.Name
            Passed = (Test-GateReadOnlyContract $inputSchemaGate) -and $inputSchemaGate.Document.inputsStatus -ceq 'BLOCKED' -and $inputSchemaReasonCount -eq 1
            ReasonCount = $inputSchemaReasonCount
        }
    }
    $inputSchemaPassed = @($inputSchemaResults | Where-Object { -not $_.Passed }).Count -eq 0
    Add-Case 'release-input-schema-version-requires-exact-integer-one' $inputSchemaPassed (($inputSchemaResults | ForEach-Object { "$($_.Name)=$($_.ReasonCount)" }) -join ', ')

    $inputReleaseDocument = New-GateInputsDocument
    $inputReleaseDocument.releaseVersion = 'tech-v0.2'
    $inputReleasePath = Join-Path $inputContractDirectory 'gate-inputs-release-case.json'
    Write-GateInputs $inputReleaseDocument $inputReleasePath
    $inputReleaseGate = Invoke-Gate $inputReleasePath
    $inputReleaseReasonCount = if ($null -eq $inputReleaseGate.Document) { 0 } else { @($inputReleaseGate.Document.inputsError | Where-Object { $_ -match 'inputs releaseVersion must exactly equal TECH-V0.2' }).Count }
    $inputReleasePassed = (Test-GateReadOnlyContract $inputReleaseGate) -and $inputReleaseGate.Document.inputsStatus -ceq 'BLOCKED' -and $inputReleaseReasonCount -eq 1
    Add-Case 'release-input-version-is-case-exact' $inputReleasePassed "reasonCount=$inputReleaseReasonCount"

    # Case 7: local worker JSON/XML files are evidence snapshots and use strict integer contracts.
    $workerDirectory = Join-Path $runRoot 'local-worker-evidence'
    [void][System.IO.Directory]::CreateDirectory($workerDirectory)
    $workerSummaryPath = Join-Path $workerDirectory 'summary.json'
    $workerRuntimePath = Join-Path $workerDirectory 'runtime.json'
    $workerXmlPath = Join-Path $workerDirectory 'worker-regression.xml'
    $validWorkerSummary = [ordered]@{
        runId = 'binding-worker-run'
        automation = [ordered]@{
            mode = 'scheduled-worker'
            manualSlaProcessRequestCount = 0
            manualOutboxRecoveryRequestCount = 0
        }
        failedRequestCount = 0
        scenarioCount = 3
    }
    $validWorkerRuntime = [ordered]@{
        runId = 'binding-worker-run'
        scheduledAutomationWorkerEnabled = $true
        devHeaderAuthEnabled = $false
        environmentType = 'TARGET_UAT'
    }
    $validWorkerXml = '<?xml version="1.0" encoding="UTF-8"?><testsuite tests="3" failures="0" errors="0" skipped="0"><testcase name="management-loop"/></testsuite>'
    [System.IO.File]::WriteAllText($workerSummaryPath, ($validWorkerSummary | ConvertTo-Json -Depth 10), $utf8NoBom)
    Write-Utf8BomText $workerRuntimePath ($validWorkerRuntime | ConvertTo-Json -Depth 10)
    [System.IO.File]::WriteAllText($workerXmlPath, $validWorkerXml, $utf8NoBom)
    $workerInputs = New-GateInputsDocument
    $workerInputs.localWorkerEvidence.summaryPath = Get-WorkspaceRelativePath $workerSummaryPath
    $workerInputs.localWorkerEvidence.runtimeStatePath = Get-WorkspaceRelativePath $workerRuntimePath
    $workerInputs.localWorkerEvidence.workerRegressionXmlPath = Get-WorkspaceRelativePath $workerXmlPath
    $workerInputsPath = Join-Path $workerDirectory 'gate-inputs.json'
    Write-GateInputs $workerInputs $workerInputsPath
    $workerGate = Invoke-Gate $workerInputsPath
    $workerCheck = Get-GateCheck $workerGate 'REL-P0-01'
    $expectedWorkerEvidence = @($workerSummaryPath, $workerRuntimePath, $workerXmlPath) | ForEach-Object { Get-WorkspaceRelativePath $_ }
    $workerEvidencePresent = $null -ne $workerCheck -and @($expectedWorkerEvidence | Where-Object { $workerCheck.evidence -notcontains $_ }).Count -eq 0
    $stableWorkerPassed = (
        (Test-GateReadOnlyContract $workerGate) -and
        $null -ne $workerCheck -and
        $workerCheck.status -ceq 'PASS' -and
        $workerEvidencePresent -and
        [int]$workerGate.Document.safeguards.finalEvidenceReferencesRevalidated -ge 3
    )
    Add-Case 'local-worker-files-reach-final-revalidation' $stableWorkerPassed "status=$($workerCheck.status), evidence=$workerEvidencePresent, finalRefs=$($workerGate.Document.safeguards.finalEvidenceReferencesRevalidated)"
    $workerRuntimeBomBytes = [System.IO.File]::ReadAllBytes($workerRuntimePath)
    $workerRuntimeBomPresent = $workerRuntimeBomBytes.Length -ge 3 -and $workerRuntimeBomBytes[0] -eq 0xEF -and $workerRuntimeBomBytes[1] -eq 0xBB -and $workerRuntimeBomBytes[2] -eq 0xBF
    Add-Case 'locked-worker-runtime-allows-one-leading-utf8-bom' ($stableWorkerPassed -and $workerRuntimeBomPresent) "bomPresent=$workerRuntimeBomPresent"

    $slowSsoEvidencePath = Join-Path $workerDirectory 'slow-sso-evidence.bin'
    $slowSsoEvidenceBytes = New-Object byte[] (8 * 1024 * 1024)
    [System.IO.File]::WriteAllBytes($slowSsoEvidencePath, $slowSsoEvidenceBytes)
    $workerMutationInputs = New-GateInputsDocument
    $workerMutationInputs.localWorkerEvidence.summaryPath = Get-WorkspaceRelativePath $workerSummaryPath
    $workerMutationInputs.localWorkerEvidence.runtimeStatePath = Get-WorkspaceRelativePath $workerRuntimePath
    $workerMutationInputs.localWorkerEvidence.workerRegressionXmlPath = Get-WorkspaceRelativePath $workerXmlPath
    $workerMutationInputs.targetSsoAcceptance.evidenceUri = Get-WorkspaceRelativePath $slowSsoEvidencePath
    $workerMutationInputs.targetSsoAcceptance.evidenceSha256 = Get-BytesSha256 $slowSsoEvidenceBytes
    $workerMutationInputsPath = Join-Path $workerDirectory 'gate-inputs-worker-mutation.json'
    Write-GateInputs $workerMutationInputs $workerMutationInputsPath
    $workerMutationGate = Invoke-Gate $workerMutationInputsPath {
        if (-not (Wait-ForReadLock $slowSsoEvidencePath 10)) { throw 'The gate did not open the slow SSO evidence snapshot.' }
        [System.IO.File]::AppendAllText($workerSummaryPath, ' ', $utf8NoBom)
    }
    $workerMutationCheck = Get-GateCheck $workerMutationGate 'REL-P0-01'
    $workerMutationReasons = if ($null -eq $workerMutationCheck) { @() } else { @($workerMutationCheck.reasons | Where-Object { $_ -match 'local worker summary .*changed before final gate decision|local worker summary .*changed during final gate evaluation' }) }
    $workerMutationPassed = (Test-GateReadOnlyContract $workerMutationGate) -and $workerMutationGate.InputLockObserved -and @($workerMutationReasons).Count -ge 1
    Add-Case 'local-worker-replacement-before-final-decision-is-blocked' $workerMutationPassed "inputLock=$($workerMutationGate.InputLockObserved), reasonCount=$(@($workerMutationReasons).Count)"

    $strictWorkerSummary = $validWorkerSummary | ConvertTo-Json -Depth 10 | ConvertFrom-Json
    $strictWorkerSummary.automation.manualSlaProcessRequestCount = [decimal]0.1
    $strictWorkerSummary.automation.manualOutboxRecoveryRequestCount = '0'
    $strictWorkerSummary.failedRequestCount = $false
    $strictWorkerSummary.scenarioCount = [decimal]3.1
    [System.IO.File]::WriteAllText($workerSummaryPath, ($strictWorkerSummary | ConvertTo-Json -Depth 10), $utf8NoBom)
    $strictWorkerJsonGate = Invoke-Gate $workerInputsPath
    $strictWorkerJsonCheck = Get-GateCheck $strictWorkerJsonGate 'REL-P0-01'
    $strictWorkerJsonPatterns = @(
        'manual SLA process request count is not exact integer zero',
        'manual outbox recovery request count is not exact integer zero',
        'failed request count is not exact integer zero',
        'scenario count is not an integer of at least 3'
    )
    $strictWorkerJsonReasonCount = if ($null -eq $strictWorkerJsonCheck) { 0 } else { @($strictWorkerJsonPatterns | Where-Object { $pattern = $_; @($strictWorkerJsonCheck.reasons | Where-Object { $_ -match $pattern }).Count -eq 1 }).Count }
    $strictWorkerJsonPassed = (Test-GateReadOnlyContract $strictWorkerJsonGate) -and $strictWorkerJsonReasonCount -eq $strictWorkerJsonPatterns.Count
    Add-Case 'local-worker-json-counts-require-strict-integers' $strictWorkerJsonPassed "reasonCount=$strictWorkerJsonReasonCount/$($strictWorkerJsonPatterns.Count)"
    [System.IO.File]::WriteAllText($workerSummaryPath, ($validWorkerSummary | ConvertTo-Json -Depth 10), $utf8NoBom)

    $strictWorkerXml = '<?xml version="1.0" encoding="UTF-8"?><testsuite tests="1.1" failures="false" errors="0.1" skipped="+0"><testcase name="management-loop"/></testsuite>'
    [System.IO.File]::WriteAllText($workerXmlPath, $strictWorkerXml, $utf8NoBom)
    $strictWorkerXmlGate = Invoke-Gate $workerInputsPath
    $strictWorkerXmlCheck = Get-GateCheck $strictWorkerXmlGate 'REL-P0-01'
    $strictWorkerXmlPatterns = @(
        'worker regression tests count is not an integer of at least 1',
        'worker regression failures count is not exact integer zero',
        'worker regression errors count is not exact integer zero',
        'worker regression skipped count is not exact integer zero'
    )
    $strictWorkerXmlReasonCount = if ($null -eq $strictWorkerXmlCheck) { 0 } else { @($strictWorkerXmlPatterns | Where-Object { $pattern = $_; @($strictWorkerXmlCheck.reasons | Where-Object { $_ -match $pattern }).Count -eq 1 }).Count }
    $strictWorkerXmlPassed = (Test-GateReadOnlyContract $strictWorkerXmlGate) -and $strictWorkerXmlReasonCount -eq $strictWorkerXmlPatterns.Count
    Add-Case 'worker-regression-xml-counts-require-strict-integer-text' $strictWorkerXmlPassed "reasonCount=$strictWorkerXmlReasonCount/$($strictWorkerXmlPatterns.Count)"
    [System.IO.File]::WriteAllText($workerXmlPath, $validWorkerXml, $utf8NoBom)

    # Case 8: ISO timestamps require an explicit T separator and UTC/offset timezone.
    $timestampDirectory = Join-Path $runRoot 'strict-iso-timestamps'
    [void][System.IO.Directory]::CreateDirectory($timestampDirectory)
    $timestampResults = @()
    foreach ($variant in @(
        [pscustomobject]@{ Name = 'localized'; Value = '07/17/2026 09:00:00'; ExpectedReasonCount = 1 },
        [pscustomobject]@{ Name = 'missing-timezone'; Value = '2026-07-17T09:00:00'; ExpectedReasonCount = 1 },
        [pscustomobject]@{ Name = 'utc-z'; Value = '2026-07-17T01:00:00Z'; ExpectedReasonCount = 0 },
        [pscustomobject]@{ Name = 'offset-plus-eight'; Value = '2026-07-17T09:00:00+08:00'; ExpectedReasonCount = 0 }
    )) {
        $timestampInputs = New-GateInputsDocument
        $timestampSignature = $timestampInputs.releaseSignoffs.signatures[0]
        $timestampSignature.status = 'SIGNED'
        $timestampSignature.decision = 'APPROVED'
        $timestampSignature.signatureId = 'sig-front-desk-controlled'
        $timestampSignature.signerId = 'human-front-desk-controlled'
        $timestampSignature.signerName = 'Controlled Front Desk Signer'
        $timestampSignature.signerTitle = 'Front Desk Representative'
        $timestampSignature.signedAt = $variant.Value
        $timestampSignature.signedByHuman = $true
        $timestampSignature.delegated = $false
        $timestampInputsPath = Join-Path $timestampDirectory ("gate-inputs-$($variant.Name).json")
        Write-GateInputs $timestampInputs $timestampInputsPath
        $timestampGate = Invoke-Gate $timestampInputsPath
        $timestampCheck = Get-GateCheck $timestampGate 'REL-P0-03'
        $timestampReasonCount = if ($null -eq $timestampCheck) { -1 } else { @($timestampCheck.reasons | Where-Object { $_ -match 'FRONT_DESK_REPRESENTATIVE human signature identity/time is incomplete or delegated' }).Count }
        $timestampResults += [pscustomobject]@{
            Name = $variant.Name
            Passed = (Test-GateReadOnlyContract $timestampGate) -and $timestampReasonCount -eq $variant.ExpectedReasonCount
            ReasonCount = $timestampReasonCount
            ExpectedReasonCount = $variant.ExpectedReasonCount
        }
    }
    $timestampPassed = @($timestampResults | Where-Object { -not $_.Passed }).Count -eq 0
    Add-Case 'timestamps-require-explicit-iso8601-timezone' $timestampPassed (($timestampResults | ForEach-Object { "$($_.Name)=$($_.ReasonCount)/$($_.ExpectedReasonCount)" }) -join ', ')

    # Case 9: fractional, string and boolean reservation values must not coerce to integer zero.
    $reservationDirectory = Join-Path $runRoot 'strict-reservations'
    [void][System.IO.Directory]::CreateDirectory($reservationDirectory)
    $reservationResults = @()
    foreach ($variant in @(
        [pscustomobject]@{ Name = 'fractional'; Value = [decimal]0.1 },
        [pscustomobject]@{ Name = 'string'; Value = '0' },
        [pscustomobject]@{ Name = 'boolean'; Value = $false }
    )) {
        $reservationInputs = New-GateInputsDocument
        $reservationInputs.releaseSignoffs.signatures[0].openReservations = $variant.Value
        $reservationInputsPath = Join-Path $reservationDirectory ("gate-inputs-$($variant.Name).json")
        Write-GateInputs $reservationInputs $reservationInputsPath
        $reservationGate = Invoke-Gate $reservationInputsPath
        $reservationCheck = Get-GateCheck $reservationGate 'REL-P0-03'
        $reservationReasonCount = if ($null -eq $reservationCheck) { 0 } else { @($reservationCheck.reasons | Where-Object { $_ -match 'FRONT_DESK_REPRESENTATIVE has open reservations or a non-integer reservation count' }).Count }
        $reservationResults += [pscustomobject]@{
            Name = $variant.Name
            Passed = (Test-GateReadOnlyContract $reservationGate) -and $reservationReasonCount -eq 1
            ReasonCount = $reservationReasonCount
        }
    }
    $reservationPassed = @($reservationResults | Where-Object { -not $_.Passed }).Count -eq 0
    Add-Case 'release-signoff-reservations-require-exact-integer-zero' $reservationPassed (($reservationResults | ForEach-Object { "$($_.Name)=$($_.ReasonCount)" }) -join ', ')

    # Case 6: persisted attachments still require the exact OBJECT_STORAGE storage type.
    $storageDirectory = Join-Path $runRoot 'invalid-storage-type'
    [void][System.IO.Directory]::CreateDirectory($storageDirectory)
    $storageInputs = New-GateInputsDocument
    $storageInputs.fieldPhotoAndTargetAttachmentAcceptance.targetAttachmentChain.storageType = 'FOO'
    $storageInputs.fieldPhotoAndTargetAttachmentAcceptance.targetAttachmentChain.objectStoragePersisted = $true
    $storageInputsPath = Join-Path $storageDirectory 'gate-inputs.json'
    Write-GateInputs $storageInputs $storageInputsPath
    $storageGate = Invoke-Gate $storageInputsPath
    $storageCheck = Get-GateCheck $storageGate 'REL-P0-04'
    $storageReasons = if ($null -eq $storageCheck) { @() } else { @($storageCheck.reasons | Where-Object { $_ -match 'target attachment storageType is not OBJECT_STORAGE' }) }
    $storagePassed = (Test-GateReadOnlyContract $storageGate) -and @($storageReasons).Count -eq 1
    Add-Case 'attachment-storage-type-must-be-exact-object-storage' $storagePassed "reasonCount=$(@($storageReasons).Count)"

    # Case 7: an extra attachment approval must be rejected even when all four required roles remain present.
    $approvalCountDirectory = Join-Path $runRoot 'extra-attachment-approval'
    [void][System.IO.Directory]::CreateDirectory($approvalCountDirectory)
    $approvalCountInputs = New-GateInputsDocument
    $extraApproval = $approvalCountInputs.fieldPhotoAndTargetAttachmentAcceptance.approvals[0] | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $extraApproval.roleCode = 'UNEXPECTED_APPROVER'
    $approvalCountInputs.fieldPhotoAndTargetAttachmentAcceptance.approvals = @($approvalCountInputs.fieldPhotoAndTargetAttachmentAcceptance.approvals) + @($extraApproval)
    $approvalCountInputsPath = Join-Path $approvalCountDirectory 'gate-inputs.json'
    Write-GateInputs $approvalCountInputs $approvalCountInputsPath
    $approvalCountGate = Invoke-Gate $approvalCountInputsPath
    $approvalCountCheck = Get-GateCheck $approvalCountGate 'REL-P0-04'
    $approvalCountReasons = if ($null -eq $approvalCountCheck) { @() } else { @($approvalCountCheck.reasons | Where-Object { $_ -match 'exactly 4 attachment approvals are required; found 5' }) }
    $approvalCountPassed = (Test-GateReadOnlyContract $approvalCountGate) -and @($approvalCountReasons).Count -eq 1
    Add-Case 'attachment-approval-set-rejects-extra-items' $approvalCountPassed "reasonCount=$(@($approvalCountReasons).Count)"

    # Case 8: repeating one valid artifact five times must not satisfy the formal five-artifact contract.
    $duplicateArtifactDirectory = Join-Path $runRoot 'duplicate-manifest-artifacts'
    [void][System.IO.Directory]::CreateDirectory($duplicateArtifactDirectory)
    $duplicateFileName = 'hotel-ai-os-core-api-TECH-V0.2-rc.3.jar'
    $duplicateArtifactPath = Join-Path $duplicateArtifactDirectory $duplicateFileName
    $duplicateBytes = [System.Text.Encoding]::UTF8.GetBytes('one-artifact-repeated-five-times')
    [System.IO.File]::WriteAllBytes($duplicateArtifactPath, $duplicateBytes)
    $duplicateSha = Get-BytesSha256 $duplicateBytes
    $duplicateEntry = [ordered]@{ file = $duplicateFileName; sizeBytes = $duplicateBytes.Length; sha256 = $duplicateSha }
    $duplicateEntries = @($duplicateEntry, $duplicateEntry, $duplicateEntry, $duplicateEntry, $duplicateEntry)
    $duplicateFingerprintParts = @($duplicateEntries | ForEach-Object { "$($_.file)`:$($_.sha256)" })
    $duplicateManifest = [ordered]@{
        schemaVersion = 1
        releaseVersion = 'TECH-V0.2-rc.3'
        versions = [ordered]@{ database = 'DB-V13'; apiBase = '/api/v1' }
        source = [ordered]@{ commit = ('0' * 40); dirty = $false }
        artifacts = $duplicateEntries
        reproducibleBuild = [ordered]@{ payloadFingerprintSha256 = Get-TextSha256 ($duplicateFingerprintParts -join "`n") }
    }
    $duplicateManifestPath = Join-Path $duplicateArtifactDirectory 'manifest.json'
    [System.IO.File]::WriteAllText($duplicateManifestPath, ($duplicateManifest | ConvertTo-Json -Depth 20), $utf8NoBom)
    $duplicateSumsPath = Join-Path $duplicateArtifactDirectory 'SHA256SUMS.txt'
    [System.IO.File]::WriteAllText($duplicateSumsPath, "$duplicateSha  $duplicateFileName`r`n", [System.Text.Encoding]::ASCII)
    $duplicateInputs = New-GateInputsDocument
    $duplicateInputs.sourceTraceability.rcTag = 'TECH-V0.2-rc.3'
    $duplicateInputs.sourceTraceability.artifactManifestPath = Get-WorkspaceRelativePath $duplicateManifestPath
    $duplicateInputs.sourceTraceability.sha256SumsPath = Get-WorkspaceRelativePath $duplicateSumsPath
    $duplicateInputsPath = Join-Path $duplicateArtifactDirectory 'gate-inputs.json'
    Write-GateInputs $duplicateInputs $duplicateInputsPath
    $duplicateGate = Invoke-Gate $duplicateInputsPath
    $duplicateCheck = Get-GateCheck $duplicateGate 'REL-P0-05'
    $duplicateReasons = if ($null -eq $duplicateCheck) { @() } else { @($duplicateCheck.reasons | Where-Object { $_ -match 'artifact filenames must be unique|exactly one required release artifact' }) }
    $duplicatePassed = (Test-GateReadOnlyContract $duplicateGate) -and @($duplicateReasons).Count -ge 1
    Add-Case 'duplicate-manifest-artifacts-cannot-satisfy-formal-contract' $duplicatePassed "reasonCount=$(@($duplicateReasons).Count)"

    # Case 13: the manifest is parsed only from the bytes held by its first locked snapshot.
    $manifestToctouPath = Join-Path $artifactDirectory 'manifest-toctou.json'
    $manifestToctouDocument = [ordered]@{
        schemaVersion = 1
        releaseVersion = 'TECH-V0.2-rc.3'
        snapshotPadding = [string]::new([char]'A', 16 * 1024 * 1024)
        versions = [ordered]@{ database = 'DB-V13'; apiBase = '/api/v1' }
        source = [ordered]@{ commit = ('0' * 40); dirty = $false }
        artifacts = $artifactEntries
        reproducibleBuild = [ordered]@{ payloadFingerprintSha256 = Get-TextSha256 ($fingerprintParts -join "`n") }
    }
    $manifestToctouOriginalText = $manifestToctouDocument | ConvertTo-Json -Depth 20
    [System.IO.File]::WriteAllText($manifestToctouPath, $manifestToctouOriginalText, $utf8NoBom)
    $probeFileName = 'toctou-probe-artifact.bin'
    $probeSha = [string]::new([char]'f', 64)
    $manifestToctouReplacement = [ordered]@{
        schemaVersion = 1
        releaseVersion = 'TECH-V0.2-rc.3'
        versions = [ordered]@{ database = 'DB-V13'; apiBase = '/api/v1' }
        source = [ordered]@{ commit = ('0' * 40); dirty = $false }
        artifacts = @([ordered]@{ file = $probeFileName; sizeBytes = 1; sha256 = $probeSha })
        reproducibleBuild = [ordered]@{ payloadFingerprintSha256 = Get-TextSha256 ("$probeFileName`:$probeSha") }
    }
    $manifestToctouReplacementBytes = $utf8NoBom.GetBytes(($manifestToctouReplacement | ConvertTo-Json -Depth 20))
    $manifestToctouInputs = New-GateInputsDocument
    $manifestToctouInputs.sourceTraceability.rcTag = 'TECH-V0.2-rc.3'
    $manifestToctouInputs.sourceTraceability.artifactManifestPath = Get-WorkspaceRelativePath $manifestToctouPath
    $manifestToctouInputs.sourceTraceability.sha256SumsPath = Get-WorkspaceRelativePath $sumsPath
    $manifestToctouInputsPath = Join-Path $artifactDirectory 'gate-inputs-manifest-toctou.json'
    Write-GateInputs $manifestToctouInputs $manifestToctouInputsPath
    $manifestToctouGate = Invoke-Gate $manifestToctouInputsPath {
        if (-not (Wait-ForReadLock $manifestToctouPath 10)) { throw 'The gate did not open the initial manifest snapshot.' }
        $writeStream = $null
        $writeDeadline = [DateTimeOffset]::UtcNow.AddSeconds(5)
        while ($null -eq $writeStream -and [DateTimeOffset]::UtcNow -lt $writeDeadline) {
            try {
                $writeStream = New-Object System.IO.FileStream($manifestToctouPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
            } catch [System.IO.IOException] {
                Start-Sleep -Milliseconds 1
            }
        }
        if ($null -eq $writeStream) { throw 'The initial manifest snapshot did not release its file lock.' }
        try {
            $writeStream.SetLength(0)
            $writeStream.Write($manifestToctouReplacementBytes, 0, $manifestToctouReplacementBytes.Length)
            $writeStream.Flush()
        } finally {
            $writeStream.Dispose()
        }
        Start-Sleep -Milliseconds 75
        [System.IO.File]::WriteAllText($manifestToctouPath, $manifestToctouOriginalText, $utf8NoBom)
    }
    $manifestToctouCheck = Get-GateCheck $manifestToctouGate 'REL-P0-05'
    $manifestToctouProbeReasons = if ($null -eq $manifestToctouCheck) { @('missing check') } else { @($manifestToctouCheck.reasons | Where-Object { $_ -match 'toctou-probe-artifact' }) }
    $manifestToctouPassed = (Test-GateReadOnlyContract $manifestToctouGate) -and $manifestToctouGate.InputLockObserved -and @($manifestToctouProbeReasons).Count -eq 0
    Add-Case 'manifest-is-parsed-from-its-locked-snapshot-bytes' $manifestToctouPassed "inputLock=$($manifestToctouGate.InputLockObserved), probeReasonCount=$(@($manifestToctouProbeReasons).Count)"

    # Case 14: SHA256SUMS is itself re-read immediately before the final decision.
    $slowOperationsEvidencePath = Join-Path $artifactDirectory 'slow-operations-evidence.bin'
    $slowOperationsEvidenceBytes = New-Object byte[] (8 * 1024 * 1024)
    [System.IO.File]::WriteAllBytes($slowOperationsEvidencePath, $slowOperationsEvidenceBytes)
    $sumsMutationInputs = New-GateInputsDocument
    $sumsMutationInputs.sourceTraceability.rcTag = 'TECH-V0.2-rc.3'
    $sumsMutationInputs.sourceTraceability.artifactManifestPath = Get-WorkspaceRelativePath $manifestPath
    $sumsMutationInputs.sourceTraceability.sha256SumsPath = Get-WorkspaceRelativePath $sumsPath
    $sumsMutationInputs.targetOperationsAcceptance.evidenceUri = Get-WorkspaceRelativePath $slowOperationsEvidencePath
    $sumsMutationInputs.targetOperationsAcceptance.evidenceSha256 = Get-BytesSha256 $slowOperationsEvidenceBytes
    $sumsMutationInputsPath = Join-Path $artifactDirectory 'gate-inputs-sums-mutation.json'
    Write-GateInputs $sumsMutationInputs $sumsMutationInputsPath
    $stableSumsText = [System.IO.File]::ReadAllText($sumsPath, [System.Text.Encoding]::ASCII)
    $sumsMutationGate = Invoke-Gate $sumsMutationInputsPath {
        if (-not (Wait-ForReadLock $slowOperationsEvidencePath 10)) { throw 'The gate did not open the slow operations evidence snapshot.' }
        [System.IO.File]::AppendAllText($sumsPath, "# replaced before final decision`r`n", [System.Text.Encoding]::ASCII)
    }
    $sumsMutationCheck = Get-GateCheck $sumsMutationGate 'REL-P0-05'
    $sumsMutationReasons = if ($null -eq $sumsMutationCheck) { @() } else { @($sumsMutationCheck.reasons | Where-Object { $_ -match 'SHA256SUMS .*changed before final gate decision|SHA256SUMS .*changed during final gate evaluation' }) }
    $sumsMutationPassed = (Test-GateReadOnlyContract $sumsMutationGate) -and $sumsMutationGate.InputLockObserved -and @($sumsMutationReasons).Count -ge 1
    Add-Case 'sha256sums-replacement-before-final-decision-is-blocked' $sumsMutationPassed "inputLock=$($sumsMutationGate.InputLockObserved), reasonCount=$(@($sumsMutationReasons).Count)"
    [System.IO.File]::WriteAllText($sumsPath, $stableSumsText, [System.Text.Encoding]::ASCII)
} catch {
    $failures.Add("test harness exception: $($_.Exception.Message)")
    $cases.Add([pscustomobject][ordered]@{ name = 'test-harness-completed'; passed = $false; detail = $_.Exception.Message })
} finally {
    try {
        $deleteTarget = [System.IO.Path]::GetFullPath($runRoot)
        if (-not $deleteTarget.StartsWith($testParentPrefix, [StringComparison]::OrdinalIgnoreCase) -or
            [System.IO.Path]::GetFileName($deleteTarget) -notlike 'gate-evidence-binding-*') {
            throw 'Cleanup target escaped the controlled evidence-binding test directory.'
        }
        if (Test-Path -LiteralPath $deleteTarget) { Remove-Item -LiteralPath $deleteTarget -Recurse -Force }
    } catch {
        $cleanupError = $_.Exception.Message
    }
}

$temporaryArtifactsRemaining = if (Test-Path -LiteralPath $runRoot) { @(Get-ChildItem -LiteralPath $runRoot -Recurse -Force -ErrorAction SilentlyContinue).Count + 1 } else { 0 }
$cleanupPassed = [string]::IsNullOrWhiteSpace($cleanupError) -and $temporaryArtifactsRemaining -eq 0
Add-Case 'controlled-temporary-evidence-is-fully-removed' $cleanupPassed "remaining=$temporaryArtifactsRemaining, cleanupError=$cleanupError"

$governanceAfter = Get-GitGovernanceFingerprint
$governanceUnchanged = $governanceBefore -eq $governanceAfter
Add-Case 'git-governance-state-remains-unchanged' $governanceUnchanged "before=$governanceBefore, after=$governanceAfter"

$result = [ordered]@{
    status = if ($failures.Count -eq 0) { 'PASS' } else { 'FAIL' }
    cases = $cases
    failures = $failures
    governanceFingerprintBefore = $governanceBefore
    governanceFingerprintAfter = $governanceAfter
    mutations = [ordered]@{
        temporaryArtifactsRemaining = $temporaryArtifactsRemaining
        signaturesCreated = 0
        approvalsCreated = 0
        commitsCreated = 0
        tagsCreated = 0
        releaseStatusModified = $false
        networkWrites = 0
    }
}
$result | ConvertTo-Json -Depth 10
if ($result.status -ceq 'PASS') { exit 0 }
exit 1
