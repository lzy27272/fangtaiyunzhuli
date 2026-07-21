[CmdletBinding()]
param(
    [string]$RcEvidencePath,
    [string]$ReleaseArtifactPath1,
    [string]$ReleaseArtifactPath2,
    [string]$OutputFormat = 'Json',
    [long]$MaxTextBytes = 67108864,
    [long]$MaxArchiveEntryBytes = 67108864,
    [long]$MaxArchiveTotalBytes = 1073741824,
    [int]$MaxArchiveEntries = 100000,
    [int]$MaxArchiveDepth = 4
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function New-DetectionRule {
    param(
        [string]$Id,
        [string]$Pattern,
        [bool]$IgnoreCase = $false
    )

    $options = [System.Text.RegularExpressions.RegexOptions]::CultureInvariant
    $options = $options -bor [System.Text.RegularExpressions.RegexOptions]::Multiline
    if ($IgnoreCase) {
        $options = $options -bor [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    }

    return [pscustomobject][ordered]@{
        Id = $Id
        Regex = [System.Text.RegularExpressions.Regex]::new(
            $Pattern,
            $options,
            [TimeSpan]::FromSeconds(2)
        )
    }
}

function Initialize-ScannerState {
    $script:FindingMap = @{}
    $script:ErrorMap = @{}
    $script:FingerprintLines = New-Object 'System.Collections.Generic.List[string]'
    $script:ArchiveLimitHit = $false
    $script:Stats = [ordered]@{
        inputRootsAccepted = 0
        filesScanned = 0
        archivesScanned = 0
        archiveEntriesInspected = 0
        readableTextUnitsScanned = 0
        namesScanned = 0
        binaryUnitsSkipped = 0
        bytesDeclaredInArchiveEntries = [long]0
    }
}

function Protect-OutputName {
    param([AllowNull()][string]$Value)

    if ($null -eq $Value) {
        return $null
    }

    $protected = $Value
    foreach ($rule in $script:Rules) {
        try {
            $protected = $rule.Regex.Replace($protected, "[REDACTED-$($rule.Id)]")
        } catch [System.Text.RegularExpressions.RegexMatchTimeoutException] {
            return '[REDACTED-PATH]'
        }
    }
    return $protected
}

function Add-ScanError {
    param(
        [string]$Code,
        [AllowNull()][string]$RelativePath,
        [AllowNull()][string]$ArchiveEntry,
        [int]$Count = 1
    )

    $safePath = Protect-OutputName $RelativePath
    $safeEntry = Protect-OutputName $ArchiveEntry
    $key = $Code + [char]31 + $safePath + [char]31 + $safeEntry
    if ($script:ErrorMap.ContainsKey($key)) {
        $script:ErrorMap[$key].count = [int]$script:ErrorMap[$key].count + $Count
        return
    }

    $script:ErrorMap[$key] = [pscustomobject][ordered]@{
        code = $Code
        relativePath = $safePath
        archiveEntry = $safeEntry
        count = $Count
    }
}

function Add-Finding {
    param(
        [string]$RuleId,
        [string]$RelativePath,
        [AllowNull()][string]$ArchiveEntry,
        [int]$Count
    )

    if ($Count -le 0) {
        return
    }

    $safePath = Protect-OutputName $RelativePath
    $safeEntry = Protect-OutputName $ArchiveEntry
    $key = $RuleId + [char]31 + $safePath + [char]31 + $safeEntry
    if ($script:FindingMap.ContainsKey($key)) {
        $script:FindingMap[$key].count = [int]$script:FindingMap[$key].count + $Count
        return
    }

    $script:FindingMap[$key] = [pscustomobject][ordered]@{
        ruleId = $RuleId
        relativePath = $safePath
        archiveEntry = $safeEntry
        count = $Count
    }
}

function Scan-TextValue {
    param(
        [AllowEmptyString()][string]$Text,
        [string]$RelativePath,
        [AllowNull()][string]$ArchiveEntry,
        [bool]$IsName = $false
    )

    if ($IsName) {
        $script:Stats.namesScanned = [int]$script:Stats.namesScanned + 1
    } else {
        $script:Stats.readableTextUnitsScanned = [int]$script:Stats.readableTextUnitsScanned + 1
    }

    if ([string]::IsNullOrEmpty($Text)) {
        return
    }

    foreach ($rule in $script:Rules) {
        try {
            $matchCount = $rule.Regex.Matches($Text).Count
            if ($matchCount -gt 0) {
                Add-Finding $rule.Id $RelativePath $ArchiveEntry $matchCount
            }
        } catch [System.Text.RegularExpressions.RegexMatchTimeoutException] {
            Add-ScanError 'REGEX_TIMEOUT' $RelativePath $ArchiveEntry
        }
    }
}

function Test-KnownTextName {
    param([string]$Name)

    $leaf = [System.IO.Path]::GetFileName($Name).ToLowerInvariant()
    if ($script:KnownTextLeafNames.ContainsKey($leaf)) {
        return $true
    }

    $extension = [System.IO.Path]::GetExtension($leaf).ToLowerInvariant()
    return $script:KnownTextExtensions.ContainsKey($extension)
}

function Test-ArchiveName {
    param([string]$Name)

    $extension = [System.IO.Path]::GetExtension($Name).ToLowerInvariant()
    return $extension -eq '.zip' -or $extension -eq '.jar'
}

function Test-LooksLikeUtf16WithoutBom {
    param([byte[]]$Bytes)

    $sampleLength = [Math]::Min($Bytes.Length, 4096)
    if ($sampleLength -lt 4) {
        return 0
    }

    $evenZero = 0
    $oddZero = 0
    $pairs = [Math]::Floor($sampleLength / 2)
    for ($index = 0; $index -lt ($pairs * 2); $index += 2) {
        if ($Bytes[$index] -eq 0) { $evenZero++ }
        if ($Bytes[$index + 1] -eq 0) { $oddZero++ }
    }

    if ($oddZero -ge [Math]::Max(2, [Math]::Floor($pairs * 0.60)) -and $evenZero -le [Math]::Floor($pairs * 0.10)) {
        return 1
    }
    if ($evenZero -ge [Math]::Max(2, [Math]::Floor($pairs * 0.60)) -and $oddZero -le [Math]::Floor($pairs * 0.10)) {
        return 2
    }
    return 0
}

function Test-ReadableCharacterRatio {
    param([string]$Text)

    if ([string]::IsNullOrEmpty($Text)) {
        return $true
    }

    $sampleLength = [Math]::Min($Text.Length, 4096)
    $controlCount = 0
    for ($index = 0; $index -lt $sampleLength; $index++) {
        $character = $Text[$index]
        if ([char]::IsControl($character) -and $character -ne "`r" -and $character -ne "`n" -and $character -ne "`t") {
            $controlCount++
        }
    }

    return ($controlCount / [double]$sampleLength) -le 0.02
}

function Try-DecodeReadableText {
    param(
        [byte[]]$Bytes,
        [string]$Name,
        [ref]$DecodedText
    )

    $DecodedText.Value = $null
    $knownText = Test-KnownTextName $Name
    if ($Bytes.Length -eq 0) {
        $DecodedText.Value = ''
        return $true
    }

    $encoding = $null
    $offset = 0
    if ($Bytes.Length -ge 4 -and $Bytes[0] -eq 0x00 -and $Bytes[1] -eq 0x00 -and $Bytes[2] -eq 0xFE -and $Bytes[3] -eq 0xFF) {
        $encoding = [System.Text.Encoding]::GetEncoding('utf-32BE')
        $offset = 4
    } elseif ($Bytes.Length -ge 4 -and $Bytes[0] -eq 0xFF -and $Bytes[1] -eq 0xFE -and $Bytes[2] -eq 0x00 -and $Bytes[3] -eq 0x00) {
        $encoding = [System.Text.Encoding]::UTF32
        $offset = 4
    } elseif ($Bytes.Length -ge 3 -and $Bytes[0] -eq 0xEF -and $Bytes[1] -eq 0xBB -and $Bytes[2] -eq 0xBF) {
        $encoding = New-Object System.Text.UTF8Encoding($false, $true)
        $offset = 3
    } elseif ($Bytes.Length -ge 2 -and $Bytes[0] -eq 0xFE -and $Bytes[1] -eq 0xFF) {
        $encoding = [System.Text.Encoding]::BigEndianUnicode
        $offset = 2
    } elseif ($Bytes.Length -ge 2 -and $Bytes[0] -eq 0xFF -and $Bytes[1] -eq 0xFE) {
        $encoding = [System.Text.Encoding]::Unicode
        $offset = 2
    } else {
        $utf16Kind = Test-LooksLikeUtf16WithoutBom $Bytes
        if ($utf16Kind -eq 1) {
            $encoding = [System.Text.Encoding]::Unicode
        } elseif ($utf16Kind -eq 2) {
            $encoding = [System.Text.Encoding]::BigEndianUnicode
        } else {
            $encoding = New-Object System.Text.UTF8Encoding($false, $true)
        }
    }

    try {
        $text = $encoding.GetString($Bytes, $offset, $Bytes.Length - $offset)
    } catch [System.Text.DecoderFallbackException] {
        if (-not $knownText) {
            return $false
        }
        $text = [System.Text.Encoding]::UTF8.GetString($Bytes, $offset, $Bytes.Length - $offset)
    }

    if (-not $knownText -and -not (Test-ReadableCharacterRatio $text)) {
        return $false
    }

    $DecodedText.Value = $text
    return $true
}

function Try-ReadStreamBytes {
    param(
        [System.IO.Stream]$Stream,
        [long]$DeclaredLength,
        [long]$Limit,
        [ref]$Bytes
    )

    $Bytes.Value = $null
    if ($DeclaredLength -lt 0 -or $DeclaredLength -gt $Limit) {
        return $false
    }

    $memory = New-Object System.IO.MemoryStream
    try {
        $buffer = New-Object byte[] 81920
        $total = [long]0
        while (($read = $Stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $total += $read
            if ($total -gt $Limit) {
                return $false
            }
            $memory.Write($buffer, 0, $read)
        }
        if ($DeclaredLength -ge 0 -and $total -ne $DeclaredLength) {
            return $false
        }
        $Bytes.Value = $memory.ToArray()
        return $true
    } finally {
        $memory.Dispose()
    }
}

function Get-ArchiveEntryChain {
    param(
        [AllowNull()][string]$ParentChain,
        [string]$EntryName
    )

    if ([string]::IsNullOrEmpty($ParentChain)) {
        return $EntryName
    }
    return $ParentChain + '!/' + $EntryName
}

function Scan-ZipArchive {
    param(
        [System.IO.Compression.ZipArchive]$Archive,
        [string]$RelativePath,
        [AllowNull()][string]$ParentChain,
        [int]$Depth
    )

    if ($script:ArchiveLimitHit) {
        return
    }
    if ($Depth -gt $MaxArchiveDepth) {
        Add-ScanError 'ARCHIVE_DEPTH_LIMIT' $RelativePath $ParentChain
        return
    }

    $script:Stats.archivesScanned = [int]$script:Stats.archivesScanned + 1
    $entries = @($Archive.Entries | Sort-Object -Property FullName)
    foreach ($entry in $entries) {
        $script:Stats.archiveEntriesInspected = [int]$script:Stats.archiveEntriesInspected + 1
        if ($script:Stats.archiveEntriesInspected -gt $MaxArchiveEntries) {
            Add-ScanError 'ARCHIVE_ENTRY_COUNT_LIMIT' $RelativePath $ParentChain
            $script:ArchiveLimitHit = $true
            return
        }

        $entryChain = Get-ArchiveEntryChain $ParentChain $entry.FullName
        Scan-TextValue $entry.FullName $RelativePath $entryChain $true

        $isDirectory = $entry.FullName.EndsWith('/') -or $entry.FullName.EndsWith('\')
        if ($isDirectory) {
            continue
        }

        $script:Stats.bytesDeclaredInArchiveEntries = [long]$script:Stats.bytesDeclaredInArchiveEntries + [long]$entry.Length
        if ($script:Stats.bytesDeclaredInArchiveEntries -gt $MaxArchiveTotalBytes) {
            Add-ScanError 'ARCHIVE_TOTAL_SIZE_LIMIT' $RelativePath $entryChain
            $script:ArchiveLimitHit = $true
            return
        }

        if ($entry.Length -gt 1048576 -and $entry.CompressedLength -gt 0) {
            $compressionRatio = $entry.Length / [double]$entry.CompressedLength
            if ($compressionRatio -gt 500) {
                Add-ScanError 'ARCHIVE_COMPRESSION_RATIO_LIMIT' $RelativePath $entryChain
                continue
            }
        }

        $entryLimit = if (Test-ArchiveName $entry.FullName) { $MaxArchiveEntryBytes } else { $MaxTextBytes }
        if ($entry.Length -gt $entryLimit) {
            Add-ScanError 'ARCHIVE_ENTRY_SIZE_LIMIT' $RelativePath $entryChain
            continue
        }

        $entryStream = $null
        try {
            $entryStream = $entry.Open()
            $entryBytes = $null
            if (-not (Try-ReadStreamBytes $entryStream ([long]$entry.Length) $entryLimit ([ref]$entryBytes))) {
                Add-ScanError 'ARCHIVE_ENTRY_READ_LIMIT_OR_LENGTH_MISMATCH' $RelativePath $entryChain
                continue
            }
        } catch {
            Add-ScanError 'ARCHIVE_ENTRY_READ_FAILED' $RelativePath $entryChain
            continue
        } finally {
            if ($null -ne $entryStream) {
                $entryStream.Dispose()
            }
        }

        if (Test-ArchiveName $entry.FullName) {
            if (($Depth + 1) -gt $MaxArchiveDepth) {
                Add-ScanError 'ARCHIVE_DEPTH_LIMIT' $RelativePath $entryChain
                continue
            }

            $memory = $null
            $nestedArchive = $null
            try {
                $memory = [System.IO.MemoryStream]::new($entryBytes, $false)
                $nestedArchive = [System.IO.Compression.ZipArchive]::new(
                    $memory,
                    [System.IO.Compression.ZipArchiveMode]::Read,
                    $true
                )
                Scan-ZipArchive $nestedArchive $RelativePath $entryChain ($Depth + 1)
            } catch {
                Add-ScanError 'NESTED_ARCHIVE_OPEN_OR_SCAN_FAILED' $RelativePath $entryChain
            } finally {
                if ($null -ne $nestedArchive) { $nestedArchive.Dispose() }
                if ($null -ne $memory) { $memory.Dispose() }
            }
            continue
        }

        $decodedText = $null
        if (Try-DecodeReadableText $entryBytes $entry.FullName ([ref]$decodedText)) {
            Scan-TextValue $decodedText $RelativePath $entryChain $false
        } else {
            $script:Stats.binaryUnitsSkipped = [int]$script:Stats.binaryUnitsSkipped + 1
        }
    }
}

function Scan-ArchiveFile {
    param(
        [string]$FullPath,
        [string]$RelativePath
    )

    $archive = $null
    try {
        $archive = [System.IO.Compression.ZipFile]::OpenRead($FullPath)
        Scan-ZipArchive $archive $RelativePath $null 0
    } catch {
        Add-ScanError 'ARCHIVE_OPEN_OR_SCAN_FAILED' $RelativePath $null
    } finally {
        if ($null -ne $archive) {
            $archive.Dispose()
        }
    }
}

function Scan-PlainFile {
    param(
        [string]$FullPath,
        [string]$RelativePath,
        [long]$Length
    )

    if ($Length -gt $MaxTextBytes) {
        Add-ScanError 'FILE_SIZE_LIMIT' $RelativePath $null
        return
    }

    try {
        $bytes = [System.IO.File]::ReadAllBytes($FullPath)
    } catch {
        Add-ScanError 'FILE_READ_FAILED' $RelativePath $null
        return
    }

    $decodedText = $null
    if (Try-DecodeReadableText $bytes $FullPath ([ref]$decodedText)) {
        Scan-TextValue $decodedText $RelativePath $null $false
    } else {
        $script:Stats.binaryUnitsSkipped = [int]$script:Stats.binaryUnitsSkipped + 1
    }
}

function Get-FileSha256 {
    param([string]$FullPath)

    $stream = $null
    $sha = $null
    try {
        $stream = [System.IO.File]::Open($FullPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
        $sha = [System.Security.Cryptography.SHA256]::Create()
        return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    } finally {
        if ($null -ne $sha) { $sha.Dispose() }
        if ($null -ne $stream) { $stream.Dispose() }
    }
}

function Get-StringSha256 {
    param([string]$Value)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Get-RelativeFilePath {
    param(
        [string]$RootPath,
        [string]$FullPath
    )

    $prefix = $RootPath.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    if (-not $FullPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        return $null
    }
    return $FullPath.Substring($prefix.Length).Replace('\', '/')
}

function Resolve-InputRoot {
    param(
        [string]$Label,
        [AllowNull()][string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        Add-ScanError 'INPUT_PATH_MISSING' $Label $null
        return $null
    }

    try {
        $resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
        if ($resolved.Provider.Name -ne 'FileSystem') {
            Add-ScanError 'INPUT_NOT_FILESYSTEM' $Label $null
            return $null
        }
        $item = Get-Item -LiteralPath $resolved.Path -Force -ErrorAction Stop
        if (-not $item.PSIsContainer) {
            Add-ScanError 'INPUT_NOT_DIRECTORY' $Label $null
            return $null
        }
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            Add-ScanError 'INPUT_REPARSE_POINT_NOT_ALLOWED' $Label $null
            return $null
        }
        return [System.IO.Path]::GetFullPath($item.FullName).TrimEnd('\', '/')
    } catch {
        Add-ScanError 'INPUT_PATH_UNAVAILABLE' $Label $null
        return $null
    }
}

function Scan-InputRoot {
    param(
        [string]$Label,
        [string]$RootPath
    )

    $script:Stats.inputRootsAccepted = [int]$script:Stats.inputRootsAccepted + 1
    try {
        $items = @(Get-ChildItem -LiteralPath $RootPath -Force -Recurse -ErrorAction Stop)
    } catch {
        Add-ScanError 'INPUT_ENUMERATION_FAILED' $Label $null
        return
    }

    foreach ($reparseItem in @($items | Where-Object { ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 })) {
        $reparseRelative = Get-RelativeFilePath $RootPath $reparseItem.FullName
        if ($null -eq $reparseRelative) { $reparseRelative = '[OUTSIDE-ROOT]' }
        Add-ScanError 'REPARSE_POINT_NOT_ALLOWED' ($Label + '/' + $reparseRelative) $null
    }

    $filePaths = @($items | Where-Object { -not $_.PSIsContainer -and ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0 } | ForEach-Object { $_.FullName })
    [Array]::Sort($filePaths, [StringComparer]::Ordinal)
    if ($filePaths.Count -eq 0) {
        Add-ScanError 'INPUT_ROOT_EMPTY' $Label $null
        return
    }

    foreach ($fullPath in $filePaths) {
        $relative = Get-RelativeFilePath $RootPath $fullPath
        if ($null -eq $relative) {
            Add-ScanError 'FILE_OUTSIDE_INPUT_ROOT' $Label $null
            continue
        }

        $displayPath = $Label + '/' + $relative
        $script:Stats.filesScanned = [int]$script:Stats.filesScanned + 1
        Scan-TextValue $displayPath $displayPath $null $true

        try {
            $before = Get-Item -LiteralPath $fullPath -Force -ErrorAction Stop
            $beforeLength = [long]$before.Length
            $beforeTicks = [long]$before.LastWriteTimeUtc.Ticks
        } catch {
            Add-ScanError 'FILE_METADATA_READ_FAILED' $displayPath $null
            continue
        }

        if (Test-ArchiveName $fullPath) {
            Scan-ArchiveFile $fullPath $displayPath
        } else {
            Scan-PlainFile $fullPath $displayPath $beforeLength
        }

        try {
            $fileSha256 = Get-FileSha256 $fullPath
            $after = Get-Item -LiteralPath $fullPath -Force -ErrorAction Stop
            if ([long]$after.Length -ne $beforeLength -or [long]$after.LastWriteTimeUtc.Ticks -ne $beforeTicks) {
                Add-ScanError 'INPUT_CHANGED_DURING_SCAN' $displayPath $null
                continue
            }
            $encodedRelative = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($displayPath))
            [void]$script:FingerprintLines.Add($encodedRelative + '|' + $beforeLength + '|' + $fileSha256)
        } catch {
            Add-ScanError 'FILE_HASH_FAILED' $displayPath $null
        }
    }
}

function Convert-MapToSortedArray {
    param(
        [hashtable]$Map,
        [string[]]$Properties
    )

    if ($Map.Count -eq 0) {
        return @()
    }
    return @($Map.Values | Sort-Object -Property $Properties)
}

function Write-ScannerResult {
    param(
        $Result,
        [string]$Format
    )

    if ($Format -eq 'Text') {
        Write-Output ("STATUS={0}" -f $Result.status)
        Write-Output ("DECISION={0}" -f $Result.decision)
        Write-Output ("FILES_SCANNED={0}" -f $Result.summary.filesScanned)
        Write-Output ("FINDING_GROUPS={0}" -f $Result.summary.findingGroups)
        Write-Output ("MATCH_COUNT={0}" -f $Result.summary.matchCount)
        Write-Output ("ERROR_GROUPS={0}" -f $Result.summary.errorGroups)
        foreach ($finding in $Result.findings) {
            Write-Output ("FINDING rule={0} path={1} entry={2} count={3}" -f $finding.ruleId, $finding.relativePath, $finding.archiveEntry, $finding.count)
        }
        foreach ($scanError in $Result.errors) {
            Write-Output ("ERROR code={0} path={1} entry={2} count={3}" -f $scanError.code, $scanError.relativePath, $scanError.archiveEntry, $scanError.count)
        }
        return
    }

    Write-Output ($Result | ConvertTo-Json -Depth 8 -Compress)
}

function New-FatalResult {
    param([string]$Code)

    return [pscustomobject][ordered]@{
        schemaVersion = 1
        scannerVersion = '1.0.0'
        status = 'BLOCKED'
        decision = 'SCAN_INCOMPLETE'
        inputSetSha256 = $null
        summary = [pscustomobject][ordered]@{
            inputRootsAccepted = 0
            filesScanned = 0
            archivesScanned = 0
            archiveEntriesInspected = 0
            readableTextUnitsScanned = 0
            namesScanned = 0
            binaryUnitsSkipped = 0
            bytesDeclaredInArchiveEntries = 0
            findingGroups = 0
            matchCount = 0
            errorGroups = 1
            errorCount = 1
        }
        findings = @()
        errors = @([pscustomobject][ordered]@{ code = $Code; relativePath = $null; archiveEntry = $null; count = 1 })
        safeguards = [pscustomobject][ordered]@{
            readOnly = $true
            matchedValuesIncluded = $false
            matchedTextIncluded = $false
            failClosed = $true
        }
    }
}

$exitCode = 3
$script:Phase = 'START'
try {
    $script:Phase = 'VALIDATE_PARAMETERS'
    if ($OutputFormat -notin @('Json', 'Text')) {
        $fatal = New-FatalResult 'OUTPUT_FORMAT_INVALID'
        Write-ScannerResult $fatal 'Json'
        exit 3
    }
    if ($MaxTextBytes -lt 1024 -or $MaxArchiveEntryBytes -lt 1024 -or $MaxArchiveTotalBytes -lt 1024 -or $MaxArchiveEntries -lt 1 -or $MaxArchiveDepth -lt 0) {
        $fatal = New-FatalResult 'SCAN_LIMIT_INVALID'
        Write-ScannerResult $fatal $OutputFormat
        exit 3
    }

    $script:Phase = 'LOAD_COMPRESSION'
    Add-Type -AssemblyName System.IO.Compression -ErrorAction Stop
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop

    $script:Phase = 'INITIALIZE_RULES'
    $script:Rules = @(
        New-DetectionRule 'COMPACT_JWT' '(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{3,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}(?![A-Za-z0-9_-])'
        New-DetectionRule 'BEARER_CREDENTIAL' '\bBearer[ \t]+[A-Za-z0-9._~+/=-]{8,}' $true
        New-DetectionRule 'PRIVATE_KEY_PEM' '-----BEGIN[ \t]+(?:(?:RSA|EC|DSA|OPENSSH|PGP|ENCRYPTED)[ \t]+)?PRIVATE[ \t]+KEY-----' $true
        New-DetectionRule 'AWS_ACCESS_KEY_ID' '(?<![A-Z0-9])(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}(?![A-Z0-9])'
        New-DetectionRule 'AWS_SECRET_ACCESS_KEY_ASSIGNMENT' '\b(?:AWS_SECRET_ACCESS_KEY|awsSecretAccessKey)\b\s*(?:=|:)\s*["'']?[A-Za-z0-9/+=]{32,}' $true
        New-DetectionRule 'GITHUB_TOKEN' '(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255})(?![A-Za-z0-9_])'
        New-DetectionRule 'GITLAB_TOKEN' '(?<![A-Za-z0-9_-])glpat-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])'
        New-DetectionRule 'SLACK_TOKEN' '(?<![A-Za-z0-9-])xox[baprs]-[A-Za-z0-9-]{10,}(?![A-Za-z0-9-])'
        New-DetectionRule 'SLACK_WEBHOOK' 'https://hooks\.slack\.com/services/[A-Z0-9]{6,}/[A-Z0-9]{6,}/[A-Za-z0-9]{16,}' $true
        New-DetectionRule 'OPENAI_API_KEY' '(?<![A-Za-z0-9_-])sk-(?:(?:proj|svcacct)-)?[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])'
        New-DetectionRule 'STRIPE_LIVE_KEY' '(?<![A-Za-z0-9_])(?:sk|rk)_live_[A-Za-z0-9]{16,}(?![A-Za-z0-9_])'
        New-DetectionRule 'GOOGLE_API_KEY' '(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])'
        New-DetectionRule 'NPM_TOKEN' '(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{36}(?![A-Za-z0-9_])'
        New-DetectionRule 'PASSWORD_ASSIGNMENT' '(?:^|[\s,;{])["'']?(?:password|passwd|pwd|db_password|database_password)["'']?\s*(?:=|:)\s*(?!(?:["'']|\s)*(?:null|none|pending|redacted|masked|changeme|example|\*{3,}|\$\{|\{\{))(?:(?:"[^"\r\n]{4,}")|(?:''[^''\r\n]{4,}'')|(?:[^\s,;}\]]{4,}))' $true
    )

    $script:KnownTextExtensions = @{}
    @(
        '.txt', '.json', '.jsonl', '.yaml', '.yml', '.xml', '.md', '.csv', '.tsv', '.log',
        '.properties', '.conf', '.config', '.env', '.ini', '.sql', '.html', '.htm', '.css', '.scss',
        '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.java', '.kt', '.kts', '.gradle', '.groovy',
        '.sh', '.bash', '.zsh', '.ps1', '.psm1', '.psd1', '.cmd', '.bat', '.toml', '.lock', '.pem',
        '.key', '.crt', '.cer', '.graphql', '.gql', '.mf', '.service', '.factory', '.providers', '.idx'
    ) | ForEach-Object { $script:KnownTextExtensions[$_] = $true }
    $script:KnownTextLeafNames = @{}
    @('dockerfile', 'makefile', 'procfile', '.env', '.npmrc', '.pypirc', 'gradlew') | ForEach-Object {
        $script:KnownTextLeafNames[$_] = $true
    }

    $script:Phase = 'INITIALIZE_STATE'
    Initialize-ScannerState

    $script:Phase = 'RESOLVE_INPUT_ROOTS'
    $rootInputs = @(
        [pscustomobject][ordered]@{ Label = 'rc-evidence'; Path = $RcEvidencePath },
        [pscustomobject][ordered]@{ Label = 'release-artifact-1'; Path = $ReleaseArtifactPath1 },
        [pscustomobject][ordered]@{ Label = 'release-artifact-2'; Path = $ReleaseArtifactPath2 }
    )
    $resolvedRoots = New-Object 'System.Collections.Generic.List[object]'
    foreach ($rootInput in $rootInputs) {
        $resolvedPath = Resolve-InputRoot $rootInput.Label $rootInput.Path
        if ($null -ne $resolvedPath) {
            [void]$resolvedRoots.Add([pscustomobject][ordered]@{ Label = $rootInput.Label; Path = $resolvedPath })
        }
    }

    $script:Phase = 'SCAN_INPUT_ROOTS'
    $seenRoots = @{}
    foreach ($root in $resolvedRoots) {
        $rootKey = $root.Path.ToLowerInvariant()
        if ($seenRoots.ContainsKey($rootKey)) {
            Add-ScanError 'DUPLICATE_INPUT_ROOT' $root.Label $null
            continue
        }
        $seenRoots[$rootKey] = $true
        Scan-InputRoot $root.Label $root.Path
    }

    $script:Phase = 'BUILD_FINDINGS'
    $findings = @(Convert-MapToSortedArray $script:FindingMap @('ruleId', 'relativePath', 'archiveEntry'))
    $script:Phase = 'BUILD_ERRORS'
    $scanErrors = @(Convert-MapToSortedArray $script:ErrorMap @('code', 'relativePath', 'archiveEntry'))
    $script:Phase = 'COUNT_RESULTS'
    $matchCount = [int]0
    foreach ($finding in $findings) { $matchCount += [int]$finding.count }
    $errorCount = [int]0
    foreach ($scanError in $scanErrors) { $errorCount += [int]$scanError.count }

    $script:Phase = 'BUILD_FINGERPRINT'
    $inputFingerprint = $null
    if ($scanErrors.Count -eq 0 -and $script:FingerprintLines.Count -gt 0) {
        $inputFingerprint = Get-StringSha256 (($script:FingerprintLines.ToArray()) -join "`n")
    }

    $script:Phase = 'DECIDE_STATUS'
    if ($scanErrors.Count -gt 0 -and $findings.Count -gt 0) {
        $status = 'BLOCKED'
        $decision = 'SCAN_INCOMPLETE_AND_SENSITIVE_DATA_DETECTED'
        $exitCode = 3
    } elseif ($scanErrors.Count -gt 0) {
        $status = 'BLOCKED'
        $decision = 'SCAN_INCOMPLETE'
        $exitCode = 3
    } elseif ($findings.Count -gt 0) {
        $status = 'BLOCKED'
        $decision = 'SENSITIVE_DATA_DETECTED'
        $exitCode = 2
    } else {
        $status = 'PASS'
        $decision = 'CLEAN'
        $exitCode = 0
    }

    $script:Phase = 'CREATE_RESULT_OBJECT'
    $result = [pscustomobject][ordered]@{
        schemaVersion = 1
        scannerVersion = '1.0.0'
        status = $status
        decision = $decision
        inputSetSha256 = $inputFingerprint
        policy = [pscustomobject][ordered]@{
            rootAliases = @('rc-evidence', 'release-artifact-1', 'release-artifact-2')
            ruleIds = @($script:Rules.Id | Sort-Object)
            maxTextBytes = $MaxTextBytes
            maxArchiveEntryBytes = $MaxArchiveEntryBytes
            maxArchiveTotalBytes = $MaxArchiveTotalBytes
            maxArchiveEntries = $MaxArchiveEntries
            maxArchiveDepth = $MaxArchiveDepth
        }
        summary = [pscustomobject][ordered]@{
            inputRootsAccepted = $script:Stats.inputRootsAccepted
            filesScanned = $script:Stats.filesScanned
            archivesScanned = $script:Stats.archivesScanned
            archiveEntriesInspected = $script:Stats.archiveEntriesInspected
            readableTextUnitsScanned = $script:Stats.readableTextUnitsScanned
            namesScanned = $script:Stats.namesScanned
            binaryUnitsSkipped = $script:Stats.binaryUnitsSkipped
            bytesDeclaredInArchiveEntries = $script:Stats.bytesDeclaredInArchiveEntries
            findingGroups = $findings.Count
            matchCount = $matchCount
            errorGroups = $scanErrors.Count
            errorCount = $errorCount
        }
        findings = $findings
        errors = $scanErrors
        safeguards = [pscustomobject][ordered]@{
            readOnly = $true
            matchedValuesIncluded = $false
            matchedTextIncluded = $false
            absoluteInputPathsIncluded = $false
            failClosed = $true
        }
    }

    $script:Phase = 'WRITE_RESULT'
    Write-ScannerResult $result $OutputFormat
} catch {
    $safeExceptionType = $_.Exception.GetType().Name -replace '[^A-Za-z0-9_]', '_'
    $safePhase = $script:Phase -replace '[^A-Za-z0-9_]', '_'
    $fallback = New-FatalResult ('UNHANDLED_SCAN_ERROR_' + $safePhase + '_' + $safeExceptionType)
    Write-ScannerResult $fallback 'Json'
    $exitCode = 3
}

exit $exitCode
