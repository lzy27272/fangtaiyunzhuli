[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$scannerPath = Join-Path $repoRoot 'tools\release\Test-ReleaseSensitiveInformation.ps1'
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('release-sensitive-information-' + [guid]::NewGuid().ToString('N'))
$results = New-Object 'System.Collections.Generic.List[object]'
$failures = New-Object 'System.Collections.Generic.List[string]'
$phase = 'initialize'

function Add-Case([string]$Name, [bool]$Passed, [string]$Detail) {
    $results.Add([pscustomobject][ordered]@{ name = $Name; passed = $Passed; detail = $Detail })
    if (-not $Passed) { $failures.Add("$Name`: $Detail") }
}

function Invoke-ScannerCase([string]$Path) {
    $output = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $scannerPath -InputFile $Path -OutputFormat Json
    $exitCode = $LASTEXITCODE
    $document = $output | ConvertFrom-Json
    return [pscustomobject]@{ exitCode = $exitCode; document = $document }
}

try {
    $phase = 'create-test-inputs'
    [void](New-Item -ItemType Directory -Path $temporaryRoot -Force)
    $literalPath = Join-Path $temporaryRoot 'literal-password.ps1'
    $variablePath = Join-Path $temporaryRoot 'variable-password.ps1'
    $environmentPath = Join-Path $temporaryRoot 'environment-password.mjs'

    $fieldName = 'pass' + 'word'
    $quotedValue = [string][char]34 + ('scanner' + '-test' + '-only') + [string][char]34
    [System.IO.File]::WriteAllText($literalPath, ('$' + $fieldName + ' = ' + $quotedValue + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText($variablePath, ('$' + $fieldName + ' = $reviewAccessValue' + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText($environmentPath, ('const credentials = { ' + $fieldName + ': process.env.OTA_REVIEW_ACCESS_VALUE };' + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))

    $phase = 'scan-literal'
    $literal = Invoke-ScannerCase $literalPath
    $literalFound = @($literal.document.findings | Where-Object { $_.ruleId -eq 'PASSWORD_ASSIGNMENT' }).Count -eq 1
    Add-Case 'literal-password-is-blocked' (($literal.exitCode -eq 2) -and ($literal.document.status -eq 'BLOCKED') -and $literalFound) 'Quoted password literals must be blocked.'

    $phase = 'scan-variable-reference'
    $variable = Invoke-ScannerCase $variablePath
    Add-Case 'variable-password-reference-passes' (($variable.exitCode -eq 0) -and ($variable.document.status -eq 'PASS') -and @($variable.document.findings).Count -eq 0) 'Variable references must not be treated as literals.'

    $phase = 'scan-environment-reference'
    $environment = Invoke-ScannerCase $environmentPath
    Add-Case 'environment-password-reference-passes' (($environment.exitCode -eq 0) -and ($environment.document.status -eq 'PASS') -and @($environment.document.findings).Count -eq 0) 'Environment references must not be treated as literals.'
} catch {
    [pscustomobject][ordered]@{
        status = 'FAIL'
        phase = $phase
        exceptionType = $_.Exception.GetType().Name
    } | ConvertTo-Json -Compress
    throw
} finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
}

$result = [pscustomobject][ordered]@{
    status = if ($failures.Count -eq 0) { 'PASS' } else { 'FAIL' }
    cases = @($results.ToArray())
    failureCount = $failures.Count
}
$result | ConvertTo-Json -Depth 5 -Compress
if ($failures.Count -gt 0) {
    throw ($failures -join '; ')
}
