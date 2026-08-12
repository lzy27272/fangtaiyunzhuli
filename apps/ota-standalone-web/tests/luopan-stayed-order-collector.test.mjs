import assert from 'node:assert/strict'
import test from 'node:test'
import {
  summarizeLuopanStayedOrderPages,
} from '../../../tools/uat/luopan-stayed-order-collector.mjs'

const base = {
  hotelId: 'hotel-009',
  businessDate: '2026-08-12',
  secretKey: 'test-only-secret-key-with-enough-entropy',
}

test('Luopan stayed-order summary deduplicates checked-out registrations without persisting identifiers', () => {
  const summary = summarizeLuopanStayedOrderPages({
    ...base,
    pages: [
      [
        { recordKey: 'registration-a', status: '已退房', checkoutDate: '2026-08-01' },
        { recordKey: 'registration-b', status: '已离店', checkoutDate: '2026-08-11' },
        { recordKey: 'registration-b', status: '已离店', checkoutDate: '2026-08-11' },
      ],
      [
        { recordKey: 'registration-c', status: '作废', checkoutDate: '2026-08-10' },
        { recordKey: 'registration-d', status: '已退房', checkoutDate: '2026-07-31' },
      ],
    ],
  })

  assert.equal(summary.monthStart, '2026-08-01')
  assert.equal(summary.throughDate, '2026-08-11')
  assert.equal(summary.validStayedOrderCount, 2)
  assert.equal(summary.fetchedRowCount, 5)
  assert.equal(summary.pageCount, 2)
  assert.deepEqual(summary.statusCounts, {
    CHECKED_OUT: 4,
    IN_HOUSE: 0,
    INVALID: 1,
    OTHER: 0,
  })
  assert.equal(summary.storesGuestData, false)
  assert.equal(summary.storesRawRegisterNumbers, false)
  assert.equal(Object.hasOwn(summary, 'records'), false)
  assert.equal(Object.hasOwn(summary, 'identifiers'), false)
})

test('Luopan stayed-order summary refuses unexpected status values', () => {
  assert.throws(
    () => summarizeLuopanStayedOrderPages({
      ...base,
      pages: [[{
        recordKey: 'registration-x',
        status: '待确认',
        checkoutDate: '2026-08-10',
      }]],
    }),
    /LUOPAN_STAYED_ORDER_STATUS_UNRECOGNIZED/,
  )
})
