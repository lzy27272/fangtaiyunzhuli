[CmdletBinding()]
param(
    [string]$ReleaseVersion = 'TECH-V0.2-RC',
    [string]$BuildTimestamp = '2026-07-18T00:00:00Z',
    [string]$OutputRoot
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$root = if ($OutputRoot) {
    [System.IO.Path]::GetFullPath($OutputRoot)
} else {
    Join-Path $repoRoot '.uat-runtime\release-artifacts\reproducibility'
}
$allowedRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot '.uat-runtime\release-artifacts')).TrimEnd('\') + '\'
$normalizedRoot = [System.IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
if (-not $normalizedRoot.StartsWith($allowedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputRoot must stay under $allowedRoot"
}
$first = Join-Path $root 'build-1'
$second = Join-Path $root 'build-2'

$one = & (Join-Path $PSScriptRoot 'New-ReleaseArtifacts.ps1') `
    -ReleaseVersion $ReleaseVersion -OutputRoot $first -BuildTimestamp $BuildTimestamp
if ($LASTEXITCODE -ne 0) { throw 'First release build failed.' }
$two = & (Join-Path $PSScriptRoot 'New-ReleaseArtifacts.ps1') `
    -ReleaseVersion $ReleaseVersion -OutputRoot $second -BuildTimestamp $BuildTimestamp
if ($LASTEXITCODE -ne 0) { throw 'Second release build failed.' }

$manifestOne = Get-Content -LiteralPath (Join-Path $first 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$manifestTwo = Get-Content -LiteralPath (Join-Path $second 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$differences = @()
foreach ($artifact in $manifestOne.artifacts) {
    $other = $manifestTwo.artifacts | Where-Object file -eq $artifact.file | Select-Object -First 1
    if (-not $other -or $artifact.sha256 -ne $other.sha256 -or $artifact.sizeBytes -ne $other.sizeBytes) {
        $differences += [ordered]@{
            file = $artifact.file
            build1 = $artifact.sha256
            build2 = if ($other) { $other.sha256 } else { $null }
        }
    }
}
if ($differences.Count -gt 0) {
    $differences | ConvertTo-Json -Depth 4 | Write-Output
    throw "Release builds were not reproducible; $($differences.Count) artifact(s) differ."
}
if ($manifestOne.reproducibleBuild.payloadFingerprintSha256 -ne $manifestTwo.reproducibleBuild.payloadFingerprintSha256) {
    throw 'Release payload fingerprints differ.'
}

[ordered]@{
    status = 'PASS'
    releaseVersion = $ReleaseVersion
    buildTimestamp = $BuildTimestamp
    payloadFingerprintSha256 = $manifestOne.reproducibleBuild.payloadFingerprintSha256
    artifactCount = @($manifestOne.artifacts).Count
    build1 = $first
    build2 = $second
} | ConvertTo-Json -Depth 4
