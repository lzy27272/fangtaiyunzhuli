import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildGatewayUrl,
  normalizeBookingCoverage,
  normalizeRevenueCoverage,
  normalizeRoomRentCoverage,
} from '../../../tools/uat/luopan-gateway-local-test.mjs'

test('gateway URL is pinned to the vendor read-only gateway', () => {
  const url = buildGatewayUrl({
    endpoint: '/stat_hotel_daily_room_rent',
    scopeMode: 'hotel',
    scopeId: 'scope-1',
    hotelId: 'hotel-1',
    sobCode: 'code-1',
    password: 'example-secret-value',
    query: { query_date: '2026-08-03' },
  })

  assert.equal(url.origin, 'https://bj-web-r.chinapms.com')
  assert.equal(
    url.pathname,
    '/pms-web/gateway/stat_hotel_daily_room_rent',
  )
  assert.equal(url.searchParams.get('sob.hotel_id'), 'scope-1')
  assert.equal(url.searchParams.get('query_date'), '2026-08-03')
})

test('gateway URL rejects paths outside the allowlisted endpoint shape', () => {
  assert.throws(
    () => buildGatewayUrl({
      endpoint: 'https://example.com/collect',
      scopeMode: 'hotel',
      scopeId: 'scope-1',
      hotelId: 'hotel-1',
      sobCode: 'code-1',
      password: 'example-secret-value',
    }),
    /ENDPOINT_NOT_ALLOWED/,
  )
})

test('room rent and revenue coverage accept documented operational fields', () => {
  assert.equal(normalizeRoomRentCoverage({
    today_date: '2026-08-03',
    total_room: 30,
    avail_room: 8,
    rent_room: 22,
    rent_ratio: 73.33,
    avg_room_rate: 260,
    revpar: 190.67,
  }).contractSatisfied, true)

  assert.equal(normalizeRevenueCoverage({
    today_date: '2026-08-03',
    total_revenue: 7000,
    room_fee_revenue: 6200,
  }).contractSatisfied, true)
})

test('booking coverage keeps only aggregate evidence and reports PII dropped', () => {
  const coverage = normalizeBookingCoverage([{
    hotel_id: 'hotel-1',
    check_in_date: '2026-08-04',
    check_out_date: '2026-08-05',
    total_price: 300,
    order_status: 1,
    card_no: 'not-retained',
    mobile: 'not-retained',
    booker_name: 'not-retained',
    booker_mobile: 'not-retained',
    guests: [{ name: 'not-retained' }],
    room_rates: [{
      room_rate_items: [{
        rate_date: '2026-08-04',
        room_rate: 300,
      }],
    }],
  }])

  assert.equal(coverage.contractSatisfied, true)
  assert.equal(coverage.futureDateCount, 1)
  assert.equal(coverage.piiFieldOccurrencesDropped, 5)
  assert.equal(coverage.piiPersisted, false)
  assert.equal(JSON.stringify(coverage).includes('not-retained'), false)
})
