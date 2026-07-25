[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PostgresBin,
    [string]$MavenExecutable,
    [string]$JavaHome,
    [string]$MavenRepository
)

$ErrorActionPreference = 'Stop'

function Read-SingleUserSql {
    param([Parameter(Mandatory = $true)][string]$File)
    return ((Get-Content -LiteralPath $File -Encoding UTF8) |
        Where-Object { $_ -notmatch '^\s*(--|\\)' } |
        ForEach-Object { $_.Trim() }) -join ' '
}

function Read-ParameterizedSingleUserSql {
    param(
        [Parameter(Mandatory = $true)][string]$File,
        [Parameter(Mandatory = $true)][hashtable]$Variables
    )
    $sql = Read-SingleUserSql -File $File
    foreach ($name in $Variables.Keys) {
        $value = [string]$Variables[$name]
        $quotedValue = "'" + $value.Replace("'", "''") + "'"
        $sql = $sql.Replace(":'$name'", $quotedValue)
    }
    if ($sql -match ":'[A-Za-z_][A-Za-z0-9_]*'") {
        throw "Unresolved psql variable in single-user SQL: $File"
    }
    return $sql
}

function Invoke-SingleUserSql {
    param([Parameter(Mandatory = $true)][string]$Sql)
    $output = $Sql | & $script:Postgres --single -D $script:DataDirectory postgres 2>&1
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Output $_ }
    if ($exitCode -ne 0 -or ($output -join "`n") -match '(?m)\b(ERROR|FATAL|PANIC):') {
        throw 'PostgreSQL single-user catalog verification failed'
    }
}

$migrationDirectory = Split-Path -Parent $PSCommandPath
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $migrationDirectory '..\..'))
$resolvedBin = [System.IO.Path]::GetFullPath($PostgresBin)
$initdb = Join-Path $resolvedBin 'initdb.exe'
$pgCtl = Join-Path $resolvedBin 'pg_ctl.exe'
$script:Postgres = Join-Path $resolvedBin 'postgres.exe'

if (-not $MavenExecutable) {
    $MavenExecutable = Join-Path $repositoryRoot '.tooling\maven\apache-maven-3.9.9\bin\mvn.cmd'
}
if (-not $JavaHome) {
    $JavaHome = Join-Path $repositoryRoot '.tooling\jdk\jdk-21.0.11+10'
}
if (-not $MavenRepository) {
    $MavenRepository = Join-Path $repositoryRoot '.tooling\m2'
}

foreach ($file in @(
    $initdb,
    $pgCtl,
    $script:Postgres,
    $MavenExecutable
)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw "Required executable not found: $file"
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin\java.exe') -PathType Leaf)) {
    throw "Java 21 runtime not found: $JavaHome"
}

$catalogVerifier = Join-Path $migrationDirectory 'verify-postgresql.sql'
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$temporaryCluster = [System.IO.Path]::GetFullPath(
    [System.IO.Path]::Combine($tempRoot, 'ota-s0-pg-' + [guid]::NewGuid().ToString('N')))
$script:DataDirectory = Join-Path $temporaryCluster 'data'

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$script:Port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()

New-Item -ItemType Directory -Path $temporaryCluster -Force | Out-Null
$started = $false
$previousMavenOpts = $env:MAVEN_OPTS
$resolvedMavenRepository = [System.IO.Path]::GetFullPath($MavenRepository)
$mavenRepositoryOption = "-Dmaven.repo.local=`"$resolvedMavenRepository`""
$env:MAVEN_OPTS = if ([string]::IsNullOrWhiteSpace($previousMavenOpts)) {
    $mavenRepositoryOption
} else {
    "$previousMavenOpts $mavenRepositoryOption"
}
try {
    & $initdb -D $script:DataDirectory -U postgres -A trust --no-locale -E UTF8
    if ($LASTEXITCODE -ne 0) {
        throw 'initdb failed'
    }

    $migrationUsername = 'ota_it_migration_owner'
    $migrationPassword = 'disposable-migration-owner'
    Invoke-SingleUserSql -Sql (
        "CREATE ROLE $migrationUsername WITH LOGIN PASSWORD " +
        "'$migrationPassword' NOSUPERUSER NOCREATEDB NOCREATEROLE " +
        "NOINHERIT NOREPLICATION NOBYPASSRLS; " +
        "REVOKE CREATE, TEMPORARY ON DATABASE postgres FROM PUBLIC; " +
        "REVOKE CREATE ON SCHEMA public FROM PUBLIC; " +
        "GRANT CONNECT, CREATE, TEMPORARY ON DATABASE postgres TO " +
        "$migrationUsername;"
    )

    & $pgCtl -D $script:DataDirectory -l (Join-Path $temporaryCluster 'postgres.log') `
        -o "-p $script:Port -h 127.0.0.1" -w start
    if ($LASTEXITCODE -ne 0) {
        throw 'temporary PostgreSQL startup failed'
    }
    $started = $true

    $env:JAVA_HOME = [System.IO.Path]::GetFullPath($JavaHome)
    $env:OTA_POSTGRES_IT_CONFIRM = 'isolated-database'
    $env:OTA_POSTGRES_IT_ADMIN_URL = "jdbc:postgresql://127.0.0.1:$script:Port/postgres"
    $env:OTA_POSTGRES_IT_ADMIN_USERNAME = 'postgres'
    $env:OTA_POSTGRES_IT_REPOSITORY_ROOT = $repositoryRoot
    # The disposable cluster uses loopback-only trust auth. This non-secret value only satisfies
    # the integration-test contract and is never used outside the temporary process.
    $env:OTA_POSTGRES_IT_ADMIN_PASSWORD = 'disposable-trust-cluster'
    $env:OTA_POSTGRES_IT_MIGRATION_URL =
        "jdbc:postgresql://127.0.0.1:$script:Port/postgres"
    $env:OTA_POSTGRES_IT_MIGRATION_USERNAME = $migrationUsername
    $env:OTA_POSTGRES_IT_MIGRATION_PASSWORD = $migrationPassword

    & $MavenExecutable -f (Join-Path $repositoryRoot 'ota-platform-pom.xml') `
        -o `
        -pl apps/ota-connector-worker -am `
        '-Dtest=PostgresSecurityIntegrationTest,Sprint1RealPostgresClosedLoopIntegrationTest' `
        '-Dsurefire.failIfNoSpecifiedTests=false' test
    if ($LASTEXITCODE -ne 0) {
        throw 'real PostgreSQL security and API-Worker-API closed-loop integration tests failed'
    }

    $jshell = Join-Path $JavaHome 'bin\jshell.exe'
    $postgresJdbcDriver = Join-Path `
        $resolvedMavenRepository `
        'org\postgresql\postgresql\42.7.7\postgresql-42.7.7.jar'
    $concurrencySetup = Join-Path `
        $migrationDirectory 'verify-sprint2d-concurrency-setup.sql'
    $concurrencyVerifier = Join-Path `
        $migrationDirectory 'verify-sprint2d-concurrency.jsh'
    foreach ($file in @(
        $jshell,
        $postgresJdbcDriver,
        $concurrencySetup,
        $concurrencyVerifier
    )) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            throw "Sprint 2D concurrency verifier is missing: $file"
        }
    }

    $env:OTA_SPRINT2D_CONCURRENCY_JDBC_URL =
        "jdbc:postgresql://127.0.0.1:$script:Port/postgres"
    $env:OTA_SPRINT2D_CONCURRENCY_USERNAME = $migrationUsername
    $env:OTA_SPRINT2D_CONCURRENCY_PASSWORD = $migrationPassword
    $env:OTA_SPRINT2D_CONCURRENCY_SETUP = $concurrencySetup
    & $jshell --class-path $postgresJdbcDriver $concurrencyVerifier
    if ($LASTEXITCODE -ne 0) {
        throw 'Sprint 2D concurrent predecessor CAS verification failed'
    }

    $verificationApiRole = 'ota_it_acl_verify_api'
    $verificationWorkerRole = 'ota_it_acl_verify_worker_green'
    $verificationAuditRole = 'ota_it_acl_verify_audit'
    $verificationPrincipalId = '29000000-0000-4000-8000-000000000001'
    $roleSql = (
        "CREATE ROLE $verificationApiRole LOGIN NOSUPERUSER NOCREATEDB " +
        "NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS; " +
        "CREATE ROLE $verificationWorkerRole LOGIN NOSUPERUSER NOCREATEDB " +
        "NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS; " +
        "CREATE ROLE $verificationAuditRole LOGIN NOSUPERUSER NOCREATEDB " +
        "NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;"
    )
    $principalSql = (
        "INSERT INTO control.service_principal(" +
        "service_principal_id, principal_code, purpose, status) VALUES (" +
        "'$verificationPrincipalId', 'OTA_RUNTIME_ACL_VERIFY_GREEN', " +
        "'CONNECTOR_WORKER', 'ACTIVE');"
    )
    $grantScript = Join-Path $migrationDirectory 'post-migration-grants.sql'
    $runtimeGrantVerifier = Join-Path $migrationDirectory 'verify-runtime-grants.sql'
    $runtimeVariables = @{
        api_role = $verificationApiRole
        worker_role = $verificationWorkerRole
        audit_role = $verificationAuditRole
        worker_service_principal_id = $verificationPrincipalId
        worker_slot = 'GREEN'
    }
    $grantSql = Read-ParameterizedSingleUserSql `
        -File $grantScript -Variables $runtimeVariables
    $runtimeVerifierSql = Read-ParameterizedSingleUserSql `
        -File $runtimeGrantVerifier -Variables $runtimeVariables

    & $pgCtl -D $script:DataDirectory -m fast -w stop
    if ($LASTEXITCODE -ne 0) {
        throw 'temporary PostgreSQL shutdown failed'
    }
    $started = $false

    Invoke-SingleUserSql -Sql $roleSql
    Invoke-SingleUserSql -Sql (
        "SET SESSION AUTHORIZATION $migrationUsername; " +
        $principalSql +
        $grantSql +
        " RESET SESSION AUTHORIZATION;"
    )
    Invoke-SingleUserSql -Sql (
        "SET SESSION AUTHORIZATION $migrationUsername; " +
        $runtimeVerifierSql +
        " RESET SESSION AUTHORIZATION;"
    )
    Invoke-SingleUserSql -Sql (Read-SingleUserSql -File $catalogVerifier)
    Write-Output (
        'PASS: Flyway V1 through V6 under a LOGIN/NOSUPERUSER/NOINHERIT/NOBYPASSRLS migration owner, ' +
        'real API-Worker-API simulation closed loop, ' +
        'non-owner runtime-role safety and DELIVERY_BLOCKED/no-external-delivery proof, ' +
        'Sprint 2C contract governance, database-clock leases, blue/green OID+name rotation gates, ' +
        'READ COMMITTED and membership isolation, tenant-by-tenant FORCE-RLS dispatch, message delivery freeze, ' +
        'wrong-principal rejection, exact-minute ordinary/per-simulation slot idempotency, ' +
        'non-owner NOBYPASSRLS isolation, append-only audit behavior, and ' +
        'Sprint 2D offline manual authorization rehearsal controls and ' +
        'concurrent predecessor CAS verified.')
}
finally {
    Remove-Item Env:OTA_SPRINT2D_CONCURRENCY_JDBC_URL `
        -ErrorAction SilentlyContinue
    Remove-Item Env:OTA_SPRINT2D_CONCURRENCY_USERNAME `
        -ErrorAction SilentlyContinue
    Remove-Item Env:OTA_SPRINT2D_CONCURRENCY_PASSWORD `
        -ErrorAction SilentlyContinue
    Remove-Item Env:OTA_SPRINT2D_CONCURRENCY_SETUP `
        -ErrorAction SilentlyContinue
    if ($null -eq $previousMavenOpts) {
        Remove-Item Env:MAVEN_OPTS -ErrorAction SilentlyContinue
    } else {
        $env:MAVEN_OPTS = $previousMavenOpts
    }
    if ($started) {
        & $pgCtl -D $script:DataDirectory -m fast -w stop
    }
    $resolvedTemporaryCluster = [System.IO.Path]::GetFullPath($temporaryCluster)
    $safeName = (Split-Path $resolvedTemporaryCluster -Leaf).StartsWith('ota-s0-pg-')
    if (-not ($resolvedTemporaryCluster.StartsWith(
                $tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and $safeName)) {
        throw 'temporary PostgreSQL cleanup path safety check failed'
    }
    if (Test-Path -LiteralPath $resolvedTemporaryCluster) {
        Remove-Item -LiteralPath $resolvedTemporaryCluster -Recurse -Force
    }
}
