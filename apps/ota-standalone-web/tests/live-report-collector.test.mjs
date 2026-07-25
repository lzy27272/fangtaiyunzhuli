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
              order({
                orderNo: 'D',
                source: '抖音预付',
                arrive: '2026-07-27',
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
              order({
                orderNo: 'D',
                source: '抖音预付',
                arrive: '2026-07-27',
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
  assert.equal(
    result.snapshot.orders.some((item) => item.channel === 'DOUYIN'),
    true,
  )
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

test('room forecast payload follows the PMS business day and fills room availability', async () => {
  const forecastSource = {
    sourceId: 'forecast-source',
    endpointUrl:
      'https://pms.meituan.com/hotelpms/api/v2/report/roomState/batchSearchBaseRoomForcasting',
    reportType: 'PHYSICAL_INVENTORY',
    enabled: true,
    requestPayloadJson: JSON.stringify({
      roomTypes: [
        { id: 'KING', roomTypeName: '测试大床房', description: null },
        { id: 'TWIN', roomTypeName: '测试双床房', description: null },
      ],
      beginHour: '18:00',
      channelKey: 'Hotel',
      beginDate: '2000-01-01 00:00:00',
      endDate: '2000-01-30 00:00:00',
    }),
  }
  const allSources = [...sources, forecastSource]
  const allCookies = {
    ...cookiesBySourceId,
    [forecastSource.sourceId]: `${cookie}; _lxsdk_cuid=test-client-id`,
  }
  const requests = []
  const fetchImpl = async (url, init) => {
    const target = new URL(url)
    requests.push({ path: target.pathname, body: JSON.parse(init.body) })
    const body =
      target.pathname.endsWith('/batchSearchBaseRoomForcasting')
        ? {
            code: 10000,
            data: [
              {
                roomTypeName: '测试大床房',
                totalCount: '6',
                isAggregation: false,
                details: [
                  {
                    date: '2026-07-25 00:00:00',
                    occupationCount: '6',
                    availableCount: '0',
                    roomRent: 1200,
                    adr: 200,
                    revPar: 200,
                    overbookingCount: '0',
                    checkinCount: '6',
                    orderCount: '0',
                    maintainingCount: '0',
                  },
                ],
              },
              {
                roomTypeName: '测试双床房',
                totalCount: '4',
                isAggregation: false,
                details: [
                  {
                    date: '2026-07-25 00:00:00',
                    occupationCount: '2',
                    availableCount: '2',
                    roomRent: 300,
                    adr: 150,
                    revPar: 75,
                    overbookingCount: '0',
                    checkinCount: '2',
                    orderCount: '0',
                    maintainingCount: '0',
                  },
                ],
              },
              {
                roomTypeName: '汇总',
                totalCount: '10',
                isAggregation: true,
                details: [],
              },
            ],
          }
        : target.pathname.endsWith('/report/jy09')
          ? {
              code: 10000,
              data: {
                dataList: [
                  {
                    estimatedDate: '2026-07-25',
                    roomCount: 10,
                    availableRoom: 2,
                    saleRoom: 8,
                    estimatedRoomFee: 1500,
                    estimatedRoomNights: 8,
                    estimatedRentRate: 0.8,
                    estimatedAvgRoomPrice: 187.5,
                    estimatedRevpar: 150,
                  },
                ],
              },
            }
        : responseSet(1)[target.pathname]
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  const result = await collectLiveReports({
    hotel,
    sources: allSources,
    cookiesBySourceId: allCookies,
    previousSnapshots: [],
    secretKey: 'unit-test-hmac-key',
    reportDate: '2026-07-25',
    businessDateBasis: 'PMS_CONFIRMED',
    now: new Date('2026-07-26T01:00:00Z'),
    fetchImpl,
  })
  const king = result.snapshot.physicalInventory.find(
    (room) => room.displayName === '测试大床房',
  )
  const monitor = monitorFromSnapshot(
    result.snapshot,
    hotel,
    null,
    [king.physicalRoomTypeCode],
  )
  const forecastRequest = requests.find((request) =>
    request.path.endsWith('/batchSearchBaseRoomForcasting'))

  assert.equal(result.run.status, 'SUCCEEDED')
  assert.equal(king.primaryAvailableRooms, 0)
  assert.equal(monitor.hotSellingAlerts[0].state, 'SOLD_OUT')
  assert.equal(monitor.hotSellingAlerts[0].shouldNotify, true)
  assert.equal(forecastRequest.body.beginDate, '2026-07-25 00:00:00')
  assert.equal(forecastRequest.body.endDate, '2026-08-23 00:00:00')
})
