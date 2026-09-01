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
  assert.match(consoleUi, /export function PlatformIcon/u)
})
