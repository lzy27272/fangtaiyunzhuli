import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectLiveReports,
  monitorFromSnapshot,
} from '../../../tools/uat/live-report-collector.mjs'

const hotel = {
  tenantId: 'tenant-001',
  hotelId: 'hotel-001',
  hotelName: '喷水池态六酒店',
  timezone: 'Asia/Shanghai',
}

const sources = [
  {
    sourceId: 'order-source',
    endpointUrl: 'https://pms.meituan.com/hotelpms/api/v1/report/jd01',
    reportType: 'ORDER_DETAIL',
    enabled: true,
  },
  {
    sourceId: 'overview-source',
    endpointUrl: 'https://pms.meituan.com/hotelpms/api/v2/report/jy09',
    reportType: 'CUSTOM_REPORT',
    enabled: true,
  },
  {
    sourceId: 'room-source',
    endpointUrl:
      'https://pms.meituan.com/hotelpms/api/v1/report/lion/manager/workbench/room',
    reportType: 'PHYSICAL_INVENTORY',
    enabled: true,
  },
]

const cookie = [
  'hotelpms_login_hotel_id=602758915',
  'hotelpms_login_org_id=5621650',
  'hotelpms_tenant_id=13084645',
  'hotelpms_token=test-only-token-value',
].join('; ')

const cookiesBySourceId = Object.fromEntries(
  sources.map((source) => [source.sourceId, cookie]),
)

const order = ({
  orderNo,
  status = '已确认',
  source = '美团',
  arrive = '2026-07-26',
  depart = '2026-07-27',
  rooms = 1,
}) => ({
  orderNo,
  orderDate: '2026-07-26',
  orderStatus: status,
  orderSource: source,
  estArriveTime: `${arrive} 14:00:00`,
  estDepatureTime: `${depart} 12:00:00`,
  roomType: '测试房型',
  roomCount: rooms,
  roomPrice: 300,
})

const responseSet = (version) => ({
  '/hotelpms/api/v1/report/jd01': {
    code: 10000,
    data: {
      dataList:
        version === 1
          ? [
              order({ orderNo: 'A' }),
              order({
                orderNo: 'B',
                source: '携程',
                arrive: '2026-07-27',
                depart: '2026-07-29',
                rooms: 2,
              }),
            ]
          : [
              order({ orderNo: 'A', status: '已取消' }),
              order({
                orderNo: 'B',
                source: '携程',
                arrive: '2026-07-27',
                depart: '2026-07-29',
                rooms: 2,
              }),
              order({ orderNo: 'C' }),
            ],
    },
  },
  '/hotelpms/api/v2/report/jy09': {
    code: 10000,
    data: {
      dataList: [
        {
          estimatedDate: '2026-07-26',
          roomCount: 10,
          availableRoom: version === 1 ? 4 : 3,
          saleRoom: version === 1 ? 6 : 7,
          estimatedRoomFee: version === 1 ? 1000 : 1100,
          estimatedRoomNights: version === 1 ? 6 : 7,
          estimatedRentRate: version === 1 ? 0.6 : 0.7,
          estimatedAvgRoomPrice: version === 1 ? 166.67 : 157.14,
          estimatedRevpar: version === 1 ? 100 : 110,
        },
      ],
    },
  },
  '/hotelpms/api/v1/report/lion/manager/workbench/room': {
    code: 10000,
    data: [
      {
        roomName: '测试大床房',
        roomNum: 6,
        availableRoomNum: version === 1 ? 2 : 1,
        estimatedRoomNights: version === 1 ? 4 : 5,
        estimatedRoomAmt: 800,
        estimatedAvgRoomPrice: 200,
      },
      {
        roomName: '测试双床房',
        roomNum: 4,
        availableRoomNum: 2,
        estimatedRoomNights: 2,
        estimatedRoomAmt: 300,
        estimatedAvgRoomPrice: 150,
      },
    ],
  },
})

const fetchFor = (version, requests) => async (url, init) => {
  const target = new URL(url)
  requests.push({
    path: target.pathname,
    body: JSON.parse(init.body),
    headers: new Headers(init.headers),
  })
  return new Response(JSON.stringify(responseSet(version)[target.pathname]), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

test('collector creates a safe real baseline from all three PMS reports', async () => {
  const requests = []
  const result = await collectLiveReports({
    hotel,
    sources,
    cookiesBySourceId,
    previousSnapshots: [],
    secretKey: 'unit-test-hmac-key',
    target: { roomRevenueTarget: '2000.00' },
    now: new Date('2026-07-26T10:00:00Z'),
    fetchImpl: fetchFor(1, requests),
  })

  assert.equal(result.run.status, 'SUCCEEDED')
  assert.equal(result.run.outboundDeliveryAttempted, false)
  assert.equal(result.monitor.simulationMode, false)
  assert.equal(result.monitor.metrics.totalRevenue.value, 1000)
  assert.equal(result.monitor.metrics.soldRooms.value, 6)
  assert.equal(result.monitor.metrics.targetProgress.value, 50)
  assert.equal(result.monitor.hourlyDelta.basis, 'BASELINE_PENDING')
  assert.equal(result.monitor.inventory.length, 2)
  assert.ok(result.monitor.inventory.every((room) => room.state === 'UNAVAILABLE'))
  assert.equal(JSON.stringify(result.snapshot).includes('"A"'), false)
  assert.equal(JSON.stringify(result.snapshot).includes('"B"'), false)

  const roomRequest = requests.find((item) =>
    item.path.endsWith('/lion/manager/workbench/room'))
  assert.equal(roomRequest.headers.get('origin'), 'https://awp.meituan.com')
  assert.equal(
    roomRequest.headers.get('hotelpms-login-hotel-id'),
    '602758915',
  )
  assert.deepEqual(roomRequest.body, {
    orgId: '602758915',
    timeType: '1',
    startDate: '2026-07-26',
    endDate: '2026-07-26',
  })
})

test('second hourly snapshot reports room-night additions and cancellation transitions', async () => {
  const first = await collectLiveReports({
    hotel,
    sources,
    cookiesBySourceId,
    previousSnapshots: [],
    secretKey: 'unit-test-hmac-key',
    now: new Date('2026-07-26T10:00:00Z'),
    fetchImpl: fetchFor(1, []),
  })
  const second = await collectLiveReports({
    hotel,
    sources,
    cookiesBySourceId,
    previousSnapshots: [first.snapshot],
    secretKey: 'unit-test-hmac-key',
    now: new Date('2026-07-26T11:00:00Z'),
    fetchImpl: fetchFor(2, []),
  })

  assert.equal(second.monitor.hourlyDelta.basis, 'HOURLY_SNAPSHOT_DIFF')
  assert.deepEqual(second.monitor.hourlyDelta.totals, {
    newRoomNights: 1,
    todayRoomNights: 1,
    futureRoomNights: 0,
    canceledRoomNights: 1,
  })
  assert.equal(
    second.monitor.hourlyDelta.byChannel.MEITUAN.newRoomNights,
    1,
  )
  assert.equal(
    second.monitor.hourlyDelta.byChannel.MEITUAN.canceledRoomNights,
    1,
  )
  assert.equal(second.monitor.hourlyDelta.metricDelta.roomFee, 100)
  assert.equal(second.monitor.hourlyDelta.metricDelta.roomNights, 1)
})

test('empty monitor does not expose simulation data or a false zero', () => {
  const monitor = monitorFromSnapshot(null, hotel)
  assert.equal(monitor.simulationMode, false)
  assert.equal(monitor.completeness, 'UNAVAILABLE')
  assert.equal(monitor.metrics.totalRevenue.state, 'UNAVAILABLE')
  assert.equal(monitor.metrics.totalRevenue.value, null)
})

test('configured hot-selling rooms alert only on a reliable zero', () => {
  const monitor = monitorFromSnapshot(
    {
      collectionRunId: 'run-hot-room-test',
      businessDate: '2026-07-25',
      businessDateBasis: 'PMS_CONFIRMED',
      observedAt: '2026-07-26T01:00:00+08:00',
      completeness: 'COMPLETE',
      sources: [],
      overview: null,
      hourlyDelta: {
        basis: 'BASELINE_PENDING',
        intervalStartAt: null,
        intervalEndAt: '2026-07-26T01:00:00+08:00',
        totals: null,
        byChannel: null,
        metricDelta: null,
      },
      physicalInventory: [
        {
          inventoryPoolId: 'room-zero',
          physicalRoomTypeCode: 'ROOM-ZERO',
          displayName: '热销大床房',
          primaryAvailableRooms: 0,
        },
        {
          inventoryPoolId: 'room-unknown',
          physicalRoomTypeCode: 'ROOM-UNKNOWN',
          displayName: '热销双床房',
          primaryAvailableRooms: null,
        },
      ],
    },
    hotel,
    null,
    ['ROOM-ZERO', 'ROOM-UNKNOWN'],
  )

  const soldOut = monitor.hotSellingAlerts.find(
    (alert) => alert.physicalRoomTypeCode === 'ROOM-ZERO',
  )
  const unavailable = monitor.hotSellingAlerts.find(
    (alert) => alert.physicalRoomTypeCode === 'ROOM-UNKNOWN',
  )
  assert.equal(soldOut.state, 'SOLD_OUT')
  assert.equal(soldOut.shouldNotify, true)
  assert.equal(unavailable.state, 'UNAVAILABLE')
  assert.equal(unavailable.shouldNotify, false)
})
