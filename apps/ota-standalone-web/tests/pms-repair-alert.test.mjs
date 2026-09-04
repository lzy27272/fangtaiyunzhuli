import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  buildStoreRepairConsoleUrl,
  evaluatePmsRepair,
  luopanPmsRepairGuidance,
  PMS_REPAIR_STALE_AFTER_MS,
  pmsRepairIncidentFor,
  pmsRepairNoticeContent,
  pmsRepairNoticeMessageKey,
} from '../../../tools/uat/pms-repair-alert.mjs'

const now = new Date('2026-09-01T15:00:00.000Z')
const monitor = ({ ageMs = 0, completeness = 'COMPLETE', cutoffAt } = {}) => ({
  completeness,
  cutoffAt: cutoffAt ?? new Date(now.getTime() - ageMs).toISOString(),
})
const trusted = (patch = {}) => ({
  eligible: true,
  enrollmentPending: false,
  device: {
    status: 'ACTIVE',
    lastSeenAt: '2024-01-01T00:00:00.000Z',
    reenrollRequired: false,
    scopeApprovalStatus: 'APPROVED',
    ...patch,
  },
})

test('fresh complete PMS data stays normal even when the device heartbeat is old', () => {
  const result = evaluatePmsRepair({
    monitor: monitor({ ageMs: 15 * 60 * 1000 }),
    trustedDeviceStatus: trusted(),
    now,
  })
  assert.deepEqual(result.reasons, [])
  assert.equal(result.required, false)
})

test('PMS data becomes repair-required only after the 90 minute boundary', () => {
  assert.equal(evaluatePmsRepair({
    monitor: monitor({ ageMs: PMS_REPAIR_STALE_AFTER_MS }),
    trustedDeviceStatus: trusted(),
    now,
  }).required, false)
  assert.deepEqual(evaluatePmsRepair({
    monitor: monitor({ ageMs: PMS_REPAIR_STALE_AFTER_MS + 1 }),
    trustedDeviceStatus: trusted(),
    now,
  }).reasons, [{ code: 'PMS_DATA_STALE', detail: 'PMS数据超过90分钟未更新' }])
})

test('incomplete snapshots, re-enrollment and unapproved scope share one repair incident', () => {
  const result = evaluatePmsRepair({
    monitor: monitor({ completeness: 'PARTIAL' }),
    trustedDeviceStatus: trusted({
      reenrollRequired: true,
      scopeApprovalStatus: 'UNBOUND',
    }),
    now,
  })
  assert.deepEqual(result.reasons.map((reason) => reason.code), [
    'PMS_SNAPSHOT_INCOMPLETE',
    'PMS_DEVICE_REENROLL_REQUIRED',
    'PMS_SCOPE_NOT_APPROVED',
  ])
  const incident = pmsRepairIncidentFor({
    hotel: { hotelId: 'hotel-001' },
    monitor: monitor({ completeness: 'PARTIAL' }),
    trustedDeviceStatus: trusted({
      reenrollRequired: true,
      scopeApprovalStatus: 'UNBOUND',
    }),
    now,
  })
  assert.equal(incident.type, 'PMS_REPAIR_REQUIRED')
  assert.equal(incident.status, 'OPEN')
  assert.equal(incident.sourceCode, 'PMS')
  assert.match(incident.directionCode, /PMS_SNAPSHOT_INCOMPLETE/u)
  assert.match(incident.directionCode, /PMS_DEVICE_REENROLL_REQUIRED/u)
  assert.match(incident.directionCode, /PMS_SCOPE_NOT_APPROVED/u)
})

test('missing device requires re-enrollment and valid recovered state closes automatically', () => {
  assert.deepEqual(evaluatePmsRepair({
    monitor: monitor(),
    trustedDeviceStatus: { eligible: true, device: null },
    now,
  }).reasons.map((reason) => reason.code), ['PMS_DEVICE_REENROLL_REQUIRED'])

  const recovered = pmsRepairIncidentFor({
    hotel: { hotelId: 'hotel-001' },
    monitor: monitor(),
    trustedDeviceStatus: trusted(),
    now,
  })
  assert.equal(recovered, null)
})

test('complete snapshot without a valid collection time is treated as incomplete', () => {
  const result = evaluatePmsRepair({
    monitor: monitor({ cutoffAt: 'not-a-date' }),
    trustedDeviceStatus: trusted(),
    now,
  })
  assert.deepEqual(result.reasons.map((reason) => reason.code), ['PMS_SNAPSHOT_INCOMPLETE'])
})

test('repair notice includes a login-gated store repair link and no heartbeat language', () => {
  const incident = pmsRepairIncidentFor({
    hotel: { hotelId: 'hotel-001' },
    monitor: monitor({ ageMs: PMS_REPAIR_STALE_AFTER_MS + 1 }),
    trustedDeviceStatus: trusted({ scopeApprovalStatus: 'UNBOUND' }),
    now,
  })
  const content = pmsRepairNoticeContent({
    hotel: { hotelCode: '001', hotelName: '测试酒店' },
    incident,
    publicOrigin: 'https://www.sfgzt.cn',
  })
  assert.match(content, /PMS需要修复处理/u)
  assert.match(content, /PMS数据超过90分钟未更新/u)
  assert.match(content, /PMS门店范围尚未授权/u)
  assert.match(
    content,
    /https:\/\/www\.sfgzt\.cn\/ota-console\/\?repairHotel=001/u,
  )
  assert.match(content, /登录后按页面指引操作/u)
  assert.doesNotMatch(content, /心跳|离线/u)
})

test('Luopan stale-data notice explains when no captcha is needed', () => {
  const hotel = {
    hotelId: 'hotel-007',
    hotelCode: '007',
    hotelName: '测试罗盘酒店',
    pmsSystemCode: 'LUOPAN_CLOUD',
  }
  const incident = pmsRepairIncidentFor({
    hotel,
    monitor: monitor({ ageMs: PMS_REPAIR_STALE_AFTER_MS + 1 }),
    trustedDeviceStatus: { eligible: false, device: null },
    now,
  })
  const content = pmsRepairNoticeContent({
    hotel,
    incident,
    publicOrigin: 'https://www.sfgzt.cn',
    providerLastErrorCode: 'LUOPAN_FORECAST_TABLE_UNAVAILABLE',
  })

  assert.match(content, /罗盘房态报表页未返回可识别表格/u)
  assert.match(content, /本次无需验证码/u)
  assert.match(content, /不会发送无效验证码/u)
  assert.doesNotMatch(content, /验证码已私聊/u)
  assert.match(
    pmsRepairNoticeMessageKey({
      hotel,
      incident,
      providerLastErrorCode: 'LUOPAN_FORECAST_TABLE_UNAVAILABLE',
    }),
    /:LUOPAN_GUIDANCE_V1:NONAUTH$/u,
  )
})

test('Luopan reauthentication notice routes the manager to the captcha bot', () => {
  const guidance = luopanPmsRepairGuidance('LUOPAN_REAUTH_REQUIRED')
  assert.equal(guidance.captchaRequired, true)
  assert.match(guidance.captchaText, /私聊本店管理员发送验证码图片/u)
  assert.match(guidance.action, /门店编号 验证码/u)

  const key = pmsRepairNoticeMessageKey({
    hotel: {
      hotelId: 'hotel-007',
      pmsSystemCode: 'LUOPAN_CLOUD',
    },
    incident: { incidentId: 'incident-reauth' },
    providerLastErrorCode: 'LUOPAN_REAUTH_REQUIRED',
  })
  assert.match(key, /:LUOPAN_GUIDANCE_V1:REAUTH$/u)
})

test('scheduled Luopan repair delivery uses the versioned provider guidance key', () => {
  const apiSource = fs.readFileSync(
    new URL(
      '../../../tools/uat/ota-standalone-review-api.mjs',
      import.meta.url,
    ),
    'utf8',
  )

  assert.match(
    apiSource,
    /const messageKey = pmsRepairNoticeMessageKey\([\s\S]{0,1600}deliverMorningRepairNotice\(\{[\s\S]{0,220}messageKey,/u,
  )
  assert.match(
    apiSource,
    /const resolvedMessageKey = messageKey[\s\S]{0,160}\?\? `\$\{hotel\.hotelId\}:\$\{deliveryType\}:\$\{auditRecord\.auditKey\}`/u,
  )
})

test('repair console links accept only HTTPS origins and three-digit store codes', () => {
  assert.equal(buildStoreRepairConsoleUrl({
    publicOrigin: 'https://www.sfgzt.cn/ignored/path?secret=no',
    hotelCode: '013',
  }), 'https://www.sfgzt.cn/ota-console/?repairHotel=013')
  assert.throws(() => buildStoreRepairConsoleUrl({
    publicOrigin: 'http://www.sfgzt.cn',
    hotelCode: '013',
  }), /PMS_REPAIR_PUBLIC_ORIGIN_INVALID/u)
  assert.throws(() => buildStoreRepairConsoleUrl({
    publicOrigin: 'https://www.sfgzt.cn',
    hotelCode: '../013',
  }), /PMS_REPAIR_HOTEL_CODE_INVALID/u)
})

test('production release package includes the PMS repair alert runtime module', () => {
  const publishScript = fs.readFileSync(
    new URL(
      '../../../infra/ota-standalone-server/scripts/Publish-OtaStandaloneServer.ps1',
      import.meta.url,
    ),
    'utf8',
  )

  assert.match(publishScript, /'tools\/uat\/pms-repair-alert\.mjs'/)
})
