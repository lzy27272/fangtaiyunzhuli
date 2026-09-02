import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const exceptionCenterSource = await readFile(
  new URL('../src/pages/ExceptionCenterPage.tsx', import.meta.url),
  'utf8',
)
const businessDisplaySource = await readFile(
  new URL('../src/ui/businessDisplay.ts', import.meta.url),
  'utf8',
)

test('safe recollection gives immediate progress and a bounded wait', () => {
  assert.match(exceptionCenterSource, /采集请求已提交/)
  assert.match(exceptionCenterSource, /已等待 \{processingSeconds\} 秒/)
  assert.match(exceptionCenterSource, /COLLECTION_FEEDBACK_TIMEOUT_MS = 120_000/)
  assert.match(exceptionCenterSource, /服务器可能仍在继续处理/)
})

test('safe recollection reports partial source results before refreshing', () => {
  assert.match(exceptionCenterSource, /successfulSourceCount.*sourceCount/)
  assert.match(exceptionCenterSource, /setNotice\(collectionResultNotice\(issue, run\)\)/)
  assert.match(exceptionCenterSource, /setSelected\(null\); setNote\(''\); void refresh\(\)/)
  assert.match(
    businessDisplaySource,
    /LUOPAN_ORDER_DETAIL_NOT_CONFIGURED: '罗盘订单明细尚未配置'/,
  )
})
