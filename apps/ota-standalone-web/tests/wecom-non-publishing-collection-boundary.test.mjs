import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const apiPath = fileURLToPath(
  new URL('../../../tools/uat/ota-standalone-review-api.mjs', import.meta.url),
)

const sourceBetween = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

test('test suite and hot-selling retry always collect without publishing', async () => {
  const source = await readFile(apiPath, 'utf8')
  const testSuiteRoute = sourceBetween(
    source,
    "suffix === '/wecom-test-suite-deliveries'",
    "suffix === '/wecom-test-deliveries'",
  )
  const retryFlow = sourceBetween(
    source,
    'const runHotSellingRetryUnlocked = async',
    'const runHotSellingRetry = async',
  )

  assert.match(
    testSuiteRoute,
    /collectLiveFor\(hotelId,\s*\{\s*publishSnapshot:\s*false,?\s*\}\)/u,
  )
  assert.match(
    retryFlow,
    /collectLiveFor\(hotelId,\s*\{\s*publishSnapshot:\s*false,?\s*\}\)/u,
  )
})

test('real WeCom test sends require exact server-side confirmation', async () => {
  const source = await readFile(apiPath, 'utf8')
  const route = sourceBetween(
    source,
    "suffix === '/wecom-test-suite-deliveries'",
    "suffix === '/wecom-test-deliveries'",
  )
  assert.match(
    route,
    /confirmRealWeComSend,expectedEndpointSha256,reasonCode/u,
  )
  assert.match(route, /body\.confirmRealWeComSend !== true/u)
  assert.match(
    route,
    /body\.reasonCode !== 'SEND_WECOM_UAT_TEST_SUITE'/u,
  )
  assert.match(
    route,
    /body\.expectedEndpointSha256 !== config\.endpointSha256/u,
  )
})

test('manager P1 test is isolated from collection and production risk state', async () => {
  const source = await readFile(apiPath, 'utf8')
  const route = sourceBetween(
    source,
    "suffix === '/wecom-manager-p1-test-deliveries'",
    "suffix === '/wecom-test-suite-deliveries'",
  )
  const delivery = sourceBetween(
    source,
    'const deliverWeComManagerP1Test = async',
    'const p1ManualReplayFailureForDecision =',
  )
  assert.match(
    route,
    /confirmRealWeComSend,expectedBotIdFingerprint,reasonCode/u,
  )
  assert.match(route, /SEND_WECOM_MANAGER_P1_TEST/u)
  assert.match(route, /body\.confirmRealWeComSend !== true/u)
  assert.match(
    route,
    /body\.expectedBotIdFingerprint !== botStatus\.botIdFingerprint/u,
  )
  assert.match(route, /deliverWeComManagerP1Test/u)
  assert.match(delivery, /deliveryType: 'P1_FUTURE_DEMAND_TEST'/u)
  assert.match(delivery, /\{ testMode: true \}/u)
  assert.match(delivery, /deliverWeComRepairBotDirectMessage/u)
  assert.doesNotMatch(delivery, /collectLiveFor/u)
  assert.doesNotMatch(delivery, /persistFutureDemandRiskStates/u)
  assert.doesNotMatch(delivery, /deliverWeComSnapshot/u)
})

test('011 manager P1 test has a loopback-only idempotent maintenance trigger', async () => {
  const source = await readFile(apiPath, 'utf8')
  const route = sourceBetween(
    source,
    "path === '/api/v1/internal/wecom-manager-p1-test-011'",
    "path === '/api/v1/auth/login'",
  )
  assert.match(route, /if \(!loopbackPilotTriggerAuthorized\(request\)\)/u)
  assert.match(route, /SEND_WECOM_MANAGER_P1_TEST_011/u)
  assert.match(route, /hotel\.hotelCode === '011'/u)
  assert.match(route, /MANAGER_P1_TEST_011_20260912_V1/u)
  assert.match(route, /deliverWeComManagerP1Test/u)
})

test('non-publishing collection cannot append snapshots or refresh OTA', async () => {
  const source = await readFile(apiPath, 'utf8')
  const luopanCollection = sourceBetween(
    source,
    'const collectLuopanLiveFor = async',
    'const collectLiveFor = async',
  )
  const genericCollection = sourceBetween(
    source,
    'const collectLiveFor = async',
    'const scheduledCollectionTick = async',
  )

  const luopanEarlyReturn = luopanCollection.indexOf('if (!publishSnapshot)')
  const luopanAppend = luopanCollection.indexOf('appendAndPersistSnapshot(')
  assert.ok(luopanEarlyReturn >= 0)
  assert.ok(luopanAppend > luopanEarlyReturn)
  assert.match(
    luopanCollection.slice(luopanEarlyReturn, luopanAppend),
    /return\s*\{[\s\S]*?otaRefreshes:\s*\[\][\s\S]*?\}/u,
  )

  assert.match(
    genericCollection,
    /if\s*\(publishSnapshot\)\s*\{\s*appendAndPersistSnapshot\(/u,
  )
  assert.match(
    genericCollection,
    /const otaRefreshes = publishSnapshot\s*\?\s*await refreshEnabledOtaSourcesFor\(/u,
  )
  assert.match(
    genericCollection,
    /const collectionLockKey = publishSnapshot\s*\?\s*hotelId\s*:\s*`\$\{hotelId\}:ISOLATED_NON_PUBLISHING`/u,
  )
})

test('non-publishing collection cannot trigger automatic repair side effects', async () => {
  const source = await readFile(apiPath, 'utf8')
  const luopanCollection = sourceBetween(
    source,
    'const collectLuopanLiveFor = async',
    'const collectLiveFor = async',
  )
  const genericCollection = sourceBetween(
    source,
    'const collectLiveFor = async',
    'const scheduledCollectionTick = async',
  )

  assert.match(
    luopanCollection,
    /if\s*\(publishSnapshot\)\s*\{[\s\S]*?startLuopanRepairChallenge\(/u,
  )
  assert.match(
    genericCollection,
    /publishSnapshot[\s\S]*?startBieyanghongRepairChallenge\(/u,
  )
  assert.match(
    genericCollection,
    /publishSnapshot[\s\S]*?updateYilianRepairStatus\(/u,
  )
  assert.doesNotMatch(
    genericCollection,
    /if\s*\(!publishSnapshot\)[\s\S]*?(?:startLuopanRepairChallenge|startBieyanghongRepairChallenge|updateYilianRepairStatus)\(/u,
  )
})
