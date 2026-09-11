import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  businessReadErrorMessage,
  businessReadFailureSummary,
} from '../src/ui/businessDisplay.ts'

test('store read errors expose actionable allow-listed business reasons', () => {
  assert.equal(
    businessReadErrorMessage(new Error('YILIAN_SOURCE_CONTRACT_INVALID'), '读取失败'),
    '驿联云数据接口配置不完整，请在采集配置中启用并验证固定的三个接口',
  )
  assert.equal(
    businessReadErrorMessage(new Error('REVIEW_HOTEL_NOT_FOUND'), '读取失败'),
    '当前账号无法读取该门店，请返回门店总览重新选择，或联系管理员检查门店权限',
  )
  assert.equal(
    businessReadErrorMessage(new Error('会话已失效，请重新登录'), '读取失败'),
    '登录状态已失效，请重新登录',
  )
})

test('store read errors map transport status and never echo arbitrary detail', () => {
  const forbidden = Object.assign(new Error('opaque server detail'), { status: 403 })
  assert.equal(
    businessReadErrorMessage(forbidden, '读取失败'),
    '当前账号无权读取该门店，请联系管理员检查门店权限',
  )
  assert.equal(
    businessReadErrorMessage(
      new Error('数据库密码 secret-should-not-be-shown'),
      '读取失败',
    ),
    '读取失败',
  )
})

test('store read failure summaries deduplicate repeated endpoint failures', () => {
  assert.equal(
    businessReadFailureSummary([
      new Error('REVIEW_HOTEL_NOT_FOUND'),
      new Error('REVIEW_HOTEL_NOT_FOUND'),
    ], '读取失败'),
    '当前账号无法读取该门店，请返回门店总览重新选择，或联系管理员检查门店权限',
  )
})

test('store detail counts only actual requests and preserves successful prior data', async () => {
  const source = await readFile(
    new URL('../src/pages/StoreConsolePage.tsx', import.meta.url),
    'utf8',
  )
  assert.match(source, /const requestedResults = canConfigure \? results : results\.slice\(1\)/u)
  assert.match(source, /setData\(\(current\) => \(\{/u)
  assert.match(source, /current\.monitor/u)
  assert.match(source, /businessReadFailureSummary/u)
})

test('Yilian repair status displays the last safe reason code', async () => {
  const source = await readFile(
    new URL('../src/pages/StoreRepairPanel.tsx', import.meta.url),
    'utf8',
  )
  assert.match(source, /最近一次云端登录修复未完成/u)
  assert.match(source, /businessCodeLabel\(yilian\?\.lastErrorCode/u)
  assert.match(source, /<dt>最近结果<\/dt>/u)
})
