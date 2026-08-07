import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createFutureBookingWeComPayloads,
  futureBookingBriefLimits,
} from '../../../tools/uat/wecom/src/future-booking-brief.mjs'
import {
  createFutureDemandP1WeComPayloads,
  futureDemandRiskLimits,
  futureDemandRiskStateAfterDelivery,
  reconcileFutureDemandRiskStates,
  selectFutureDemandRiskCandidates,
} from '../../../tools/uat/wecom/src/future-demand-risk.mjs'

const addDays = (dateText, days) => {
  const date = new Date(`${dateText}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const hotel = {
  hotelId: 'hotel-001',
  hotelName: '喷水池态六酒店',
}

const dailyRow = (day, occupancyPercent = day, hourlyNet = 0) => ({
  stayDate: addDays('2026-07-26', day),
  roomCount: 50,
  availableRooms: 50 - Math.round(occupancyPercent / 2),
  bookedRoomNights: Math.round(occupancyPercent / 2),
  occupancyPercent,
  adr: 200 + day,
  hourlyNetRoomNights: hourlyNet,
  cumulativeNetRoomNights: day === 14 ? 10 : day % 5,
  previousDayNetRoomNights: day % 3,
  inferredHourlyAdr: hourlyNet > 0 ? 236 : null,
})

const snapshot = {
  collectionRunId: 'run-future-001',
  businessDate: '2026-07-26',
  observedAt: '2026-07-26T11:02:00+08:00',
  futureBookingChanges: {
    basis: 'FUTURE_SNAPSHOT_DIFF',
    hourlyBaselineAt: '2026-07-26T10:02:00+08:00',
    cumulativeBaselineAt: '2026-07-26T02:02:00+08:00',
    previousDayEndAt: '2026-07-25T23:41:00+08:00',
    daily: Array.from({ length: 90 }, (_, index) =>
      dailyRow(index + 1, index === 19 ? 25 : index + 1, index === 2 ? 3 : 0)),
  },
}

test('future booking brief is one @all message with 14 stay dates under 1900 bytes', () => {
  const payloads = createFutureBookingWeComPayloads(hotel, snapshot)
  assert.equal(payloads.length, 1)
  assert.deepEqual(payloads[0].text.mentioned_list, ['@all'])
  assert.match(payloads[0].text.content, /喷水池态六酒店｜远期房态/)
  assert.match(payloads[0].text.content, /07-27｜/)
  assert.match(payloads[0].text.content, /08-09｜/)
  assert.doesNotMatch(payloads[0].text.content, /08-10｜/)
  assert.doesNotMatch(
    payloads[0].text.content,
    /^用途｜/m,
  )
  assert.match(payloads[0].text.content, /日期｜售\/余｜率｜ADR｜时｜累｜昨/)
  assert.match(payloads[0].text.content, /累起07-26 02:02/)
  assert.match(payloads[0].text.content, /08-09｜[^\n]*｜\+10｜/)
  assert.ok(
    Buffer.byteLength(payloads[0].text.content, 'utf8')
      <= futureBookingBriefLimits.maxMessageBytes,
  )
})

test('high-demand advice gives owner, conditional action and review criteria', () => {
  const highDemand = {
    ...snapshot,
    collectionRunId: 'run-future-high-demand',
    futureBookingChanges: {
      ...snapshot.futureBookingChanges,
      daily: Array.from({ length: 90 }, (_, index) =>
        dailyRow(index + 1, index === 5 ? 74 : index + 1, 0)),
    },
  }
  const content = createFutureBookingWeComPayloads(
    hotel,
    highDemand,
  )[0].text.content
  assert.match(content, /结论｜08-01售卖率74%，余13间，高需求但当前未触发加速/)
  assert.match(content, /先做｜店长\/收益30分钟内核对竞对同房型可售价/)
  assert.match(content, /策略｜若2小时出现新增且竞对价格不弱/)
  assert.match(content, /售卖率≥80%再收紧一档/)
})

test('accelerating advice uses a bounded experiment and rollback signal', () => {
  const content = createFutureBookingWeComPayloads(
    hotel,
    snapshot,
  )[0].text.content
  assert.match(content, /结论｜07-29小时净增\+3间夜/)
  assert.match(content, /人工评估提价3%-5%并限量低价房/)
  assert.match(content, /避免同时改多个变量/)
  assert.match(content, /零新增则取消提价试验/)
})

test('soft-demand advice recommends one-variable testing instead of discounting', () => {
  const softDemand = {
    ...snapshot,
    collectionRunId: 'run-future-soft-demand',
    futureBookingChanges: {
      ...snapshot.futureBookingChanges,
      daily: Array.from({ length: 90 }, (_, index) =>
        dailyRow(index + 1, Math.min(35, index + 1), 0)),
    },
  }
  const content = createFutureBookingWeComPayloads(
    hotel,
    softDemand,
  )[0].text.content
  assert.match(content, /未来14天未见明显加速/)
  assert.match(content, /价格、套餐或曝光三选一/)
  assert.match(content, /无新增则撤回并记录原因/)
})

test('D+15 to D+90 first crosses 20 percent and builds a safe P1 payload', () => {
  const candidates = selectFutureDemandRiskCandidates({
    hotelId: hotel.hotelId,
    snapshot,
    riskStates: {},
  })
  const day20 = candidates.find((item) => item.dayOffset === 20)
  assert.ok(day20)
  assert.deepEqual(day20.reasons, ['CROSS_20_PERCENT'])
  const payloads = createFutureDemandP1WeComPayloads(
    hotel,
    snapshot,
    day20,
  )
  assert.equal(payloads.length, 1)
  assert.deepEqual(payloads[0].text.mentioned_list, ['@all'])
  assert.match(payloads[0].text.content, /🚨P1远期需求异动/)
  assert.match(payloads[0].text.content, /不能仅凭本告警直接调价/)
  assert.doesNotMatch(payloads[0].text.content, /^用途｜/m)
  assert.ok(
    Buffer.byteLength(payloads[0].text.content, 'utf8')
      <= futureDemandRiskLimits.maxMessageBytes,
  )
})

test('many future P1 dates are batched into one bounded message', () => {
  const candidates = selectFutureDemandRiskCandidates({
    hotelId: hotel.hotelId,
    snapshot,
    riskStates: {},
  })
  const payloads = createFutureDemandP1WeComPayloads(
    hotel,
    snapshot,
    candidates,
  )
  assert.equal(payloads.length, 1)
  assert.match(
    payloads[0].text.content,
    new RegExp(`触发${candidates.length}个入住日`),
  )
  assert.ok(
    Buffer.byteLength(payloads[0].text.content, 'utf8')
      <= futureDemandRiskLimits.maxMessageBytes,
  )
})

test('active future P1 re-alerts at +5 points or hourly net +3 only once per run', () => {
  const row = dailyRow(20, 22, 3)
  const current = {
    ...snapshot,
    collectionRunId: 'run-future-002',
    futureBookingChanges: {
      ...snapshot.futureBookingChanges,
      daily: [row],
    },
  }
  const riskStates = {
    [`${hotel.hotelId}:${row.stayDate}`]: {
      active: true,
      stayDate: row.stayDate,
      lastAlertOccupancy: 20,
      lastAlertRunId: 'run-future-001',
    },
  }
  const velocity = selectFutureDemandRiskCandidates({
    hotelId: hotel.hotelId,
    snapshot: current,
    riskStates,
  })
  assert.equal(velocity.length, 1)
  assert.deepEqual(velocity[0].reasons, ['HOURLY_NET_3'])

  riskStates[velocity[0].stateKey] =
    futureDemandRiskStateAfterDelivery(velocity[0], current)
  assert.equal(
    selectFutureDemandRiskCandidates({
      hotelId: hotel.hotelId,
      snapshot: current,
      riskStates,
    }).length,
    0,
  )

  const plusFive = {
    ...current,
    collectionRunId: 'run-future-003',
    futureBookingChanges: {
      ...current.futureBookingChanges,
      daily: [dailyRow(20, 27, 0)],
    },
  }
  const pace = selectFutureDemandRiskCandidates({
    hotelId: hotel.hotelId,
    snapshot: plusFive,
    riskStates,
  })
  assert.equal(pace.length, 1)
  assert.deepEqual(pace[0].reasons, ['GAIN_5_POINTS'])
})

test('future P1 state clears below 20 percent so a later recross can alert', () => {
  const row = dailyRow(20, 18, 0)
  const key = `${hotel.hotelId}:${row.stayDate}`
  const riskStates = {
    [key]: {
      active: true,
      stayDate: row.stayDate,
      lastAlertOccupancy: 22,
      lastAlertRunId: 'run-old',
    },
  }
  const changed = reconcileFutureDemandRiskStates({
    hotelId: hotel.hotelId,
    snapshot: {
      ...snapshot,
      futureBookingChanges: {
        ...snapshot.futureBookingChanges,
        daily: [row],
      },
    },
    riskStates,
  })
  assert.equal(changed, true)
  assert.equal(riskStates[key].active, false)

  const recross = {
    ...snapshot,
    collectionRunId: 'run-recross',
    futureBookingChanges: {
      ...snapshot.futureBookingChanges,
      daily: [dailyRow(20, 20, 0)],
    },
  }
  assert.deepEqual(
    selectFutureDemandRiskCandidates({
      hotelId: hotel.hotelId,
      snapshot: recross,
      riskStates,
    })[0].reasons,
    ['CROSS_20_PERCENT'],
  )
})
