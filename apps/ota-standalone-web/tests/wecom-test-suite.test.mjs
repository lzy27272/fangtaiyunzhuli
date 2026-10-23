import assert from 'node:assert/strict'
import test from 'node:test'
import { createWeComTestSuitePlan } from '../../../tools/uat/wecom/src/wecom-test-suite.mjs'

const hotel = {
  hotelId: 'hotel-001',
  hotelName: '测试酒店',
}

const futureRow = (stayDate, overrides = {}) => ({
  stayDate,
  bookedRoomNights: 2,
  availableRooms: 18,
  roomCount: 20,
  occupancyPercent: 10,
  hourlyNetRoomNights: 0,
  previousDayNetRoomNights: 0,
  adr: 300,
  ...overrides,
})

test('safe WeCom test templates include future room status and a marked P1 risk', () => {
  const snapshot = {
    collectionRunId: 'run-001',
    businessDate: '2026-07-28',
    observedAt: '2026-07-28T10:00:00+08:00',
    futureBookingChanges: {
      daily: [
        futureRow('2026-07-29'),
        futureRow('2026-08-17', {
          bookedRoomNights: 6,
          availableRooms: 14,
          occupancyPercent: 30,
          hourlyNetRoomNights: 3,
        }),
      ],
    },
  }

  const plan = createWeComTestSuitePlan({
    hotelId: hotel.hotelId,
    snapshot,
  })

  assert.equal(plan.requestedTemplateCount, 3)
  assert.deepEqual(
    plan.templates.map((template) => template.templateCode),
    ['TODAY_REVENUE', 'FUTURE_14D', 'P1_FUTURE_DEMAND'],
  )
  assert.deepEqual(plan.skippedTemplates, [])

  for (const template of plan.templates.filter(
    (item) => typeof item.payloadFactory === 'function',
  )) {
    const payloads = template.payloadFactory({ hotel, snapshot })
    assert.equal(payloads.length, 1)
    assert.deepEqual(payloads[0].text.mentioned_list, [])
    if (template.templateCode === 'P1_FUTURE_DEMAND') {
      assert.match(payloads[0].text.content, /^🧪测试消息｜P1远期需求异动\n/u)
      assert.doesNotMatch(payloads[0].text.content, /^🚨P1远期需求异动\n/u)
    }
  }
})

test('P1 test template is skipped instead of fabricating a future demand risk', () => {
  const snapshot = {
    collectionRunId: 'run-002',
    businessDate: '2026-07-28',
    observedAt: '2026-07-28T10:30:00+08:00',
    futureBookingChanges: {
      daily: [
        futureRow('2026-07-29'),
        futureRow('2026-08-17', { occupancyPercent: 19 }),
      ],
    },
  }

  const plan = createWeComTestSuitePlan({
    hotelId: hotel.hotelId,
    snapshot,
  })

  assert.deepEqual(
    plan.templates.map((template) => template.templateCode),
    ['TODAY_REVENUE', 'FUTURE_14D'],
  )
  assert.deepEqual(plan.skippedTemplates, [{
    templateCode: 'P1_FUTURE_DEMAND',
    reasonCode: 'NO_CURRENT_RISK',
  }])
}
)

test('safe future test templates require actual future room data, not a current-day change row or placeholders', () => {
  for (const daily of [
    [],
    [futureRow('2026-07-28')],
    [futureRow('2026-07-27')],
    [futureRow('2026-08-12')],
    [{ stayDate: '2026-07-29' }],
    [futureRow('2026-07-29', { bookedRoomNights: null })],
    [futureRow('2026-07-29', { roomCount: null, availableRooms: null })],
    [futureRow('2026-07-32')],
  ]) {
    const plan = createWeComTestSuitePlan({
      hotelId: hotel.hotelId,
      snapshot: { businessDate: '2026-07-28', futureDaily: [], futureBookingChanges: { daily } },
    })
    assert.equal(plan.templates.some(template => template.templateCode === 'FUTURE_14D'), false,
      JSON.stringify(daily))
    assert.ok(plan.skippedTemplates.some(template => template.templateCode === 'FUTURE_14D'
      && template.reasonCode === 'FUTURE_BOOKING_SNAPSHOT_REQUIRED'))
  }
})

test('safe future test templates preserve a real zero-booking future row', () => {
  const plan = createWeComTestSuitePlan({
    hotelId: hotel.hotelId,
    snapshot: { businessDate: '2026-07-28', futureBookingChanges: {
      daily: [futureRow('2026-07-29', { bookedRoomNights: 0, availableRooms: 20, occupancyPercent: 0 })],
    } },
  })
  assert.ok(plan.templates.some(template => template.templateCode === 'FUTURE_14D'))
})
