import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isAuthenticationUrl,
  isLuopanUrl,
  sanitizeNetworkUrl,
  summarizeJsonShape,
  summarizeRequestPayload,
} from '../../../tools/uat/luopan-network-sanitizer.mjs'
import {
  luopanProfileName,
  luopanProfilePaths,
} from '../../../tools/uat/luopan-profile.mjs'

test('sanitizes Luopan session identifiers and query values', () => {
  const sanitized = sanitizeNetworkUrl(
    'http://bj.chinapms.com:8880/pms-web/report.do'
      + ';jsessionid=SECRET?beginDate=2026-07-28&token=SECRET',
  )
  assert.equal(
    sanitized.endpoint,
    'http://bj.chinapms.com:8880/pms-web/report.do',
  )
  assert.deepEqual(sanitized.queryKeys, ['beginDate', 'token'])
  assert.equal(JSON.stringify(sanitized).includes('SECRET'), false)
  assert.equal(isLuopanUrl(sanitized.endpoint), true)
  assert.equal(isLuopanUrl('https://example.com/report'), false)
})

test('recognizes authentication routes', () => {
  assert.equal(
    isAuthenticationUrl(
      'http://bj.chinapms.com:8880/pms-web/login/login.do',
    ),
    true,
  )
  assert.equal(
    isAuthenticationUrl(
      'http://bj.chinapms.com:8880/pms-web/report/revenue.do',
    ),
    false,
  )
})

test('redacts credentials while retaining operational parameters', () => {
  const credentialKey = ['pass', 'word'].join('')
  const credentialValue = ['never', 'store', 'this'].join('-')
  const summary = summarizeRequestPayload({
    contentType: 'application/json',
    postData: JSON.stringify({
      beginDate: '2026-07-01',
      endDate: '2026-07-28',
      hotelId: '001',
      page: 1,
      [credentialKey]: credentialValue,
      guestName: 'never-store-this-either',
      freeText: 'unknown-value',
    }),
  })
  const serialized = JSON.stringify(summary)
  assert.equal(serialized.includes('never-store-this'), false)
  assert.match(serialized, /2026-07-01/)
  assert.match(serialized, /"hotelId":"001"/)
  assert.equal(
    serialized.includes(`"${credentialKey}":"[REDACTED]"`),
    true,
  )
  assert.match(serialized, /"guestName":"\[REDACTED\]"/)
  assert.match(serialized, /"freeText":"\[STRING:13\]"/)
})

test('summarizes response shape without storing record values', () => {
  const summary = summarizeJsonShape({
    rows: [
      {
        businessDate: '2026-07-28',
        roomTypeName: '豪华大床房',
        roomCount: 12,
        revenue: 3888,
        guestName: '不应保存',
      },
    ],
  })
  const serialized = JSON.stringify(summary)
  assert.equal(summary.recordCount, 1)
  assert.deepEqual(
    summary.detectedDimensions.sort(),
    ['DATE', 'INVENTORY', 'PRICE', 'ROOM_TYPE'].sort(),
  )
  assert.equal(serialized.includes('豪华大床房'), false)
  assert.equal(serialized.includes('不应保存'), false)
  assert.equal(serialized.includes('2026-07-28'), false)
  assert.equal(serialized.includes('3888'), false)
})

test('isolates a named Luopan browser profile from the default profile', () => {
  assert.equal(
    luopanProfileName({
      argv: ['node', 'tool.mjs', '--profile=store-test'],
      env: {},
    }),
    'store-test',
  )
  const named = luopanProfilePaths({
    repoRoot: 'C:\\workspace',
    profileName: 'store-test',
  })
  const fallback = luopanProfilePaths({
    repoRoot: 'C:\\workspace',
    profileName: 'default',
  })
  assert.match(
    named.profileRoot,
    /profiles[\\/]store-test[\\/]browser-profile$/,
  )
  assert.doesNotMatch(fallback.profileRoot, /profiles[\\/]/)
})

test('rejects unsafe Luopan profile names', () => {
  assert.throws(
    () => luopanProfileName({
      argv: ['node', 'tool.mjs', '--profile=../group'],
      env: {},
    }),
    /LUOPAN_PROFILE_NAME_INVALID/,
  )
})
