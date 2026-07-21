[CmdletBinding()]
param([string]$RuntimeRoot = 'D:\SifangguanHotelAIOS')

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$resolvedRuntimeRoot = [IO.Path]::GetFullPath($RuntimeRoot)
$secretFile = Join-Path $resolvedRuntimeRoot 'Secrets\pilot-uat.env'
foreach ($line in Get-Content -LiteralPath $secretFile -Encoding UTF8) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    $pair = $trimmed.Split('=', 2); Set-Item -Path "Env:$($pair[0])" -Value $pair[1]
}
$java = Get-ChildItem -LiteralPath (Join-Path $repoRoot '.tooling\jdk') -Filter java.exe -Recurse | Select-Object -First 1
$driver = Get-ChildItem -LiteralPath (Join-Path $repoRoot '.tooling\m2\org\postgresql\postgresql') -Filter '*.jar' -Recurse | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$source = Join-Path $repoRoot 'tools\pilot\PilotAccountBootstrap.java'
$output = Join-Path $resolvedRuntimeRoot 'Pilot-Account-Access.txt'
$url = "jdbc:postgresql://127.0.0.1:$($env:PILOT_DB_PORT)/$($env:PILOT_DB_NAME)"
& $java.FullName --class-path $driver.FullName $source $url $output
if ($LASTEXITCODE -ne 0) { throw 'Pilot account initialization failed.' }
if (Test-Path -LiteralPath $output) {
    $acl = [Security.AccessControl.FileSecurity]::new(); $acl.SetAccessRuleProtection($true, $false)
    $allow = [Security.AccessControl.AccessControlType]::Allow
    foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User, [Security.Principal.SecurityIdentifier]'S-1-5-18', [Security.Principal.SecurityIdentifier]'S-1-5-32-544')) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl, $allow))
    }
    Set-Acl -LiteralPath $output -AclObject $acl
}
