import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createHotSellingSoldOutWeComPayloads,
  hourlyBriefBundleDelivered,
  hotSellingSoldOutAlertLimits,
  selectHotSellingSoldOutAlerts,
} from '../../../tools/uat/wecom/src/hot-selling-sold-out-alert.mjs'
import { selectHourlyDeliveryCandidates } from '../../../tools/uat/wecom/src/hourly-delivery-candidates.mjs'

const monitor = {
  hotelName: '测试酒店',
  businessDate: '2026-08-07',
  cutoffAt: '2026-08-07T14:02:00+08:00',
  hotSellingAlerts: [
    {
      physicalRoomTypeCode: 'HOT-001',
      displayName: '无界PRO大',
      availableRooms: 0,
      state: 'SOLD_OUT',
    },
    {
      physicalRoomTypeCode: 'HOT-002',
      displayName: '无界双床',
      availableRooms: null,
      state: 'UNAVAILABLE',
    },
    {
      physicalRoomTypeCode: 'HOT-003',
      displayName: '无界套房',
      availableRooms: 1,
      state: 'AVAILABLE',
    },
  ],
}

test('standalone alert contains only reliably sold-out hot-selling rooms', () => {
  const selected = selectHotSellingSoldOutAlerts(monitor)
  assert.deepEqual(selected.map((alert) => alert.displayName), ['无界PRO大'])

  const payload = createHotSellingSoldOutWeComPayloads(monitor)[0]
  assert.equal(payload.msgtype, 'text')
  assert.deepEqual(payload.text.mentioned_list, ['@all'])
  assert.match(payload.text.content, /^【热销房型售罄预警】/)
  assert.match(payload.text.content, /售罄房型｜无界PRO大/)
  assert.doesNotMatch(payload.text.content, /无界双床|无界套房/)
  assert.ok(
    Buffer.byteLength(payload.text.content, 'utf8')
      <= hotSellingSoldOutAlertLimits.maxMessageBytes,
  )
})

test('no reliable sold-out room produces no alert candidate', () => {
  const noAlertMonitor = {
    ...monitor,
    hotSellingAlerts: monitor.hotSellingAlerts.slice(1),
  }
  assert.deepEqual(selectHotSellingSoldOutAlerts(noAlertMonitor), [])
  assert.throws(
    () => createHotSellingSoldOutWeComPayloads(noAlertMonitor),
    /HOT_SELLING_SOLD_OUT_NONE/,
  )
})

test('standalone alert waits for both hourly briefs to be delivered', () => {
  const hotelId = 'hotel-001'
  const snapshotHour = '2026-08-07T14'
  const candidate = {
    snapshotHour,
    snapshot: { businessDate: '2026-08-07' },
  }
  const prefix = `${hotelId}:2026-08-07:${snapshotHour}`
  const deliveriesByKey = new Map([
    [`${prefix}:HOURLY_UAT_V1`, {
      deliveryStatus: 'DELIVERED',
      completedAt: '2026-08-07T14:07:00+08:00',
    }],
    [`${prefix}:FUTURE_14D_V1`, {
      deliveryStatus: 'SENDING',
      completedAt: null,
    }],
  ])

  assert.equal(hourlyBriefBundleDelivered({
    hotelId,
    candidate,
    deliveriesByKey,
    now: '2026-08-07T14:09:00+08:00',
  }), false)

  deliveriesByKey.set(
    `${prefix}:FUTURE_14D_V1`,
    {
      deliveryStatus: 'DELIVERED',
      completedAt: '2026-08-07T14:08:30+08:00',
    },
  )
  assert.equal(hourlyBriefBundleDelivered({
    hotelId,
    candidate,
    deliveriesByKey,
    now: '2026-08-07T14:09:29+08:00',
  }), false)
  assert.equal(hourlyBriefBundleDelivered({
    hotelId,
    candidate,
    deliveriesByKey,
    now: '2026-08-07T14:09:30+08:00',
  }), true)
})

test('the standalone alert message key de-duplicates the same hotel hour', () => {
  const hotelId = 'hotel-001'
  const snapshot = {
    businessDate: '2026-08-07',
    observedAt: '2026-08-07T14:02:00+08:00',
    completeness: 'COMPLETE',
  }
  const messageKey =
    `${hotelId}:2026-08-07:2026-08-07T14:HOT_SELLING_SOLD_OUT_V1`
  const selected = selectHourlyDeliveryCandidates({
    hotelId,
    snapshots: [snapshot],
    deliveredMessageKeys: new Set(),
    messageKeySuffix: 'HOT_SELLING_SOLD_OUT_V1',
  })
  assert.equal(selected.length, 1)
  assert.equal(selected[0].messageKey, messageKey)
  assert.deepEqual(selectHourlyDeliveryCandidates({
    hotelId,
    snapshots: [snapshot],
    deliveredMessageKeys: new Set([messageKey]),
    messageKeySuffix: 'HOT_SELLING_SOLD_OUT_V1',
  }), [])
})
