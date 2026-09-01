import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  configurationDraft,
  observedOtaSources,
  otaRoomTypeAvailable,
} from '../src/pages/hotSellingRoomModel.ts'

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
const modelUrl = new URL(
  '../src/pages/hotSellingRoomModel.ts',
  import.meta.url,
)

test('hot-selling configuration is PMS-led with dependent OTA selectors', async () => {
  const [panel, store, api, target, model] = await Promise.all([
    readFile(panelUrl, 'utf8'),
    readFile(storeUrl, 'utf8'),
    readFile(apiUrl, 'utf8'),
    readFile(targetUrl, 'utf8'),
    readFile(modelUrl, 'utf8'),
  ])

  assert.match(panel, /热销房型与渠道对应/u)
  assert.match(panel, /选择渠道/u)
  assert.match(panel, /选择该渠道房型/u)
  assert.match(panel, /请选择已抓取渠道/u)
  assert.match(panel, /type="checkbox"/u)
  assert.match(panel, /系统发现 \{autoMatchCount\} 条 PMS 与 OTA 同名对应建议/u)
  assert.match(panel, /availableOtaSources\.map/u)
  assert.match(panel, /暂无已抓取 OTA 渠道/u)
  assert.match(panel, /请先移除失效配置/u)
  assert.doesNotMatch(panel, /热销房型编码/u)
  assert.match(store, /<HotSellingRoomConfigPanel/u)
  assert.match(store, /showProductMappings=\{false\}/u)
  assert.match(target, /showProductMappings \? \(/u)
  assert.match(api, /\/room-type-configuration/u)
  assert.match(model, /sources\.filter\(\(source\) => source\.roomTypes\.length > 0\)/u)
})

test('room model only exposes observed OTA catalogs and keeps hot-selling selection separate', () => {
  const sources = [
    {
      sourceId: 'ctrip-main',
      displayName: '携程主账号',
      platformCode: 'CTRIP',
      observedAt: '2026-09-01T09:00:00.000Z',
      refreshStatus: 'COMPLETE',
      roomTypes: [
        { roomTypeCode: 'ctrip-king', displayName: '景观大床房' },
      ],
    },
    {
      sourceId: 'meituan-main',
      displayName: '美团主账号',
      platformCode: 'MEITUAN',
      observedAt: '2026-09-01T09:01:00.000Z',
      refreshStatus: 'COMPLETE',
      roomTypes: [
        { roomTypeCode: 'meituan-king', displayName: '景观大床房' },
        { roomTypeCode: 'meituan-twin', displayName: '雅致双床房（无早）' },
      ],
    },
    {
      sourceId: 'fliggy-empty',
      displayName: '飞猪未抓取账号',
      platformCode: 'FLIGGY',
      observedAt: null,
      refreshStatus: 'NEVER',
      roomTypes: [],
    },
  ]

  assert.deepEqual(
    observedOtaSources(sources).map((source) => source.sourceId),
    ['ctrip-main', 'meituan-main'],
  )

  const draft = configurationDraft({
    rowVersion: 1,
    updatedAt: null,
    pmsObservedAt: '2026-09-01T08:59:00.000Z',
    pmsRoomTypes: [
      {
        physicalRoomTypeCode: 'PMS-KING',
        displayName: '景观大床房',
        primaryAvailableRooms: 3,
      },
      {
        physicalRoomTypeCode: 'PMS-TWIN',
        displayName: '雅致双床房',
        primaryAvailableRooms: 2,
      },
    ],
    otaSources: sources,
    mappings: [],
    hotSellingRoomTypeCodes: ['PMS-TWIN'],
  })

  assert.deepEqual(
    draft.mappings.map((mapping) => [
      mapping.physicalRoomTypeCode,
      mapping.sourceId,
      mapping.otaRoomTypeCode,
    ]),
    [
      ['PMS-KING', 'ctrip-main', 'ctrip-king'],
      ['PMS-KING', 'meituan-main', 'meituan-king'],
    ],
  )
  assert.deepEqual(draft.hotSellingRoomTypeCodes, ['PMS-TWIN'])

  assert.equal(
    otaRoomTypeAvailable(
      draft.mappings,
      'meituan-main',
      'meituan-twin',
      'PMS-TWIN',
    ),
    true,
  )
  assert.equal(
    otaRoomTypeAvailable(
      draft.mappings,
      'meituan-main',
      'meituan-king',
      'PMS-TWIN',
    ),
    false,
  )
})
