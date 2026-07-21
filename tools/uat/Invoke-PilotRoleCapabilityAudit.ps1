[CmdletBinding()]
param(
    [string]$RuntimeRoot = 'D:\SifangguanHotelAIOS',
    [string]$ApiBase = 'http://127.0.0.1:18080/api/v1',
    [string]$EvidenceRoot = '',
    [switch]$ExerciseWrites
)

$ErrorActionPreference = 'Stop'
$tenantId = '10000000-0000-0000-0000-000000000001'
$credentialFile = Join-Path ([IO.Path]::GetFullPath($RuntimeRoot)) 'Pilot-Account-Access.txt'
if (-not (Test-Path -LiteralPath $credentialFile)) { throw 'Protected Pilot account file is missing.' }
if ([string]::IsNullOrWhiteSpace($EvidenceRoot)) {
    $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    $EvidenceRoot = Join-Path $repoRoot 'docs\uat\evidence\pilot6-role-capability'
}
New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null

$roleMatrix = @(
    [pscustomobject]@{ Login = 'front.demo'; Role = 'FRONT_DESK'; Package = 'WP-PILOT-FRONT-DAILY'; Team = 403; Dashboard = '' },
    [pscustomobject]@{ Login = 'fo.supervisor'; Role = 'FRONT_OFFICE_SUPERVISOR'; Package = 'WP-PILOT-FO-SUPERVISOR-DAILY'; Team = 200; Dashboard = '' },
    [pscustomobject]@{ Login = 'hk.supervisor'; Role = 'HOUSEKEEPING_SUPERVISOR'; Package = 'WP-PILOT-HK-SUPERVISOR-DAILY'; Team = 200; Dashboard = '' },
    [pscustomobject]@{ Login = 'assistant.gm'; Role = 'ASSISTANT_GENERAL_MANAGER'; Package = 'WP-PILOT-AGM-DAILY'; Team = 200; Dashboard = '/dashboards/hotels/12000000-0000-0000-0000-000000000003' },
    [pscustomobject]@{ Login = 'gm.hz'; Role = 'GENERAL_MANAGER'; Package = 'WP-PILOT-GM-DAILY'; Team = 200; Dashboard = '/dashboards/hotels/12000000-0000-0000-0000-000000000003' },
    [pscustomobject]@{ Login = 'ota.assistant'; Role = 'OTA_OPERATION_ASSISTANT'; Package = 'WP-PILOT-OTA-ASSISTANT-DAILY'; Team = 403; Dashboard = '' },
    [pscustomobject]@{ Login = 'ota.manager'; Role = 'OTA_OPERATION_MANAGER'; Package = 'WP-PILOT-OTA-MANAGER-DAILY'; Team = 200; Dashboard = '/dashboards/operations' },
    [pscustomobject]@{ Login = 'ceo.demo'; Role = 'CEO'; Package = ''; Team = 200; Dashboard = '/dashboards/ceo' }
)

$credentials = @{}
Get-Content -LiteralPath $credentialFile -Encoding UTF8 | ForEach-Object {
    $parts = $_ -split "`t"
    if ($parts.Count -ge 3 -and $roleMatrix.Login -contains $parts[1]) { $credentials[$parts[1]] = $parts[2] }
}
foreach ($row in $roleMatrix) {
    if (-not $credentials.ContainsKey($row.Login)) { throw "Protected credential is missing for $($row.Login)." }
}

function Invoke-Login([string]$LoginName) {
    $body = @{ tenantId = $tenantId; loginName = $LoginName; password = $credentials[$LoginName] } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri "$ApiBase/auth/login" -Method Post -ContentType 'application/json' -Body $body
}

function Invoke-Api([string]$Path, [string]$Token, [string]$Method = 'GET', $Body = $null) {
    $headers = @{ Authorization = "Bearer $Token"; 'X-Correlation-Id' = [guid]::NewGuid().ToString(); 'Idempotency-Key' = [guid]::NewGuid().ToString() }
    $parameters = @{ Uri = "$ApiBase$Path"; Method = $Method; Headers = $headers; UseBasicParsing = $true }
    if ($null -ne $Body) {
        $parameters.ContentType = 'application/json'
        $parameters.Body = $Body | ConvertTo-Json -Depth 30 -Compress
    }
    try {
        $response = Invoke-WebRequest @parameters
    } catch {
        $status = if ($_.Exception.Response -and $_.Exception.Response.StatusCode) { [int]$_.Exception.Response.StatusCode } else { 'NO_STATUS' }
        $detail = $_.ErrorDetails.Message
        if ([string]::IsNullOrWhiteSpace($detail) -and $_.Exception.Response) {
            try {
                $reader = [IO.StreamReader]::new($_.Exception.Response.GetResponseStream(), [Text.Encoding]::UTF8)
                try { $detail = $reader.ReadToEnd() } finally { $reader.Dispose() }
            } catch { $detail = $_.Exception.Message }
        }
        throw "$Method $Path failed with HTTP $status. $detail"
    }
    if ([string]::IsNullOrWhiteSpace($response.Content)) { return $null }
    $parsed = $response.Content | ConvertFrom-Json
    if ($parsed -is [array]) {
        foreach ($item in $parsed) { Write-Output $item }
        return
    }
    Write-Output $parsed
}

function Get-HttpStatus([string]$Path, [string]$Token) {
    try { $null = Invoke-Api $Path $Token; return 200 }
    catch {
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) { return [int]$_.Exception.Response.StatusCode }
        if ($_.Exception.Message -match 'HTTP\s+(\d{3})') { return [int]$Matches[1] }
        throw
    }
}

function New-ValidPayload($Schema) {
    if ($null -ne $Schema -and $Schema.PSObject.Properties.Name -contains 'value' -and $Schema.value -is [string]) {
        $Schema = $Schema.value | ConvertFrom-Json
    }
    $payload = [ordered]@{}
    if ($null -eq $Schema -or $null -eq $Schema.properties) { return @{ summary = 'Pilot.6 real role submission acceptance' } }
    foreach ($property in $Schema.properties.psobject.Properties) {
        $type = [string]$property.Value.type
        $payload[$property.Name] = switch ($type) {
            'integer' { 1 }
            'number' { 1 }
            'boolean' { $true }
            default { 'Pilot.6 real role submission acceptance' }
        }
    }
    $payload
}

function Upload-TestImage([string]$RecordId, [string]$Token) {
    Add-Type -AssemblyName System.Net.Http
    Add-Type -AssemblyName System.Drawing
    $file = Join-Path ([IO.Path]::GetTempPath()) "hotel-ai-os-pilot6-$RecordId.png"
    $bitmap = [Drawing.Bitmap]::new(12, 12)
    try { $bitmap.Save($file, [Drawing.Imaging.ImageFormat]::Png) } finally { $bitmap.Dispose() }
    $client = [Net.Http.HttpClient]::new()
    $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, "$ApiBase/work-data/records/$RecordId/attachments/upload")
    $multipart = [Net.Http.MultipartFormDataContent]::new()
    try {
        $request.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $Token)
        $content = [Net.Http.ByteArrayContent]::new([IO.File]::ReadAllBytes($file))
        $content.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::new('image/png')
        $multipart.Add($content, 'file', 'pilot6-role-audit.png')
        $request.Content = $multipart
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) { throw "Attachment upload failed with HTTP $([int]$response.StatusCode)." }
        return $true
    } finally {
        $multipart.Dispose(); $request.Dispose(); $client.Dispose()
        Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
    }
}

$sessions = @{}
foreach ($row in $roleMatrix) { $sessions[$row.Login] = Invoke-Login $row.Login }
$ceoToken = $sessions['ceo.demo'].accessToken
$writeDate = (Get-Date).Date.AddDays(1).ToString('yyyy-MM-dd')
$results = @()

foreach ($expected in $roleMatrix) {
    $token = $sessions[$expected.Login].accessToken
    $identity = Invoke-Api '/iam/me' $token
    $packages = @(Invoke-Api '/work-packages' $token)
    $myWork = @(Invoke-Api '/my/work-expectations' $token)
    $pilotWork = @($myWork | Where-Object { $_.work_package_code -eq $expected.Package })
    $endpointStatuses = [ordered]@{
        organization = Get-HttpStatus '/org/units' $token
        standards = Get-HttpStatus '/standards' $token
        workPackages = Get-HttpStatus '/work-packages' $token
        myWork = Get-HttpStatus '/my/work-expectations' $token
        teamWork = Get-HttpStatus '/team/work-expectations' $token
        tasks = Get-HttpStatus '/tasks?view=mine' $token
        evaluations = Get-HttpStatus '/standard-evaluations' $token
        notifications = Get-HttpStatus '/notifications' $token
    }
    if (-not [string]::IsNullOrWhiteSpace($expected.Dashboard)) {
        $endpointStatuses.dashboard = Get-HttpStatus $expected.Dashboard $token
    }

    $writeResult = 'NOT_REQUESTED'
    $attachmentResult = 'NOT_APPLICABLE'
    if ($ExerciseWrites -and $expected.Role -ne 'CEO') {
        $assignment = @($identity.positionAssignments) | Select-Object -First 1
        $null = Invoke-Api '/work-expectations/actions/generate' $ceoToken 'POST' @{
            positionAssignmentId = $assignment.id
            targetOrgUnitId = $assignment.organizationId
            businessDate = $writeDate
            periodType = 'DAY'
            dutyPeriodId = $null
        }
        $futureWork = @(Invoke-Api "/my/work-expectations?businessDate=$writeDate" $token)
        $subject = $futureWork | Where-Object { $_.work_package_code -eq $expected.Package } | Select-Object -First 1
        if (-not $subject) { throw "Generated Pilot work is missing for $($expected.Login)." }
        if ($subject.status -in @('SUBMITTED', 'SATISFIED')) {
            $writeResult = "ALREADY_$($subject.status)"
            if ($expected.Role -eq 'HOUSEKEEPING_SUPERVISOR') {
                $existingDetail = Invoke-Api "/work-expectations/$($subject.id)" $token
                $attachmentCount = 0
                foreach ($existingRecord in @($existingDetail.records)) {
                    $attachmentCount += @($existingRecord.attachments).Count
                }
                $attachmentResult = if ($attachmentCount -gt 0) { 'PASS' } else { 'BLOCKED' }
            }
        } else {
            $detail = Invoke-Api "/work-expectations/$($subject.id)" $token
            $isHousekeeping = $expected.Role -eq 'HOUSEKEEPING_SUPERVISOR'
            $record = Invoke-Api '/work-data/records' $token 'POST' @{
                orgUnitId = $assignment.organizationId
                employeeId = $identity.employee.id
                positionAssignmentId = $assignment.id
                formVersionId = $detail.form_version_id
                businessDate = $writeDate
                workPackageVersionId = $detail.work_package_version_id
                workPackageItemId = $detail.work_package_item_id
                workExpectationId = $detail.id
                targetOrgUnitId = $detail.target_org_unit_id
                occurredAt = (Get-Date).ToUniversalTime().ToString('o')
                payload = New-ValidPayload $detail.form_schema
                completionStatement = 'PILOT.6 role write acceptance completed'
                saveAsDraft = $isHousekeeping
            }
            if ($isHousekeeping) {
                $attachmentResult = if (Upload-TestImage $record.id $token) { 'PASS' } else { 'FAIL' }
                $record = Invoke-Api "/work-data/records/$($record.id)/actions/submit" $token 'POST' @{
                    expectedVersion = $record.rowVersion
                }
            }
            $after = Invoke-Api "/work-expectations/$($subject.id)" $token
            $writeResult = "$($record.status)/$($after.status)"
        }
    }

    $assignmentCount = @($identity.positionAssignments).Count
    $requiredEndpointPass = $endpointStatuses.organization -eq 200 -and
        $endpointStatuses.standards -eq 200 -and $endpointStatuses.workPackages -eq 200 -and
        $endpointStatuses.myWork -eq 200 -and $endpointStatuses.teamWork -eq $expected.Team -and
        $endpointStatuses.tasks -eq 200 -and $endpointStatuses.evaluations -eq 200 -and
        $endpointStatuses.notifications -eq 200 -and
        (-not $endpointStatuses.Contains('dashboard') -or $endpointStatuses.dashboard -eq 200)
    $workPass = $expected.Role -eq 'CEO' -or ($assignmentCount -gt 0 -and $pilotWork.Count -gt 0)
    $writePass = -not $ExerciseWrites -or $expected.Role -eq 'CEO' -or $writeResult -match 'SUBMITTED|SATISFIED'
    $attachmentPass = -not $ExerciseWrites -or $expected.Role -ne 'HOUSEKEEPING_SUPERVISOR' -or $attachmentResult -eq 'PASS'
    $results += [pscustomobject]@{
        login = $expected.Login
        expectedRole = $expected.Role
        actualRole = $identity.primaryRole
        assignmentCount = $assignmentCount
        permissionCount = @($identity.permissions).Count
        visiblePackageCount = $packages.Count
        pilotWorkCount = $pilotWork.Count
        endpointStatuses = $endpointStatuses
        writeExercise = $writeResult
        attachmentExercise = $attachmentResult
        result = if ($identity.primaryRole -eq $expected.Role -and $requiredEndpointPass -and $workPass -and $writePass -and $attachmentPass) { 'PASS' } else { 'BLOCKED' }
    }
}

$team = @(Invoke-Api '/team/work-expectations' $ceoToken)
$userCreatedGm = @($team | Where-Object {
    $_.position_assignment_id -eq 'd2203c5b-ba7f-4177-9628-ebb2546ff596' -and
    $_.work_package_code -eq 'WP-PILOT-GM-DAILY'
})
$report = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    version = 'TECH-V0.2-PILOT.6'
    databaseVersion = 16
    exerciseWrites = [bool]$ExerciseWrites
    writeBusinessDate = if ($ExerciseWrites) { $writeDate } else { $null }
    passed = (@($results | Where-Object result -ne 'PASS').Count -eq 0 -and $userCreatedGm.Count -gt 0)
    roleResults = $results
    userCreatedGeneralManager = [ordered]@{
        assignmentId = 'd2203c5b-ba7f-4177-9628-ebb2546ff596'
        pilotWorkCount = $userCreatedGm.Count
        status = @($userCreatedGm.status)
        result = if ($userCreatedGm.Count -gt 0) { 'PASS' } else { 'BLOCKED' }
    }
    credentialsPersistedInEvidence = $false
}

$jsonPath = Join-Path $EvidenceRoot 'pilot6-role-capability-audit.json'
$markdownPath = Join-Path $EvidenceRoot 'pilot6-role-capability-audit.md'
$report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $jsonPath -Encoding UTF8
$markdown = @(
    '# TECH-V0.2-PILOT.6 Real Role Capability Audit', '',
    "Generated: $($report.generatedAt)", "Database: PostgreSQL / Flyway V$($report.databaseVersion)",
    "Write exercise: $($report.exerciseWrites)", '',
    '| Account | Role | Assignments | Visible packages | Pilot work | Write exercise | Attachment | Result |',
    '|---|---|---:|---:|---:|---|---|---|'
)
foreach ($item in $results) {
    $markdown += "| $($item.login) | $($item.actualRole) | $($item.assignmentCount) | $($item.visiblePackageCount) | $($item.pilotWorkCount) | $($item.writeExercise) | $($item.attachmentExercise) | $($item.result) |"
}
$markdown += @('', "User-created general-manager assignment: $($report.userCreatedGeneralManager.result)", '', "Overall: $(if ($report.passed) { 'PASS' } else { 'BLOCKED' })")
$markdown | Set-Content -LiteralPath $markdownPath -Encoding UTF8

[pscustomobject]@{
    Version = $report.version
    RolesPassed = @($results | Where-Object result -eq 'PASS').Count
    RolesTotal = $results.Count
    UserCreatedGeneralManager = $report.userCreatedGeneralManager.result
    WriteExercise = [bool]$ExerciseWrites
    Overall = if ($report.passed) { 'PASS' } else { 'BLOCKED' }
    Evidence = $markdownPath
}

if (-not $report.passed) { exit 1 }
