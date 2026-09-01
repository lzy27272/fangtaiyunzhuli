import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const panelUrl = new URL(
  '../src/pages/HotSellingRoomConfigPanel.tsx',
  import.meta.url,
)
const storeUrl = new URL(
  '../src/pages/StoreConsolePage.tsx',
  import.meta.url,
)
const apiUrl = new URL('../src/api/business.ts', import.meta.url)
const targetUrl = new URL(
  '../src/pages/MappingTargetPage.tsx',
  import.meta.url,
)

test('hot-selling configuration is PMS-led with dependent OTA selectors', async () => {
  const [panel, store, api, target] = await Promise.all([
    readFile(panelUrl, 'utf8'),
    readFile(storeUrl, 'utf8'),
    readFile(apiUrl, 'utf8'),
    readFile(targetUrl, 'utf8'),
  ])

  assert.match(panel, /热销房型与渠道对应/u)
  assert.match(panel, /选择渠道/u)
  assert.match(panel, /选择该渠道房型/u)
  assert.match(panel, /type="checkbox"/u)
  assert.match(panel, /系统发现 \{autoMatchCount\} 条 PMS 与 OTA 同名对应建议/u)
  assert.match(panel, /请先移除失效配置/u)
  assert.doesNotMatch(panel, /热销房型编码/u)
  assert.match(store, /<HotSellingRoomConfigPanel/u)
  assert.match(store, /showProductMappings=\{false\}/u)
  assert.match(target, /showProductMappings \? \(/u)
  assert.match(api, /\/room-type-configuration/u)
})
