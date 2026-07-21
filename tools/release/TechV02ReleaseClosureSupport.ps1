function Test-TechV02ExactIntegerProperty($object, [string]$name, [long]$expected) {
    if ($null -eq $object) { return $false }
    $property = $object.PSObject.Properties[$name]
    if ($null -eq $property) { return $false }
    $value = $property.Value
    $isInteger = (
        $value -is [byte] -or $value -is [sbyte] -or
        $value -is [int16] -or $value -is [uint16] -or
        $value -is [int32] -or $value -is [uint32] -or
        $value -is [int64] -or $value -is [uint64]
    )
    return $isInteger -and [decimal]$value -eq [decimal]$expected
}

function Test-TechV02ExactBooleanProperty($object, [string]$name, [bool]$expected) {
    if ($null -eq $object) { return $false }
    $property = $object.PSObject.Properties[$name]
    if ($null -eq $property -or -not ($property.Value -is [bool])) { return $false }
    return $property.Value -eq $expected
}

function Test-TechV02StageProcessContract([int]$exitCode, [string]$reportedStatus, [string]$parseError, [string]$stderr) {
    return (
        $exitCode -eq 0 -and
        $reportedStatus -ceq 'PASS' -and
        [string]::IsNullOrWhiteSpace($parseError) -and
        [string]::IsNullOrWhiteSpace($stderr)
    )
}

function Invoke-TechV02AtomicVerifiedTextWrite {
    [CmdletBinding()]
    param(
        [string]$OutputFullPath,
        [string]$Content,
        [scriptblock]$Verifier,
        [scriptblock]$BeforeBackupCleanup
    )
    if ([string]::IsNullOrWhiteSpace($OutputFullPath)) { throw 'OutputFullPath cannot be empty.' }
    if ($null -eq $Verifier) { throw 'Verifier cannot be null.' }
    $outputDirectory = Split-Path -Parent $OutputFullPath
    if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
        throw "Atomic output directory does not exist: $outputDirectory"
    }
    $temporaryPath = Join-Path $outputDirectory ('.' + [System.IO.Path]::GetFileName($OutputFullPath) + '.' + [Guid]::NewGuid().ToString('N') + '.tmp')
    $backupPath = Join-Path $outputDirectory ('.' + [System.IO.Path]::GetFileName($OutputFullPath) + '.' + [Guid]::NewGuid().ToString('N') + '.bak')
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $promoted = $false
    $preserveBackupForRecovery = $false
    $temporarySha256 = $null
    $verification = $null
    try {
        [System.IO.File]::WriteAllText($temporaryPath, $Content, $utf8NoBom)
        $temporarySha256 = (Get-FileHash -LiteralPath $temporaryPath -Algorithm SHA256).Hash.ToLowerInvariant()
        $verification = & $Verifier $temporaryPath $temporarySha256
        if ($null -ne $verification -and (Test-TechV02ExactBooleanProperty $verification 'Promote' $true)) {
            if (Test-Path -LiteralPath $OutputFullPath -PathType Leaf) {
                [System.IO.File]::Replace($temporaryPath, $OutputFullPath, $backupPath, $true)
                try {
                    if ($null -ne $BeforeBackupCleanup) {
                        & $BeforeBackupCleanup $backupPath
                    }
                    if (Test-Path -LiteralPath $backupPath -PathType Leaf) {
                        [System.IO.File]::Delete($backupPath)
                    }
                } catch {
                    $cleanupException = $_.Exception
                    try {
                        [System.IO.File]::Replace($backupPath, $OutputFullPath, $temporaryPath, $true)
                    } catch {
                        $rollbackException = $_.Exception
                        $preserveBackupForRecovery = Test-Path -LiteralPath $backupPath -PathType Leaf
                        $fatalRollbackException = New-Object System.InvalidOperationException(
                            "Atomic replacement committed, backup cleanup failed, and rollback failed. Preserve the backup for recovery. cleanup=$($cleanupException.Message); rollback=$($rollbackException.Message)",
                            $rollbackException
                        )
                        throw $fatalRollbackException
                    }
                    $rolledBackException = New-Object System.InvalidOperationException(
                        "Atomic replacement was rolled back because backup cleanup failed: $($cleanupException.Message)",
                        $cleanupException
                    )
                    throw $rolledBackException
                }
            } else {
                [System.IO.File]::Move($temporaryPath, $OutputFullPath)
            }
            $promoted = $true
        }
    } finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            [System.IO.File]::Delete($temporaryPath)
        }
        if (-not $preserveBackupForRecovery -and (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
            [System.IO.File]::Delete($backupPath)
        }
    }
    return [pscustomobject][ordered]@{
        Promoted = $promoted
        TemporarySha256 = $temporarySha256
        Verification = $verification
        TemporaryFilesRemaining = @(@($temporaryPath, $backupPath) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }).Count
    }
}
