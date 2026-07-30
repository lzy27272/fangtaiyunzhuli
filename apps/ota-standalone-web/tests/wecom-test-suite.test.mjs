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

test('all applicable WeCom templates include future room status and real P1 risk', () => {
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
