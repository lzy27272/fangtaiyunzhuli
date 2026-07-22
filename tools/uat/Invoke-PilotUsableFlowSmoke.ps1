[CmdletBinding()]
param(
    [string]$RuntimeRoot = 'D:\SifangguanHotelAIOS',
    [string]$ApiBase = '',
    [string]$StateFile = '',
    [string]$RunId = (Get-Date -Format 'yyyyMMdd-HHmmss-pilot-flow')
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $StateFile) {
    $StateFile = Join-Path $repoRoot 'docs\uat\evidence\runtime\uat-processes.json'
}
if (-not (Test-Path -LiteralPath $StateFile)) {
    throw "Disposable UAT state is missing: $StateFile. Run Start-UatEnvironment.ps1 first."
}
$uatState = Get-Content -LiteralPath $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]$uatState.purpose -cne 'ISOLATED_UAT') {
    throw 'Mutating Pilot smoke is blocked unless the state declares purpose=ISOLATED_UAT.'
}
$expiresAt = [DateTimeOffset]::Parse([string]$uatState.expiresAt)
if ($expiresAt -le [DateTimeOffset]::Now) {
    throw 'Disposable UAT state has expired. Restart the UAT environment.'
}
$stateApiOrigin = ([string]$uatState.apiUrl).TrimEnd('/')
$stateUri = [Uri]$stateApiOrigin
if ($stateUri.Scheme -ne 'http' -or $stateUri.Host -notin @('127.0.0.1', 'localhost', '::1')) {
    throw "Mutating Pilot smoke requires a loopback disposable API, received $stateApiOrigin."
}
if ($uatState.apiPid -and -not (Get-Process -Id ([int]$uatState.apiPid) -ErrorAction SilentlyContinue)) {
    throw 'The API process recorded by the disposable UAT state is no longer running.'
}
if ($ApiBase -and $ApiBase.TrimEnd('/') -ne "$stateApiOrigin/api/v1") {
    throw 'ApiBase does not match the active disposable UAT state.'
}

Write-Warning 'Invoke-PilotUsableFlowSmoke.ps1 is retained as a compatibility entry point; it now delegates to isolated signed-JWT UAT and cannot write to the shared Pilot database.'
& (Join-Path $PSScriptRoot 'Invoke-UatApiSmoke.ps1') -ApiOrigin $stateApiOrigin -RunId $RunId
if ($LASTEXITCODE -ne 0) { throw "Isolated UAT smoke failed with exit code $LASTEXITCODE." }
return

$tenantId = '10000000-0000-0000-0000-000000000001'
$credentialFile = Join-Path ([IO.Path]::GetFullPath($RuntimeRoot)) 'Pilot-Account-Access.txt'

function Invoke-Api([string]$Path, [string]$Token, [string]$Method = 'GET', $Body = $null) {
    $headers = @{
        Authorization = "Bearer $Token"
        'X-Correlation-Id' = [guid]::NewGuid().ToString()
        'Idempotency-Key' = [guid]::NewGuid().ToString()
    }
    $parameters = @{ Uri = "$ApiBase$Path"; Method = $Method; Headers = $headers }
    if ($null -ne $Body) {
        $parameters.ContentType = 'application/json'
        $parameters.Body = ($Body | ConvertTo-Json -Depth 20 -Compress)
    }
    return Invoke-RestMethod @parameters
}

function Login([string]$Name, [string]$Password) {
    $body = @{ tenantId = $tenantId; loginName = $Name; password = $Password } | ConvertTo-Json -Compress
    return Invoke-RestMethod -Uri "$ApiBase/auth/login" -Method Post -ContentType 'application/json' -Body $body
}

function Upload-Attachment([string]$Path, [string]$Token, [string]$FilePath) {
    Add-Type -AssemblyName System.Net.Http
    $client = [Net.Http.HttpClient]::new()
    $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, "$ApiBase$Path")
    $multipart = [Net.Http.MultipartFormDataContent]::new()
    try {
        $request.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $Token)
        $fileContent = [Net.Http.ByteArrayContent]::new([IO.File]::ReadAllBytes($FilePath))
        $fileContent.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::new('image/png')
        $multipart.Add($fileContent, 'file', [IO.Path]::GetFileName($FilePath))
        $request.Content = $multipart
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        $responseBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) {
            throw "Attachment upload failed with HTTP $([int]$response.StatusCode): $responseBody"
        }
        return $responseBody | ConvertFrom-Json
    } finally {
        $multipart.Dispose()
        $request.Dispose()
        $client.Dispose()
    }
}

$ceoLine = Get-Content -LiteralPath $credentialFile -Encoding UTF8 |
    Where-Object { ($_ -split "`t")[1] -eq 'ceo.demo' } |
    Select-Object -Last 1
if (-not $ceoLine) { throw 'ceo.demo credential is missing.' }

$ceoParts = $ceoLine -split "`t"
$ceo = Login $ceoParts[1] $ceoParts[2]
$token = $ceo.accessToken
$stamp = Get-Date -Format 'yyMMddHHmmss'
$today = Get-Date -Format 'yyyy-MM-dd'

$groups = [object[]](Invoke-Api '/org/units?type=GROUP' $token)
if (-not $groups.Count) { throw 'Root group is missing.' }

$region = Invoke-Api '/org/units' $token 'POST' @{
    parentId = $groups[0].id
    code = "UAT-R-$stamp"
    name = "Pilot UAT Region $stamp"
    unitType = 'REGION'
    sortOrder = 90
}
$hotel = Invoke-Api '/org/units' $token 'POST' @{
    parentId = $region.id
    code = "UAT-H-$stamp"
    name = "Pilot UAT Hotel $stamp"
    unitType = 'HOTEL'
    sortOrder = 90
    propertyCode = "P-$stamp"
    city = 'Guiyang'
    roomCount = 36
}
$newPosition = Invoke-Api '/org/positions' $token 'POST' @{
    code = "UAT-P-$stamp"
    name = "Pilot UAT Position $stamp"
    jobFamily = 'PILOT_UAT'
    levelCode = 'P1'
}

$positions = [object[]](Invoke-Api '/org/positions' $token)
$frontPosition = $positions | Where-Object { [string]$_.code -eq 'FRONT_DESK' } | Select-Object -First 1
$roles = [object[]](Invoke-Api '/iam/roles' $token)
$frontRole = $roles | Where-Object { [string]$_.code -eq 'FRONT_DESK' } | Select-Object -First 1
if (-not $frontPosition) { throw "Front desk position is missing. Visible position count: $($positions.Count)." }
if (-not $frontRole) { throw "Front desk role is missing. Visible role count: $($roles.Count)." }

$passwordBytes = [byte[]]::new(12)
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $random.GetBytes($passwordBytes) } finally { $random.Dispose() }
$staffPassword = 'Sfg!9' + [Convert]::ToBase64String($passwordBytes).Replace('+', 'A').Replace('/', 'B').TrimEnd('=')
$loginName = "uat.front.$stamp"
$employee = Invoke-Api '/org/employees' $token 'POST' @{
    employeeNo = "UAT-E-$stamp"
    name = "Pilot UAT Front Desk $stamp"
    mobile = ''
    hiredOn = $today
    loginName = $loginName
    temporaryPassword = $staffPassword
}
$assignment = Invoke-Api "/org/employees/$($employee.id)/assignments" $token 'POST' @{
    orgUnitId = $hotel.id
    positionId = $frontPosition.id
    managerAssignmentId = $null
    primary = $true
    assignmentType = 'PERMANENT'
    validFrom = $today
    validTo = $null
}
$null = Invoke-Api '/iam/role-assignments' $token 'POST' @{
    accountId = $employee.accountId
    roleId = $frontRole.id
    scopeOrgUnitId = $hotel.id
    scopeType = 'ORG_TREE'
    validFrom = (Get-Date).ToUniversalTime().ToString('o')
    validTo = $null
}

$forms = [object[]](Invoke-Api '/work-data/forms' $token)
$frontForm = $forms |
    Where-Object { $_.code -eq 'FD-DAILY' -and $_.lifecycle_status -eq 'PUBLISHED' } |
    Select-Object -First 1
if (-not $frontForm) { throw 'Published FD-DAILY form is missing.' }

$package = Invoke-Api '/work-packages' $token 'POST' @{
    code = "UAT-WP-$stamp"
    name = "Pilot Front Desk Full Flow $stamp"
    description = 'Automated Pilot usability acceptance'
    positionId = $frontPosition.id
    ownerOrgUnitId = $region.id
}
$version = Invoke-Api "/work-packages/$($package.id)/versions" $token 'POST' @{
    title = $package.name
    description = 'Automated Pilot usability acceptance'
}
$null = Invoke-Api "/work-packages/$($package.id)/versions/$($version.id)" $token 'PUT' @{
    title = $package.name
    description = 'Automated Pilot usability acceptance'
    scopes = @(@{ scopeType = 'ORG_TREE'; orgUnitId = $hotel.id })
    items = @(@{
        itemCode = 'DAILY-01'
        name = 'Front desk daily operations and complaints'
        description = 'Full-flow acceptance work item'
        itemType = 'SCHEDULED_RECORD'
        formVersionId = $frontForm.latest_version_id
        sortOrder = 1
        required = $true
        periodType = 'DAY'
        timezoneMode = 'HOTEL'
        dueLocalTime = '23:59'
        graceMinutes = 30
        weekdays = @()
        holidayPolicy = 'INCLUDE'
        waiverAllowed = $false
        targetGranularity = 'TARGET_ORG'
        reviewMode = 'NONE'
        submissionPolicy = @{
            completionStatementRequired = $true
            attachmentRequired = $true
            maxAttachments = 10
            maxFileSizeBytes = 20971520
            allowedExtensions = @('jpg', 'jpeg', 'png', 'pdf', 'docx', 'xlsx')
        }
        standards = @()
        responsibilities = @(@{
            participantType = 'EXECUTOR'
            resolverType = 'CURRENT_ASSIGNMENT'
            scopeStrategy = 'TARGET_ORG'
            escalationLevel = 0
        })
    })
}

$validation = Invoke-Api "/work-packages/$($package.id)/versions/$($version.id)/validate" $token 'POST'
if (-not $validation.valid) { throw "Work package validation failed: $($validation.issues -join '; ')" }

$null = Invoke-Api "/work-packages/$($package.id)/versions/$($version.id)/publish" $token 'POST' @{
    effectiveFrom = (Get-Date).ToUniversalTime().ToString('o')
    effectiveTo = $null
}
$null = Invoke-Api "/work-packages/$($package.id)/allocations" $token 'POST' @{
    workPackageVersionId = $version.id
    positionAssignmentId = $assignment.id
    targetOrgUnitId = $hotel.id
    validFrom = $today
    validTo = $null
    allocationSource = 'MANUAL'
}
$generation = Invoke-Api '/work-expectations/actions/generate' $token 'POST' @{
    positionAssignmentId = $assignment.id
    targetOrgUnitId = $hotel.id
    businessDate = $today
    periodType = 'DAY'
    dutyPeriodId = $null
}

$staff = Login $loginName $staffPassword
$staffMe = Invoke-Api '/iam/me' $staff.accessToken
$staffOrgs = [object[]](Invoke-Api '/org/units' $staff.accessToken)
$myWork = [object[]](Invoke-Api "/my/work-expectations?businessDate=$today" $staff.accessToken)
$expectation = $myWork |
    Where-Object { $_.work_package_version_id -eq $version.id } |
    Select-Object -First 1
if (-not $expectation) { throw 'Generated work is not visible to assigned employee.' }

$recordDraft = Invoke-Api '/work-data/records' $staff.accessToken 'POST' @{
    orgUnitId = $hotel.id
    employeeId = $employee.id
    positionAssignmentId = $assignment.id
    formVersionId = $frontForm.latest_version_id
    businessDate = $today
    workPackageVersionId = $version.id
    workPackageItemId = $expectation.work_package_item_id
    workExpectationId = $expectation.id
    targetOrgUnitId = $hotel.id
    occurredAt = (Get-Date).ToUniversalTime().ToString('o')
    payload = @{ checkins = 1; complaints = 0; vipReception = 'Pilot acceptance completed' }
    completionStatement = 'PILOT.6 front desk full-flow acceptance completed'
    saveAsDraft = $true
}
$evidenceFile = Join-Path ([IO.Path]::GetTempPath()) "hotel-ai-os-pilot-$stamp.png"
try {
    Add-Type -AssemblyName System.Drawing
    $bitmap = [Drawing.Bitmap]::new(8, 8)
    try {
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        try { $graphics.Clear([Drawing.Color]::White) } finally { $graphics.Dispose() }
        $bitmap.Save($evidenceFile, [Drawing.Imaging.ImageFormat]::Png)
    } finally { $bitmap.Dispose() }
    $attachment = Upload-Attachment "/work-data/records/$($recordDraft.id)/attachments/upload" $staff.accessToken $evidenceFile
} finally {
    Remove-Item -LiteralPath $evidenceFile -Force -ErrorAction SilentlyContinue
}
$attachments = [object[]](Invoke-Api "/work-data/records/$($recordDraft.id)/attachments" $staff.accessToken)
$record = Invoke-Api "/work-data/records/$($recordDraft.id)/actions/submit" $staff.accessToken 'POST' @{
    expectedVersion = $recordDraft.rowVersion
}
$finalWork = [object[]](Invoke-Api "/my/work-expectations?businessDate=$today" $staff.accessToken) |
    Where-Object id -eq $expectation.id |
    Select-Object -First 1

[pscustomobject]@{
    Status = if ($record.status -eq 'SUBMITTED' -and $finalWork.status -in @('SUBMITTED', 'SATISFIED')) { 'PASS' } else { 'BLOCKED' }
    RegionCreated = [bool]$region.id
    HotelCreated = [bool]$hotel.id
    PositionCreated = [bool]$newPosition.id
    EmployeeAccountCreated = [bool]$employee.accountId
    AssignmentCreated = [bool]$assignment.id
    ScopedRole = $staffMe.primaryRole
    VisibleOrgCount = $staffOrgs.Count
    WorkPackagePublished = $true
    ExpectationsGenerated = if ($null -ne $generation.generatedCount) { $generation.generatedCount } else { $generation.generated_count }
    WorkVisibleToEmployee = [bool]$expectation.id
    RecordStatus = $record.status
    FinalWorkStatus = $finalWork.status
    AttachmentUploaded = [bool]$attachment.id
    AttachmentVisible = $attachments.Count -ge 1
}
