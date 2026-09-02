import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const storePageUrl = new URL('../src/pages/StoreConsolePage.tsx', import.meta.url)
const consoleUiUrl = new URL('../src/components/ConsoleUi.tsx', import.meta.url)

test('store overview renders only configured OTA sources with icons and direct actions', async () => {
  const [storePage, consoleUi] = await Promise.all([
    readFile(storePageUrl, 'utf8'),
    readFile(consoleUiUrl, 'utf8'),
  ])

  assert.match(storePage, /const otaSources = configuredOtaSources\(summary\.otaSources\)/u)
  assert.match(storePage, /\{otaSources\.map\(\(source\) =>/u)
  assert.doesNotMatch(storePage, /\(\['CTRIP', 'MEITUAN', 'FLIGGY', 'DOUYIN'\] as const\)\.map/u)
  assert.match(storePage, /<PlatformIcon name=\{source\.platformCode as PlatformIconName\}/u)
  assert.match(storePage, /一键直达/u)
  assert.match(storePage, /onOpen\(summary\.hotel, direct\?\.tab\)/u)
  assert.match(storePage, /label: '上游数据待处理', tab: 'collection'/u)
  assert.match(storePage, /label: '检查采集数据'/u)
  assert.match(consoleUi, /export function PlatformIcon/u)
})

test('store overview and exception center expose one PMS repair state without heartbeat alerts', async () => {
  const [storePage, exceptionPage, repairDomain] = await Promise.all([
    readFile(storePageUrl, 'utf8'),
    readFile(new URL('../src/pages/ExceptionCenterPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/domain/pmsRepair.ts', import.meta.url), 'utf8'),
  ])

  assert.match(storePage, /PMS · \{pms\.label\}/u)
  assert.match(storePage, /label: '需要修复处理'/u)
  assert.match(storePage, /tab: 'repair', label: 'PMS需要修复处理'/u)
  assert.match(exceptionPage, /PMS需要修复处理/u)
  assert.match(exceptionPage, /onOpenStore\(issue\.hotel, 'repair'\)/u)
  assert.doesNotMatch(exceptionPage, /可信设备离线/u)
  assert.doesNotMatch(repairDomain, /lastSeenAt/u)
  assert.match(repairDomain, /90 \* 60 \* 1000/u)
  assert.match(repairDomain, /reenrollRequired/u)
  assert.match(repairDomain, /scopeApprovalStatus !== 'APPROVED'/u)
})
