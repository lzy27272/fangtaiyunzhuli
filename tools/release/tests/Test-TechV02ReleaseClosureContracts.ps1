[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$supportPath = Join-Path $repoRoot 'tools\release\TechV02ReleaseClosureSupport.ps1'
$controllerPath = Join-Path $repoRoot 'tools\release\Invoke-TechV02ReleaseClosure.ps1'
. $supportPath

$cases = New-Object 'System.Collections.Generic.List[object]'
$failures = New-Object 'System.Collections.Generic.List[string]'

function Add-ContractCase([string]$name, [bool]$passed, [string]$detail) {
    $cases.Add([pscustomobject][ordered]@{ name = $name; passed = $passed; detail = $detail })
    if (-not $passed) { $failures.Add("$name`: $detail") }
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

function Get-PowerShellExecutable {
    $currentProcess = Get-Process -Id $PID
    if ($currentProcess.Path -and (Test-Path -LiteralPath $currentProcess.Path -PathType Leaf)) {
        return $currentProcess.Path
    }
    foreach ($name in @('powershell.exe', 'pwsh.exe')) {
        $candidate = Join-Path $PSHOME $name
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    throw 'Unable to resolve a PowerShell executable for isolated contract tests.'
}

function Quote-ProcessArgument([string]$value) {
    if ($value.IndexOf('"') -ge 0 -or $value.IndexOf("`r") -ge 0 -or $value.IndexOf("`n") -ge 0 -or $value.IndexOf([char]0) -ge 0) {
        throw 'Unsupported process argument character.'
    }
    return '"' + $value + '"'
}

function Invoke-IsolatedPowerShellScript([string]$scriptRelativePath, [string[]]$scriptArguments) {
    $scriptFullPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $scriptRelativePath))
    $repoPrefix = $repoRoot.TrimEnd('\') + '\'
    if (-not $scriptFullPath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Test child script is outside the workspace: $scriptRelativePath"
    }
    if (-not (Test-Path -LiteralPath $scriptFullPath -PathType Leaf)) {
        throw "Test child script is missing: $scriptRelativePath"
    }

    $argumentParts = @(
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        (Quote-ProcessArgument $scriptFullPath)
    )
    foreach ($argument in @($scriptArguments)) {
        $argumentParts += Quote-ProcessArgument $argument
    }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = Get-PowerShellExecutable
    $startInfo.Arguments = $argumentParts -join ' '
    $startInfo.WorkingDirectory = $repoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw "Failed to start isolated test child: $scriptRelativePath" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    $exitCode = $process.ExitCode
    $process.Dispose()

    $document = $null
    $parseError = $null
    if ([string]::IsNullOrWhiteSpace($stdout)) {
        $parseError = 'Child process returned no JSON output.'
    } else {
        try { $document = $stdout | ConvertFrom-Json }
        catch { $parseError = $_.Exception.Message }
    }
    $statusProperty = if ($null -eq $document) { $null } else { $document.PSObject.Properties['status'] }
    $reportedStatus = if ($null -eq $statusProperty -or $null -eq $statusProperty.Value) { 'BLOCKED' } else { $statusProperty.Value.ToString() }
    $contractPassed = Test-TechV02StageProcessContract $exitCode $reportedStatus $parseError $stderr

    return [pscustomobject][ordered]@{
        exitCode = $exitCode
        stdoutSha256 = if ([string]::IsNullOrEmpty($stdout)) { $null } else { Get-TextSha256 $stdout }
        stderrSha256 = if ([string]::IsNullOrEmpty($stderr)) { $null } else { Get-TextSha256 $stderr }
        stderrEmpty = [string]::IsNullOrWhiteSpace($stderr)
        parseError = $parseError
        reportedStatus = $reportedStatus
        processContractPassed = $contractPassed
        document = $document
    }
}

function Get-GovernanceStateFingerprint {
    $parts = New-Object 'System.Collections.Generic.List[string]'
    $fixedPaths = @(
        '.git\HEAD',
        '.git\config',
        '.git\packed-refs',
        'CHANGELOG.md',
        'docs\HOTEL-AI-OS-PRODUCT-BLUEPRINT.md',
        'docs\V1.2-ARCHITECTURE-FREEZE.md',
        'docs\TECHNICAL-VERSION-HISTORY.md',
        'docs\TECH-V0.2-RELEASE-CANDIDATE-FINAL-REPORT.md',
        'docs\releases\TECH-V0.2-RELEASE-BLOCKER-HANDOFF.md',
        'docs\releases\TECH-V0.2-RELEASE-NOTE-RC.md',
        'docs\releases\TECH-V0.2-RELEASE-SIGNOFF.md',
        'docs\releases\TECH-V0.2-EXTERNAL-EVIDENCE-BUNDLE.md',
        'docs\releases\TECH-V0.2-EXTERNAL-EVIDENCE-BUNDLE.example.json',
        'docs\releases\TECH-V0.2-RELEASE-GATE-INPUTS.example.json'
    )
    foreach ($relativePath in $fixedPaths) {
        $normalized = $relativePath.Replace('\', '/')
        $fullPath = Join-Path $repoRoot $relativePath
        if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
            $hash = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
            $parts.Add("file:$normalized`:$hash")
        } else {
            $parts.Add("file:$normalized`:MISSING")
        }
    }

    foreach ($relativeDirectory in @('.git\refs\heads', '.git\refs\tags')) {
        $normalizedDirectory = $relativeDirectory.Replace('\', '/')
        $fullDirectory = Join-Path $repoRoot $relativeDirectory
        if (-not (Test-Path -LiteralPath $fullDirectory -PathType Container)) {
            $parts.Add("dir:$normalizedDirectory`:MISSING")
            continue
        }
        $parts.Add("dir:$normalizedDirectory`:PRESENT")
        $refFiles = @(Get-ChildItem -LiteralPath $fullDirectory -File -Recurse -Force | Sort-Object FullName)
        if ($refFiles.Count -eq 0) { $parts.Add("dir:$normalizedDirectory`:EMPTY") }
        foreach ($refFile in $refFiles) {
            $relativeRef = $refFile.FullName.Substring($repoRoot.Length + 1).Replace('\', '/')
            $refHash = (Get-FileHash -LiteralPath $refFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            $parts.Add("ref:$relativeRef`:$refHash")
        }
    }

    return Get-TextSha256 ((@($parts) | Sort-Object) -join "`n")
}

function Get-AtomicTemporaryFileCount([string]$directory, [string]$targetFileName) {
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) { return 0 }
    $temporaryCount = @(Get-ChildItem -LiteralPath $directory -File -Filter ('.' + $targetFileName + '.*.tmp') -Force).Count
    $backupCount = @(Get-ChildItem -LiteralPath $directory -File -Filter ('.' + $targetFileName + '.*.bak') -Force).Count
    return $temporaryCount + $backupCount
}

$stateBefore = Get-GovernanceStateFingerprint

$missingObject = [pscustomobject]@{}
$stringZeroObject = [pscustomobject]@{ count = '0' }
$integerZeroObject = [pscustomobject]@{ count = 0 }
$integerOneObject = [pscustomobject]@{ count = 1 }
Add-ContractCase 'missing-integer-property-is-rejected' (-not (Test-TechV02ExactIntegerProperty $missingObject 'count' 0)) 'Missing JSON fields must not coerce to zero.'
Add-ContractCase 'string-zero-is-rejected' (-not (Test-TechV02ExactIntegerProperty $stringZeroObject 'count' 0)) 'String values must not satisfy integer mutation contracts.'
Add-ContractCase 'exact-integer-values-are-enforced' ((Test-TechV02ExactIntegerProperty $integerZeroObject 'count' 0) -and (Test-TechV02ExactIntegerProperty $integerOneObject 'count' 1) -and -not (Test-TechV02ExactIntegerProperty $integerOneObject 'count' 0)) 'Only an explicit integer with the expected value may pass.'
Add-ContractCase 'missing-boolean-property-is-rejected' (-not (Test-TechV02ExactBooleanProperty $missingObject 'readOnly' $true)) 'Missing JSON booleans must not satisfy safeguards.'
Add-ContractCase 'process-contract-accepts-only-clean-pass' ((Test-TechV02StageProcessContract 0 'PASS' $null '') -and (Test-TechV02StageProcessContract 0 'PASS' $null " `t")) 'Exit 0, exact PASS, parse success, and empty stderr are all required.'
Add-ContractCase 'process-contract-status-is-case-sensitive' (-not (Test-TechV02StageProcessContract 0 'pass' $null '')) 'A lower-case status must not satisfy the PASS contract.'

$blockedExitZero = Invoke-IsolatedPowerShellScript 'tools\release\tests\fixtures\ChildStatusBlockedExitZero.ps1' @()
Add-ContractCase 'exit-zero-with-blocked-json-is-rejected' (-not $blockedExitZero.processContractPassed -and $blockedExitZero.exitCode -eq 0 -and $blockedExitZero.reportedStatus -eq 'BLOCKED') "reported=$($blockedExitZero.reportedStatus), exit=$($blockedExitZero.exitCode)"

$passExitOne = Invoke-IsolatedPowerShellScript 'tools\release\tests\fixtures\ChildStatusPassExitOne.ps1' @()
Add-ContractCase 'pass-json-with-nonzero-exit-is-rejected' (-not $passExitOne.processContractPassed -and $passExitOne.exitCode -ne 0 -and $passExitOne.reportedStatus -eq 'PASS') "reported=$($passExitOne.reportedStatus), exit=$($passExitOne.exitCode)"

$invalidJson = Invoke-IsolatedPowerShellScript 'tools\release\tests\fixtures\ChildInvalidJson.ps1' @()
Add-ContractCase 'invalid-json-is-rejected' (-not $invalidJson.processContractPassed -and -not [string]::IsNullOrWhiteSpace($invalidJson.parseError)) "exit=$($invalidJson.exitCode), parseErrorPresent=$(-not [string]::IsNullOrWhiteSpace($invalidJson.parseError))"

$stderrPass = Invoke-IsolatedPowerShellScript 'tools\release\tests\fixtures\ChildPassWithStderr.ps1' @()
Add-ContractCase 'stderr-on-pass-is-rejected' (-not $stderrPass.processContractPassed -and -not $stderrPass.stderrEmpty) "exit=$($stderrPass.exitCode), stderrEmpty=$($stderrPass.stderrEmpty)"

$controllerAsLibrary = Invoke-IsolatedPowerShellScript 'tools\release\Invoke-TechV02ReleaseClosure.ps1' @('-AsLibrary')
$controllerAsLibraryRejected = (
    $controllerAsLibrary.exitCode -ne 0 -and
    -not $controllerAsLibrary.processContractPassed -and
    -not $controllerAsLibrary.stderrEmpty -and
    $null -eq $controllerAsLibrary.document
)
Add-ContractCase 'controller-aslibrary-is-rejected-by-isolated-process' $controllerAsLibraryRejected "exit=$($controllerAsLibrary.exitCode), stderrEmpty=$($controllerAsLibrary.stderrEmpty), jsonPresent=$($null -ne $controllerAsLibrary.document)"

$gateInputRelativePath = 'docs\releases\TECH-V0.2-RELEASE-GATE-INPUTS.example.json'
$gateInputFullPath = Join-Path $repoRoot $gateInputRelativePath
$gateInputBeforeSha = (Get-FileHash -LiteralPath $gateInputFullPath -Algorithm SHA256).Hash.ToLowerInvariant()
$gateInputSize = (Get-Item -LiteralPath $gateInputFullPath).Length
$gate = Invoke-IsolatedPowerShellScript 'tools\release\Test-TechV02ReleaseGate.ps1' @('-InputsPath', $gateInputFullPath)
$gateInputAfterSha = (Get-FileHash -LiteralPath $gateInputFullPath -Algorithm SHA256).Hash.ToLowerInvariant()
$gateDocument = $gate.document
$gateBindingPassed = (
    $gate.exitCode -ne 0 -and
    $gate.stderrEmpty -and
    [string]::IsNullOrWhiteSpace($gate.parseError) -and
    $null -ne $gateDocument -and
    $gateDocument.status -eq 'BLOCKED' -and
    $gateDocument.inputsStatus -eq 'LOADED' -and
    $gateDocument.inputsPath -eq $gateInputRelativePath.Replace('\', '/') -and
    $gateDocument.consumedInputsSha256 -eq $gateInputBeforeSha -and
    [long]$gateDocument.consumedInputsSizeBytes -eq [long]$gateInputSize -and
    $gateInputBeforeSha -eq $gateInputAfterSha -and
    (Test-TechV02ExactBooleanProperty $gateDocument.safeguards 'inputBytesLockedDuringEvaluation' $true) -and
    (Test-TechV02ExactBooleanProperty $gateDocument.safeguards 'readOnly' $true) -and
    (Test-TechV02ExactBooleanProperty $gateDocument.safeguards 'failClosed' $true) -and
    (Test-TechV02ExactBooleanProperty $gateDocument.safeguards 'releaseStatusModified' $false) -and
    (Test-TechV02ExactIntegerProperty $gateDocument.safeguards 'signaturesCreated' 0) -and
    (Test-TechV02ExactIntegerProperty $gateDocument.safeguards 'approvalsCreated' 0) -and
    (Test-TechV02ExactIntegerProperty $gateDocument.safeguards 'commitsCreated' 0) -and
    (Test-TechV02ExactIntegerProperty $gateDocument.safeguards 'tagsCreated' 0) -and
    (Test-TechV02ExactIntegerProperty $gateDocument.safeguards 'networkWrites' 0)
)
Add-ContractCase 'final-gate-binds-and-locks-exact-consumed-input-bytes' $gateBindingPassed "exit=$($gate.exitCode), consumed=$($gateDocument.consumedInputsSha256), before=$gateInputBeforeSha, after=$gateInputAfterSha, bytes=$gateInputSize"

$tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$atomicRoot = [System.IO.Path]::GetFullPath((Join-Path $tempBase ('tech-v02-release-closure-contracts-' + [Guid]::NewGuid().ToString('N'))))
if (-not $atomicRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -or [System.IO.Path]::GetFileName($atomicRoot) -notlike 'tech-v02-release-closure-contracts-*') {
    throw 'Atomic test directory did not resolve beneath the operating-system temporary directory.'
}
[void][System.IO.Directory]::CreateDirectory($atomicRoot)
try {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)

    $replaceTarget = Join-Path $atomicRoot 'replace-existing.txt'
    [System.IO.File]::WriteAllText($replaceTarget, 'original-existing-content', $utf8NoBom)
    $replacementContent = 'verified-replacement-content'
    $replacementSha = Get-TextSha256 $replacementContent
    $replaceResult = $null
    $replaceErrorType = $null
    try {
        $replaceResult = Invoke-TechV02AtomicVerifiedTextWrite -OutputFullPath $replaceTarget -Content $replacementContent -Verifier {
            param($temporaryPath, $temporarySha256)
            [pscustomobject]@{ Promote = ((Test-Path -LiteralPath $temporaryPath -PathType Leaf) -and $temporarySha256 -eq $replacementSha) }
        }
    } catch {
        $replaceErrorType = $_.Exception.GetType().Name
    }
    $replacePassed = (
        $null -ne $replaceResult -and
        $replaceResult.Promoted -eq $true -and
        $replaceResult.TemporarySha256 -eq $replacementSha -and
        (Test-TechV02ExactIntegerProperty $replaceResult 'TemporaryFilesRemaining' 0) -and
        [System.IO.File]::ReadAllText($replaceTarget) -ceq $replacementContent -and
        (Get-AtomicTemporaryFileCount $atomicRoot 'replace-existing.txt') -eq 0
    )
    $replacePromoted = if ($null -eq $replaceResult) { $false } else { $replaceResult.Promoted }
    $replaceTempRemaining = if ($null -eq $replaceResult) { Get-AtomicTemporaryFileCount $atomicRoot 'replace-existing.txt' } else { $replaceResult.TemporaryFilesRemaining }
    Add-ContractCase 'atomic-write-promotes-verified-content-over-existing-target' $replacePassed "promoted=$replacePromoted, tempRemaining=$replaceTempRemaining, errorType=$replaceErrorType"

    $cleanupFailureTarget = Join-Path $atomicRoot 'cleanup-failure.txt'
    $cleanupFailureOriginal = 'original-content-must-be-restored'
    [System.IO.File]::WriteAllText($cleanupFailureTarget, $cleanupFailureOriginal, $utf8NoBom)
    $cleanupFailureCaught = $false
    $cleanupFailureMessage = ''
    try {
        Invoke-TechV02AtomicVerifiedTextWrite `
            -OutputFullPath $cleanupFailureTarget `
            -Content 'verified-content-that-must-be-rolled-back' `
            -Verifier { [pscustomobject]@{ Promote = $true } } `
            -BeforeBackupCleanup { throw 'injected backup cleanup failure' } | Out-Null
    } catch {
        $cleanupFailureCaught = $true
        $cleanupFailureMessage = $_.Exception.Message
    }
    $cleanupRollbackPassed = (
        $cleanupFailureCaught -and
        $cleanupFailureMessage -like '*rolled back*' -and
        [System.IO.File]::ReadAllText($cleanupFailureTarget) -ceq $cleanupFailureOriginal -and
        (Get-AtomicTemporaryFileCount $atomicRoot 'cleanup-failure.txt') -eq 0
    )
    Add-ContractCase 'atomic-write-rolls-back-when-post-replace-cleanup-fails' $cleanupRollbackPassed "exceptionCaught=$cleanupFailureCaught, originalRestored=$([System.IO.File]::ReadAllText($cleanupFailureTarget) -ceq $cleanupFailureOriginal), tempCount=$(Get-AtomicTemporaryFileCount $atomicRoot 'cleanup-failure.txt')"

    $rejectTarget = Join-Path $atomicRoot 'reject-verification.txt'
    $rejectOriginal = 'preserve-this-content'
    [System.IO.File]::WriteAllText($rejectTarget, $rejectOriginal, $utf8NoBom)
    $rejectResult = Invoke-TechV02AtomicVerifiedTextWrite -OutputFullPath $rejectTarget -Content 'must-not-be-promoted' -Verifier {
        param($temporaryPath, $temporarySha256)
        [pscustomobject]@{ Promote = 'true'; ObservedSha256 = $temporarySha256 }
    }
    $rejectPassed = (
        $rejectResult.Promoted -eq $false -and
        (Test-TechV02ExactIntegerProperty $rejectResult 'TemporaryFilesRemaining' 0) -and
        [System.IO.File]::ReadAllText($rejectTarget) -ceq $rejectOriginal -and
        (Get-AtomicTemporaryFileCount $atomicRoot 'reject-verification.txt') -eq 0
    )
    Add-ContractCase 'atomic-write-rejects-nonboolean-verifier-approval' $rejectPassed "promoted=$($rejectResult.Promoted), tempRemaining=$($rejectResult.TemporaryFilesRemaining)"

    $exceptionTarget = Join-Path $atomicRoot 'verifier-exception.txt'
    $exceptionOriginal = 'survives-verifier-exception'
    [System.IO.File]::WriteAllText($exceptionTarget, $exceptionOriginal, $utf8NoBom)
    $exceptionCaught = $false
    try {
        Invoke-TechV02AtomicVerifiedTextWrite -OutputFullPath $exceptionTarget -Content 'must-not-survive' -Verifier {
            param($temporaryPath, $temporarySha256)
            throw 'expected verifier failure'
        } | Out-Null
    } catch {
        $exceptionCaught = $true
    }
    $exceptionCleanupPassed = (
        $exceptionCaught -and
        [System.IO.File]::ReadAllText($exceptionTarget) -ceq $exceptionOriginal -and
        (Get-AtomicTemporaryFileCount $atomicRoot 'verifier-exception.txt') -eq 0
    )
    Add-ContractCase 'atomic-write-cleans-temporary-file-when-verifier-throws' $exceptionCleanupPassed "exceptionCaught=$exceptionCaught, tempCount=$(Get-AtomicTemporaryFileCount $atomicRoot 'verifier-exception.txt')"

    $missingTarget = Join-Path $atomicRoot 'initially-absent.txt'
    $missingTargetContent = 'first-verified-content'
    $missingTargetResult = Invoke-TechV02AtomicVerifiedTextWrite -OutputFullPath $missingTarget -Content $missingTargetContent -Verifier {
        param($temporaryPath, $temporarySha256)
        [pscustomobject]@{ Promote = $true }
    }
    $missingTargetPassed = (
        $missingTargetResult.Promoted -eq $true -and
        (Test-Path -LiteralPath $missingTarget -PathType Leaf) -and
        [System.IO.File]::ReadAllText($missingTarget) -ceq $missingTargetContent -and
        (Test-TechV02ExactIntegerProperty $missingTargetResult 'TemporaryFilesRemaining' 0) -and
        (Get-AtomicTemporaryFileCount $atomicRoot 'initially-absent.txt') -eq 0
    )
    Add-ContractCase 'atomic-write-creates-verified-target-when-target-does-not-exist' $missingTargetPassed "promoted=$($missingTargetResult.Promoted), exists=$(Test-Path -LiteralPath $missingTarget -PathType Leaf)"

    $missingDirectoryTarget = Join-Path (Join-Path $atomicRoot 'missing-directory') 'output.txt'
    $missingDirectoryRejected = $false
    try {
        Invoke-TechV02AtomicVerifiedTextWrite -OutputFullPath $missingDirectoryTarget -Content 'no-output' -Verifier {
            param($temporaryPath, $temporarySha256)
            [pscustomobject]@{ Promote = $true }
        } | Out-Null
    } catch {
        $missingDirectoryRejected = $true
    }
    Add-ContractCase 'atomic-write-rejects-missing-output-directory' ($missingDirectoryRejected -and -not (Test-Path -LiteralPath $missingDirectoryTarget)) "rejected=$missingDirectoryRejected, outputExists=$(Test-Path -LiteralPath $missingDirectoryTarget)"
} finally {
    if (Test-Path -LiteralPath $atomicRoot -PathType Container) {
        [System.IO.Directory]::Delete($atomicRoot, $true)
    }
}

$stateAfter = Get-GovernanceStateFingerprint
Add-ContractCase 'governance-and-git-state-remain-unchanged' ($stateBefore -eq $stateAfter) "before=$stateBefore, after=$stateAfter"

$result = [ordered]@{
    status = if ($failures.Count -eq 0) { 'PASS' } else { 'FAIL' }
    cases = $cases
    failures = $failures
    stateFingerprintBefore = $stateBefore
    stateFingerprintAfter = $stateAfter
    safeguards = [ordered]@{
        controllerDotSourced = $false
        controllerAsLibraryUsed = $false
        supportLibraryDotSourced = $true
        isolatedChildProcesses = $true
        governancePathsCovered = @(
            '.git/refs/heads',
            '.git/refs/tags',
            '.git/packed-refs',
            '.git/HEAD',
            '.git/config',
            'CHANGELOG.md',
            'docs/HOTEL-AI-OS-PRODUCT-BLUEPRINT.md',
            'docs/V1.2-ARCHITECTURE-FREEZE.md',
            'docs/TECHNICAL-VERSION-HISTORY.md',
            'docs/TECH-V0.2-RELEASE-CANDIDATE-FINAL-REPORT.md',
            'docs/releases/TECH-V0.2-RELEASE-BLOCKER-HANDOFF.md',
            'docs/releases/TECH-V0.2-RELEASE-NOTE-RC.md',
            'docs/releases/TECH-V0.2-RELEASE-SIGNOFF.md'
        )
    }
    mutations = [ordered]@{
        signaturesCreated = 0
        approvalsCreated = 0
        commitsCreated = 0
        tagsCreated = 0
        releaseStatusModified = $false
        networkWrites = 0
    }
}
$result | ConvertTo-Json -Depth 10
if ($result.status -eq 'PASS') { exit 0 }
exit 1
