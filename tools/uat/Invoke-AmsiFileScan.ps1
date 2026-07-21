[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Path
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::Error.WriteLine('')

$source = @'
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class HotelAiOsAmsiFileScanner
{
    [DllImport("amsi.dll", CharSet = CharSet.Unicode)]
    private static extern int AmsiInitialize(string appName, out IntPtr context);

    [DllImport("amsi.dll")]
    private static extern void AmsiUninitialize(IntPtr context);

    [DllImport("amsi.dll")]
    private static extern int AmsiOpenSession(IntPtr context, out IntPtr session);

    [DllImport("amsi.dll")]
    private static extern void AmsiCloseSession(IntPtr context, IntPtr session);

    [DllImport("amsi.dll", CharSet = CharSet.Unicode)]
    private static extern int AmsiScanBuffer(
        IntPtr context,
        byte[] buffer,
        uint length,
        string contentName,
        IntPtr session,
        out int result);

    public static int ScanFile(string path)
    {
        byte[] content = File.ReadAllBytes(path);
        IntPtr context;
        int hr = AmsiInitialize("Hotel AI OS attachment scanner", out context);
        Marshal.ThrowExceptionForHR(hr);
        try
        {
            IntPtr session;
            hr = AmsiOpenSession(context, out session);
            Marshal.ThrowExceptionForHR(hr);
            try
            {
                int result;
                hr = AmsiScanBuffer(context, content, (uint)content.Length, Path.GetFileName(path), session, out result);
                Marshal.ThrowExceptionForHR(hr);
                return result;
            }
            finally
            {
                AmsiCloseSession(context, session);
            }
        }
        finally
        {
            AmsiUninitialize(context);
        }
    }
}
'@

Add-Type -TypeDefinition $source -Language CSharp
$resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path

try {
    $result = [HotelAiOsAmsiFileScanner]::ScanFile($resolved)
} catch {
    $platformRoot = 'C:\ProgramData\Microsoft\Windows Defender\Platform'
    $defender = Get-ChildItem -LiteralPath $platformRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName 'MpCmdRun.exe' } |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
    if (-not $defender) {
        [Console]::Error.WriteLine("AMSI failed and Microsoft Defender CLI is unavailable: $($_.Exception.Message)")
        exit 10
    }

    $defenderOutput = @(& $defender -Scan -ScanType 3 -File $resolved -DisableRemediation 2>&1)
    $defenderExitCode = $LASTEXITCODE
    if ($defenderExitCode -eq 0) {
        [Console]::Out.WriteLine('DEFENDER_SCAN_CLEAN provider=Microsoft-Defender-CLI fallback=AMSI-unavailable')
        exit 0
    }

    $defenderDetails = ($defenderOutput | ForEach-Object { [string]$_ }) -join ' '
    if ($defenderDetails -match '0x80004005|Product/Feature disabled|CmdTool: Failed') {
        [Console]::Error.WriteLine('AMSI and Microsoft Defender providers are unavailable on this device.')
        exit 10
    }
    [Console]::Error.WriteLine("Microsoft Defender rejected the attachment (exit=$defenderExitCode).")
    foreach ($line in $defenderOutput) { [Console]::Error.WriteLine([string]$line) }
    exit 2
}

if ($result -ge 32768) {
    [Console]::Error.WriteLine("AMSI detected malware in $resolved (result=$result).")
    exit 2
}
if ($result -ge 16384 -and $result -le 20479) {
    [Console]::Error.WriteLine("AMSI blocked the file by administrator policy (result=$result).")
    exit 3
}

[Console]::Out.WriteLine("AMSI_SCAN_CLEAN result=$result provider=Windows-AMSI")
exit 0
