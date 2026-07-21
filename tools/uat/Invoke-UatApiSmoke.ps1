[CmdletBinding()]
param(
    [string]$ApiOrigin = 'http://127.0.0.1:18080',
    [string]$RunId = (Get-Date -Format 'yyyyMMdd-HHmmss'),
    [string]$TokenFile = '',
    [string]$PhotoPath = '',
    [string]$PhotoHotel = '',
    [string]$PhotoMaskedRoom = '',
    [string]$PhotoCapturedAt = '',
    [string]$PhotoCapturedBy = '',
    [string]$PhotoIssueDescription = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runtimeRoot = Join-Path $repoRoot '.uat-runtime'
if (-not $TokenFile) {
    $TokenFile = Join-Path $runtimeRoot 'identity\tokens.json'
}
if (-not [System.IO.Path]::IsPathRooted($TokenFile)) {
    $TokenFile = Join-Path $repoRoot $TokenFile
}
if (-not (Test-Path -LiteralPath $TokenFile)) {
    throw "Signed-JWT UAT token file was not found: $TokenFile. Start mock_oidc_server.py first."
}
$tokenDocument = Get-Content -LiteralPath $TokenFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]$tokenDocument.audience -ne 'hotel-ai-os-api' -or -not $tokenDocument.tokens) {
    throw 'The UAT token file is invalid or has the wrong audience.'
}
$evidenceRoot = Join-Path $repoRoot "docs\uat\evidence\$RunId\api"
New-Item -ItemType Directory -Force -Path $evidenceRoot | Out-Null

$tenantId = '10000000-0000-0000-0000-000000000001'
$ceo = '19000000-0000-0000-0000-000000000001'
$frontDesk = '19000000-0000-0000-0000-000000000003'
$frontSupervisor = '19000000-0000-0000-0000-000000000005'
$housekeepingSupervisor = '19000000-0000-0000-0000-000000000004'
$assistantGm = '19000000-0000-0000-0000-000000000008'
$generalManager = '19000000-0000-0000-0000-000000000002'
$regionalOperations = '19000000-0000-0000-0000-000000000007'
$frontAssignment = '19200000-0000-0000-0000-000000000002'
$frontSupervisorAssignment = '19200000-0000-0000-0000-000000000004'
$housekeepingAssignment = '19200000-0000-0000-0000-000000000003'
$generalManagerAssignment = '19200000-0000-0000-0000-000000000001'
$frontStandardVersion = '27000000-0000-0000-0000-000000000002'
$housekeepingStandardVersion = '27000000-0000-0000-0000-000000000003'
$frontExpectationId = '2a500000-0000-0000-0000-000000000001'
$missedExpectationId = '2a500000-0000-0000-0000-000000000005'
$housekeepingWorkRecord = '2e000000-0000-0000-0000-000000000001'
$hangzhouHotel = '12000000-0000-0000-0000-000000000003'
$shanghaiHotel = '12000000-0000-0000-0000-000000000004'
$shenzhenHotel = '21000000-0000-0000-0000-000000000002'
$frontDepartment = '12000000-0000-0000-0000-000000000005'
$housekeepingDepartment = '12000000-0000-0000-0000-000000000006'

$roles = @(
    @{ key = 'front-desk'; actor = $frontDesk; probes = @('/iam/me','/my/work-expectations','/tasks','/standard-evaluations','/notifications') },
    @{ key = 'front-supervisor'; actor = $frontSupervisor; probes = @('/iam/me','/team/work-expectations','/tasks','/standard-evaluations','/notifications') },
    @{ key = 'housekeeping-supervisor'; actor = $housekeepingSupervisor; probes = @('/iam/me','/my/work-expectations','/team/work-expectations','/tasks','/standard-evaluations','/notifications') },
    @{ key = 'assistant-gm'; actor = $assistantGm; probes = @('/iam/me','/team/work-expectations','/tasks','/standard-evaluations','/notifications') },
    @{ key = 'general-manager'; actor = $generalManager; probes = @('/iam/me',"/dashboards/hotels/$hangzhouHotel",'/team/work-expectations','/tasks','/standard-evaluations','/notifications') },
    @{ key = 'regional-operations'; actor = $regionalOperations; probes = @('/iam/me','/dashboards/operations','/team/work-expectations','/rules','/tasks','/standard-evaluations','/notifications') }
)

$roleKeyByActor = @{}
$roleKeyByActor[$ceo] = 'ceo'
$roleKeyByActor[$frontDesk] = 'front-desk'
$roleKeyByActor[$frontSupervisor] = 'front-supervisor'
$roleKeyByActor[$housekeepingSupervisor] = 'housekeeping-supervisor'
$roleKeyByActor[$assistantGm] = 'assistant-gm'
$roleKeyByActor[$generalManager] = 'general-manager'
$roleKeyByActor[$regionalOperations] = 'regional-operations'

$requestLog = [System.Collections.Generic.List[object]]::new()

function Save-Json([string]$name, $value) {
    $path = Join-Path $evidenceRoot $name
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    $json = ConvertTo-Json -InputObject $value -Depth 30
    [System.IO.File]::WriteAllText($path, $json, [System.Text.UTF8Encoding]::new($false))
}

function Get-BytesSha256([byte[]]$bytes) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Get-Field($value, [string[]]$names) {
    foreach ($name in $names) {
        if ($null -ne $value -and $null -ne $value.PSObject.Properties[$name]) {
            return $value.PSObject.Properties[$name].Value
        }
    }
    return $null
}

function Get-UatBearerToken([string]$actor) {
    $roleKey = [string]$roleKeyByActor[$actor]
    if (-not $roleKey) { throw "No signed-JWT role mapping exists for actor $actor" }
    $property = $tokenDocument.tokens.PSObject.Properties[$roleKey]
    if (-not $property -or [string]::IsNullOrWhiteSpace([string]$property.Value)) {
        throw "No signed bearer token exists for UAT role $roleKey"
    }
    return [string]$property.Value
}

function New-UatHeaders([string]$actor, [string]$correlationId) {
    return @{
        'Authorization' = "Bearer $(Get-UatBearerToken -actor $actor)"
        'X-Correlation-Id' = $correlationId
        'Accept' = 'application/json'
    }
}

function Invoke-UatRequest(
    [string]$Path,
    [string]$Actor,
    [string]$Method = 'GET',
    $Body = $null,
    [string]$IdempotencyKey = '',
    [int[]]$ExpectedStatuses = @(200, 201, 204),
    [switch]$ReturnEnvelope
) {
    $correlationId = [guid]::NewGuid().ToString()
    $headers = New-UatHeaders -actor $Actor -correlationId $correlationId
    if ($IdempotencyKey) { $headers['Idempotency-Key'] = $IdempotencyKey }
    $client = [System.Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromSeconds(30)
    $request = [System.Net.Http.HttpRequestMessage]::new(
        [System.Net.Http.HttpMethod]::new($Method.ToUpperInvariant()),
        "$ApiOrigin/api/v1$Path"
    )
    $response = $null
    try {
        foreach ($entry in $headers.GetEnumerator()) {
            $request.Headers.TryAddWithoutValidation($entry.Key, [string]$entry.Value) | Out-Null
        }
        if ($null -ne $Body) {
            $bodyJson = ConvertTo-Json -InputObject $Body -Depth 30 -Compress
            $request.Content = [System.Net.Http.StringContent]::new(
                $bodyJson,
                [System.Text.Encoding]::UTF8,
                'application/json'
            )
        }
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        $status = [int]$response.StatusCode
        $contentBytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        $contentText = [System.Text.Encoding]::UTF8.GetString($contentBytes)
        $payload = $null
        if (-not [string]::IsNullOrWhiteSpace($contentText)) {
            if ($contentText.Trim() -eq '[]') {
                $payload = [System.Collections.ArrayList]::new()
            } else {
                try { $payload = $contentText | ConvertFrom-Json } catch { $payload = $contentText }
            }
        }
        $passed = $ExpectedStatuses -contains $status
        $requestLog.Add([ordered]@{
            category='api'
            authMode='bearer-jwt'
            path=$Path
            actor=$Actor
            method=$Method
            status=$status
            expectedStatuses=@($ExpectedStatuses)
            passed=$passed
            correlationId=$correlationId
        })
        if (-not $passed) {
            throw "Unexpected HTTP $status for $Method $Path. Expected $($ExpectedStatuses -join ','). Body: $contentText"
        }
        if ($ReturnEnvelope) {
            return [ordered]@{ status=$status; correlationId=$correlationId; body=$payload }
        }
        return $payload
    } finally {
        if ($response) { $response.Dispose() }
        $request.Dispose()
        $client.Dispose()
    }
}

function Invoke-UatHealthRequest {
    $client = [System.Net.Http.HttpClient]::new()
    $response = $null
    try {
        $response = $client.GetAsync("$ApiOrigin/actuator/health").GetAwaiter().GetResult()
        $status = [int]$response.StatusCode
        if ($status -ne 200) { throw "Health endpoint returned HTTP $status" }
        $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        $text = [System.Text.Encoding]::UTF8.GetString($bytes)
        return $text | ConvertFrom-Json
    } finally {
        if ($response) { $response.Dispose() }
        $client.Dispose()
    }
}

function Invoke-UatAuthenticationProbe(
    [string]$Case,
    [string]$Token = '',
    [hashtable]$AdditionalHeaders = @{},
    [int[]]$ExpectedStatuses = @(401)
) {
    $correlationId = [guid]::NewGuid().ToString()
    $client = [System.Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromSeconds(30)
    $request = [System.Net.Http.HttpRequestMessage]::new(
        [System.Net.Http.HttpMethod]::Get,
        "$ApiOrigin/api/v1/iam/me"
    )
    $response = $null
    try {
        $request.Headers.TryAddWithoutValidation('X-Correlation-Id', $correlationId) | Out-Null
        $request.Headers.TryAddWithoutValidation('Accept', 'application/json') | Out-Null
        if (-not [string]::IsNullOrWhiteSpace($Token)) {
            $request.Headers.TryAddWithoutValidation('Authorization', "Bearer $Token") | Out-Null
        }
        foreach ($entry in $AdditionalHeaders.GetEnumerator()) {
            $request.Headers.TryAddWithoutValidation([string]$entry.Key, [string]$entry.Value) | Out-Null
        }
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        $status = [int]$response.StatusCode
        $contentText = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $payload = $null
        if (-not [string]::IsNullOrWhiteSpace($contentText)) {
            try { $payload = $contentText | ConvertFrom-Json } catch { $payload = $contentText }
        }
        $passed = $ExpectedStatuses -contains $status
        $requestLog.Add([ordered]@{
            category='authentication'
            authMode='bearer-jwt'
            authCase=$Case
            path='/iam/me'
            method='GET'
            status=$status
            expectedStatuses=@($ExpectedStatuses)
            passed=$passed
            correlationId=$correlationId
        })
        if (-not $passed) {
            throw "Unexpected HTTP $status for authentication case $Case. Expected $($ExpectedStatuses -join ','). Body: $contentText"
        }
        return [ordered]@{
            case=$Case
            status=$status
            expectedStatuses=@($ExpectedStatuses)
            passed=$passed
            correlationId=$correlationId
            response=$payload
        }
    } finally {
        if ($response) { $response.Dispose() }
        $request.Dispose()
        $client.Dispose()
    }
}

function Invoke-UatImageUpload(
    [string]$recordId,
    [string]$actor,
    [byte[]]$imageBytes,
    [string]$mediaType,
    [string]$originalName
) {
    $correlationId = [guid]::NewGuid().ToString()
    $path = "/work-data/records/$recordId/attachments/upload"
    $client = [System.Net.Http.HttpClient]::new()
    $multipart = [System.Net.Http.MultipartFormDataContent]::new()
    $fileContent = $null
    $response = $null
    try {
        foreach ($entry in (New-UatHeaders -actor $actor -correlationId $correlationId).GetEnumerator()) {
            $client.DefaultRequestHeaders.TryAddWithoutValidation($entry.Key, [string]$entry.Value) | Out-Null
        }
        $fileContent = [System.Net.Http.ByteArrayContent]::new($imageBytes)
        $fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse($mediaType)
        $multipart.Add($fileContent, 'file', $originalName)
        $response = $client.PostAsync("$ApiOrigin/api/v1$path", $multipart).GetAwaiter().GetResult()
        $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $status = [int]$response.StatusCode
        $requestLog.Add([ordered]@{ category='api'; authMode='bearer-jwt'; path=$path; actor=$actor; method='POST'; status=$status; expectedStatuses=@(201); passed=($status -eq 201); correlationId=$correlationId })
        if (-not $response.IsSuccessStatusCode) { throw "Image upload failed with HTTP $status`: $content" }
        return $content | ConvertFrom-Json
    } finally {
        if ($response) { $response.Dispose() }
        if ($fileContent) { $fileContent.Dispose() }
        $multipart.Dispose()
        $client.Dispose()
    }
}

function Invoke-UatDownload([string]$path, [string]$actor, [string]$outputPath) {
    $correlationId = [guid]::NewGuid().ToString()
    $client = [System.Net.Http.HttpClient]::new()
    $response = $null
    try {
        foreach ($entry in (New-UatHeaders -actor $actor -correlationId $correlationId).GetEnumerator()) {
            $client.DefaultRequestHeaders.TryAddWithoutValidation($entry.Key, [string]$entry.Value) | Out-Null
        }
        $response = $client.GetAsync("$ApiOrigin/api/v1$path").GetAwaiter().GetResult()
        $status = [int]$response.StatusCode
        $requestLog.Add([ordered]@{ category='api'; authMode='bearer-jwt'; path=$path; actor=$actor; method='GET'; status=$status; expectedStatuses=@(200); passed=($status -eq 200); correlationId=$correlationId })
        if (-not $response.IsSuccessStatusCode) { throw "Attachment download failed with HTTP $status" }
        [System.IO.File]::WriteAllBytes($outputPath, $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult())
    } finally {
        if ($response) { $response.Dispose() }
        $client.Dispose()
    }
}

function Task-Status($task) {
    return [string](Get-Field $task @('lifecycle_status','lifecycleStatus','status'))
}

function Task-Version($task) {
    return [long](Get-Field $task @('row_version','rowVersion','version'))
}

function Get-UatTask([string]$taskId, [string]$actor = $ceo) {
    return Invoke-UatRequest -Path "/tasks/$taskId" -Actor $actor
}

function Find-UatTask([string]$actor, [string]$workRecordId = '', [string]$title = '', [string]$sourceValue = '') {
    for ($attempt = 1; $attempt -le 100; $attempt++) {
        $tasks = @(Invoke-UatRequest -Path '/tasks' -Actor $actor)
        foreach ($candidate in $tasks) {
            if ($title -and [string](Get-Field $candidate @('title')) -eq $title) { return $candidate }
            if ($workRecordId -or $sourceValue) {
                $taskId = [string](Get-Field $candidate @('id'))
                if (-not $taskId) { continue }
                $detail = Get-UatTask -taskId $taskId -actor $actor
                if ($workRecordId -and [string](Get-Field $detail @('work_record_id','workRecordId')) -eq $workRecordId) {
                    return $detail
                }
                if ($sourceValue -and ((Get-Field $detail @('source_snapshot','sourceSnapshot') | ConvertTo-Json -Depth 10 -Compress) -match [regex]::Escape($sourceValue))) {
                    return $detail
                }
            }
        }
        Start-Sleep -Milliseconds 200
    }
    throw "Expected UAT task was not visible. workRecordId=$workRecordId title=$title sourceValue=$sourceValue"
}

function Find-UatManagementEvents([string]$eventType, [string]$payloadValue) {
    for ($attempt = 1; $attempt -le 100; $attempt++) {
        $events = @(Invoke-UatRequest -Path '/management-events' -Actor $ceo)
        $matches = @($events | Where-Object {
            [string](Get-Field $_ @('event_type','eventType')) -eq $eventType -and
            ((Get-Field $_ @('payload_snapshot','payloadSnapshot') | ConvertTo-Json -Depth 10 -Compress) -match [regex]::Escape($payloadValue))
        })
        if ($matches.Count -gt 0) { return $matches }
        Start-Sleep -Milliseconds 200
    }
    throw "Scheduled worker did not project management event $eventType for $payloadValue"
}

function Wait-UatExpectationMissed([string]$expectationId, [string]$actor) {
    for ($attempt = 1; $attempt -le 100; $attempt++) {
        $expectation = Invoke-UatRequest -Path "/work-expectations/$expectationId" -Actor $actor
        if ([string](Get-Field $expectation @('status')) -eq 'MISSED') { return $expectation }
        Start-Sleep -Milliseconds 200
    }
    throw "Scheduled worker did not mark expectation $expectationId as MISSED"
}

function Wait-UatTaskEscalation([string]$taskId, [string]$actor) {
    for ($attempt = 1; $attempt -le 100; $attempt++) {
        $task = Get-UatTask -taskId $taskId -actor $actor
        $timeline = Invoke-UatRequest -Path "/tasks/$taskId/timeline" -Actor $actor
        $slaStatus = [string](Get-Field $task @('sla_status','slaStatus'))
        $commands = @($timeline | ForEach-Object { [string](Get-Field $_ @('command')) })
        if ($slaStatus -eq 'OVERDUE' -and $commands -contains 'MARK_OVERDUE' -and $commands -contains 'ESCALATE') {
            return [ordered]@{ task=$task; timeline=$timeline }
        }
        Start-Sleep -Milliseconds 200
    }
    throw "Scheduled worker did not mark and escalate task $taskId"
}

function Complete-UatTask(
    [string]$taskId,
    [string]$flowPath,
    [string]$assigneeActor,
    [string]$assigneeAssignment,
    [string]$reviewerActor,
    [string]$reviewerAssignment,
    [string]$standardVersion,
    [string]$orgUnitId,
    $resultPayload,
    $evaluationInput,
    $evidence = $null
) {
    $task = Get-UatTask -taskId $taskId
    Save-Json "$flowPath\task-before-execution.json" $task
    if ((Task-Status $task) -eq 'PROPOSED') {
        $task = Invoke-UatRequest -Path "/tasks/$taskId/actions/dispatch" -Actor $reviewerActor -Method 'POST' `
            -Body @{ expectedVersion=(Task-Version $task); payload=@{ scenario=$flowPath } } `
            -IdempotencyKey "$flowPath-dispatch"
        Save-Json "$flowPath\task-dispatched.json" $task
    }
    if ((Task-Status $task) -eq 'PENDING_ACK') {
        $task = Invoke-UatRequest -Path "/tasks/$taskId/actions/acknowledge" -Actor $assigneeActor -Method 'POST' `
            -Body @{ expectedVersion=(Task-Version $task); actorAssignmentId=$assigneeAssignment; payload=@{} } `
            -IdempotencyKey "$flowPath-ack"
        Save-Json "$flowPath\task-acknowledged.json" $task
    }
    if ($evidence) {
        $taskEvidence = Invoke-UatRequest -Path "/tasks/$taskId/evidence" -Actor $assigneeActor -Method 'POST' `
            -Body $evidence
        Save-Json "$flowPath\task-evidence.json" $taskEvidence
    }
    if ((Task-Status $task) -eq 'IN_PROGRESS' -or (Task-Status $task) -eq 'REWORK') {
        $task = Invoke-UatRequest -Path "/tasks/$taskId/actions/submit-result" -Actor $assigneeActor -Method 'POST' `
            -Body @{ expectedVersion=(Task-Version $task); actorAssignmentId=$assigneeAssignment; payload=$resultPayload } `
            -IdempotencyKey "$flowPath-submit-result"
        Save-Json "$flowPath\task-result-submitted.json" $task
    }
    if ((Task-Status $task) -eq 'RESULT_SUBMITTED') {
        $evaluation = Invoke-UatRequest -Path '/standard-evaluations' -Actor $reviewerActor -Method 'POST' `
            -Body @{ subjectType='TASK'; subjectId=$taskId; orgUnitId=$orgUnitId; positionAssignmentId=$assigneeAssignment; standardVersionId=$standardVersion; inputSnapshot=$evaluationInput } `
            -IdempotencyKey "$flowPath-task-evaluation"
        Save-Json "$flowPath\task-standard-evaluation.json" $evaluation
        $task = Get-UatTask -taskId $taskId
    }
    if ((Task-Status $task) -eq 'AWAITING_REVIEW') {
        $task = Invoke-UatRequest -Path "/tasks/$taskId/actions/approve" -Actor $reviewerActor -Method 'POST' `
            -Body @{ expectedVersion=(Task-Version $task); actorAssignmentId=$reviewerAssignment; payload=@{ comment='Sprint 2.1 UAT accepted' } } `
            -IdempotencyKey "$flowPath-approve"
        Save-Json "$flowPath\task-approved.json" $task
    }
    $final = Get-UatTask -taskId $taskId -actor $reviewerActor
    Save-Json "$flowPath\task-final.json" $final
    Save-Json "$flowPath\task-timeline.json" (Invoke-UatRequest -Path "/tasks/$taskId/timeline" -Actor $reviewerActor)
    if ((Task-Status $final) -ne 'COMPLETED') { throw "Task $taskId did not complete in $flowPath" }
    return $final
}

Save-Json 'health.json' (Invoke-UatHealthRequest)

function Get-NegativeToken([string]$name) {
    $property = $tokenDocument.negativeTokens.PSObject.Properties[$name]
    if (-not $property -or [string]::IsNullOrWhiteSpace([string]$property.Value)) {
        throw "Negative signed-JWT token case is missing: $name"
    }
    return [string]$property.Value
}

# Production authentication-path evidence. No bearer token is written to committed evidence.
Save-Json 'authentication\01-no-bearer-denied.json' `
    (Invoke-UatAuthenticationProbe -Case 'no-bearer')
Save-Json 'authentication\02-dev-headers-without-bearer-denied.json' `
    (Invoke-UatAuthenticationProbe -Case 'dev-headers-disabled' `
        -AdditionalHeaders @{ 'X-Tenant-Id'=$tenantId; 'X-Actor-Id'=$generalManager })
Save-Json 'authentication\03-malformed-token-denied.json' `
    (Invoke-UatAuthenticationProbe -Case 'malformed-token' -Token 'not-a-jwt')
Save-Json 'authentication\04-expired-token-denied.json' `
    (Invoke-UatAuthenticationProbe -Case 'expired-token' -Token (Get-NegativeToken 'expired'))
Save-Json 'authentication\05-wrong-audience-denied.json' `
    (Invoke-UatAuthenticationProbe -Case 'wrong-audience' -Token (Get-NegativeToken 'wrongAudience'))
Save-Json 'authentication\06-wrong-issuer-denied.json' `
    (Invoke-UatAuthenticationProbe -Case 'wrong-issuer' -Token (Get-NegativeToken 'wrongIssuer'))
Save-Json 'authentication\07-missing-tenant-claim-denied.json' `
    (Invoke-UatAuthenticationProbe -Case 'missing-tenant-claim' -Token (Get-NegativeToken 'missingTenant'))
Save-Json 'authentication\08-missing-account-identity-denied.json' `
    (Invoke-UatAuthenticationProbe -Case 'missing-account-identity' -Token (Get-NegativeToken 'missingIdentity'))
Save-Json 'authentication\09-unknown-account-denied.json' `
    (Invoke-UatAuthenticationProbe -Case 'unknown-account' -Token (Get-NegativeToken 'unknownAccount'))
Save-Json 'authentication\10-cross-tenant-token-denied.json' `
    (Invoke-UatAuthenticationProbe -Case 'cross-tenant-token' -Token (Get-NegativeToken 'crossTenant'))

foreach ($role in $roles) {
    foreach ($probe in $role.probes) {
        $safeName = ($probe -replace '[^a-zA-Z0-9]+','-').Trim('-').ToLowerInvariant()
        Save-Json "roles\$($role.key)\$safeName.json" `
            (Invoke-UatRequest -Path $probe -Actor $role.actor -ReturnEnvelope)
    }
}

# Front-office supervisor positive business action: create and cancel an in-scope remediation task.
$manualSupervisorTask = Invoke-UatRequest -Path '/tasks' -Actor $frontSupervisor -Method 'POST' `
    -Body @{ orgUnitId=$frontDepartment; assigneeAssignmentId=$frontAssignment; reviewerAssignmentId=$frontSupervisorAssignment; standardVersionId=$frontStandardVersion; title='前厅主管手工发起整改任务（UAT）'; description='验证前厅主管可在授权部门内发起整改任务。'; priority='NORMAL'; dueAt=(Get-Date).ToUniversalTime().AddHours(4).ToString('o'); sourceSnapshot=@{ scenario='SUPERVISOR_MANUAL_CREATE' } } `
    -IdempotencyKey 'uat-front-supervisor-manual-remediation-create'
Save-Json 'roles\front-supervisor\manual-remediation-task-created.json' $manualSupervisorTask
$manualSupervisorTaskId = [string](Get-Field $manualSupervisorTask @('id'))
$manualSupervisorTaskCancelled = Invoke-UatRequest -Path "/tasks/$manualSupervisorTaskId/actions/cancel" -Actor $frontSupervisor -Method 'POST' `
    -Body @{ expectedVersion=(Task-Version $manualSupervisorTask); actorAssignmentId=$frontSupervisorAssignment; payload=@{ reason='UAT positive create check completed' } } `
    -IdempotencyKey 'uat-front-supervisor-manual-remediation-cancel'
Save-Json 'roles\front-supervisor\manual-remediation-task-cancelled.json' $manualSupervisorTaskCancelled

# Deterministic permission-denial probes. Expected 4xx responses are PASS evidence, not failed requests.
Save-Json 'security\01-front-desk-team-work-denied.json' `
    (Invoke-UatRequest -Path '/team/work-expectations' -Actor $frontDesk -ExpectedStatuses @(403) -ReturnEnvelope)
Save-Json 'security\02-general-manager-cross-hotel-denied.json' `
    (Invoke-UatRequest -Path "/dashboards/hotels/$shanghaiHotel" -Actor $generalManager -ExpectedStatuses @(403) -ReturnEnvelope)
Save-Json 'security\03-regional-role-cross-region-hotel-denied.json' `
    (Invoke-UatRequest -Path "/dashboards/hotels/$shenzhenHotel" -Actor $regionalOperations -ExpectedStatuses @(403) -ReturnEnvelope)
Save-Json 'security\04-supervisor-outside-org-assignment-denied.json' `
    (Invoke-UatRequest -Path '/tasks' -Actor $frontSupervisor -Method 'POST' `
        -Body @{ orgUnitId=$frontDepartment; assigneeAssignmentId=$housekeepingAssignment; reviewerAssignmentId=$frontSupervisorAssignment; standardVersionId=$frontStandardVersion; title='跨部门越权任务（应拒绝）'; priority='NORMAL' } `
        -IdempotencyKey 'uat-security-outside-org-task' -ExpectedStatuses @(403) -ReturnEnvelope)
Save-Json 'security\05-self-review-task-definition-denied.json' `
    (Invoke-UatRequest -Path '/tasks' -Actor $generalManager -Method 'POST' `
        -Body @{ orgUnitId=$hangzhouHotel; assigneeAssignmentId=$generalManagerAssignment; reviewerAssignmentId=$generalManagerAssignment; standardVersionId=$frontStandardVersion; title='责任人与验收人相同（应拒绝）'; priority='NORMAL' } `
        -IdempotencyKey 'uat-security-self-review-task' -ExpectedStatuses @(400) -ReturnEnvelope)

# Scenario A: housekeeping photo -> hygiene evaluation -> remediation task -> housekeeping execution -> GM acceptance.
$flowA = 'flows\A-housekeeping-photo-standard-remediation'
$photoBytes = $null
$photoMediaType = 'image/png'
$photoOriginalName = 'uat-room-inspection.png'
$photoSourceType = 'TECHNICAL_FIXTURE'
if ($PhotoPath) {
    $resolvedPhoto = (Resolve-Path -LiteralPath $PhotoPath).Path
    $photoExtension = [System.IO.Path]::GetExtension($resolvedPhoto).ToLowerInvariant()
    $photoMediaType = switch ($photoExtension) {
        '.png' { 'image/png' }
        '.jpg' { 'image/jpeg' }
        '.jpeg' { 'image/jpeg' }
        default { throw 'Formal field-photo UAT accepts only PNG or JPEG files.' }
    }
    $missingMetadata = @()
    foreach ($pair in @{
        PhotoHotel=$PhotoHotel
        PhotoMaskedRoom=$PhotoMaskedRoom
        PhotoCapturedAt=$PhotoCapturedAt
        PhotoCapturedBy=$PhotoCapturedBy
        PhotoIssueDescription=$PhotoIssueDescription
    }.GetEnumerator()) {
        if ([string]::IsNullOrWhiteSpace([string]$pair.Value)) { $missingMetadata += $pair.Key }
    }
    if ($missingMetadata.Count -gt 0) {
        throw "Formal field-photo UAT requires metadata: $($missingMetadata -join ', ')"
    }
    $parsedCaptureTime = [datetimeoffset]::MinValue
    if (-not [datetimeoffset]::TryParse($PhotoCapturedAt, [ref]$parsedCaptureTime)) {
        throw 'PhotoCapturedAt must be an ISO-8601 date-time with timezone.'
    }
    $photoBytes = [System.IO.File]::ReadAllBytes($resolvedPhoto)
    if ($photoBytes.Length -lt 1024) {
        throw 'Formal field-photo UAT rejects files smaller than 1 KiB; provide the original on-site photo.'
    }
    $photoOriginalName = [System.IO.Path]::GetFileName($resolvedPhoto)
    $photoSourceType = 'FIELD_PHOTO_CANDIDATE'
} else {
    $photoBytes = [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
}
$photoInputSha256 = Get-BytesSha256 $photoBytes
Save-Json "$flowA\00-photo-source.json" ([ordered]@{
    sourceType=$photoSourceType
    originalName=$photoOriginalName
    mediaType=$photoMediaType
    sizeBytes=$photoBytes.Length
    sha256=$photoInputSha256
    hotel=$PhotoHotel
    maskedRoom=$PhotoMaskedRoom
    capturedAt=$PhotoCapturedAt
    capturedBy=$PhotoCapturedBy
    issueDescription=$PhotoIssueDescription
    absoluteSourcePathPersisted=$false
})
$attachment = Invoke-UatImageUpload -recordId $housekeepingWorkRecord -actor $housekeepingSupervisor `
    -imageBytes $photoBytes -mediaType $photoMediaType -originalName $photoOriginalName
Save-Json "$flowA\01-photo-upload.json" $attachment
$attachmentId = [string](Get-Field $attachment @('id'))
$attachmentObjectKey = [string](Get-Field $attachment @('objectKey','object_key'))
$attachmentSha256 = [string](Get-Field $attachment @('sha256'))
Save-Json 'security\06-cross-department-attachment-download-denied.json' `
    (Invoke-UatRequest -Path "/work-data/attachments/$attachmentId/content" -Actor $frontSupervisor -ExpectedStatuses @(403) -ReturnEnvelope)
Save-Json "$flowA\02-photo-list.json" (Invoke-UatRequest -Path "/work-data/records/$housekeepingWorkRecord/attachments" -Actor $housekeepingSupervisor)
$downloadPath = Join-Path $evidenceRoot "$flowA\03-photo-download.png"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $downloadPath) | Out-Null
Invoke-UatDownload -path "/work-data/attachments/$attachmentId/content" -actor $housekeepingSupervisor -outputPath $downloadPath
$downloadSha256 = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
Save-Json "$flowA\04-photo-sha256.json" ([ordered]@{ uploadSha256=$attachmentSha256; downloadSha256=$downloadSha256; matched=($attachmentSha256 -eq $downloadSha256) })
if ($attachmentSha256 -ne $downloadSha256) { throw 'Scenario A downloaded image SHA-256 did not match.' }

$hygieneEvaluation = Invoke-UatRequest -Path '/standard-evaluations' -Actor $housekeepingSupervisor -Method 'POST' `
    -Body @{ subjectType='WORK_RECORD'; subjectId=$housekeepingWorkRecord; orgUnitId=$housekeepingDepartment; positionAssignmentId=$housekeepingAssignment; standardVersionId=$housekeepingStandardVersion; inputSnapshot=@{ roomsChecked=32; photoAttached=$true; issueClosed=$false } } `
    -IdempotencyKey 'uat-a-housekeeping-hygiene-fail'
Save-Json "$flowA\05-hygiene-standard-evaluation.json" $hygieneEvaluation
Save-Json 'roles\housekeeping-supervisor\hygiene-standard-evaluation-created.json' $hygieneEvaluation
if ([string](Get-Field $hygieneEvaluation @('outcome')) -ne 'FAIL') { throw 'Scenario A hygiene evaluation was expected to FAIL.' }

$hygieneEvaluationId = [string](Get-Field $hygieneEvaluation @('id'))
$hygieneEvents = Find-UatManagementEvents -eventType 'STANDARDEVALUATIONCOMPLETED' -payloadValue $hygieneEvaluationId
Save-Json "$flowA\06-scheduled-worker-event.json" $hygieneEvents
Save-Json "$flowA\07-failed-evaluation-rule-event.json" $hygieneEvents
$taskA = Find-UatTask -actor $generalManager -workRecordId $housekeepingWorkRecord
Save-Json "$flowA\08-rule-remediation-task-created.json" $taskA
$taskAId = [string](Get-Field $taskA @('id'))
$taskAEvidence = @{ submittedByAssignmentId=$housekeepingAssignment; evidenceType='IMAGE'; objectKey=$attachmentObjectKey; originalName=$photoOriginalName; mediaType=$photoMediaType; sizeBytes=[long](Get-Field $attachment @('sizeBytes','size_bytes')); sha256=$attachmentSha256; structuredResult=@{ scenario='A'; issueClosed=$true; sourceType=$photoSourceType } }
$finalTaskA = Complete-UatTask -taskId $taskAId -flowPath $flowA -assigneeActor $housekeepingSupervisor `
    -assigneeAssignment $housekeepingAssignment -reviewerActor $generalManager -reviewerAssignment $generalManagerAssignment `
    -standardVersion $housekeepingStandardVersion -orgUnitId $housekeepingDepartment `
    -resultPayload @{ summary='Hygiene remediation and evidence retake completed'; roomsChecked=32; photoAttached=$true; issueClosed=$true } `
    -evaluationInput @{ roomsChecked=32; photoAttached=$true; issueClosed=$true } -evidence $taskAEvidence

# Scenario B: front-desk complaint submission -> standard judgment -> rule -> task -> closure.
$flowB = 'flows\B-front-complaint-rule-task-closure'
$today = Get-Date -Format 'yyyy-MM-dd'
$frontRecord = Invoke-UatRequest -Path '/work-data/records' -Actor $frontDesk -Method 'POST' `
    -Body @{ orgUnitId=$frontDepartment; employeeId='19100000-0000-0000-0000-000000000002'; positionAssignmentId=$frontAssignment; formVersionId='29700000-0000-0000-0000-000000000002'; businessDate=$today; workPackageVersionId='2a100000-0000-0000-0000-000000000001'; workPackageItemId='2a200000-0000-0000-0000-000000000001'; workExpectationId=$frontExpectationId; targetOrgUnitId=$frontDepartment; recordKind='EVENT'; occurredAt=(Get-Date).ToUniversalTime().ToString('o'); payload=@{ complaintRecorded=$true; guestContacted=$false; resolutionSummary='Complaint logged; guest callback pending'; guestName='UAT Guest' } } `
    -IdempotencyKey 'uat-b-front-complaint-submit'
Save-Json "$flowB\01-complaint-submitted.json" $frontRecord
$frontRecordId = [string](Get-Field $frontRecord @('id'))
$frontJudgment = Invoke-UatRequest -Path '/standard-evaluations' -Actor $frontSupervisor -Method 'POST' `
    -Body @{ subjectType='WORK_RECORD'; subjectId=$frontRecordId; orgUnitId=$frontDepartment; positionAssignmentId=$frontAssignment; standardVersionId=$frontStandardVersion; inputSnapshot=@{ complaintRecorded=$true; guestContacted=$false; resolutionSummary='Complaint logged; guest callback pending' } } `
    -IdempotencyKey 'uat-b-front-complaint-judgment'
Save-Json "$flowB\02-standard-judgment.json" $frontJudgment
if ([string](Get-Field $frontJudgment @('outcome')) -ne 'FAIL') { throw 'Scenario B complaint standard judgment was expected to FAIL.' }
$frontJudgmentId = [string](Get-Field $frontJudgment @('id'))
$complaintEvents = Find-UatManagementEvents -eventType 'STANDARDEVALUATIONCOMPLETED' -payloadValue $frontJudgmentId
Save-Json "$flowB\03-scheduled-worker-rule-events.json" $complaintEvents
Save-Json "$flowB\04-complaint-rule-event.json" $complaintEvents
$taskB = Find-UatTask -actor $frontSupervisor -workRecordId $frontRecordId
Save-Json "$flowB\05-rule-task-created.json" $taskB
$taskBId = [string](Get-Field $taskB @('id'))
$finalTaskB = Complete-UatTask -taskId $taskBId -flowPath $flowB -assigneeActor $frontDesk `
    -assigneeAssignment $frontAssignment -reviewerActor $frontSupervisor -reviewerAssignment $frontSupervisorAssignment `
    -standardVersion $frontStandardVersion -orgUnitId $frontDepartment `
    -resultPayload @{ complaintRecorded=$true; guestContacted=$true; resolutionSummary='Guest callback and complaint closure completed' } `
    -evaluationInput @{ complaintRecorded=$true; guestContacted=$true; resolutionSummary='Guest callback and complaint closure completed' }

# Scenario C: no submission -> MISSED scan -> reminder -> remediation task -> overdue escalation.
$flowC = 'flows\C-missed-scan-reminder-task-escalation'
$missedExpectation = Wait-UatExpectationMissed -expectationId $missedExpectationId -actor $housekeepingSupervisor
Save-Json "$flowC\01-scheduled-worker-missed-detection.json" ([ordered]@{ mode='scheduled-worker'; manualTrigger=$false; expectation=$missedExpectation })
Save-Json "$flowC\02-expectation-missed.json" $missedExpectation
if ([string](Get-Field $missedExpectation @('status')) -ne 'MISSED') { throw 'Scenario C expectation was not marked MISSED.' }
$missedEvents = Find-UatManagementEvents -eventType 'WORKEXPECTATIONMISSED' -payloadValue $missedExpectationId
Save-Json "$flowC\03-scheduled-worker-missed-event.json" $missedEvents
$missedNotification = $null
for ($attempt = 1; $attempt -le 20 -and -not $missedNotification; $attempt++) {
    $notices = @(Invoke-UatRequest -Path '/notifications' -Actor $housekeepingSupervisor)
    $missedNotification = $notices | Where-Object { [string](Get-Field $_ @('notification_type','notificationType','type')) -eq 'MISSED_WORK_REMINDER' } | Select-Object -First 1
    if (-not $missedNotification) { Start-Sleep -Milliseconds 300 }
}
if (-not $missedNotification) { throw 'Scenario C missed-work reminder notification was not created.' }
Save-Json "$flowC\04-reminder-notification.json" $missedNotification
$taskC = Find-UatTask -actor $housekeepingSupervisor -sourceValue $missedExpectationId
Save-Json "$flowC\05-remediation-task-created.json" $taskC
$taskCId = [string](Get-Field $taskC @('id'))
$taskEscalation = Wait-UatTaskEscalation -taskId $taskCId -actor $assistantGm
$taskCAfterSla = $taskEscalation.task
$taskCTimeline = $taskEscalation.timeline
Save-Json "$flowC\06-scheduled-worker-task-sla.json" ([ordered]@{ mode='scheduled-worker'; manualTrigger=$false; task=$taskCAfterSla })
Save-Json "$flowC\07-task-overdue.json" $taskCAfterSla
Save-Json "$flowC\08-task-escalation-timeline.json" $taskCTimeline
$taskCSlaStatus = [string](Get-Field $taskCAfterSla @('sla_status','slaStatus'))
$timelineCommands = @($taskCTimeline | ForEach-Object { [string](Get-Field $_ @('command')) })
if ($taskCSlaStatus -ne 'OVERDUE' -or $timelineCommands -notcontains 'MARK_OVERDUE' -or $timelineCommands -notcontains 'ESCALATE') {
    throw 'Scenario C remediation task did not produce overdue and escalation timeline evidence.'
}

$finalStatusA = Task-Status $finalTaskA
$finalStatusB = Task-Status $finalTaskB
$finalStatusC = Task-Status $taskCAfterSla
$scenarioA = [ordered]@{
    id = 'A'
    name = 'housekeeping-photo-standard-remediation-execution-gm-acceptance'
    workRecordId = $housekeepingWorkRecord
    taskId = $taskAId
    finalStatus = $finalStatusA
}
$scenarioB = [ordered]@{
    id = 'B'
    name = 'front-complaint-standard-rule-task-closure'
    workRecordId = $frontRecordId
    taskId = $taskBId
    finalStatus = $finalStatusB
}
$scenarioC = [ordered]@{
    id = 'C'
    name = 'missing-submission-missed-reminder-task-overdue-escalation'
    expectationId = $missedExpectationId
    taskId = $taskCId
    finalStatus = $finalStatusC
    slaStatus = $taskCSlaStatus
}
$summary = [ordered]@{
    runId = $RunId
    executedAt = (Get-Date).ToString('o')
    apiOrigin = $ApiOrigin
    tenantId = $tenantId
    authentication = [ordered]@{
        mode = 'bearer-jwt'
        algorithm = [string]$tokenDocument.algorithm
        issuer = [string]$tokenDocument.issuer
        audience = [string]$tokenDocument.audience
        formalRoleCount = $roles.Count
        negativeProbeCount = @($requestLog | Where-Object { $_.category -eq 'authentication' }).Count
        secretsPersistedInEvidence = $false
    }
    automation = [ordered]@{
        mode = 'scheduled-worker'
        manualSlaProcessRequestCount = @($requestLog | Where-Object { $_.path -match '/sla/process' }).Count
        manualOutboxRecoveryRequestCount = @($requestLog | Where-Object { $_.path -match 'project-outbox|outbox/recover' }).Count
    }
    roleProbeCount = ($roles | ForEach-Object { $_.probes.Count } | Measure-Object -Sum).Sum
    supervisorManualTask = [ordered]@{ taskId=$manualSupervisorTaskId; finalStatus=(Task-Status $manualSupervisorTaskCancelled) }
    permissionDenialProbeCount = 6
    housekeepingSupervisorEvaluation = [ordered]@{
        evaluationId = $hygieneEvaluationId
        actorAccountId = $housekeepingSupervisor
        outcome = [string](Get-Field $hygieneEvaluation @('outcome'))
    }
    housekeepingPhoto = [ordered]@{
        sourceType = $photoSourceType
        originalName = $photoOriginalName
        mediaType = $photoMediaType
        sizeBytes = $photoBytes.Length
        sha256 = $photoInputSha256
        fieldMetadataComplete = ($photoSourceType -eq 'FIELD_PHOTO_CANDIDATE')
    }
    scenarioCount = 3
    scenarios = @($scenarioA, $scenarioB, $scenarioC)
    requestCount = $requestLog.Count
    failedRequestCount = @($requestLog | Where-Object { $_.passed -eq $false }).Count
    expectedDeniedRequestCount = @($requestLog | Where-Object { $_.passed -and $_.status -ge 400 }).Count
    expectedBusinessDeniedRequestCount = @($requestLog | Where-Object { $_.category -eq 'api' -and $_.passed -and $_.status -ge 400 }).Count
    expectedAuthenticationDeniedRequestCount = @($requestLog | Where-Object { $_.category -eq 'authentication' -and $_.passed -and $_.status -eq 401 }).Count
    evidenceRoot = $evidenceRoot
}
Save-Json 'request-log.json' $requestLog
Save-Json 'summary.json' $summary

if ($summary.failedRequestCount -ne 0 `
    -or $summary.expectedBusinessDeniedRequestCount -ne 6 `
    -or $summary.expectedAuthenticationDeniedRequestCount -ne 10 `
    -or $summary.automation.manualSlaProcessRequestCount -ne 0 `
    -or $summary.automation.manualOutboxRecoveryRequestCount -ne 0) {
    throw "UAT API smoke failed with $($summary.failedRequestCount) failed request(s)."
}

Write-Host "Signed-JWT API/PostgreSQL smoke passed for six roles and scenarios A, B and C. Evidence: $evidenceRoot"
