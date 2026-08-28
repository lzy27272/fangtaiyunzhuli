import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectLiveReports,
  monitorFromSnapshot,
} from '../../../tools/uat/live-report-collector.mjs'
import {
  futureBookingChangesForLuopan,
} from '../../../tools/uat/luopan-controlled-browser-collector.mjs'

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
        {
          estimatedDate: '2026-07-27',
          roomCount: 10,
          availableRoom: version === 1 ? 8 : 5,
          saleRoom: version === 1 ? 2 : 5,
          estimatedRoomFee: version === 1 ? 400 : 1150,
          estimatedRoomNights: version === 1 ? 2 : 5,
          estimatedRentRate: version === 1 ? 0.2 : 0.5,
          estimatedAvgRoomPrice: version === 1 ? 200 : 230,
          estimatedRevpar: version === 1 ? 40 : 115,
        },
        {
          estimatedDate: '2026-07-28',
          roomCount: 10,
          availableRoom: version === 1 ? 9 : 8,
          saleRoom: version === 1 ? 1 : 2,
          estimatedRoomFee: version === 1 ? 220 : 460,
          estimatedRoomNights: version === 1 ? 1 : 2,
          estimatedRentRate: version === 1 ? 0.1 : 0.2,
          estimatedAvgRoomPrice: version === 1 ? 220 : 230,
          estimatedRevpar: version === 1 ? 22 : 46,
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
    body: init.body ? JSON.parse(init.body) : null,
    headers: new Headers(init.headers),
  })
  const body =
    target.pathname.includes('/night/audit/businessDate')
      ? {
          code: 10000,
          data: {
            businessDate: 20260726,
            businessBeginTime: 1785007210000,
          },
        }
      : responseSet(version)[target.pathname]
  return new Response(JSON.stringify(body), {
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
  assert.equal(
    result.monitor.sources[0].sourceId,
    result.snapshot.sources[0].sourceId,
  )
  assert.equal(
    result.monitor.sources[0].reportType,
    result.snapshot.sources[0].reportType,
  )
  assert.ok(result.monitor.inventory.every((room) => room.state === 'UNAVAILABLE'))
  assert.equal(
    result.snapshot.orders.some((item) => item.channel === 'DOUYIN'),
    true,
  )
  assert.equal(JSON.stringify(result.snapshot).includes('"A"'), false)
  assert.equal(JSON.stringify(result.snapshot).includes('"B"'), false)
  assert.equal(result.snapshot.futureDaily.length, 2)
  assert.equal(result.snapshot.futureDaily[0].stayDate, '2026-07-27')
  assert.equal(result.snapshot.futureBookingChanges.daily.length, 3)
  assert.deepEqual(
    {
      stayDate: result.snapshot.futureBookingChanges.daily[0].stayDate,
      bookedRoomNights:
        result.snapshot.futureBookingChanges.daily[0].bookedRoomNights,
      availableRooms:
        result.snapshot.futureBookingChanges.daily[0].availableRooms,
      occupancyPercent:
        result.snapshot.futureBookingChanges.daily[0].occupancyPercent,
      adr: result.snapshot.futureBookingChanges.daily[0].adr,
    },
    {
      stayDate: '2026-07-26',
      bookedRoomNights: 6,
      availableRooms: 4,
      occupancyPercent: 60,
      adr: 166.67,
    },
  )
  assert.equal(
    result.snapshot.futureBookingChanges.basis,
    'BASELINE_PENDING',
  )

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
  const futureRequest = requests.find((item) =>
    item.path.endsWith('/report/jy09'))
  assert.deepEqual(futureRequest.body, {
    hotelId: '602758915',
    startDate: '2026-07-26',
    endDate: '2026-10-24',
    dimension: 'Hotel',
  })
})

test('night audit business date replaces the stale configured report date', async () => {
  const requests = []
  const result = await collectLiveReports({
    hotel,
    sources,
    cookiesBySourceId,
    previousSnapshots: [],
    secretKey: 'unit-test-hmac-key',
    reportDate: '2026-07-25',
    now: new Date('2026-07-26T04:00:00Z'),
    fetchImpl: fetchFor(1, requests),
  })

  assert.equal(result.snapshot.businessDate, '2026-07-26')
  assert.equal(result.snapshot.previousBusinessDate, '2026-07-25')
  assert.equal(result.snapshot.businessDateChanged, true)
  assert.equal(result.snapshot.businessDateBasis, 'PMS_CONFIRMED')
  assert.equal(
    result.snapshot.businessDateSource,
    'PMS_NIGHT_AUDIT_API',
  )
  assert.equal(
    result.snapshot.businessDateStartedAt,
    '2026-07-26T03:20:10+08:00',
  )
  assert.equal(result.run.businessDateChanged, true)
  const datedRequests = requests.filter((request) => request.body)
  assert.ok(datedRequests.length >= 3)
  assert.ok(
    datedRequests.every((request) =>
      request.body.startDate === '2026-07-26'),
  )
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

test('a PMS switch never treats the previous connector as an hourly baseline', async () => {
  const oldConnector = await collectLiveReports({
    hotel,
    sources,
    cookiesBySourceId,
    previousSnapshots: [],
    secretKey: 'unit-test-hmac-key',
    now: new Date('2026-07-26T10:00:00Z'),
    fetchImpl: fetchFor(1, []),
  })
  const current = await collectLiveReports({
    hotel,
    sources,
    cookiesBySourceId,
    previousSnapshots: [{
      ...oldConnector.snapshot,
      sourceSystem: 'LUOPAN_CLOUD',
      orders: [],
    }],
    secretKey: 'unit-test-hmac-key',
    now: new Date('2026-07-26T11:00:00Z'),
    fetchImpl: fetchFor(2, []),
  })

  assert.equal(current.monitor.hourlyDelta.basis, 'BASELINE_PENDING')
  assert.equal(
    current.snapshot.futureBookingChanges.basis,
    'BASELINE_PENDING',
  )
})

test('08:00 first brief summarizes changes since the final 01:00 snapshot', async () => {
  const finalBeforePause = await collectLiveReports({
    hotel,
    sources,
    cookiesBySourceId,
    previousSnapshots: [],
    secretKey: 'unit-test-hmac-key',
    now: new Date('2026-07-25T17:00:00Z'),
    fetchImpl: fetchFor(1, []),
  })
  const firstMorningBrief = await collectLiveReports({
    hotel,
    sources,
    cookiesBySourceId,
    previousSnapshots: [finalBeforePause.snapshot],
    secretKey: 'unit-test-hmac-key',
    now: new Date('2026-07-26T00:00:00Z'),
    fetchImpl: fetchFor(2, []),
  })

  assert.equal(
    firstMorningBrief.monitor.hourlyDelta.basis,
    'HOURLY_SNAPSHOT_DIFF',
  )
  assert.equal(
    firstMorningBrief.monitor.hourlyDelta.aggregationWindow,
    'PAUSE_TO_FIRST_BRIEF',
  )
  assert.equal(
    firstMorningBrief.monitor.hourlyDelta.intervalStartAt,
    '2026-07-26T01:00:00+08:00',
  )
  assert.equal(
    firstMorningBrief.monitor.hourlyDelta.intervalEndAt,
    '2026-07-26T08:00:00+08:00',
  )
  assert.deepEqual(firstMorningBrief.monitor.hourlyDelta.totals, {
    newRoomNights: 1,
    todayRoomNights: 1,
    futureRoomNights: 0,
    canceledRoomNights: 1,
  })
})

test('ordinary morning briefs compare against the previous two-hour slot', async () => {
  const nineOClock = await collectLiveReports({
    hotel,
    sources,
    cookiesBySourceId,
    previousSnapshots: [],
    secretKey: 'unit-test-hmac-key',
    now: new Date('2026-09-10T01:00:00Z'),
    fetchImpl: fetchFor(1, []),
  })
  const elevenOClock = await collectLiveReports({
    hotel,
    sources,
    cookiesBySourceId,
    previousSnapshots: [nineOClock.snapshot],
    secretKey: 'unit-test-hmac-key',
    now: new Date('2026-09-10T03:00:00Z'),
    fetchImpl: fetchFor(2, []),
  })

  assert.equal(
    elevenOClock.monitor.hourlyDelta.basis,
    'HOURLY_SNAPSHOT_DIFF',
  )
  assert.equal(
    elevenOClock.monitor.hourlyDelta.aggregationWindow,
    'TWO_HOUR',
  )
  assert.equal(
    elevenOClock.monitor.hourlyDelta.intervalStartAt,
    '2026-09-10T09:00:00+08:00',
  )
  assert.equal(
    elevenOClock.monitor.hourlyDelta.intervalEndAt,
    '2026-09-10T11:00:00+08:00',
  )
})

test('future booking changes compare hour, cycle and yesterday baselines', async () => {
  const previousDay = await collectLiveReports({
    hotel,
    sources,
    cookiesBySourceId,
    previousSnapshots: [],
    secretKey: 'unit-test-hmac-key',
    now: new Date('2026-07-25T15:41:00Z'),
    fetchImpl: fetchFor(1, []),
  })
  const hourlyBaseline = {
    ...previousDay.snapshot,
    collectionRunId: 'hourly-future-baseline',
    observedAt: '2026-07-26T10:00:00+08:00',
  }
  const cumulativeBaseline = {
    ...previousDay.snapshot,
    collectionRunId: 'cycle-future-baseline',
    observedAt: '2026-07-26T01:00:00+08:00',
    futureDaily: previousDay.snapshot.futureDaily.map((row) =>
      row.stayDate === '2026-07-27'
        ? { ...row, roomNights: 3, soldRooms: 3 }
        : row),
  }
  const current = await collectLiveReports({
    hotel,
    sources,
    cookiesBySourceId,
    previousSnapshots: [
      previousDay.snapshot,
      cumulativeBaseline,
      hourlyBaseline,
    ],
    secretKey: 'unit-test-hmac-key',
    now: new Date('2026-07-26T03:00:00Z'),
    fetchImpl: fetchFor(2, []),
  })

  assert.equal(
    current.snapshot.futureBookingChanges.hourlyBaselineAt,
    '2026-07-26T10:00:00+08:00',
  )
  assert.equal(
    current.snapshot.futureBookingChanges.previousDayEndAt,
    '2026-07-25T23:41:00+08:00',
  )
  assert.equal(
    current.snapshot.futureBookingChanges.cumulativeBaselineAt,
    '2026-07-26T01:00:00+08:00',
  )
  const july27 = current.snapshot.futureBookingChanges.daily.find(
    (row) => row.stayDate === '2026-07-27',
  )
  const july26 = current.snapshot.futureBookingChanges.daily.find(
    (row) => row.stayDate === '2026-07-26',
  )
  assert.equal(july26.bookedRoomNights, 7)
  assert.equal(july26.availableRooms, 3)
  assert.equal(july26.occupancyPercent, 70)
  assert.equal(july26.hourlyNetRoomNights, 1)
  assert.equal(july26.cumulativeNetRoomNights, 1)
  assert.equal(july26.previousDayNetRoomNights, 1)
  assert.equal(july27.bookedRoomNights, 5)
  assert.equal(july27.occupancyPercent, 50)
  assert.equal(july27.hourlyNetRoomNights, 3)
  assert.equal(july27.cumulativeNetRoomNights, 2)
  assert.equal(july27.previousDayNetRoomNights, 3)
  assert.equal(july27.inferredHourlyAdr, 250)
})

test('Luopan future booking changes keep cycle cumulative separate from yesterday', () => {
  const row = (soldRooms, roomFee = soldRooms * 200) => ({
    stayDate: '2026-08-20',
    soldRooms,
    roomFee,
    occupancyRate: soldRooms,
    adr: 200,
  })
  const previous = (observedAt, soldRooms) => ({
    sourceSystem: 'LUOPAN_CLOUD',
    observedAt,
    businessDate: '2026-08-07',
    completeness: 'COMPLETE',
    overview: {
      roomCount: 50,
      availableRooms: 50 - soldRooms,
      roomNights: soldRooms,
      roomFee: soldRooms * 200,
      occupancyRate: soldRooms * 2,
      adr: 200,
    },
    futureDaily: [row(soldRooms)],
  })
  const current = {
    ...previous('2026-08-07T13:00:00+08:00', 20),
  }
  const changes = futureBookingChangesForLuopan(
    current,
    [
      previous('2026-08-06T23:30:00+08:00', 10),
      previous('2026-08-07T01:00:00+08:00', 12),
      previous('2026-08-07T12:00:00+08:00', 19),
    ],
    new Date(current.observedAt).getTime(),
  )

  assert.equal(changes.hourlyBaselineAt, '2026-08-07T12:00:00+08:00')
  assert.equal(changes.cumulativeBaselineAt, '2026-08-07T01:00:00+08:00')
  assert.equal(changes.previousDayEndAt, '2026-08-06T23:30:00+08:00')
  const today = changes.daily.find((item) => item.stayDate === '2026-08-07')
  const august20 = changes.daily.find((item) => item.stayDate === '2026-08-20')
  assert.equal(today.bookedRoomNights, 20)
  assert.equal(today.availableRooms, 30)
  assert.equal(today.hourlyNetRoomNights, 1)
  assert.equal(august20.hourlyNetRoomNights, 1)
  assert.equal(august20.cumulativeNetRoomNights, 8)
  assert.equal(august20.previousDayNetRoomNights, 10)
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
    requests.push({
      path: target.pathname,
      body: init.body ? JSON.parse(init.body) : null,
    })
    const body =
      target.pathname.includes('/night/audit/businessDate')
        ? {
            code: 10000,
            data: {
              businessDate: 20260725,
              businessBeginTime: 1784920810000,
            },
          }
        : target.pathname.endsWith('/batchSearchBaseRoomForcasting')
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

test('collector fails closed when PMS cannot confirm a valid business date', async () => {
  const fetchImpl = async (url, init) => {
    const target = new URL(url)
    const body =
      target.pathname.includes('/night/audit/businessDate')
        ? {
            code: 10000,
            data: {
              businessDate: '2026-02-30',
              businessBeginTime: 1784920810000,
            },
          }
        : responseSet(1)[target.pathname]
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  await assert.rejects(
    collectLiveReports({
      hotel,
      sources,
      cookiesBySourceId,
      previousSnapshots: [],
      secretKey: 'unit-test-hmac-key',
      reportDate: '2026-07-25',
      fetchImpl,
    }),
    /PMS_BUSINESS_DATE_UNAVAILABLE/,
  )
})

test('collector identifies an explicitly rejected PMS session', async () => {
  const fetchImpl = async (url) => {
    const target = new URL(url)
    const body = target.pathname.includes('/night/audit/businessDate')
      ? { code: 10008, data: null }
      : responseSet(1)[target.pathname]
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  await assert.rejects(
    collectLiveReports({
      hotel,
      sources,
      cookiesBySourceId,
      previousSnapshots: [],
      secretKey: 'unit-test-hmac-key',
      reportDate: '2026-07-25',
      fetchImpl,
    }),
    /PMS_SESSION_REAUTH_REQUIRED/,
  )
})
