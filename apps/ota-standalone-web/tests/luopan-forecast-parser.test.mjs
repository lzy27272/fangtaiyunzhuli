import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseLuopanForecastTable,
} from '../../../tools/uat/luopan-forecast-parser.mjs'

const rows = [
  ['', '07-28', '07-29', '07-30'],
  ['周二', '周三', '周四'],
  ['全部可售房', '1', '44', '57'],
  ['已售房', '106', '63', '50'],
  ['在住', '94', '14', '10'],
  ['预抵', '12', '49', '40'],
  ['预离', '0', '92', '53'],
  ['维修', '0', '0', '0'],
  ['自用', '0', '0', '0'],
  ['简单出租率', '99.07%', '58.88%', '46.73%'],
  ['预计平均房价', '411.98', '381.65', '384.34'],
  ['预计房费收入', '43670.39', '24044.05', '19216.81'],
  ['示例大床房', '0', '1', '1'],
  ['已售房', '1', '0', '0'],
  ['在住', '1', '0', '0'],
  ['预抵', '0', '0', '0'],
  ['预离', '0', '1', '0'],
  ['维修', '0', '0', '0'],
  ['自用', '0', '0', '0'],
  ['简单出租率', '100%', '0%', '0%'],
  ['预计平均房价', '500', '---', '---'],
  ['预计房费收入', '500', '0', '0'],
  ['示例双床房', '1', '1', '1'],
  ['已售房', '0', '0', '0'],
  ['在住', '0', '0', '0'],
  ['预抵', '0', '0', '0'],
  ['预离', '0', '0', '0'],
  ['维修', '0', '0', '0'],
  ['自用', '0', '0', '0'],
  ['简单出租率', '0%', '0%', '0%'],
  ['预计平均房价', '---', '---', '---'],
  ['预计房费收入', '0', '0', '0'],
]

test('parses Luopan aggregate forecast into monitor-ready metrics', () => {
  const parsed = parseLuopanForecastTable({
    rows,
    businessDate: '2026-07-28',
    secretKey: 'test-only-parser-secret',
  })
  assert.equal(parsed.current.roomCount, 107)
  assert.equal(parsed.current.availableRooms, 1)
  assert.equal(parsed.current.soldRooms, 106)
  assert.equal(parsed.current.roomFee, 43670.39)
  assert.equal(parsed.current.adr, 411.98)
  assert.equal(parsed.current.occupancyRate, 99.07)
  assert.equal(parsed.futureDaily.length, 2)
  assert.equal(parsed.futureDaily[0].stayDate, '2026-07-29')
  assert.equal(parsed.physicalInventory.length, 2)
  assert.match(
    parsed.physicalInventory[0].physicalRoomTypeCode,
    /^LUOPAN-[a-f0-9]{16}$/,
  )
})

test('Luopan parser fails closed when the PMS business date is absent', () => {
  assert.throws(
    () => parseLuopanForecastTable({
      rows,
      businessDate: '2026-08-01',
      secretKey: 'test-only-parser-secret',
    }),
    /LUOPAN_FORECAST_DATES_INVALID/,
  )
})
