import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const businessDisplaySource = await readFile(
  new URL('../src/ui/businessDisplay.ts', import.meta.url),
  'utf8',
)

test('store overview labels every live PMS operating metric with its real meaning', () => {
  const expectedLabels = [
    "totalRevenue: '当日预计房费'",
    "adr: '平均房价（ADR）'",
    "revPar: '单房收益（RevPAR）'",
    "soldRooms: '当日已售间夜'",
    "availableRooms: '当日剩余可售房'",
    "targetProgress: '营收目标完成率'",
    "sellProgress: '出租率（OCC）'",
  ]

  for (const label of expectedLabels) {
    assert.ok(businessDisplaySource.includes(label), `missing metric label: ${label}`)
  }
})

test('store overview renders the collector currency unit as yuan', () => {
  assert.match(businessDisplaySource, /CURRENCY: '元'/u)
})
