[CmdletBinding()]
param(
    [string]$RuntimeRoot = 'D:\SifangguanHotelAIOS',
    [string]$ApiBase = '',
    [string]$StateFile = '',
    [string]$OutputPath = '',
    [string]$RunId = (Get-Date -Format 'yyyyMMdd-HHmmss'),
    [switch]$ConfirmMutation,
    [switch]$AllowPublicApi
)

$ErrorActionPreference = 'Stop'
$tenantId = '10000000-0000-0000-0000-000000000001'
$requiredAccounts = @('ceo.demo', 'front.demo', 'fo.supervisor', 'ota.assistant')
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $repoRoot '.uat-runtime\pilot\pilot7-live-smoke.json'
}
$stateFileRequiredMessage = 'Invoke-Pilot7LiveSmoke no longer accepts the shared/default Pilot target. Supply an active disposable ISOLATED_UAT StateFile, or use tools\uat\Invoke-IsolatedV21RoleClosedLoopUat.ps1.'
if ([string]::IsNullOrWhiteSpace($StateFile) -or [string]::IsNullOrWhiteSpace($ApiBase)) {
    throw $stateFileRequiredMessage
}
$resolvedStateFile = [IO.Path]::GetFullPath($StateFile)
if (-not (Test-Path -LiteralPath $resolvedStateFile -PathType Leaf)) {
    throw "Disposable UAT state is missing: $resolvedStateFile"
}
$uatState = Get-Content -LiteralPath $resolvedStateFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]$uatState.purpose -cne 'ISOLATED_UAT') { throw $stateFileRequiredMessage }
if ([DateTimeOffset]::Parse([string]$uatState.expiresAt) -le [DateTimeOffset]::Now) {
    throw 'Disposable UAT state has expired.'
}
$databaseMarker = ([string]$uatState.database).ToLowerInvariant()
$disposableDatabase = ($databaseMarker.Contains('hotel_ai_os_uat') -or $databaseMarker.Contains('embedded postgresql')) `
    -and -not $databaseMarker.Contains('pilot') `
    -and -not $databaseMarker.Contains('sifangguanhotelaios')
if (-not $disposableDatabase) { throw $stateFileRequiredMessage }

$ApiBase = $ApiBase.TrimEnd('/')
$apiUri = [Uri]$ApiBase
$isLoopback = $apiUri.Host -in @('127.0.0.1', 'localhost', '::1')
$stateApiOrigin = ([string]$uatState.apiUrl).TrimEnd('/')
if ($ApiBase -cne "$stateApiOrigin/api/v1") {
    throw 'ApiBase does not match the active disposable UAT state.'
}

if (-not $ConfirmMutation) {
    throw 'This smoke creates and advances one clearly labelled live task. Re-run with -ConfirmMutation after reviewing the target API.'
}
if (-not $isLoopback -or $AllowPublicApi) {
    throw 'Public/non-loopback mutation is disabled for this legacy smoke. Use an isolated loopback UAT API.'
}
if ($RunId -notmatch '^[A-Za-z0-9._-]{4,80}$') {
    throw 'RunId must be 4-80 characters and contain only letters, digits, dot, underscore or hyphen.'
}

$credentialFile = Join-Path ([IO.Path]::GetFullPath($RuntimeRoot)) 'Pilot-Account-Access.txt'
if (-not (Test-Path -LiteralPath $credentialFile -PathType Leaf)) {
    throw "Protected Pilot account file is missing: $credentialFile"
}

$credentials = @{}
Get-Content -LiteralPath $credentialFile -Encoding UTF8 | ForEach-Object {
    $parts = $_ -split "`t", 3
    if ($parts.Count -eq 3 -and $requiredAccounts -contains $parts[1]) {
        # The last matching line wins because the protected file is append-only after password initialization.
        $credentials[$parts[1]] = $parts[2]
    }
}
foreach ($account in $requiredAccounts) {
    if (-not $credentials.ContainsKey($account)) {
        throw "Protected credential is missing for $account."
    }
}

$checks = [Collections.Generic.List[object]]::new()
$taskId = $null
$evaluationId = $null
$startedAt = [DateTimeOffset]::UtcNow

function ConvertTo-SafeError([object]$Value) {
    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    $text = $text -replace '(?i)Bearer\s+[A-Za-z0-9._-]+', 'Bearer [REDACTED]'
    $text = $text -replace '(?i)("?(?:accessToken|refreshToken|password)"?\s*[:=]\s*")[^"]+', '$1[REDACTED]'
    if ($text.Length -gt 500) { $text = $text.Substring(0, 500) }
    return $text
}

function Add-Check([string]$Name, [string]$Result, [object]$Details) {
    $script:checks.Add([pscustomobject][ordered]@{
        name = $Name
        result = $Result
        passed = if ($Result -eq 'PASS') { $true } elseif ($Result -eq 'FAIL') { $false } else { $null }
        details = $Details
    }) | Out-Null
}

function ConvertFrom-JsonSafe([string]$Content) {
    if ([string]::IsNullOrWhiteSpace($Content)) { return $null }
    try { return $Content | ConvertFrom-Json }
    catch { return $Content }
}

function Invoke-HotelApi(
    [string]$Path,
    [string]$Token,
    [string]$Method = 'GET',
    [object]$Body = $null,
    [string]$IdempotencyKey = ''
) {
    $headers = @{ 'X-Correlation-Id' = [guid]::NewGuid().ToString() }
    if (-not [string]::IsNullOrWhiteSpace($Token)) { $headers.Authorization = "Bearer $Token" }
    if (-not [string]::IsNullOrWhiteSpace($IdempotencyKey)) { $headers['Idempotency-Key'] = $IdempotencyKey }
    $parameters = @{
        Uri = "$ApiBase$Path"
        Method = $Method
        Headers = $headers
        UseBasicParsing = $true
    }
    if ($null -ne $Body) {
        $parameters.ContentType = 'application/json'
        $parameters.Body = $Body | ConvertTo-Json -Depth 30 -Compress
    }
    try {
        $response = Invoke-WebRequest @parameters
        return [pscustomobject]@{
            statusCode = [int]$response.StatusCode
            body = ConvertFrom-JsonSafe ([string]$response.Content)
            error = $null
        }
    } catch {
        $statusCode = 0
        if ($_.Exception.Response -and $null -ne $_.Exception.Response.StatusCode) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        $detail = $_.ErrorDetails.Message
        if ([string]::IsNullOrWhiteSpace([string]$detail)) { $detail = $_.Exception.Message }
        return [pscustomobject]@{
            statusCode = $statusCode
            body = $null
            error = ConvertTo-SafeError $detail
        }
    }
}

function Require-Status([object]$Response, [int[]]$Expected, [string]$Operation) {
    if ($Expected -notcontains [int]$Response.statusCode) {
        throw "$Operation returned HTTP $($Response.statusCode): $($Response.error)"
    }
    return $Response.body
}

function Login-Pilot([string]$LoginName) {
    $response = Invoke-HotelApi '/auth/login' '' 'POST' @{
        tenantId = $tenantId
        loginName = $LoginName
        password = $credentials[$LoginName]
    }
    $body = Require-Status $response @(200) "Login $LoginName"
    if ([string]::IsNullOrWhiteSpace([string]$body.accessToken)) {
        throw "Login $LoginName returned no access token."
    }
    return $body
}

function As-Array([object]$Value) {
    if ($null -eq $Value) { return @() }
    if ($Value -is [string]) { return @($Value) }
    if ($Value.PSObject.Properties.Name -contains 'value' -and $null -ne $Value.value) {
        return @($Value.value)
    }
    return @($Value)
}

function Find-Task([object]$Body, [string]$ExpectedTaskId) {
    return As-Array $Body | Where-Object { [string]$_.id -eq $ExpectedTaskId } | Select-Object -First 1
}

$fatalError = $null
try {
    # CEO is deliberately authenticated first. Tokens and protected passwords never enter the report.
    $ceoSession = Login-Pilot 'ceo.demo'
    $ceoToken = [string]$ceoSession.accessToken
    $ceoMeResponse = Invoke-HotelApi '/iam/me' $ceoToken
    $ceoMe = Require-Status $ceoMeResponse @(200) 'CEO /iam/me'
    $ceoIdentityPass = [string]$ceoMe.primaryRole -eq 'CEO' -and [bool]$ceoMe.tenantScope
    Add-Check 'ceo_identity' $(if ($ceoIdentityPass) { 'PASS' } else { 'FAIL' }) @{
        httpStatus = $ceoMeResponse.statusCode
        primaryRole = $ceoMe.primaryRole
        tenantScope = [bool]$ceoMe.tenantScope
    }
    if (-not $ceoIdentityPass) { throw 'ceo.demo did not resolve to a tenant-scoped CEO identity.' }

    $ceoTargetsResponse = Invoke-HotelApi '/tasks/targets' $ceoToken
    $ceoTargets = As-Array (Require-Status $ceoTargetsResponse @(200) 'CEO /tasks/targets')
    Add-Check 'ceo_task_targets' $(if ($ceoTargets.Count -gt 0) { 'PASS' } else { 'FAIL' }) @{
        httpStatus = $ceoTargetsResponse.statusCode
        targetCount = $ceoTargets.Count
    }
    if ($ceoTargets.Count -eq 0) { throw 'CEO task target list is empty.' }

    $ceoDashboardResponse = Invoke-HotelApi '/dashboards/ceo' $ceoToken
    $null = Require-Status $ceoDashboardResponse @(200) 'CEO dashboard'
    $operationsResponse = Invoke-HotelApi '/dashboards/operations' $ceoToken
    $operations = Require-Status $operationsResponse @(200) 'CEO operations dashboard'
    $operationHotels = As-Array $operations.hotels
    $hotelDashboardResults = @()
    foreach ($hotel in $operationHotels) {
        $hotelResponse = Invoke-HotelApi "/dashboards/hotels/$($hotel.id)" $ceoToken
        $hotelDashboardResults += [pscustomobject]@{
            hotelId = [string]$hotel.id
            hotelName = [string]$hotel.name
            httpStatus = [int]$hotelResponse.statusCode
        }
    }
    $hotelDashboardsPass = $operationHotels.Count -gt 0 -and @($hotelDashboardResults | Where-Object httpStatus -ne 200).Count -eq 0
    Add-Check 'ceo_operations_and_hotel_dashboards' $(if ($hotelDashboardsPass) { 'PASS' } else { 'FAIL' }) @{
        ceoDashboardHttpStatus = $ceoDashboardResponse.statusCode
        operationsHttpStatus = $operationsResponse.statusCode
        operationHotelCount = $operationHotels.Count
        hotelDashboards = $hotelDashboardResults
    }
    if (-not $hotelDashboardsPass) { throw 'CEO could not read at least one operations hotel dashboard.' }

    $frontSession = Login-Pilot 'front.demo'
    $frontToken = [string]$frontSession.accessToken
    $frontMeResponse = Invoke-HotelApi '/iam/me' $frontToken
    $frontMe = Require-Status $frontMeResponse @(200) 'front.demo /iam/me'
    $frontAssignment = As-Array $frontMe.positionAssignments | Where-Object { [bool]$_.primary } | Select-Object -First 1
    if (-not $frontAssignment) { $frontAssignment = As-Array $frontMe.positionAssignments | Select-Object -First 1 }
    if (-not $frontAssignment) { throw 'front.demo has no active assignment.' }

    $supervisorSession = Login-Pilot 'fo.supervisor'
    $supervisorToken = [string]$supervisorSession.accessToken
    $supervisorMe = Require-Status (Invoke-HotelApi '/iam/me' $supervisorToken) @(200) 'fo.supervisor /iam/me'
    $supervisorAssignments = As-Array $supervisorMe.positionAssignments
    $supervisorAssignment = $supervisorAssignments |
        Where-Object { [string]$_.organizationId -eq [string]$frontAssignment.organizationId } |
        Select-Object -First 1
    if (-not $supervisorAssignment) { $supervisorAssignment = $supervisorAssignments | Select-Object -First 1 }
    if (-not $supervisorAssignment) { throw 'fo.supervisor has no active assignment.' }

    $frontTarget = $ceoTargets |
        Where-Object { [string]$_.assignment_id -eq [string]$frontAssignment.id } |
        Select-Object -First 1
    Add-Check 'ceo_can_target_front_demo' $(if ($frontTarget) { 'PASS' } else { 'FAIL' }) @{
        frontAssignmentId = [string]$frontAssignment.id
        targetVisible = [bool]$frontTarget
    }
    if (-not $frontTarget) { throw 'front.demo assignment is missing from CEO task targets.' }

    $standardsResponse = Invoke-HotelApi '/standards' $ceoToken
    $standards = As-Array (Require-Status $standardsResponse @(200) 'CEO standards')
    $evaluationStandard = $standards |
        Where-Object { [string]$_.code -eq 'STD-FD-CHECKIN' -and [string]$_.lifecycle_status -eq 'PUBLISHED' -and $_.latest_version_id } |
        Select-Object -First 1
    if ($evaluationStandard) {
        Add-Check 'safe_evaluation_standard' 'PASS' @{
            code = [string]$evaluationStandard.code
            standardVersionId = [string]$evaluationStandard.latest_version_id
        }
    } else {
        Add-Check 'safe_evaluation_standard' 'SKIPPED' @{
            reason = 'Published STD-FD-CHECKIN was not available; the task will be verified without creating an unrelated standard evaluation.'
        }
    }

    $taskKey = "pilot7-live-smoke-task:$RunId"
    $taskBody = [ordered]@{
        orgUnitId = [string]$frontAssignment.organizationId
        assigneeAssignmentId = [string]$frontAssignment.id
        reviewerAssignmentId = [string]$supervisorAssignment.id
        standardVersionId = if ($evaluationStandard) { [string]$evaluationStandard.latest_version_id } else { $null }
        workRecordId = $null
        title = "[PILOT7-LIVE-SMOKE] Front desk task flow $RunId"
        description = 'Internal live API evidence for CEO dispatch, employee receipt, result submission and supervisor visibility.'
        priority = 'NORMAL'
        dueAt = [DateTimeOffset]::Now.AddHours(24).ToString('o')
        sourceSnapshot = @{
            source = 'PILOT7_LIVE_SMOKE'
            runId = $RunId
            taskPolicy = @{
                narrativeRequired = $true
                attachmentRequired = $false
                maxAttachments = 10
            }
        }
        creatorAssignmentId = $null
        dispatchNow = $true
    }
    $createResponse = Invoke-HotelApi '/tasks' $ceoToken 'POST' $taskBody $taskKey
    $createdTask = Require-Status $createResponse @(201) 'CEO create-and-dispatch task'
    $taskId = [string]$createdTask.id
    $createdStatus = [string]$createdTask.lifecycle_status
    $createPass = -not [string]::IsNullOrWhiteSpace($taskId) -and $createdStatus -eq 'PENDING_ACK'
    Add-Check 'ceo_atomic_task_dispatch' $(if ($createPass) { 'PASS' } else { 'FAIL' }) @{
        httpStatus = $createResponse.statusCode
        taskId = $taskId
        lifecycleStatus = $createdStatus
        assigneeAssignmentId = [string]$frontAssignment.id
        reviewerAssignmentId = [string]$supervisorAssignment.id
    }
    if (-not $createPass) { throw 'CEO task was not atomically dispatched to PENDING_ACK.' }

    $frontMineResponse = Invoke-HotelApi '/tasks?view=mine' $frontToken
    $frontMine = Require-Status $frontMineResponse @(200) 'front.demo mine tasks'
    $frontTask = Find-Task $frontMine $taskId
    $frontNotificationsResponse = Invoke-HotelApi '/notifications?unreadOnly=false' $frontToken
    $frontNotifications = As-Array (Require-Status $frontNotificationsResponse @(200) 'front.demo notifications')
    $frontNotification = $frontNotifications |
        Where-Object { [string]$_.source_type -eq 'TASK' -and [string]$_.source_id -eq $taskId -and [string]$_.notification_type -eq 'TASK_ASSIGNED' } |
        Select-Object -First 1
    $deliveryPass = $null -ne $frontTask -and $null -ne $frontNotification
    Add-Check 'front_receives_task_and_notification' $(if ($deliveryPass) { 'PASS' } else { 'FAIL' }) @{
        mineHttpStatus = $frontMineResponse.statusCode
        notificationHttpStatus = $frontNotificationsResponse.statusCode
        taskVisible = $null -ne $frontTask
        notificationVisible = $null -ne $frontNotification
    }
    if (-not $deliveryPass) { throw 'front.demo did not receive both the task and its assignment notification.' }

    $ackResponse = Invoke-HotelApi "/tasks/$taskId/actions/ACKNOWLEDGE" $frontToken 'POST' @{
        expectedVersion = [long]$frontTask.row_version
        actorAssignmentId = [string]$frontAssignment.id
        payload = @{ note = 'PILOT7 live smoke acknowledged' }
    } "pilot7-live-smoke-ack:$RunId"
    $ackTask = Require-Status $ackResponse @(200) 'front.demo ACKNOWLEDGE'
    $ackStatus = [string]$ackTask.lifecycle_status
    $ackPass = $ackStatus -in @('ACKNOWLEDGED', 'IN_PROGRESS')
    Add-Check 'front_acknowledge' $(if ($ackPass) { 'PASS' } else { 'FAIL' }) @{
        httpStatus = $ackResponse.statusCode
        lifecycleStatus = $ackStatus
        rowVersion = $ackTask.row_version
    }
    if (-not $ackPass) { throw 'ACKNOWLEDGE did not enter an acknowledged or in-progress state.' }

    # The current frozen state model maps ACKNOWLEDGE directly to IN_PROGRESS and reserves START for REWORK.
    # We still call START so a future explicit ACKNOWLEDGED state is covered without hiding the current semantics.
    $startResponse = Invoke-HotelApi "/tasks/$taskId/actions/START" $frontToken 'POST' @{
        expectedVersion = [long]$ackTask.row_version
        actorAssignmentId = [string]$frontAssignment.id
        payload = @{ note = 'PILOT7 live smoke start attempt' }
    } "pilot7-live-smoke-start:$RunId"
    $currentTask = $ackTask
    $startMode = $null
    if ($startResponse.statusCode -eq 200) {
        $currentTask = $startResponse.body
        $startMode = 'EXPLICIT_START'
        $startPass = [string]$currentTask.lifecycle_status -eq 'IN_PROGRESS'
    } else {
        $startMode = 'ACKNOWLEDGE_ALREADY_STARTED'
        $startPass = $ackStatus -eq 'IN_PROGRESS' -and $startResponse.statusCode -eq 400
    }
    Add-Check 'front_start' $(if ($startPass) { 'PASS' } else { 'FAIL' }) @{
        httpStatus = $startResponse.statusCode
        mode = $startMode
        lifecycleStatus = [string]$currentTask.lifecycle_status
        note = if ($startMode -eq 'ACKNOWLEDGE_ALREADY_STARTED') { 'Current state model enters IN_PROGRESS during ACKNOWLEDGE; START is only valid from REWORK.' } else { $null }
    }
    if (-not $startPass) { throw "START compatibility check failed with HTTP $($startResponse.statusCode)." }

    $submitResponse = Invoke-HotelApi "/tasks/$taskId/actions/SUBMIT_RESULT" $frontToken 'POST' @{
        expectedVersion = [long]$currentTask.row_version
        actorAssignmentId = [string]$frontAssignment.id
        payload = @{
            result = @{
                summary = 'PILOT7 live API smoke: front desk employee completed the task and submitted this narrative result.'
            }
        }
    } "pilot7-live-smoke-submit:$RunId"
    $submittedTask = Require-Status $submitResponse @(200) 'front.demo SUBMIT_RESULT'
    $submitPass = [string]$submittedTask.lifecycle_status -eq 'RESULT_SUBMITTED'
    Add-Check 'front_submit_text_result' $(if ($submitPass) { 'PASS' } else { 'FAIL' }) @{
        httpStatus = $submitResponse.statusCode
        lifecycleStatus = [string]$submittedTask.lifecycle_status
        rowVersion = $submittedTask.row_version
    }
    if (-not $submitPass) { throw 'SUBMIT_RESULT did not enter RESULT_SUBMITTED.' }

    if ($evaluationStandard) {
        $evaluationResponse = Invoke-HotelApi '/standard-evaluations' $ceoToken 'POST' @{
            subjectType = 'TASK'
            subjectId = $taskId
            orgUnitId = [string]$frontAssignment.organizationId
            positionAssignmentId = [string]$frontAssignment.id
            standardVersionId = [string]$evaluationStandard.latest_version_id
            inputSnapshot = @{
                greeting = 'completed'
                identity = 'completed'
                explain = 'completed'
                key = 'completed'
                farewell = 'completed'
            }
        } "pilot7-live-smoke-evaluation:$RunId"
        $evaluation = Require-Status $evaluationResponse @(201) 'CEO create standard evaluation'
        $evaluationId = [string]$evaluation.id
        $evaluationPass = -not [string]::IsNullOrWhiteSpace($evaluationId) -and [string]$evaluation.execution_status -eq 'COMPLETED'
        Add-Check 'task_standard_evaluation' $(if ($evaluationPass) { 'PASS' } else { 'FAIL' }) @{
            httpStatus = $evaluationResponse.statusCode
            evaluationId = $evaluationId
            executionStatus = [string]$evaluation.execution_status
            outcome = [string]$evaluation.outcome
            standardCode = [string]$evaluationStandard.code
        }
        if (-not $evaluationPass) { throw 'The safe deterministic task evaluation did not complete.' }
    } else {
        Add-Check 'task_standard_evaluation' 'SKIPPED' @{
            reason = 'No known published deterministic front-desk standard was available, so no unrelated standard was bound or evaluated.'
        }
    }

    $teamResponse = Invoke-HotelApi '/tasks?view=team' $supervisorToken
    $teamTask = Find-Task (Require-Status $teamResponse @(200) 'fo.supervisor team tasks') $taskId
    $reviewResponse = Invoke-HotelApi '/tasks?view=review' $supervisorToken
    $reviewTask = Find-Task (Require-Status $reviewResponse @(200) 'fo.supervisor review tasks') $taskId
    $supervisorPass = $null -ne $teamTask -and $null -ne $reviewTask
    Add-Check 'front_office_supervisor_team_and_review_visibility' $(if ($supervisorPass) { 'PASS' } else { 'FAIL' }) @{
        teamHttpStatus = $teamResponse.statusCode
        reviewHttpStatus = $reviewResponse.statusCode
        teamVisible = $null -ne $teamTask
        reviewVisible = $null -ne $reviewTask
        taskLifecycleStatus = if ($reviewTask) { [string]$reviewTask.lifecycle_status } else { $null }
    }
    if (-not $supervisorPass) { throw 'fo.supervisor could not see the task in both team and review views.' }

    $approveResponse = Invoke-HotelApi "/tasks/$taskId/actions/APPROVE" $supervisorToken 'POST' @{
        expectedVersion = [long]$reviewTask.row_version
        actorAssignmentId = [string]$supervisorAssignment.id
        payload = @{
            note = if ($evaluationStandard) {
                'PILOT7 live smoke accepted after deterministic standard evaluation.'
            } else {
                'PILOT7 live smoke accepted through the audited manual no-standard review path.'
            }
        }
    } "pilot7-live-smoke-approve:$RunId"
    $completedTask = Require-Status $approveResponse @(200) 'fo.supervisor APPROVE'
    $completionPass = [string]$completedTask.lifecycle_status -eq 'COMPLETED'
    Add-Check 'supervisor_acceptance_closes_task' $(if ($completionPass) { 'PASS' } else { 'FAIL' }) @{
        httpStatus = $approveResponse.statusCode
        lifecycleStatus = [string]$completedTask.lifecycle_status
        reviewMode = if ($evaluationStandard) { 'STANDARD_EVALUATION' } else { 'MANUAL_NO_STANDARD' }
    }
    if (-not $completionPass) { throw 'Supervisor acceptance did not close the task.' }

    $otaSession = Login-Pilot 'ota.assistant'
    $otaToken = [string]$otaSession.accessToken
    $otaTargetsResponse = Invoke-HotelApi '/tasks/targets' $otaToken
    $otaTargets = As-Array (Require-Status $otaTargetsResponse @(200) 'ota.assistant task targets')
    $otaNonManagement = @($otaTargets | Where-Object { [string]$_.level_code -notlike 'M*' })
    $otaHotelCount = @($otaTargets | Where-Object hotel_id | Select-Object -ExpandProperty hotel_id -Unique).Count
    $ceoManagementHotelCount = @($ceoTargets | Where-Object { [string]$_.level_code -like 'M*' -and $_.hotel_id } | Select-Object -ExpandProperty hotel_id -Unique).Count
    $requiredHotelCoverage = [Math]::Min(2, $ceoManagementHotelCount)
    $otaScopePass = $otaTargets.Count -gt 0 -and $otaNonManagement.Count -eq 0 -and $otaHotelCount -ge $requiredHotelCoverage
    Add-Check 'ota_assistant_management_targets' $(if ($otaScopePass) { 'PASS' } else { 'FAIL' }) @{
        httpStatus = $otaTargetsResponse.statusCode
        targetCount = $otaTargets.Count
        nonManagementTargetCount = $otaNonManagement.Count
        distinctHotelCount = $otaHotelCount
        managementHotelsAvailableToCeo = $ceoManagementHotelCount
        requiredHotelCoverage = $requiredHotelCoverage
        dataLimitation = if ($ceoManagementHotelCount -lt 2) { 'The current dataset has management assignments in fewer than two hotels; two-hotel coverage is not assertable.' } else { $null }
    }
    if (-not $otaScopePass) { throw 'ota.assistant target scope included a non-management position or missed available hotel coverage.' }

    $forbiddenResponse = Invoke-HotelApi '/tasks' $frontToken 'POST' @{
        orgUnitId = [string]$frontAssignment.organizationId
        assigneeAssignmentId = [string]$frontAssignment.id
        reviewerAssignmentId = [string]$supervisorAssignment.id
        standardVersionId = $null
        title = "[PILOT7-LIVE-SMOKE] forbidden create $RunId"
        description = 'This request must be rejected before any task is created.'
        priority = 'NORMAL'
        sourceSnapshot = @{ source = 'PILOT7_FORBIDDEN_PROBE' }
        creatorAssignmentId = [string]$frontAssignment.id
        dispatchNow = $false
    } "pilot7-live-smoke-front-forbidden:$RunId"
    $forbiddenPass = $forbiddenResponse.statusCode -eq 403
    Add-Check 'front_task_create_forbidden' $(if ($forbiddenPass) { 'PASS' } else { 'FAIL' }) @{
        httpStatus = $forbiddenResponse.statusCode
        expectedHttpStatus = 403
    }
    if (-not $forbiddenPass) { throw "front.demo task creation returned HTTP $($forbiddenResponse.statusCode), expected 403." }
} catch {
    $fatalError = ConvertTo-SafeError $_.Exception.Message
    Add-Check 'fatal_error' 'FAIL' @{ message = $fatalError }
} finally {
    $failedCount = @($checks | Where-Object result -eq 'FAIL').Count
    $report = [ordered]@{
        schemaVersion = 1
        version = 'TECH-V0.2-PILOT.7'
        runId = $RunId
        generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
        startedAt = $startedAt.ToString('o')
        apiTarget = [ordered]@{
            scheme = $apiUri.Scheme
            host = $apiUri.Host
            port = $apiUri.Port
            loopback = $isLoopback
        }
        mutationConfirmed = [bool]$ConfirmMutation
        credentialsPersistedInReport = $false
        artifacts = [ordered]@{
            taskId = $taskId
            evaluationId = $evaluationId
            cleanupPerformed = $false
            retentionNote = if ($taskId) { 'The clearly labelled smoke task is retained as auditable live evidence; this script never deletes or rewrites unrelated data.' } else { $null }
        }
        summary = [ordered]@{
            passed = $failedCount -eq 0
            checkCount = $checks.Count
            passedCount = @($checks | Where-Object result -eq 'PASS').Count
            skippedCount = @($checks | Where-Object result -eq 'SKIPPED').Count
            failedCount = $failedCount
            fatalError = $fatalError
        }
        checks = $checks
    }
    $resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
    New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($resolvedOutput)) | Out-Null
    $report | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $resolvedOutput -Encoding UTF8

    [pscustomobject]@{
        Version = $report.version
        RunId = $RunId
        Overall = if ($report.summary.passed) { 'PASS' } else { 'BLOCKED' }
        ChecksPassed = $report.summary.passedCount
        ChecksFailed = $report.summary.failedCount
        Output = $resolvedOutput
        CredentialsPersisted = $false
    }
    if (-not $report.summary.passed) { exit 1 }
}
