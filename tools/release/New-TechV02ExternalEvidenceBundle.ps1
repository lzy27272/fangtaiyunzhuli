[CmdletBinding()]
param(
    [string]$BundlePath = '.uat-runtime/release/TECH-V0.2-EXTERNAL-EVIDENCE-BUNDLE.json',
    [string]$OutputPath = '.uat-runtime/release/TECH-V0.2-RELEASE-GATE-INPUTS.json'
)

$ErrorActionPreference = 'Stop'
$requestedBundlePath = $BundlePath
$requestedOutputPath = $OutputPath
$validatorPath = Join-Path $PSScriptRoot 'Test-TechV02ExternalEvidenceBundle.ps1'
. $validatorPath -AsLibrary
. (Join-Path $PSScriptRoot 'TechV02ReleaseClosureSupport.ps1')
$BundlePath = $requestedBundlePath
$OutputPath = $requestedOutputPath

$preflight = Invoke-TechV02ExternalEvidenceBundleValidation -BundlePath $BundlePath
$outputFullPath = Resolve-TechV02WorkspacePath $OutputPath
if (-not $outputFullPath) {
    throw 'OutputPath must resolve to a file inside the workspace.'
}
$allowedOutputRoot = [System.IO.Path]::GetFullPath((Join-Path $script:TechV02EvidenceRepoRoot '.uat-runtime\release')).TrimEnd('\') + '\'
if (-not $outputFullPath.StartsWith($allowedOutputRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'OutputPath must stay under .uat-runtime/release.'
}
if (-not $outputFullPath.EndsWith('.json', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'OutputPath must be a JSON file.'
}
$bundleFullPath = Resolve-TechV02WorkspacePath $BundlePath
if ($bundleFullPath -and $outputFullPath.Equals($bundleFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'OutputPath cannot overwrite the external evidence bundle.'
}
$bundleRelativePath = if ($bundleFullPath) { Get-TechV02RelativePath $bundleFullPath } else { $BundlePath.Replace('\','/') }
$outputRelativePath = Get-TechV02RelativePath $outputFullPath
$externalValidationStep = [ordered]@{
    script = 'tools/release/Test-TechV02ExternalEvidenceBundle.ps1'
    arguments = [ordered]@{ BundlePath = $bundleRelativePath; GateInputsPath = $outputRelativePath }
}
$finalGateStep = [ordered]@{
    script = 'tools/release/Test-TechV02ReleaseGate.ps1'
    arguments = [ordered]@{ InputsPath = $outputRelativePath }
}
if ($preflight.status -cne 'PASS') {
    [ordered]@{
        schemaVersion = 1
        releaseVersion = 'TECH-V0.2'
        status = 'BLOCKED'
        outputPath = $outputRelativePath
        outputSha256 = $null
        bundleSha256 = $preflight.bundleSha256
        verifiedGateInputsSha256 = $null
        gateInputsCompared = $false
        staleOutputPresent = Test-Path -LiteralPath $outputFullPath -PathType Leaf
        reasons = @($preflight.reasons)
        formalValidationRequired = $true
        requiredValidationOrder = @($externalValidationStep, $finalGateStep)
        nextStep = $null
        finalGateStep = $finalGateStep
        warning = 'The evidence bundle failed preflight, so no gate-input file was written. Any pre-existing output is stale and must not be used.'
        mutations = [ordered]@{ gateInputsFilesWritten = 0; temporaryFilesRemaining = 0; signaturesCreated = 0; approvalsCreated = 0; commitsCreated = 0; tagsCreated = 0; networkWrites = 0 }
    } | ConvertTo-Json -Depth 10
    exit 1
}
$outputDirectory = Split-Path -Parent $outputFullPath
if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
}
$json = $preflight.gateInputs | ConvertTo-Json -Depth 30
$atomicResult = Invoke-TechV02AtomicVerifiedTextWrite `
    -OutputFullPath $outputFullPath `
    -Content ($json + [Environment]::NewLine) `
    -Verifier {
        param($candidatePath, $candidateSha256)
        $candidateVerification = Invoke-TechV02ExternalEvidenceBundleValidation -BundlePath $BundlePath -GateInputsPath $candidatePath
        $candidateReasons = @($candidateVerification.reasons)
        if ($candidateVerification.bundleSha256 -ne $preflight.bundleSha256) {
            $candidateReasons += 'external evidence bundle changed between preflight and temporary-input verification'
        }
        if ($candidateVerification.gateInputsSha256 -ne $candidateSha256) {
            $candidateReasons += 'validator did not consume the exact temporary gate-input bytes'
        }
        $promote = (
            $candidateVerification.status -ceq 'PASS' -and
            (Test-TechV02ExactBooleanProperty $candidateVerification 'gateInputsCompared' $true) -and
            $candidateReasons.Count -eq 0
        )
        [pscustomobject][ordered]@{
            Promote = $promote
            Result = $candidateVerification
            Reasons = @($candidateReasons | Select-Object -Unique)
        }
    }
$verified = $atomicResult.Verification.Result
$verificationReasons = @($atomicResult.Verification.Reasons)
$canonicalWritten = $atomicResult.Promoted
$temporarySha256 = $atomicResult.TemporarySha256
$temporaryFilesRemaining = $atomicResult.TemporaryFilesRemaining
$verifiedComparisonPassed = Test-TechV02ExactBooleanProperty $verified 'gateInputsCompared' $true
$status = if ($canonicalWritten -and $verified.status -ceq 'PASS' -and $verifiedComparisonPassed -and $verificationReasons.Count -eq 0) { 'PASS' } else { 'BLOCKED' }
$summary = [ordered]@{
    schemaVersion = 1
    releaseVersion = 'TECH-V0.2'
    status = $status
    outputPath = $outputRelativePath
    outputSha256 = if ($canonicalWritten) { Get-TechV02FileSha256 $outputFullPath } else { $null }
    bundleSha256 = $preflight.bundleSha256
    verifiedGateInputsSha256 = if ($verified) { $verified.gateInputsSha256 } else { $null }
    gateInputsCompared = $canonicalWritten -and $verifiedComparisonPassed
    staleOutputPresent = -not $canonicalWritten -and (Test-Path -LiteralPath $outputFullPath -PathType Leaf)
    reasons = @($verificationReasons | Select-Object -Unique)
    formalValidationRequired = $true
    requiredValidationOrder = @($externalValidationStep, $finalGateStep)
    nextStep = if ($canonicalWritten) { $externalValidationStep } else { $null }
    finalGateStep = $finalGateStep
    warning = 'Do not run the legacy release gate alone. The external validator must PASS with -GateInputsPath first. JSON and hashes do not independently prove a human identity.'
    mutations = [ordered]@{ gateInputsFilesWritten = if ($canonicalWritten) { 1 } else { 0 }; temporaryFilesRemaining = $temporaryFilesRemaining; signaturesCreated = 0; approvalsCreated = 0; commitsCreated = 0; tagsCreated = 0; networkWrites = 0 }
}
$summary | ConvertTo-Json -Depth 10
if ($status -eq 'PASS') { exit 0 }
exit 1
