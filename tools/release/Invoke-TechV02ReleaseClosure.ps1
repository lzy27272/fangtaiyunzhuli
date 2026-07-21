[CmdletBinding()]
param(
    [string]$BundlePath = '.uat-runtime/release/TECH-V0.2-EXTERNAL-EVIDENCE-BUNDLE.json',
    [string]$GateInputsPath = '.uat-runtime/release/TECH-V0.2-RELEASE-GATE-INPUTS.json'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$stages = New-Object 'System.Collections.Generic.List[object]'
$script:gateInputsSha256 = $null
$script:bundleFullPath = $null
$script:bundleSha256Before = $null
$script:gateInputsFullPath = $null
. (Join-Path $PSScriptRoot 'TechV02ReleaseClosureSupport.ps1')

function Assert-SafeProcessArgument([string]$value, [string]$name) {
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "$name cannot be empty."
    }
    if ($value.IndexOf('"') -ge 0 -or $value.IndexOf("`r") -ge 0 -or $value.IndexOf("`n") -ge 0 -or $value.IndexOf([char]0) -ge 0) {
        throw "$name contains an unsupported process-argument character."
    }
}

function Quote-ProcessArgument([string]$value) {
    return '"' + $value + '"'
}

function Get-TextSha256([string]$value) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($value)
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Resolve-WorkspaceCandidate([string]$path, [string]$requiredRoot = '') {
    $candidate = if ([System.IO.Path]::IsPathRooted($path)) {
        [System.IO.Path]::GetFullPath($path)
    } else {
        [System.IO.Path]::GetFullPath((Join-Path $repoRoot $path))
    }
    $repoPrefix = $repoRoot.TrimEnd('\') + '\'
    if (-not $candidate.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Path is outside the workspace: $path"
    }
    if (-not [string]::IsNullOrWhiteSpace($requiredRoot)) {
        $requiredFullPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $requiredRoot))
        $requiredPrefix = $requiredFullPath.TrimEnd('\') + '\'
        if (-not $candidate.StartsWith($requiredPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Path must stay under $requiredRoot`: $path"
        }
    }

    $root = [System.IO.Path]::GetPathRoot($candidate)
    $current = $root
    $remaining = $candidate.Substring($root.Length)
    foreach ($segment in @($remaining -split '[\\/]' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })) {
        $current = Join-Path $current $segment
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Path contains a reparse point: $path"
            }
        }
    }
    return $candidate
}

function Get-WorkspaceFileSha256([string]$path) {
    if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-RepoRelativePath([string]$path) {
    $prefix = $repoRoot.TrimEnd('\') + '\'
    if ($path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $path.Substring($prefix.Length).Replace('\', '/')
    }
    return $path
}

function Resolve-ReleaseScript([string]$relativePath) {
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $relativePath))
    $allowedRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'tools\release')).TrimEnd('\') + '\'
    if (-not $candidate.StartsWith($allowedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Release script is outside tools/release: $relativePath"
    }
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "Release script does not exist: $relativePath"
    }
    return $candidate
}

function Get-PowerShellExecutable {
    $currentProcess = Get-Process -Id $PID
    if ($currentProcess.Path -and (Test-Path -LiteralPath $currentProcess.Path -PathType Leaf)) {
        return $currentProcess.Path
    }
    $windowsPowerShell = Join-Path $PSHOME 'powershell.exe'
    if (Test-Path -LiteralPath $windowsPowerShell -PathType Leaf) {
        return $windowsPowerShell
    }
    $powerShellCore = Join-Path $PSHOME 'pwsh.exe'
    if (Test-Path -LiteralPath $powerShellCore -PathType Leaf) {
        return $powerShellCore
    }
    throw 'Unable to resolve a PowerShell executable for isolated release checks.'
}

function Convert-StageResult([string]$name, $document) {
    if ($null -eq $document) { return $null }
    switch ($name) {
        'LOCAL-EVIDENCE-CONSISTENCY' {
            return [ordered]@{
                status = $document.status
                summary = $document.summary
                failedChecks = @($document.checks | Where-Object { $_.status -ne 'PASS' } | ForEach-Object { $_.id })
                safeguards = $document.safeguards
            }
        }
        'EXTERNAL-EVIDENCE-GENERATION' {
            return [ordered]@{
                status = $document.status
                outputPath = $document.outputPath
                outputSha256 = $document.outputSha256
                gateInputsCompared = $document.gateInputsCompared
                staleOutputPresent = $document.staleOutputPresent
                reasons = @($document.reasons)
                mutations = $document.mutations
            }
        }
        'EXTERNAL-EVIDENCE-RECOMPUTE' {
            return [ordered]@{
                status = $document.status
                gateInputsCompared = $document.gateInputsCompared
                reasons = @($document.reasons)
                git = $document.git
                mutations = $document.mutations
            }
        }
        'FINAL-RELEASE-GATE' {
            return [ordered]@{
                status = $document.status
                inputsPath = $document.inputsPath
                consumedInputsSha256 = $document.consumedInputsSha256
                consumedInputsSizeBytes = $document.consumedInputsSizeBytes
                summary = $document.summary
                blockedChecks = @($document.checks | Where-Object { $_.status -ne 'PASS' } | ForEach-Object {
                    [ordered]@{ id = $_.id; name = $_.name; reasons = @($_.reasons) }
                })
                safeguards = $document.safeguards
            }
        }
    }
    return $document
}

function Invoke-JsonReleaseStage([string]$name, [string]$scriptRelativePath, [string[]]$scriptArguments) {
    $scriptPath = Resolve-ReleaseScript $scriptRelativePath
    $powerShellPath = Get-PowerShellExecutable
    $argumentParts = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Quote-ProcessArgument $scriptPath))
    foreach ($argument in @($scriptArguments)) {
        Assert-SafeProcessArgument $argument "$name argument"
        $argumentParts += Quote-ProcessArgument $argument
    }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $powerShellPath
    $startInfo.Arguments = $argumentParts -join ' '
    $startInfo.WorkingDirectory = $repoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw "Failed to start release stage: $name" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    $exitCode = $process.ExitCode
    $process.Dispose()

    $document = $null
    $parseError = $null
    if (-not [string]::IsNullOrWhiteSpace($stdout)) {
        try { $document = $stdout | ConvertFrom-Json }
        catch { $parseError = $_.Exception.Message }
    } else {
        $parseError = 'Child release script returned no JSON output.'
    }
    $reportedStatus = if ($document -and $document.status) { $document.status.ToString() } else { 'BLOCKED' }
    $passed = Test-TechV02StageProcessContract $exitCode $reportedStatus $parseError $stderr
    return [pscustomobject][ordered]@{
        name = $name
        status = if ($passed) { 'PASS' } else { 'BLOCKED' }
        exitCode = $exitCode
        stdoutSha256 = Get-TextSha256 $stdout
        stderrSha256 = if ([string]::IsNullOrEmpty($stderr)) { $null } else { Get-TextSha256 $stderr }
        stderrEmpty = [string]::IsNullOrWhiteSpace($stderr)
        parseError = $parseError
        contractViolations = @()
        result = Convert-StageResult $name $document
    }
}

function Set-StageContractViolations($stage, [string[]]$violations) {
    $normalized = @($violations | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $stage.contractViolations = $normalized
    if ($normalized.Count -gt 0) { $stage.status = 'BLOCKED' }
}

function Complete-Closure([string]$nextAction, [int]$exitCode) {
    $requiredStageNames = @('LOCAL-EVIDENCE-CONSISTENCY','EXTERNAL-EVIDENCE-GENERATION','EXTERNAL-EVIDENCE-RECOMPUTE','FINAL-RELEASE-GATE')
    $finalStage = @($stages | Where-Object { $_.name -eq 'FINAL-RELEASE-GATE' } | Select-Object -First 1)
    $stageNamesValid = $true
    foreach ($requiredStageName in $requiredStageNames) {
        if (@($stages | Where-Object { $_.name -eq $requiredStageName }).Count -ne 1) { $stageNamesValid = $false }
    }
    $readyEvidence = (
        $stages.Count -eq 4 -and
        @($stages | Where-Object { $_.status -ne 'PASS' }).Count -eq 0 -and
        $stageNamesValid -and
        -not [string]::IsNullOrWhiteSpace($script:gateInputsSha256) -and
        $finalStage.Count -eq 1 -and
        (Test-TechV02ExactIntegerProperty $finalStage[0].result.summary 'total' 6) -and
        (Test-TechV02ExactIntegerProperty $finalStage[0].result.summary 'passed' 6) -and
        (Test-TechV02ExactIntegerProperty $finalStage[0].result.summary 'blocked' 0) -and
        $finalStage[0].result.consumedInputsSha256 -eq $script:gateInputsSha256
    )
    $status = if ($readyEvidence -and $exitCode -eq 0) { 'READY_FOR_RELEASE_APPROVAL' } else { 'BLOCKED' }
    if ($exitCode -eq 0 -and -not $readyEvidence) {
        $nextAction = 'READY was rejected because four passing stages, final 6/6, or the consumed input SHA contract was missing.'
        $exitCode = 2
    }
    $bundleSha256After = Get-WorkspaceFileSha256 $script:bundleFullPath
    $bundleUnchanged = $bundleSha256After -eq $script:bundleSha256Before
    if (-not $bundleUnchanged) {
        $status = 'BLOCKED'
        $nextAction = 'The external evidence bundle changed while the closure workflow was running; restart from a stable controlled export.'
        $exitCode = 2
    }
    $passedCount = @($stages | Where-Object { $_.status -eq 'PASS' }).Count
    $allStageNames = $requiredStageNames
    $executedNames = @($stages | ForEach-Object { $_.name })
    $failedStage = @($stages | Where-Object { $_.status -eq 'BLOCKED' } | Select-Object -First 1)
    [ordered]@{
        schemaVersion = 1
        evaluator = 'tech-v0.2-release-closure-controller'
        workflow = 'tech-v0.2-release-closure'
        releaseVersion = 'TECH-V0.2'
        evaluatedAt = [DateTimeOffset]::UtcNow.ToString('o')
        status = $status
        failedStage = if ($failedStage.Count -eq 1) { $failedStage[0].name } else { $null }
        gateInputsPath = if ($script:gateInputsFullPath) { Get-RepoRelativePath $script:gateInputsFullPath } else { $GateInputsPath }
        gateInputsSha256 = $script:gateInputsSha256
        eligibleForHumanReleaseDecision = $status -eq 'READY_FOR_RELEASE_APPROVAL' -and $readyEvidence
        summary = [ordered]@{
            totalStages = 4
            executedStages = $stages.Count
            passedStages = $passedCount
            blockedStages = @($stages | Where-Object { $_.status -eq 'BLOCKED' }).Count
            notRunStages = @($allStageNames | Where-Object { $executedNames -notcontains $_ })
        }
        stages = $stages
        nextAction = $nextAction
        safeguards = [ordered]@{
            failClosed = $true
            externalEvidenceRecomputedBeforeFinalGate = @($stages | Where-Object { $_.name -eq 'EXTERNAL-EVIDENCE-RECOMPUTE' -and $_.status -eq 'PASS' }).Count -eq 1
            externalBundleModified = -not $bundleUnchanged
            gateInputsFilesWritten = if (@($stages | Where-Object { $_.name -eq 'EXTERNAL-EVIDENCE-GENERATION' -and $_.status -eq 'PASS' }).Count -eq 1) { 1 } else { 0 }
            signaturesCreated = 0
            approvalsCreated = 0
            commitsCreated = 0
            tagsCreated = 0
            formalReleaseStatusModified = $false
            sprint3Started = $false
            networkWrites = 0
        }
    } | ConvertTo-Json -Depth 20
    exit $exitCode
}

try {
    Assert-SafeProcessArgument $BundlePath 'BundlePath'
    Assert-SafeProcessArgument $GateInputsPath 'GateInputsPath'

    $script:bundleFullPath = Resolve-WorkspaceCandidate $BundlePath '.uat-runtime\release'
    $script:gateInputsFullPath = Resolve-WorkspaceCandidate $GateInputsPath '.uat-runtime\release'
    if (-not $script:gateInputsFullPath.EndsWith('.json', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'GateInputsPath must be a JSON file.'
    }
    if ($script:bundleFullPath.Equals($script:gateInputsFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'BundlePath and GateInputsPath cannot identify the same file.'
    }
    $script:bundleSha256Before = Get-WorkspaceFileSha256 $script:bundleFullPath

    $localConsistency = Invoke-JsonReleaseStage 'LOCAL-EVIDENCE-CONSISTENCY' 'tools\release\Test-TechV02EvidenceConsistency.ps1' @()
    $localViolations = @()
    if ($localConsistency.status -eq 'PASS') {
        if (-not (Test-TechV02ExactIntegerProperty $localConsistency.result.summary 'total' 15) -or -not (Test-TechV02ExactIntegerProperty $localConsistency.result.summary 'passed' 15) -or -not (Test-TechV02ExactIntegerProperty $localConsistency.result.summary 'failed' 0)) {
            $localViolations += 'local evidence summary is not exactly 15 PASS / 0 FAIL'
        }
        if (-not (Test-TechV02ExactBooleanProperty $localConsistency.result.safeguards 'readOnly' $true)) {
            $localViolations += 'local evidence checker did not assert readOnly=true'
        }
        if (-not (Test-TechV02ExactBooleanProperty $localConsistency.result.safeguards 'releaseStatusModified' $false)) {
            $localViolations += 'local evidence checker did not assert releaseStatusModified=false'
        }
        if (-not (Test-TechV02ExactBooleanProperty $localConsistency.result.safeguards 'failClosed' $true)) {
            $localViolations += 'local evidence checker did not assert failClosed=true'
        }
    }
    Set-StageContractViolations $localConsistency $localViolations
    $stages.Add($localConsistency)
    if ($localConsistency.status -ne 'PASS') {
        Complete-Closure 'Repair the local RC evidence inconsistency before processing any external release evidence.' 2
    }

    $generation = Invoke-JsonReleaseStage 'EXTERNAL-EVIDENCE-GENERATION' 'tools\release\New-TechV02ExternalEvidenceBundle.ps1' @('-BundlePath', $script:bundleFullPath, '-OutputPath', $script:gateInputsFullPath)
    $generationViolations = @()
    if ($generation.status -eq 'PASS') {
        $actualGateInputsSha256 = Get-WorkspaceFileSha256 $script:gateInputsFullPath
        $expectedOutputPath = Get-RepoRelativePath $script:gateInputsFullPath
        if ([string]::IsNullOrWhiteSpace($actualGateInputsSha256)) { $generationViolations += 'generated gate-input file is missing' }
        if ([string]::IsNullOrWhiteSpace($generation.result.outputPath) -or $generation.result.outputPath.Replace('\','/') -ne $expectedOutputPath) { $generationViolations += 'generator outputPath does not equal GateInputsPath' }
        if ($generation.result.outputSha256 -ne $actualGateInputsSha256) { $generationViolations += 'generator output SHA-256 does not match the generated file' }
        if (-not (Test-TechV02ExactBooleanProperty $generation.result 'gateInputsCompared' $true)) { $generationViolations += 'generator did not compare its output with recomputed evidence' }
        if (-not (Test-TechV02ExactIntegerProperty $generation.result.mutations 'gateInputsFilesWritten' 1)) { $generationViolations += 'generator did not report exactly one gate-input write' }
        if (-not (Test-TechV02ExactIntegerProperty $generation.result.mutations 'temporaryFilesRemaining' 0)) { $generationViolations += 'generator did not prove temporaryFilesRemaining=0' }
        foreach ($field in @('signaturesCreated','approvalsCreated','commitsCreated','tagsCreated','networkWrites')) {
            if (-not (Test-TechV02ExactIntegerProperty $generation.result.mutations $field 0)) { $generationViolations += "generator omitted or reported forbidden mutation: $field" }
        }
        if ($generationViolations.Count -eq 0) { $script:gateInputsSha256 = $actualGateInputsSha256 }
    }
    Set-StageContractViolations $generation $generationViolations
    $stages.Add($generation)
    if ($generation.status -ne 'PASS') {
        Complete-Closure 'Provide complete controlled external evidence at BundlePath; invalid evidence does not create or refresh the canonical gate-input file.' 2
    }

    $shaBeforeRecompute = Get-WorkspaceFileSha256 $script:gateInputsFullPath
    $recompute = Invoke-JsonReleaseStage 'EXTERNAL-EVIDENCE-RECOMPUTE' 'tools\release\Test-TechV02ExternalEvidenceBundle.ps1' @('-BundlePath', $script:bundleFullPath, '-GateInputsPath', $script:gateInputsFullPath)
    $shaAfterRecompute = Get-WorkspaceFileSha256 $script:gateInputsFullPath
    $recomputeViolations = @()
    if ($recompute.status -eq 'PASS') {
        if (-not (Test-TechV02ExactBooleanProperty $recompute.result 'gateInputsCompared' $true)) { $recomputeViolations += 'external evidence was not byte-semantically compared with gate inputs' }
        if ($shaBeforeRecompute -ne $shaAfterRecompute -or $shaAfterRecompute -ne $script:gateInputsSha256) { $recomputeViolations += 'gate-input SHA-256 changed during external evidence recomputation' }
        foreach ($field in @('signaturesCreated','approvalsCreated','commitsCreated','tagsCreated','networkWrites')) {
            if (-not (Test-TechV02ExactIntegerProperty $recompute.result.mutations $field 0)) { $recomputeViolations += "external validator omitted or reported forbidden mutation: $field" }
        }
    }
    Set-StageContractViolations $recompute $recomputeViolations
    $stages.Add($recompute)
    if ($recompute.status -ne 'PASS') {
        Complete-Closure 'Repair the external-evidence hash or identity mismatch; the final legacy gate was not executed.' 2
    }

    $shaBeforeFinalGate = Get-WorkspaceFileSha256 $script:gateInputsFullPath
    $finalGate = Invoke-JsonReleaseStage 'FINAL-RELEASE-GATE' 'tools\release\Test-TechV02ReleaseGate.ps1' @('-InputsPath', $script:gateInputsFullPath)
    $shaAfterFinalGate = Get-WorkspaceFileSha256 $script:gateInputsFullPath
    $finalViolations = @()
    if ($finalGate.status -eq 'PASS') {
        if (-not (Test-TechV02ExactIntegerProperty $finalGate.result.summary 'total' 6) -or -not (Test-TechV02ExactIntegerProperty $finalGate.result.summary 'passed' 6) -or -not (Test-TechV02ExactIntegerProperty $finalGate.result.summary 'blocked' 0)) {
            $finalViolations += 'final release gate is not exactly 6 PASS / 0 BLOCKED'
        }
        if ([string]::IsNullOrWhiteSpace($finalGate.result.inputsPath) -or $finalGate.result.inputsPath.Replace('\','/') -ne (Get-RepoRelativePath $script:gateInputsFullPath)) { $finalViolations += 'final release gate did not evaluate GateInputsPath' }
        if ($shaBeforeFinalGate -ne $shaAfterFinalGate -or $shaAfterFinalGate -ne $script:gateInputsSha256) { $finalViolations += 'gate-input SHA-256 changed after external validation' }
        if ($finalGate.result.consumedInputsSha256 -ne $script:gateInputsSha256) { $finalViolations += 'final gate consumed a different gate-input SHA-256' }
        if (-not (Test-TechV02ExactBooleanProperty $finalGate.result.safeguards 'inputBytesLockedDuringEvaluation' $true)) { $finalViolations += 'final gate did not lock consumed input bytes during evaluation' }
        if (-not (Test-TechV02ExactBooleanProperty $finalGate.result.safeguards 'readOnly' $true)) { $finalViolations += 'final gate did not assert readOnly=true' }
        if (-not (Test-TechV02ExactBooleanProperty $finalGate.result.safeguards 'failClosed' $true)) { $finalViolations += 'final gate did not assert failClosed=true' }
        foreach ($field in @('signaturesCreated','approvalsCreated','commitsCreated','tagsCreated','networkWrites')) {
            if (-not (Test-TechV02ExactIntegerProperty $finalGate.result.safeguards $field 0)) { $finalViolations += "final gate omitted or reported forbidden mutation: $field" }
        }
        if (-not (Test-TechV02ExactBooleanProperty $finalGate.result.safeguards 'releaseStatusModified' $false)) { $finalViolations += 'final gate did not assert releaseStatusModified=false' }
    }
    Set-StageContractViolations $finalGate $finalViolations
    $stages.Add($finalGate)
    if ($finalGate.status -ne 'PASS') {
        Complete-Closure 'Close every REL-P0 gate. TECH-V0.2 remains Unreleased and Sprint 3 must not start.' 2
    }

    Complete-Closure 'The release owner must approve and record TECH-V0.2 Released in a separate governed action before Sprint 3 starts.' 0
} catch {
    $stages.Add([pscustomobject][ordered]@{
        name = 'CLOSURE-ORCHESTRATOR'
        status = 'BLOCKED'
        exitCode = 1
        stdoutSha256 = $null
        stderrSha256 = $null
        stderrEmpty = $true
        parseError = $_.Exception.Message
        contractViolations = @()
        result = $null
    })
    Complete-Closure 'Repair the closure-orchestrator error before continuing the release workflow.' 3
}
