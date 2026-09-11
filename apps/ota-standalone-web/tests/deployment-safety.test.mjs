import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  defaultYilianReportSourcesForMigration,
  verifyYilianSourceContractMigration,
} from '../../../infra/ota-standalone-server/scripts/verify-yilian-source-contract-migration.mjs'

const publishSource = await readFile(
  new URL(
    '../../../infra/ota-standalone-server/scripts/Publish-OtaStandaloneServer.ps1',
    import.meta.url,
  ),
  'utf8',
)
const deploySource = await readFile(
  new URL(
    '../../../infra/ota-standalone-server/scripts/deploy-native.sh',
    import.meta.url,
  ),
  'utf8',
)
const reviewApiSource = await readFile(
  new URL('../../../tools/uat/ota-standalone-review-api.mjs', import.meta.url),
  'utf8',
)
const verifierSource = await readFile(
  new URL(
    '../../../infra/ota-standalone-server/scripts/verify-yilian-source-contract-migration.mjs',
    import.meta.url,
  ),
  'utf8',
)

const hotelId = '01500000-0000-4000-8000-000000000015'
const otherYilianHotelId = '01600000-0000-4000-8000-000000000016'
const tenantId = '00100000-0000-4000-8000-000000000001'
const hotels = [
  {
    tenantId,
    hotelId,
    tenantCode: '001',
    tenantName: '四方馆酒店经营中心',
    hotelCode: '015',
    hotelName: '015 测试门店',
    ownershipType: 'DIRECT',
    pmsSystemCode: 'YILIAN_CLOUD',
    pmsSystemName: '驿联云 PMS',
    timezone: 'Asia/Shanghai',
    lifecycleStatus: 'PILOT',
    collectionEnabled: false,
    messageEnabled: false,
    configuredMockConnectors: 0,
    simulationOnly: true,
    rowVersion: 1,
  },
]
const failedStatus = {
  state: 'FAILED',
  trigger: 'MANUAL_REPAIR',
  lastAttemptAt: '2026-09-11T03:00:00.000Z',
  lastValidatedAt: null,
  lastSucceededAt: null,
  lastBusinessDate: null,
  lastErrorCode: 'YILIAN_SOURCE_CONTRACT_INVALID',
  sourceCount: 0,
  successfulSourceCount: 0,
  outboundDeliveryAttempted: false,
}
const migratedStatus = {
  ...failedStatus,
  state: 'IDLE',
  trigger: 'STARTUP_SOURCE_CONTRACT_MIGRATION',
  lastAttemptAt: null,
  lastErrorCode: null,
  sourceCount: 3,
  successfulSourceCount: 0,
}
const intentionallyUnconfiguredStatus = {
  ...failedStatus,
  state: 'IDLE',
  trigger: 'SOURCE_CONFIG_UPDATED',
  lastAttemptAt: null,
  lastErrorCode: null,
}

const exactMigration = ({
  beforeReportSourcesText = JSON.stringify({ [hotelId]: [] }),
  beforeRepairStatusesText = JSON.stringify({ [hotelId]: failedStatus }),
  afterReportSources = {
    [hotelId]: defaultYilianReportSourcesForMigration(),
  },
  afterRepairStatuses = { [hotelId]: migratedStatus },
  configuredPmsHotelIds = new Set(),
} = {}) => verifyYilianSourceContractMigration({
  beforeReportSourcesText,
  beforeRepairStatusesText,
  afterReportSources,
  afterRepairStatuses,
  hotels,
  configuredPmsHotelIds,
})

test('publisher rejects tracked and untracked changes and runs both test roots', () => {
  assert.match(publishSource, /status --porcelain\r?\n/u)
  assert.doesNotMatch(publishSource, /--untracked-files=no/u)
  assert.match(publishSource, /WORKTREE_NOT_CLEAN/u)
  assert.match(publishSource, /Join-Path \$webRoot 'tests'/u)
  assert.match(publishSource, /tools\\uat\\wecom\\tests/u)
  assert.match(publishSource, /foreach \(\$testRoot in \$testRoots\)/u)
})

test('publisher requires a pre-pinned SSH host key for every remote transport', () => {
  assert.doesNotMatch(publishSource, /StrictHostKeyChecking=accept-new/u)
  assert.match(publishSource, /SSH_REMOTE_HOST_KEY_NOT_PINNED/u)
  assert.match(publishSource, /ssh-keygen\.exe/u)
  assert.match(publishSource, /-F \$remoteHostName -f \$KnownHostsFile/u)
  assert.match(publishSource, /StrictHostKeyChecking=yes/u)
  assert.match(publishSource, /UserKnownHostsFile=\$KnownHostsFile/u)
  assert.match(publishSource, /GlobalKnownHostsFile=none/u)
  assert.match(publishSource, /UpdateHostKeys=no/u)
  assert.match(
    publishSource,
    /\$arguments = \$script:sshConnectionArguments \+ @\(/u,
  )
  assert.match(
    publishSource,
    /\$archiveUploadArguments = \$script:sshConnectionArguments \+ @\(/u,
  )
  assert.match(
    publishSource,
    /\$deployUploadArguments = \$script:sshConnectionArguments \+ @\(/u,
  )
})

test('native deploy arms one ERR rollback path across switch and restart', () => {
  const armedAt = deploySource.indexOf('rollback_armed=true')
  const switchAt = deploySource.indexOf('next_link=')
  const finalHealthAt = deploySource.indexOf('POST_CONFIGURATION_HEALTH_CHECK_FAILED')
  const disarmedAt = deploySource.lastIndexOf('rollback_armed=false')
  assert.match(deploySource, /trap deployment_error_trap ERR/u)
  assert.match(deploySource, /DEPLOYMENT_COMMAND_FAILED_ROLLING_BACK/u)
  assert.ok(armedAt > 0 && armedAt < switchAt)
  assert.ok(disarmedAt > finalHealthAt)
  assert.match(
    deploySource,
    /verify_expected_yilian_migration[\s\S]*verify-yilian-source-contract-migration\.mjs/u,
  )
  assert.match(deploySource, /before_non_yilian_fingerprint/u)
  assert.match(deploySource, /PROTECTED_RUNTIME_PATH_UNSAFE/u)
})

test('native deploy quiesces writers before every protected-state snapshot', () => {
  const pauseAt = deploySource.indexOf('scheduler_pause_created=true')
  const preRecoveryAt = deploySource.indexOf('pre_switch_recovery_armed=true')
  const stopAt = deploySource.indexOf(
    'systemctl stop sifangguan-ota-api.service',
    pauseAt,
  )
  const stopStateAt = deploySource.indexOf('api_active_state=', stopAt)
  const stoppedPidAt = deploySource.indexOf('api_main_pid=', stopStateAt)
  const registryDiscoveryAt = deploySource.indexOf(
    "-name 'trusted-device-registry-*.json'",
    stoppedPidAt,
  )
  const backupAt = deploySource.indexOf('backup_stamp=', registryDiscoveryAt)
  const fullRollbackAt = deploySource.indexOf('rollback_armed=true', backupAt)
  const fingerprintAt = deploySource.indexOf('before_fingerprint=', fullRollbackAt)
  const switchAt = deploySource.indexOf('next_link=', fingerprintAt)

  assert.ok(pauseAt > 0 && pauseAt < preRecoveryAt)
  assert.ok(preRecoveryAt < stopAt && stopAt < stopStateAt)
  assert.ok(stopStateAt < stoppedPidAt && stoppedPidAt < registryDiscoveryAt)
  assert.ok(registryDiscoveryAt < backupAt && backupAt < fullRollbackAt)
  assert.ok(fullRollbackAt < fingerprintAt && fingerprintAt < switchAt)
  assert.match(deploySource, /DEPLOYMENT_API_STOP_NOT_CONFIRMED/u)
  assert.match(deploySource, /DEPLOYMENT_API_PROCESS_STILL_PRESENT/u)
  assert.match(
    deploySource,
    /elif \[\[ \$\{pre_switch_recovery_armed\} == true \]\]; then[\s\S]*recover_pre_switch_release/u,
  )

  const recovery = deploySource.slice(
    deploySource.indexOf('recover_pre_switch_release()'),
    deploySource.indexOf('rollback_release()'),
  )
  assert.ok(
    recovery.indexOf('wait_for_health')
      < recovery.indexOf('release_owned_scheduler_pause'),
  )
})

test('deployment verifier accepts only the exact failed-contract migration', () => {
  assert.deepEqual(exactMigration(), { migratedHotelCount: 1 })

  const changedSources = defaultYilianReportSourcesForMigration()
  changedSources[0] = {
    ...changedSources[0],
    endpointUrl: 'https://attacker.invalid/collect',
  }
  assert.throws(
    () => exactMigration({
      afterReportSources: { [hotelId]: changedSources },
    }),
    { message: 'YILIAN_REPORT_SOURCE_MIGRATION_MISMATCH' },
  )
  assert.throws(
    () => exactMigration({
      afterRepairStatuses: {
        [hotelId]: { ...migratedStatus, lastSucceededAt: new Date().toISOString() },
      },
    }),
    { message: 'YILIAN_REPAIR_STATUS_MIGRATION_MISMATCH' },
  )
})

test('deployment verifier accepts only the exact outdated Yilian endpoint migration', () => {
  const legacySources = defaultYilianReportSourcesForMigration().map(
    (source, index) => ({
      ...source,
      endpointUrl: index === 0
        ? 'https://pms.ygjpms.com/newPms/forwardRoomState/nowRoomState?manageHotelCode='
        : source.endpointUrl,
      rowVersion: 10 + index,
    }),
  )
  const migratedSources = defaultYilianReportSourcesForMigration().map(
    (source, index) => ({ ...source, rowVersion: 11 + index }),
  )
  const legacyStatus = {
    ...failedStatus,
    lastErrorCode: 'YILIAN_REPORT_CODE_REJECTED',
    sourceCount: 3,
  }
  const expectedStatus = {
    ...legacyStatus,
    state: 'IDLE',
    trigger: 'STARTUP_SOURCE_CONTRACT_MIGRATION',
    lastAttemptAt: null,
    lastErrorCode: null,
    sourceCount: 3,
    successfulSourceCount: 0,
  }
  assert.deepEqual(verifyYilianSourceContractMigration({
    beforeReportSourcesText: JSON.stringify({ [hotelId]: legacySources }),
    beforeRepairStatusesText: JSON.stringify({ [hotelId]: legacyStatus }),
    afterReportSources: { [hotelId]: migratedSources },
    afterRepairStatuses: { [hotelId]: expectedStatus },
    hotels,
  }), { migratedHotelCount: 1 })
})

test('deployment verifier rejects Yilian defaults synthesized for a non-migrating store', () => {
  const secondHotel = {
    ...hotels[0],
    hotelId: otherYilianHotelId,
    hotelCode: '016',
    hotelName: '016 测试门店',
  }
  const input = {
    beforeReportSourcesText: '{}',
    beforeRepairStatusesText: JSON.stringify({
      [hotelId]: failedStatus,
      [otherYilianHotelId]: intentionallyUnconfiguredStatus,
    }),
    afterRepairStatuses: {
      [hotelId]: migratedStatus,
      [otherYilianHotelId]: intentionallyUnconfiguredStatus,
    },
    hotels: [...hotels, secondHotel],
  }

  assert.deepEqual(
    verifyYilianSourceContractMigration({
      ...input,
      afterReportSources: {
        [hotelId]: defaultYilianReportSourcesForMigration(),
      },
    }),
    { migratedHotelCount: 1 },
  )
  assert.throws(
    () => verifyYilianSourceContractMigration({
      ...input,
      afterReportSources: {
        [hotelId]: defaultYilianReportSourcesForMigration(),
        [otherYilianHotelId]: defaultYilianReportSourcesForMigration(),
      },
    }),
    { message: 'YILIAN_REPORT_SOURCE_MIGRATION_MISMATCH' },
  )
})

test('deployment verifier is pinned to the runtime Yilian migration contract', () => {
  const contractLiterals = [
    'STARTUP_SOURCE_CONTRACT_MIGRATION',
    '34000000-0000-4000-8000-000000000001',
    '27f5ead0-11a3-4131-87ce-7ba9d7ff0ce0',
    '94c0b6ee-2ee4-421f-a9e8-d1fa38a352a9',
    '/newPms/reportAPP/nowRoomStateReport',
    '/newPms/orderManage/selectAll?pageNum=1&pageSize=100&recState=2',
    '/newPms/reportAPP/rateCalendarReport?startDate=2020-01-01&endDate=2020-01-02',
  ]
  for (const literal of contractLiterals) {
    assert.equal(reviewApiSource.includes(literal), true)
    assert.equal(verifierSource.includes(literal), true)
  }
})

test('deployment verifier migrates the undersized Yilian order page safely', () => {
  const legacySources = defaultYilianReportSourcesForMigration().map(
    (source, index) => ({
      ...source,
      endpointUrl: index === 1
        ? 'https://pms.ygjpms.com/newPms/orderManage/selectAll?pageNum=1&pageSize=1&recState=2'
        : source.endpointUrl,
      rowVersion: 20 + index,
    }),
  )
  const migratedSources = defaultYilianReportSourcesForMigration().map(
    (source, index) => ({ ...source, rowVersion: 21 + index }),
  )
  const legacyStatus = {
    ...failedStatus,
    lastErrorCode: 'YILIAN_ORDER_PAGINATION_LIMIT',
    sourceCount: 0,
    successfulSourceCount: 0,
  }
  const expectedStatus = {
    ...legacyStatus,
    state: 'IDLE',
    trigger: 'STARTUP_SOURCE_CONTRACT_MIGRATION',
    lastAttemptAt: null,
    lastErrorCode: null,
    sourceCount: 3,
    successfulSourceCount: 0,
  }
  assert.deepEqual(verifyYilianSourceContractMigration({
    beforeReportSourcesText: JSON.stringify({ [hotelId]: legacySources }),
    beforeRepairStatusesText: JSON.stringify({ [hotelId]: legacyStatus }),
    afterReportSources: { [hotelId]: migratedSources },
    afterRepairStatuses: { [hotelId]: expectedStatus },
    hotels,
  }), { migratedHotelCount: 1 })
})

test('deployment verifier rejects corrupt stores and preserves opt-out', () => {
  assert.throws(
    () => exactMigration({ beforeReportSourcesText: '{broken-json' }),
    { message: 'REPORT_SOURCE_BASELINE_INVALID' },
  )
  assert.deepEqual(
    exactMigration({ beforeReportSourcesText: '[]' }),
    { migratedHotelCount: 1 },
  )

  const defaultStatusMigration = {
    state: 'IDLE',
    trigger: 'STARTUP_SOURCE_CONTRACT_MIGRATION',
    lastAttemptAt: null,
    lastValidatedAt: null,
    lastSucceededAt: null,
    lastBusinessDate: null,
    lastErrorCode: null,
    sourceCount: 3,
    successfulSourceCount: 0,
    outboundDeliveryAttempted: false,
  }
  assert.deepEqual(
    exactMigration({
      beforeRepairStatusesText: 'null',
      afterRepairStatuses: { [hotelId]: defaultStatusMigration },
      configuredPmsHotelIds: new Set([hotelId]),
    }),
    { migratedHotelCount: 1 },
  )
  assert.throws(
    () => exactMigration({ beforeRepairStatusesText: '{broken-json' }),
    { message: 'REPAIR_STATUS_BASELINE_INVALID' },
  )
  assert.throws(
    () => exactMigration({
      beforeReportSourcesText: JSON.stringify({ [hotelId]: [{}] }),
    }),
    { message: 'REPORT_SOURCE_BASELINE_INVALID' },
  )

  assert.throws(
    () => exactMigration({
      beforeRepairStatusesText: JSON.stringify({
        [hotelId]: intentionallyUnconfiguredStatus,
      }),
    }),
    { message: 'YILIAN_MIGRATION_NOT_EXPECTED' },
  )
})

test('legacy activation is allowed only when a credential was validated', () => {
  const idleStatus = {
    state: 'IDLE',
    trigger: null,
    lastAttemptAt: null,
    lastValidatedAt: null,
    lastSucceededAt: null,
    lastBusinessDate: null,
    lastErrorCode: null,
    sourceCount: 0,
    successfulSourceCount: 0,
    outboundDeliveryAttempted: false,
  }
  const expectedStatus = {
    ...idleStatus,
    trigger: 'STARTUP_SOURCE_CONTRACT_MIGRATION',
    sourceCount: 3,
  }
  const legacy = {
    beforeRepairStatusesText: JSON.stringify({ [hotelId]: idleStatus }),
    afterRepairStatuses: { [hotelId]: expectedStatus },
  }
  assert.throws(
    () => exactMigration(legacy),
    { message: 'YILIAN_MIGRATION_NOT_EXPECTED' },
  )
  assert.deepEqual(
    exactMigration({
      ...legacy,
      configuredPmsHotelIds: new Set([hotelId]),
    }),
    { migratedHotelCount: 1 },
  )
})
