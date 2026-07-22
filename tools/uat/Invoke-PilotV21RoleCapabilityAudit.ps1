[CmdletBinding()]
param(
    [string]$RuntimeRoot = 'D:\SifangguanHotelAIOS',
    [string]$ApiBase = 'http://127.0.0.1:4180/api/v1',
    [string]$EvidenceRoot = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$tenantId = '10000000-0000-0000-0000-000000000001'
$ceoProbeOrgUnitId = '12000000-0000-0000-0000-000000000003'
$credentialFile = Join-Path ([IO.Path]::GetFullPath($RuntimeRoot)) 'Pilot-Account-Access.txt'

if (-not (Test-Path -LiteralPath $credentialFile -PathType Leaf)) {
    throw 'Protected Pilot account file is missing.'
}
if ([string]::IsNullOrWhiteSpace($EvidenceRoot)) {
    $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    $EvidenceRoot = Join-Path $repoRoot 'docs\uat\evidence\pilot-v21-role-capability'
}
New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null
$EvidenceRoot = [IO.Path]::GetFullPath($EvidenceRoot)

# Permission expectations are copied from the V18 migration. They deliberately
# assert subsets instead of treating the current /iam/me response as the source
# of truth for its own expected authorization.
$lowPermissionSubset = @(
    'daily-report.read',
    'daily-report.submit',
    'daily-report-template.read',
    'daily-operation.read',
    'task-candidate.read',
    'ai-recommendation.read',
    'ai-recommendation.feedback'
)
$supervisorPermissionSubset = @(
    'daily-report.read',
    'daily-report.submit',
    'daily-report.team-read',
    'daily-report.review',
    'daily-report.revision-review',
    'daily-report-template.read',
    'daily-report-template.store-supplement',
    'daily-operation.read',
    'issue.confirm',
    'issue.assign',
    'issue.close',
    'issue.reopen',
    'task-candidate.read',
    'task-candidate.manage',
    'task-candidate.confirm',
    'task-candidate.reject',
    'task-candidate.retry',
    'operation-snapshot.read',
    'operation-snapshot.retry',
    'operation-snapshot.compare',
    'operation-export.create',
    'operation-export.download',
    'ai-recommendation.read',
    'ai-recommendation.feedback',
    'ai-recommendation.adopt'
)
$ceoPermissionSubset = @(
    'daily-report.read',
    'daily-report.submit',
    'daily-report.team-read',
    'daily-report.review',
    'daily-report.revision-review',
    'daily-report-template.read',
    'daily-report-template.manage',
    'daily-report-template.review',
    'daily-report-template.publish',
    'daily-report-template.store-supplement',
    'daily-operation.read',
    'daily-operation.cross-hotel-read',
    'issue.confirm',
    'issue.assign',
    'issue.close',
    'issue.reopen',
    'task-candidate.read',
    'task-candidate.manage',
    'task-candidate.confirm',
    'task-candidate.reject',
    'task-candidate.retry',
    'evidence.sensitive.read',
    'operation-snapshot.read',
    'operation-snapshot.retry',
    'operation-snapshot.compare',
    'operation-export.create',
    'operation-export.download',
    'operation-export.sensitive',
    'ai-recommendation.read',
    'ai-recommendation.feedback',
    'ai-recommendation.adopt',
    'audit.cross-org-read'
)
$v18PermissionUniverse = @($ceoPermissionSubset)
$lowForbiddenSubset = @($v18PermissionUniverse | Where-Object { $_ -notin $lowPermissionSubset })
$supervisorForbiddenSubset = @($v18PermissionUniverse | Where-Object { $_ -notin $supervisorPermissionSubset })

$roleMatrix = @(
    [pscustomobject]@{ Login = 'front.demo'; Role = 'FRONT_DESK'; AssignmentRequired = $true; Required = $lowPermissionSubset; Forbidden = $lowForbiddenSubset },
    [pscustomobject]@{ Login = 'fo.supervisor'; Role = 'FRONT_OFFICE_SUPERVISOR'; AssignmentRequired = $true; Required = $supervisorPermissionSubset; Forbidden = $supervisorForbiddenSubset },
    [pscustomobject]@{ Login = 'hk.supervisor'; Role = 'HOUSEKEEPING_SUPERVISOR'; AssignmentRequired = $true; Required = $supervisorPermissionSubset; Forbidden = $supervisorForbiddenSubset },
    [pscustomobject]@{ Login = 'assistant.gm'; Role = 'ASSISTANT_GENERAL_MANAGER'; AssignmentRequired = $true; Required = $supervisorPermissionSubset; Forbidden = $supervisorForbiddenSubset },
    [pscustomobject]@{ Login = 'gm.hz'; Role = 'GENERAL_MANAGER'; AssignmentRequired = $true; Required = $supervisorPermissionSubset; Forbidden = $supervisorForbiddenSubset },
    [pscustomobject]@{ Login = 'ota.assistant'; Role = 'OTA_OPERATION_ASSISTANT'; AssignmentRequired = $true; Required = $lowPermissionSubset; Forbidden = $lowForbiddenSubset },
    [pscustomobject]@{ Login = 'ota.manager'; Role = 'OTA_OPERATION_MANAGER'; AssignmentRequired = $true; Required = $supervisorPermissionSubset; Forbidden = $supervisorForbiddenSubset },
    [pscustomobject]@{ Login = 'ceo.demo'; Role = 'CEO'; AssignmentRequired = $false; Required = $ceoPermissionSubset; Forbidden = @() }
)

$credentials = @{}
Get-Content -LiteralPath $credentialFile -Encoding UTF8 | ForEach-Object {
    $parts = $_ -split "`t"
    if ($parts.Count -ge 3 -and $roleMatrix.Login -contains $parts[1]) {
        $credentials[$parts[1]] = $parts[2]
    }
}
foreach ($expectation in $roleMatrix) {
    if (-not $credentials.ContainsKey($expectation.Login)) {
        throw "Protected credential is missing for $($expectation.Login)."
    }
}

function Get-ExceptionHttpStatus {
    param([Parameter(Mandatory)]$ErrorRecord)

    $exception = $ErrorRecord.Exception
    if ($null -ne $exception -and $exception.PSObject.Properties.Name -contains 'Response') {
        $response = $exception.Response
        if ($null -ne $response -and $response.PSObject.Properties.Name -contains 'StatusCode' -and
            $null -ne $response.StatusCode) {
            return [int]$response.StatusCode
        }
    }
    if ($null -ne $exception -and $exception.Message -match 'HTTP\s+(\d{3})') {
        return [int]$Matches[1]
    }
    return 'NO_STATUS'
}

function Invoke-PilotLogin {
    param(
        [Parameter(Mandatory)][string]$LoginName,
        [Parameter(Mandatory)][string]$Password
    )

    $requestJson = @{
        tenantId = $tenantId
        loginName = $LoginName
        password = $Password
    } | ConvertTo-Json -Compress
    try {
        $response = Invoke-RestMethod -Uri "$ApiBase/auth/login" -Method Post `
            -ContentType 'application/json' -Body $requestJson -Verbose:$false -Debug:$false
    } catch {
        $status = Get-ExceptionHttpStatus -ErrorRecord $_
        throw "Authentication request for '$LoginName' failed with HTTP $status."
    } finally {
        $requestJson = $null
    }
    if ($null -eq $response -or
        -not ($response.PSObject.Properties.Name -contains 'accessToken') -or
        [string]::IsNullOrWhiteSpace([string]$response.accessToken)) {
        throw "Authentication response for '$LoginName' did not contain an access token."
    }
    return [string]$response.accessToken
}

function Invoke-GetProbe {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Token
    )

    $headers = @{
        'X-Hotel-AI-Authorization' = "Bearer $Token"
        'X-Correlation-Id' = [guid]::NewGuid().ToString()
    }
    try {
        $response = Invoke-WebRequest -Uri "$ApiBase$Path" -Method Get `
            -Headers $headers -UseBasicParsing -Verbose:$false -Debug:$false
        $parsedBody = $null
        if (-not [string]::IsNullOrWhiteSpace([string]$response.Content)) {
            $parsedBody = $response.Content | ConvertFrom-Json
        }
        return [pscustomobject]@{
            Status = [int]$response.StatusCode
            Body = $parsedBody
        }
    } catch {
        return [pscustomobject]@{
            Status = Get-ExceptionHttpStatus -ErrorRecord $_
            Body = $null
        }
    } finally {
        $headers['X-Hotel-AI-Authorization'] = $null
    }
}

function New-EndpointCheck {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][int]$ExpectedStatus,
        [Parameter(Mandatory)][string]$Token
    )

    $probe = Invoke-GetProbe -Path $Path -Token $Token
    return [pscustomobject]@{
        name = $Name
        path = $Path
        expectedStatus = $ExpectedStatus
        actualStatus = $probe.Status
        result = if ($probe.Status -eq $ExpectedStatus) { 'PASS' } else { 'BLOCKED' }
    }
}

function Test-HasPermission {
    param(
        [Parameter(Mandatory)][string[]]$ExpectedPermissions,
        [Parameter(Mandatory)][string]$Permission
    )
    return $ExpectedPermissions -contains $Permission
}

$results = @()
foreach ($expected in $roleMatrix) {
    $token = $null
    try {
        $token = Invoke-PilotLogin -LoginName $expected.Login -Password $credentials[$expected.Login]
        $identityProbe = Invoke-GetProbe -Path '/iam/me' -Token $token
        if ($identityProbe.Status -ne 200 -or $null -eq $identityProbe.Body) {
            throw "GET /iam/me failed with HTTP $($identityProbe.Status)."
        }
        $identity = $identityProbe.Body
        $assignments = @($identity.positionAssignments)
        $actualPermissions = @($identity.permissions)
        $missingRequired = @($expected.Required | Where-Object { $actualPermissions -notcontains $_ })
        $unexpectedForbidden = @($expected.Forbidden | Where-Object { $actualPermissions -contains $_ })
        $activeAssignmentPass = -not $expected.AssignmentRequired -or $assignments.Count -gt 0

        $probeOrgUnitId = $ceoProbeOrgUnitId
        if ($assignments.Count -gt 0) {
            $primaryAssignment = @($assignments | Where-Object { $_.primary }) | Select-Object -First 1
            if ($null -eq $primaryAssignment) {
                $primaryAssignment = $assignments | Select-Object -First 1
            }
            $probeOrgUnitId = [string]$primaryAssignment.organizationId
        }
        $encodedOrgUnitId = [Uri]::EscapeDataString($probeOrgUnitId)

        $teamExpected = if (Test-HasPermission -ExpectedPermissions $expected.Required -Permission 'daily-report.team-read') { 200 } else { 403 }
        $snapshotExpected = if (Test-HasPermission -ExpectedPermissions $expected.Required -Permission 'operation-snapshot.read') { 200 } else { 403 }
        $exportExpected = if ((Test-HasPermission -ExpectedPermissions $expected.Required -Permission 'operation-export.create') -or
            (Test-HasPermission -ExpectedPermissions $expected.Required -Permission 'operation-export.download')) { 200 } else { 403 }

        $endpointChecks = @(
            New-EndpointCheck -Name 'myDailyReports' -Path '/daily-reports/my' -ExpectedStatus 200 -Token $token
            New-EndpointCheck -Name 'dailyReportTemplates' -Path '/daily-report-templates' -ExpectedStatus 200 -Token $token
            New-EndpointCheck -Name 'dailyOperationOverview' -Path '/daily-operations' -ExpectedStatus 200 -Token $token
            New-EndpointCheck -Name 'dailyOperationIssues' -Path '/daily-operations/issues' -ExpectedStatus 200 -Token $token
            New-EndpointCheck -Name 'dailyOperationActionItems' -Path '/daily-operations/action-items' -ExpectedStatus 200 -Token $token
            New-EndpointCheck -Name 'taskCandidates' -Path '/task-candidates' -ExpectedStatus 200 -Token $token
            New-EndpointCheck -Name 'teamDailyReports' -Path "/daily-reports/team?orgUnitId=$encodedOrgUnitId" -ExpectedStatus $teamExpected -Token $token
            New-EndpointCheck -Name 'operationSnapshots' -Path '/daily-operation-snapshots' -ExpectedStatus $snapshotExpected -Token $token
            New-EndpointCheck -Name 'operationExports' -Path '/daily-operations/exports' -ExpectedStatus $exportExpected -Token $token
        )

        $rolePass = [string]$identity.primaryRole -eq $expected.Role
        $permissionPass = $missingRequired.Count -eq 0 -and $unexpectedForbidden.Count -eq 0
        $endpointsPass = @($endpointChecks | Where-Object { $_.result -ne 'PASS' }).Count -eq 0
        $results += [pscustomobject]@{
            login = $expected.Login
            expectedRole = $expected.Role
            actualRole = [string]$identity.primaryRole
            activeAssignmentRequired = [bool]$expected.AssignmentRequired
            activeAssignmentCount = $assignments.Count
            activeAssignmentResult = if ($activeAssignmentPass) { 'PASS' } else { 'BLOCKED' }
            requiredPermissionSubset = @($expected.Required)
            missingRequiredPermissions = $missingRequired
            forbiddenPermissionSubset = @($expected.Forbidden)
            unexpectedForbiddenPermissions = $unexpectedForbidden
            permissionCount = $actualPermissions.Count
            endpointChecks = $endpointChecks
            result = if ($rolePass -and $activeAssignmentPass -and $permissionPass -and $endpointsPass) { 'PASS' } else { 'BLOCKED' }
            failure = $null
        }
    } catch {
        $results += [pscustomobject]@{
            login = $expected.Login
            expectedRole = $expected.Role
            actualRole = $null
            activeAssignmentRequired = [bool]$expected.AssignmentRequired
            activeAssignmentCount = 0
            activeAssignmentResult = 'BLOCKED'
            requiredPermissionSubset = @($expected.Required)
            missingRequiredPermissions = @($expected.Required)
            forbiddenPermissionSubset = @($expected.Forbidden)
            unexpectedForbiddenPermissions = @()
            permissionCount = 0
            endpointChecks = @()
            result = 'BLOCKED'
            failure = ($_.Exception.Message -replace '[\r\n]+', ' ').Trim()
        }
    } finally {
        $token = $null
    }
}
$credentials.Clear()

$report = [ordered]@{
    metadata = [ordered]@{
        generatedAt = (Get-Date).ToUniversalTime().ToString('o')
        product = 'Hotel AI OS'
        release = 'TECH-V0.2'
        pilotSchema = 'V21'
        databaseVersion = 21
        auditMode = 'READ_ONLY'
        accountCount = $roleMatrix.Count
        authenticationHeader = 'X-Hotel-AI-Authorization'
        allowedPostPath = '/auth/login'
        businessApiMethods = @('GET')
        credentialsPersistedInEvidence = $false
        tokensPersistedInEvidence = $false
    }
    passed = @($results | Where-Object { $_.result -ne 'PASS' }).Count -eq 0
    rolesPassed = @($results | Where-Object { $_.result -eq 'PASS' }).Count
    rolesTotal = $results.Count
    roleResults = $results
}

$jsonPath = Join-Path $EvidenceRoot 'pilot-v21-role-capability-audit.json'
$markdownPath = Join-Path $EvidenceRoot 'pilot-v21-role-capability-audit.md'
$report | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

$markdown = @(
    '# TECH-V0.2 Pilot V21 Role Capability Audit',
    '',
    "Generated: $($report.metadata.generatedAt)",
    'Mode: READ_ONLY (POST /auth/login only; all business probes are GET)',
    'Authentication: X-Hotel-AI-Authorization Bearer header',
    'Database contract: Flyway V21',
    '',
    '| Account | Expected role | Actual role | Active assignments | Permissions | Endpoints | Result |',
    '|---|---|---|---:|---|---|---|'
)
foreach ($item in $results) {
    $permissionResult = if ($item.missingRequiredPermissions.Count -eq 0 -and $item.unexpectedForbiddenPermissions.Count -eq 0) { 'PASS' } else { 'BLOCKED' }
    $endpointResult = if (@($item.endpointChecks | Where-Object { $_.result -ne 'PASS' }).Count -eq 0 -and $item.endpointChecks.Count -gt 0) { 'PASS' } else { 'BLOCKED' }
    $markdown += "| $($item.login) | $($item.expectedRole) | $($item.actualRole) | $($item.activeAssignmentCount) | $permissionResult | $endpointResult | $($item.result) |"
}

foreach ($item in $results) {
    $markdown += @('', "## $($item.login)", '')
    if (-not [string]::IsNullOrWhiteSpace([string]$item.failure)) {
        $markdown += "Failure: $($item.failure)"
        continue
    }
    $missing = if ($item.missingRequiredPermissions.Count -eq 0) { 'none' } else { $item.missingRequiredPermissions -join ', ' }
    $forbidden = if ($item.unexpectedForbiddenPermissions.Count -eq 0) { 'none' } else { $item.unexpectedForbiddenPermissions -join ', ' }
    $markdown += @(
        "Actual role: $($item.actualRole)",
        "Active assignment assertion: $($item.activeAssignmentResult) (count=$($item.activeAssignmentCount), required=$($item.activeAssignmentRequired))",
        "Missing required permissions: $missing",
        "Unexpected forbidden permissions: $forbidden",
        '',
        '| Probe | Expected | Actual | Result |',
        '|---|---:|---:|---|'
    )
    foreach ($endpoint in $item.endpointChecks) {
        $markdown += "| $($endpoint.name) | $($endpoint.expectedStatus) | $($endpoint.actualStatus) | $($endpoint.result) |"
    }
}
$markdown += @('', "Overall: $(if ($report.passed) { 'PASS' } else { 'BLOCKED' })")
$markdown | Set-Content -LiteralPath $markdownPath -Encoding UTF8

[pscustomobject]@{
    Release = $report.metadata.release
    DatabaseVersion = $report.metadata.databaseVersion
    RolesPassed = $report.rolesPassed
    RolesTotal = $report.rolesTotal
    ReadOnly = $true
    Overall = if ($report.passed) { 'PASS' } else { 'BLOCKED' }
    Evidence = $markdownPath
}

if (-not $report.passed) { exit 1 }
