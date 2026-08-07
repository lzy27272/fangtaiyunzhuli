import assert from 'node:assert/strict'
import test from 'node:test'
import {
  combinedOperationsBriefLimits,
  createCombinedOperationsWeComPayloads,
} from '../../../tools/uat/wecom/src/combined-operations-brief.mjs'

const addDays = (dateText, days) => {
  const date = new Date(`${dateText}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const hotel = { hotelName: '毕节慧博酒店' }
const monitor = {
  completeness: 'PARTIAL',
  sources: [
    { completeness: 'COMPLETE' },
    { completeness: 'COMPLETE' },
    { completeness: 'PARTIAL' },
  ],
  metrics: {
    totalRevenue: { value: 12680 },
    adr: { value: 428 },
    revPar: { value: 282 },
    soldRooms: { value: 29 },
    availableRooms: { value: 16 },
    sellProgress: { value: 64 },
  },
  hourlyDelta: {
    basis: 'HOURLY_SNAPSHOT_DIFF',
    intervalStartAt: '2026-08-07T19:00:00+08:00',
    intervalEndAt: '2026-08-07T20:00:00+08:00',
    totals: {
      newRoomNights: 2,
      canceledRoomNights: 1,
      todayRoomNights: 1,
    },
  },
}
const snapshot = {
  businessDate: '2026-08-07',
  observedAt: '2026-08-07T20:02:00+08:00',
  orders: null,
  futureBookingChanges: {
    daily: Array.from({ length: 15 }, (_, index) => ({
      stayDate: addDays('2026-08-07', index),
      roomCount: 45,
      bookedRoomNights: 20 + index,
      availableRooms: 25 - index,
      occupancyPercent: ((20 + index) / 45) * 100,
      adr: 400 + index,
      hourlyNetRoomNights: index === 2 ? 2 : 0,
      cumulativeNetRoomNights: index,
      previousDayNetRoomNights: index % 3,
    })),
  },
}

test('combined operations preview is one bounded operational message', () => {
  const payloads = createCombinedOperationsWeComPayloads({
    hotel,
    monitor,
    snapshot,
    messagePrefix: '合并版预览',
  })
  const content = payloads[0].text.content
  assert.equal(payloads.length, 1)
  assert.deepEqual(payloads[0].text.mentioned_list, ['@all'])
  assert.match(content, /^毕节慧博酒店｜经营综合简报｜合并版预览/u)
  assert.match(content, /📌今日/u)
  assert.match(content, /✅小时进单/u)
  assert.match(content, /📊当日\+未来14天/u)
  assert.match(content, /08-07｜/u)
  assert.match(content, /08-21｜/u)
  assert.match(content, /PMS未提供订单明细/u)
  assert.match(content, /🤖运营建议/u)
  assert.doesNotMatch(content, /UAT测试|隐私处理/u)
  assert.ok(
    Buffer.byteLength(content, 'utf8')
      <= combinedOperationsBriefLimits.maxMessageBytes,
  )
})

test('combined operations preview does not invent hourly order changes', () => {
  const payload = createCombinedOperationsWeComPayloads({
    hotel,
    monitor: {
      ...monitor,
      hourlyDelta: { basis: 'BASELINE_PENDING', totals: null },
    },
    snapshot,
  })[0]
  assert.match(payload.text.content, /同PMS一小时前基线待建立/u)
  assert.doesNotMatch(payload.text.content, /^新增\d/mu)
})
