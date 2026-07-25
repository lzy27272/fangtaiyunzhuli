[CmdletBinding()]
param(
    [string]$RuntimeRoot = 'D:\SifangguanHotelAIOS',
    [string]$RepoRoot = '',
    [string]$ResultPath = '',
    [string]$CandidateJar = '',
    [string]$RollbackJar = ''
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = (Resolve-Path (Join-Path $scriptRoot '..\..')).Path
}
if ([string]::IsNullOrWhiteSpace($ResultPath)) {
    $ResultPath = Join-Path $RepoRoot '.uat-runtime\pilot\pilot7-deploy-result.json'
}
& (Join-Path $scriptRoot 'Deploy-Pilot6.ps1') `
    -RuntimeRoot $RuntimeRoot `
    -RepoRoot $RepoRoot `
    -ResultPath $ResultPath `
    -CandidateJar $CandidateJar `
    -RollbackJar $RollbackJar
exit $LASTEXITCODE
