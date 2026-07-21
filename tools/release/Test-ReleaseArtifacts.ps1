[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ArtifactDirectory
)

$ErrorActionPreference = 'Stop'
$directory = (Resolve-Path -LiteralPath $ArtifactDirectory).Path
$manifestFile = Join-Path $directory 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestFile)) { throw "Manifest not found: $manifestFile" }
$manifest = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1) { throw "Unsupported manifest schema: $($manifest.schemaVersion)" }

$verified = foreach ($artifact in $manifest.artifacts) {
    $path = Join-Path $directory $artifact.file
    if (-not (Test-Path -LiteralPath $path)) { throw "Artifact missing: $($artifact.file)" }
    $item = Get-Item -LiteralPath $path
    if ($item.Length -ne [long]$artifact.sizeBytes) {
        throw "Artifact size mismatch: $($artifact.file)"
    }
    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $artifact.sha256) { throw "Artifact SHA-256 mismatch: $($artifact.file)" }
    [ordered]@{ file = $artifact.file; sizeBytes = $item.Length; sha256 = $actual; status = 'PASS' }
}

$payloadFingerprintInput = ($verified | ForEach-Object { "$($_.file):$($_.sha256)" }) -join "`n"
$bytes = [Text.Encoding]::UTF8.GetBytes($payloadFingerprintInput)
$sha = [Security.Cryptography.SHA256]::Create()
try {
    $fingerprint = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
} finally { $sha.Dispose() }
if ($fingerprint -ne $manifest.reproducibleBuild.payloadFingerprintSha256) {
    throw 'Payload fingerprint mismatch.'
}

$result = [ordered]@{
    status = 'PASS'
    releaseVersion = $manifest.releaseVersion
    databaseVersion = $manifest.versions.database
    apiBase = $manifest.versions.apiBase
    payloadFingerprintSha256 = $fingerprint
    artifactCount = @($verified).Count
    artifacts = @($verified)
}
$result | ConvertTo-Json -Depth 6
