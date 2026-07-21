[CmdletBinding()]
param(
    [string]$ServiceName = 'SifangguanPilot',
    [string]$DatabaseServiceName = 'SifangguanPostgreSQL',
    [string]$CoreApiSystemTaskName = 'SifangguanPilotCoreApi',
    [string]$CoreApiUserTaskName = 'SifangguanPilotCoreApiUser',
    [int]$ApiPort = 18080,
    [int]$DatabasePort = 55432
)

$ErrorActionPreference = 'Stop'

function Test-LoopbackTcpPort {
    param([Parameter(Mandatory)][int]$Port)
    $client = [Net.Sockets.TcpClient]::new()
    try {
        $client.Connect('127.0.0.1', $Port)
        return $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
$databaseService = Get-Service -Name $DatabaseServiceName -ErrorAction SilentlyContinue
$tunnelService = Get-Service -Name 'SifangguanPilotTunnel' -ErrorAction SilentlyContinue
$coreApiSystemTask = Get-ScheduledTask -TaskName $CoreApiSystemTaskName -ErrorAction SilentlyContinue
$coreApiUserTask = Get-ScheduledTask -TaskName $CoreApiUserTaskName -ErrorAction SilentlyContinue
$listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in 80, 443, 4180, $ApiPort, $DatabasePort } |
    Select-Object LocalAddress, LocalPort, OwningProcess
$tunnelProcess = Get-Process cloudflared -ErrorAction SilentlyContinue
$originReachable = $false
$originClient = [Net.Sockets.TcpClient]::new()
try {
    $originClient.Connect('127.0.0.1', 4180)
    $originReachable = $originClient.Connected
} catch {
    $originReachable = $false
} finally {
    $originClient.Dispose()
}

$apiHealthy = $false
try {
    $apiHealthy = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$ApiPort/actuator/health" -TimeoutSec 3).StatusCode -eq 200
} catch {
    $apiHealthy = $false
}

$databaseListening = Test-LoopbackTcpPort -Port $DatabasePort
$apiListening = Test-LoopbackTcpPort -Port $ApiPort

[pscustomobject]@{
    ServiceInstalled = [bool]$service
    ServiceState = if ($service) { [string]$service.Status } else { 'NotInstalled' }
    ServiceStartMode = if ($service) { [string]$service.StartType } else { $null }
    HttpListening = [bool]($listeners | Where-Object LocalPort -eq 80)
    HttpsListening = [bool]($listeners | Where-Object LocalPort -eq 443)
    LoopbackOriginListening = $originReachable
    CoreApiListening = $apiListening
    CoreApiHealthy = $apiHealthy
    CoreApiSystemTaskState = if ($coreApiSystemTask) { [string]$coreApiSystemTask.State } else { 'NotInstalled' }
    CoreApiUserTaskState = if ($coreApiUserTask) { [string]$coreApiUserTask.State } else { 'NotInstalled' }
    PostgreSqlListening = $databaseListening
    PostgreSqlServiceState = if ($databaseService) { [string]$databaseService.Status } else { 'NotInstalled' }
    PostgreSqlServiceStartMode = if ($databaseService) { [string]$databaseService.StartType } else { $null }
    TunnelProcessRunning = [bool]$tunnelProcess
    TunnelServiceState = if ($tunnelService) { [string]$tunnelService.Status } else { 'NotInstalled' }
    TunnelServiceStartMode = if ($tunnelService) { [string]$tunnelService.StartType } else { $null }
}

$listeners
