[CmdletBinding()]
param(
    [string]$ReportPath = 'docs/TECH-V0.2-RELEASE-CANDIDATE-FINAL-REPORT.md',
    [string]$ApiSummaryPath = 'docs/uat/evidence/20260718-0154-tech-v02-rc2/api/summary.json',
    [string]$DatabaseEnvironmentPath = 'docs/uat/evidence/20260718-0154-tech-v02-rc2/database/00-environment.json',
    [string]$ArtifactValidationPath = 'docs/uat/evidence/20260718-0154-tech-v02-rc2/regression/release-artifact-validation.json',
    [string]$RecoveryDrillPath = '.uat-runtime/release-db-drill/tech-v0.2-rc-final-20260718/evidence/database-recovery-drill.json',
    [string]$ScreenshotManifestPath = 'docs/uat/evidence/20260718-0112-tech-v02-rc-final/screenshots/manifest.json',
    [string]$LocalHardeningSummaryPath = 'docs/uat/evidence/20260718-1315-tech-v02-rc3-local-hardening/summary.json',
    [string]$SensitiveScanPath = 'docs/uat/evidence/20260718-1315-tech-v02-rc3-local-hardening/security/release-sensitive-information-scan.json',
    [string]$RequiredSecretFailFastPath = 'docs/uat/evidence/20260718-1315-tech-v02-rc3-local-hardening/security/required-secret-fail-fast.json',
    [string]$LiveShutdownSummaryPath = 'docs/uat/evidence/20260718-1306-tech-v02-shutdown-order-fixed/summary.json',
    [string]$Rc3ManifestPath1 = 'docs/uat/evidence/20260718-1315-tech-v02-rc3-local-hardening/artifacts/build-1-manifest.json',
    [string]$Rc3ManifestPath2 = 'docs/uat/evidence/20260718-1315-tech-v02-rc3-local-hardening/artifacts/build-2-manifest.json'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$checks = New-Object 'System.Collections.Generic.List[object]'

function Resolve-RepoFile([string]$path) {
    $candidate = if ([System.IO.Path]::IsPathRooted($path)) {
        [System.IO.Path]::GetFullPath($path)
    } else {
        [System.IO.Path]::GetFullPath((Join-Path $repoRoot $path))
    }
    $prefix = $repoRoot.TrimEnd('\') + '\'
    if (-not $candidate.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Path is outside the repository: $path"
    }
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "Required evidence file is missing: $path"
    }
    return $candidate
}

function Read-Json([string]$path) {
    return Get-Content -LiteralPath (Resolve-RepoFile $path) -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Add-Check([string]$id, [bool]$passed, [string]$detail, [string[]]$evidence) {
    $checks.Add([pscustomobject]@{
        id = $id
        status = if ($passed) { 'PASS' } else { 'FAIL' }
        detail = $detail
        evidence = @($evidence)
    })
}

try {
    $reportFile = Resolve-RepoFile $ReportPath
    $report = Get-Content -LiteralPath $reportFile -Raw -Encoding UTF8
    $api = Read-Json $ApiSummaryPath
    $database = @(Read-Json $DatabaseEnvironmentPath)[0]
    $artifacts = Read-Json $ArtifactValidationPath
    $recovery = Read-Json $RecoveryDrillPath
    $screens = Read-Json $ScreenshotManifestPath
    $hardening = Read-Json $LocalHardeningSummaryPath
    $sensitiveScan = Read-Json $SensitiveScanPath
    $requiredSecretFailFast = Read-Json $RequiredSecretFailFastPath
    $liveShutdown = Read-Json $LiveShutdownSummaryPath
    $rc3ManifestOne = Read-Json $Rc3ManifestPath1
    $rc3ManifestTwo = Read-Json $Rc3ManifestPath2

    Add-Check 'RC-IDENTITY' (
        $report.Contains('RC-FINAL-V1.6') -and
        $report.Contains($api.runId) -and
        $report.Contains('TECH-V0.2-rc.3-local')
    ) 'Report revision, frozen RC2 business run and RC3 local hardening identifier agree.' @($ReportPath, $ApiSummaryPath, $LocalHardeningSummaryPath)

    Add-Check 'API-SUMMARY' (
        [int]$api.requestCount -eq 89 -and
        [int]$api.failedRequestCount -eq 0 -and
        [int]$api.expectedDeniedRequestCount -eq 16 -and
        [int]$api.expectedAuthenticationDeniedRequestCount -eq 10 -and
        [int]$api.expectedBusinessDeniedRequestCount -eq 6 -and
        [int]$api.scenarioCount -eq 3
    ) 'API totals and expected-denial partition match the frozen RC2 baseline.' @($ApiSummaryPath)

    $scenarioA = @($api.scenarios | Where-Object { $_.id -eq 'A' })[0]
    $scenarioB = @($api.scenarios | Where-Object { $_.id -eq 'B' })[0]
    $scenarioC = @($api.scenarios | Where-Object { $_.id -eq 'C' })[0]
    Add-Check 'SCENARIO-A' (
        $null -ne $scenarioA -and
        $scenarioA.finalStatus -eq 'COMPLETED' -and
        $report.Contains($scenarioA.taskId)
    ) 'Scenario A final task is completed and referenced by the report.' @($ReportPath, $ApiSummaryPath)
    Add-Check 'SCENARIO-B' (
        $null -ne $scenarioB -and
        $scenarioB.finalStatus -eq 'COMPLETED' -and
        $report.Contains($scenarioB.workRecordId) -and
        $report.Contains($scenarioB.taskId)
    ) 'Scenario B work record and final task are referenced by the report.' @($ReportPath, $ApiSummaryPath)
    Add-Check 'SCENARIO-C' (
        $null -ne $scenarioC -and
        $scenarioC.finalStatus -eq 'PENDING_ACK' -and
        $scenarioC.slaStatus -eq 'OVERDUE' -and
        $report.Contains($scenarioC.expectationId) -and
        $report.Contains($scenarioC.taskId)
    ) 'Scenario C expected overdue state and identifiers are referenced by the report.' @($ReportPath, $ApiSummaryPath)

    Add-Check 'DATABASE' (
        [string]$database.flyway_version -eq '13' -and
        [int]$database.successful_migrations -eq 13 -and
        [int]$database.forced_rls_tables -eq 49 -and
        $database.runtime_role_superuser -eq $false -and
        $database.runtime_role_bypass_rls -eq $false -and
        $report.Contains('DB-V13')
    ) 'Database migration and forced-RLS baseline match the report.' @($ReportPath, $DatabaseEnvironmentPath)

    $artifactHashesPresent = $true
    foreach ($artifact in @($artifacts.artifacts)) {
        if ([string]::IsNullOrWhiteSpace($artifact.sha256) -or -not $report.Contains($artifact.sha256)) {
            $artifactHashesPresent = $false
        }
    }
    Add-Check 'ARTIFACTS' (
        $artifacts.status -eq 'PASS' -and
        [int]$artifacts.artifactCount -eq 5 -and
        $report.Contains($artifacts.payloadFingerprintSha256) -and
        $artifactHashesPresent
    ) 'Artifact status, fingerprint and five SHA-256 values are referenced by the report.' @($ReportPath, $ArtifactValidationPath)

    $rc3HashesPresent = $true
    foreach ($artifact in @($rc3ManifestOne.artifacts)) {
        $other = @($rc3ManifestTwo.artifacts | Where-Object { $_.file -eq $artifact.file })[0]
        if ([string]::IsNullOrWhiteSpace($artifact.sha256) -or
            $null -eq $other -or
            $artifact.sha256 -ne $other.sha256 -or
            -not $report.Contains($artifact.sha256)) {
            $rc3HashesPresent = $false
        }
    }
    Add-Check 'RC3-ARTIFACTS' (
        $rc3ManifestOne.releaseVersion -eq 'TECH-V0.2-rc.3-local' -and
        $rc3ManifestTwo.releaseVersion -eq 'TECH-V0.2-rc.3-local' -and
        @($rc3ManifestOne.artifacts).Count -eq 5 -and
        @($rc3ManifestTwo.artifacts).Count -eq 5 -and
        $rc3ManifestOne.reproducibleBuild.payloadFingerprintSha256 -eq $rc3ManifestTwo.reproducibleBuild.payloadFingerprintSha256 -and
        $report.Contains($rc3ManifestOne.reproducibleBuild.payloadFingerprintSha256) -and
        $rc3HashesPresent
    ) 'RC3 manifests are reproducible and all five hashes are referenced by the report.' @($ReportPath, $Rc3ManifestPath1, $Rc3ManifestPath2)

    Add-Check 'LOCAL-HARDENING' (
        $hardening.status -eq 'PASS' -and
        $hardening.candidateVersion -eq 'TECH-V0.2-rc.3-local' -and
        [int]$hardening.backendRegression.tests -eq 48 -and
        [int]$hardening.backendRegression.failures -eq 0 -and
        [int]$hardening.backendRegression.errors -eq 0 -and
        [int]$hardening.backendRegression.skipped -eq 2 -and
        [int]$hardening.backendRegression.databaseMigrations -eq 13
    ) 'RC3 local hardening summary records the final backend regression and migration baseline.' @($LocalHardeningSummaryPath)

    Add-Check 'SENSITIVE-SCAN' (
        $sensitiveScan.status -eq 'PASS' -and
        $sensitiveScan.decision -eq 'CLEAN' -and
        [int]$sensitiveScan.summary.findingGroups -eq 0 -and
        [int]$sensitiveScan.summary.matchCount -eq 0 -and
        [int]$sensitiveScan.summary.errorGroups -eq 0 -and
        [int]$sensitiveScan.summary.errorCount -eq 0 -and
        $report.Contains($sensitiveScan.inputSetSha256)
    ) 'RC3 evidence and both release builds pass the machine-readable sensitive-information scan.' @($ReportPath, $SensitiveScanPath)

    Add-Check 'REQUIRED-SECRET-FAIL-FAST' (
        $requiredSecretFailFast.status -eq 'PASS' -and
        [int]$requiredSecretFailFast.processExitCode -ne 0 -and
        $requiredSecretFailFast.observations.springBannerRendered -eq $false -and
        $requiredSecretFailFast.observations.serverStarted -eq $false -and
        $requiredSecretFailFast.observations.databaseConnectionAttempted -eq $false -and
        $requiredSecretFailFast.observations.knownSecretSentinelRendered -eq $false -and
        $report.Contains($requiredSecretFailFast.artifactSha256)
    ) 'The packaged JAR rejects missing database secrets before Spring startup, database access or network listen.' @($ReportPath, $RequiredSecretFailFastPath)

    Add-Check 'LIVE-SHUTDOWN' (
        $liveShutdown.status -eq 'PASS' -and
        $liveShutdown.observations.hikariShutdownBeforePostgres -eq $true -and
        [int]$liveShutdown.observations.springTestAfterClassErrors -eq 0 -and
        $liveShutdown.observations.mavenBuildSuccess -eq $true -and
        [int]$liveShutdown.observations.managedProcessesStillRunning -eq 0 -and
        [int]$liveShutdown.testResult.tests -eq 1 -and
        [int]$liveShutdown.testResult.errors -eq 0
    ) 'The repaired Live UAT host closes Spring/Hikari before PostgreSQL and exits cleanly.' @($LiveShutdownSummaryPath)

    Add-Check 'RECOVERY' (
        $recovery.status -eq 'PASS' -and
        [int]$recovery.migrationsExecutedOnFreshCluster -eq 13 -and
        [int]$recovery.verification.forcedRlsTables -eq 49 -and
        $report.Contains($recovery.backup.contentManifestSha256)
    ) 'Recovery drill baseline and backup manifest SHA-256 match the report.' @($ReportPath, $RecoveryDrillPath)

    $allScreensPassed = @($screens.cases | Where-Object { $_.passed -ne $true }).Count -eq 0
    Add-Check 'SCREENSHOTS' (
        [int]$screens.runMetadata.cases -eq 25 -and
        [int]$screens.runMetadata.passed -eq 25 -and
        [int]$screens.runMetadata.failed -eq 0 -and
        [int]$screens.runMetadata.consoleErrorCount -eq 0 -and
        $allScreensPassed
    ) 'Screenshot manifest contains 25 passing cases and no console errors.' @($ScreenshotManifestPath)

    Add-Check 'RELEASE-STATE' (
        $report.Contains('NO-GO') -and
        $report.Contains('TECH-V0.2 = Unreleased') -and
        -not $report.Contains('TECH-V0.2 = Released')
    ) 'Report remains fail-closed and does not claim TECH-V0.2 is released.' @($ReportPath)
} catch {
    Add-Check 'INPUTS' $false $_.Exception.Message @()
}

$failed = @($checks | Where-Object { $_.status -ne 'PASS' })
$result = [pscustomobject]@{
    schemaVersion = 1
    evaluator = 'tech-v0.2-evidence-consistency'
    evaluatedAt = (Get-Date).ToUniversalTime().ToString('o')
    status = if ($failed.Count -eq 0) { 'PASS' } else { 'FAIL' }
    summary = [pscustomobject]@{
        total = $checks.Count
        passed = $checks.Count - $failed.Count
        failed = $failed.Count
    }
    checks = $checks
    safeguards = [pscustomobject]@{
        readOnly = $true
        releaseStatusModified = $false
        failClosed = $true
    }
}

$result | ConvertTo-Json -Depth 8
if ($failed.Count -gt 0) { exit 2 }
