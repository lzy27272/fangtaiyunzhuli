[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$powerShellPath = (Get-Process -Id $PID).Path
$cases = New-Object 'System.Collections.Generic.List[object]'
$failures = New-Object 'System.Collections.Generic.List[string]'

function Quote-Argument([string]$value) {
    if ($value.IndexOf('"') -ge 0 -or $value.IndexOf("`r") -ge 0 -or $value.IndexOf("`n") -ge 0) {
        throw 'Test argument contains an unsupported character.'
    }
    return '"' + $value + '"'
}

function Invoke-IsolatedScript([string]$scriptPath, [string[]]$arguments) {
    $parts = @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',(Quote-Argument $scriptPath))
    foreach ($argument in @($arguments)) { $parts += Quote-Argument $argument }
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $powerShellPath
    $startInfo.Arguments = $parts -join ' '
    $startInfo.WorkingDirectory = $repoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw "Could not start $scriptPath" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    $exitCode = $process.ExitCode
    $process.Dispose()
    $document = if ([string]::IsNullOrWhiteSpace($stdout)) { $null } else { $stdout | ConvertFrom-Json }
    return [pscustomobject]@{ ExitCode = $exitCode; Stdout = $stdout; Stderr = $stderr; Document = $document }
}

function Add-Case([string]$name, [bool]$passed, [string]$detail) {
    $cases.Add([pscustomobject]@{ name = $name; passed = $passed; detail = $detail })
    if (-not $passed) { $failures.Add("$name`: $detail") }
}

$generatorPath = Join-Path $repoRoot 'tools\release\New-TechV02ExternalEvidenceBundle.ps1'
$controllerPath = Join-Path $repoRoot 'tools\release\Invoke-TechV02ReleaseClosure.ps1'
$exampleBundle = 'docs/releases/TECH-V0.2-EXTERNAL-EVIDENCE-BUNDLE.example.json'
$runId = [Guid]::NewGuid().ToString('N')
$negativeOutput = ".uat-runtime/release/tests/generator-negative-$runId.json"
$negativeOutputFullPath = Join-Path $repoRoot $negativeOutput

$generator = Invoke-IsolatedScript $generatorPath @('-BundlePath',$exampleBundle,'-OutputPath',$negativeOutput)
$generatorPassed = (
    $generator.ExitCode -eq 1 -and
    $generator.Document.status -eq 'BLOCKED' -and
    [int]$generator.Document.mutations.gateInputsFilesWritten -eq 0 -and
    [int]$generator.Document.mutations.temporaryFilesRemaining -eq 0 -and
    @($generator.Document.requiredValidationOrder).Count -eq 2 -and
    $generator.Document.requiredValidationOrder[0].script -eq 'tools/release/Test-TechV02ExternalEvidenceBundle.ps1' -and
    $null -eq $generator.Document.PSObject.Properties['nextCommand'] -and
    -not (Test-Path -LiteralPath $negativeOutputFullPath) -and
    [string]::IsNullOrWhiteSpace($generator.Stderr)
)
Add-Case 'invalid-bundle-does-not-write-gate-inputs' $generatorPassed "exit=$($generator.ExitCode), status=$($generator.Document.status), fileExists=$(Test-Path -LiteralPath $negativeOutputFullPath)"

$outsideGeneratorOutput = "docs/releases/generator-unsafe-$runId.json"
$outsideGeneratorFullPath = Join-Path $repoRoot $outsideGeneratorOutput
$outsideGenerator = Invoke-IsolatedScript $generatorPath @('-BundlePath',$exampleBundle,'-OutputPath',$outsideGeneratorOutput)
$outsideGeneratorPassed = (
    $outsideGenerator.ExitCode -ne 0 -and
    $null -eq $outsideGenerator.Document -and
    -not [string]::IsNullOrWhiteSpace($outsideGenerator.Stderr) -and
    -not (Test-Path -LiteralPath $outsideGeneratorFullPath)
)
Add-Case 'generator-output-outside-runtime-is-rejected' $outsideGeneratorPassed "exit=$($outsideGenerator.ExitCode), fileExists=$(Test-Path -LiteralPath $outsideGeneratorFullPath)"

$nonJsonGeneratorOutput = ".uat-runtime/release/tests/generator-unsafe-$runId.txt"
$nonJsonGeneratorFullPath = Join-Path $repoRoot $nonJsonGeneratorOutput
$nonJsonGenerator = Invoke-IsolatedScript $generatorPath @('-BundlePath',$exampleBundle,'-OutputPath',$nonJsonGeneratorOutput)
$nonJsonGeneratorPassed = (
    $nonJsonGenerator.ExitCode -ne 0 -and
    $null -eq $nonJsonGenerator.Document -and
    -not [string]::IsNullOrWhiteSpace($nonJsonGenerator.Stderr) -and
    -not (Test-Path -LiteralPath $nonJsonGeneratorFullPath)
)
Add-Case 'generator-non-json-output-is-rejected' $nonJsonGeneratorPassed "exit=$($nonJsonGenerator.ExitCode), fileExists=$(Test-Path -LiteralPath $nonJsonGeneratorFullPath)"

$missingBundle = ".uat-runtime/release/missing-controlled-evidence-$runId.json"
$closureOutput = ".uat-runtime/release/tests/closure-negative-$runId.json"
$closureOutputFullPath = Join-Path $repoRoot $closureOutput
$closure = Invoke-IsolatedScript $controllerPath @('-BundlePath',$missingBundle,'-GateInputsPath',$closureOutput)
$notRun = @($closure.Document.summary.notRunStages)
$closurePassed = (
    $closure.ExitCode -eq 2 -and
    $closure.Document.status -eq 'BLOCKED' -and
    $closure.Document.failedStage -eq 'EXTERNAL-EVIDENCE-GENERATION' -and
    [int]$closure.Document.summary.executedStages -eq 2 -and
    $closure.Document.stages[0].status -eq 'PASS' -and
    $closure.Document.stages[1].status -eq 'BLOCKED' -and
    $notRun -contains 'EXTERNAL-EVIDENCE-RECOMPUTE' -and
    $notRun -contains 'FINAL-RELEASE-GATE' -and
    [int]$closure.Document.safeguards.gateInputsFilesWritten -eq 0 -and
    -not $closure.Document.eligibleForHumanReleaseDecision -and
    -not (Test-Path -LiteralPath $closureOutputFullPath) -and
    [string]::IsNullOrWhiteSpace($closure.Stderr)
)
Add-Case 'missing-controlled-bundle-stops-before-final-gate' $closurePassed "exit=$($closure.ExitCode), failedStage=$($closure.Document.failedStage), executed=$($closure.Document.summary.executedStages)"

$unsafeOutput = "docs/releases/unsafe-gate-input-$runId.json"
$unsafeOutputFullPath = Join-Path $repoRoot $unsafeOutput
$unsafe = Invoke-IsolatedScript $controllerPath @('-BundlePath',$missingBundle,'-GateInputsPath',$unsafeOutput)
$unsafePassed = (
    $unsafe.ExitCode -eq 3 -and
    $unsafe.Document.status -eq 'BLOCKED' -and
    $unsafe.Document.failedStage -eq 'CLOSURE-ORCHESTRATOR' -and
    [int]$unsafe.Document.summary.executedStages -eq 1 -and
    -not (Test-Path -LiteralPath $unsafeOutputFullPath) -and
    [string]::IsNullOrWhiteSpace($unsafe.Stderr)
)
Add-Case 'gate-input-output-outside-runtime-is-rejected' $unsafePassed "exit=$($unsafe.ExitCode), failedStage=$($unsafe.Document.failedStage), fileExists=$(Test-Path -LiteralPath $unsafeOutputFullPath)"

$samePath = ".uat-runtime/release/tests/same-path-$runId.json"
$sameFullPath = Join-Path $repoRoot $samePath
$same = Invoke-IsolatedScript $controllerPath @('-BundlePath',$samePath,'-GateInputsPath',$samePath)
$samePassed = (
    $same.ExitCode -eq 3 -and
    $same.Document.status -eq 'BLOCKED' -and
    $same.Document.failedStage -eq 'CLOSURE-ORCHESTRATOR' -and
    -not (Test-Path -LiteralPath $sameFullPath) -and
    [string]::IsNullOrWhiteSpace($same.Stderr)
)
Add-Case 'bundle-and-output-same-path-is-rejected' $samePassed "exit=$($same.ExitCode), failedStage=$($same.Document.failedStage), fileExists=$(Test-Path -LiteralPath $sameFullPath)"

$result = [ordered]@{
    status = if ($failures.Count -eq 0) { 'PASS' } else { 'FAIL' }
    cases = $cases
    failures = $failures
    mutations = [ordered]@{
        generatedGateInputFilesRemaining = @($negativeOutputFullPath,$outsideGeneratorFullPath,$nonJsonGeneratorFullPath,$closureOutputFullPath,$unsafeOutputFullPath,$sameFullPath | Where-Object { Test-Path -LiteralPath $_ }).Count
        signaturesCreated = 0
        approvalsCreated = 0
        commitsCreated = 0
        tagsCreated = 0
        releaseStatusModified = $false
        networkWrites = 0
    }
}
$result | ConvertTo-Json -Depth 8
if ($result.status -eq 'PASS') { exit 0 }
exit 1
