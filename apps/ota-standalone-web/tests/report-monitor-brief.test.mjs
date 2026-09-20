import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createReportMonitorWeComPayloads,
  reportMonitorBriefLimits,
} from '../../../tools/uat/wecom/src/report-monitor-brief.mjs'
import {
  DAILY_ORDER_CHANNELS,
  LEGACY_DAILY_ORDER_SUMMARY_BASIS,
  createDailyOrderSummary,
} from '../../../tools/uat/daily-order-summary.mjs'

const monitor = {
  collectionRunId: 'run-brief-001',
  hotelName: '喷水池态六酒店',
  businessDate: '2026-07-25',
  cutoffAt: '2026-07-26T02:02:03+08:00',
  completeness: 'COMPLETE',
  sources: [
    { sourceCode: 'ORDER', completeness: 'COMPLETE' },
    { sourceCode: 'OVERVIEW', completeness: 'COMPLETE' },
    { sourceCode: 'INVENTORY', completeness: 'COMPLETE' },
    { sourceCode: 'FORECAST', completeness: 'COMPLETE' },
  ],
  metrics: {
    totalRevenue: { value: 18440.65, state: 'AVAILABLE' },
    adr: { value: 388.22, state: 'AVAILABLE' },
    revPar: { value: 392.35, state: 'AVAILABLE' },
    soldRooms: { value: 47.5, state: 'AVAILABLE' },
    availableRooms: { value: 0, state: 'AVAILABLE' },
    sellProgress: { value: 101.06, state: 'AVAILABLE' },
    targetProgress: { value: null, state: 'NOT_CONFIGURED' },
  },
  inventory: [
    {
      displayName: 'TAI-PLUS大床房',
      primaryAvailableRooms: 0,
      otaAvailableRooms: {},
    },
    {
      displayName: 'TAI-PRO双床房',
      primaryAvailableRooms: 0,
      otaAvailableRooms: {},
    },
  ],
  hourlyDelta: {
    basis: 'HOURLY_SNAPSHOT_DIFF',
    intervalStartAt: '2026-07-26T01:02:00+08:00',
    intervalEndAt: '2026-07-26T02:02:03+08:00',
    totals: {
      newRoomNights: 4,
      todayRoomNights: 1,
      futureRoomNights: 3,
      canceledRoomNights: 1,
    },
    byChannel: {
      MEITUAN: {
        newRoomNights: 2,
        todayRoomNights: 1,
        futureRoomNights: 1,
        canceledRoomNights: 0,
      },
      FEIZHU: {
        newRoomNights: 1,
        todayRoomNights: 0,
        futureRoomNights: 1,
        canceledRoomNights: 0,
      },
      DOUYIN: {
        newRoomNights: 1,
        todayRoomNights: 0,
        futureRoomNights: 1,
        canceledRoomNights: 0,
      },
      UNKNOWN: {
        newRoomNights: 0,
        todayRoomNights: 0,
        futureRoomNights: 0,
        canceledRoomNights: 1,
      },
    },
    metricDelta: {
      roomFee: 166,
      adr: -0.92,
      revPar: 3.32,
      roomNights: 1,
    },
  },
  hotSellingAlerts: [
    {
      displayName: 'TAI-PLUS大床房',
      availableRooms: 0,
      state: 'SOLD_OUT',
    },
  ],
}

const snapshot = {
  businessDate: '2026-07-25',
  observedAt: '2026-07-26T02:02:18+08:00',
  overview: { roomCount: 47 },
  orders: [
    {
      channel: 'MEITUAN',
      status: 'ACTIVE',
      roomNights: 9,
      arrivalClass: 'TODAY',
      orderDate: '2026-07-25',
    },
    {
      channel: 'MEITUAN',
      status: 'ACTIVE',
      roomNights: 24,
      arrivalClass: 'FUTURE',
      orderDate: '2026-07-25',
    },
    {
      channel: 'MEITUAN',
      status: 'CANCELLED',
      roomNights: 7,
      arrivalClass: 'TODAY',
      orderDate: '2026-07-25',
    },
    {
      channel: 'DOUYIN',
      status: 'ACTIVE',
      roomNights: 6,
      arrivalClass: 'TODAY',
      orderDate: '2026-07-25',
    },
    {
      channel: 'DOUYIN',
      status: 'ACTIVE',
      roomNights: 23,
      arrivalClass: 'FUTURE',
      orderDate: '2026-07-25',
    },
    {
      channel: 'UNKNOWN',
      status: 'ACTIVE',
      roomNights: 2,
      arrivalClass: 'FUTURE',
      orderDate: '2026-07-25',
    },
  ],
}

test('confirmed 1900-byte monitor template omits removed broadcast decorations', () => {
  const payloads = createReportMonitorWeComPayloads(monitor, {
    snapshot,
    briefId: 'brief-001',
    messagePrefix: '手动通道测试',
  })
  const content = payloads[0].text.content

  assert.equal(payloads.length, reportMonitorBriefLimits.partCount)
  assert.equal(payloads[0].msgtype, 'text')
  assert.deepEqual(payloads[0].text.mentioned_list, [])
  assert.doesNotMatch(content, /【UAT测试｜非经营指令】/)
  assert.match(content, /喷水池态六酒店｜今日收益分析/)
  assert.doesNotMatch(content, /手动通道测试/)
  assert.doesNotMatch(content, /^用途｜/m)
  assert.doesNotMatch(content, /隐私处理｜已过滤姓名/)
  assert.doesNotMatch(content, /@所有人/)
  assert.match(
    content,
    /⏰截止 07-26 02:00｜营业日 07-25｜采集 02:02（4\/4完整）/,
  )
  assert.match(content, /房费｜¥18,440.65（↑166.00）/)
  assert.doesNotMatch(content, /售罄｜/)
  assert.doesNotMatch(content, /热销库存｜/)
  assert.doesNotMatch(content, /TAI-PLUS大床房|TAI-PRO双床房/)
  assert.match(content, /渠道顺序｜美团\/抖音\/其他\n今日有效｜64（33\/29\/2）/)
  assert.match(content, /新增｜4（2\/1\/1\/0）/)
  assert.match(content, /P1｜暂无法判断/)
  assert.ok(
    Buffer.byteLength(content, 'utf8')
      <= reportMonitorBriefLimits.maxMessageBytes,
  )
  assert.doesNotMatch(content, / +$/m)
})

test('baseline-pending template does not invent hourly changes', () => {
  const payloads = createReportMonitorWeComPayloads({
    ...monitor,
    hourlyDelta: {
      basis: 'BASELINE_PENDING',
      totals: null,
      byChannel: null,
      metricDelta: null,
    },
  }, {
    snapshot,
    briefId: 'brief-002',
  })
  const content = payloads[0].text.content
  assert.match(content, /✅小时进单｜同PMS一小时前基线待建立/)
  assert.doesNotMatch(content, /新增｜4/)
})

test('trusted-device brief uses redacted daily order aggregates', () => {
  const payloads = createReportMonitorWeComPayloads(monitor, {
    snapshot: {
      ...snapshot,
      dailyOrderSummary: createDailyOrderSummary({
        orders: snapshot.orders,
        businessDate: snapshot.businessDate,
      }),
      orders: [],
    },
    orderDataRedacted: true,
  })
  const content = payloads[0].text.content
  assert.match(content, /今日有效｜64（33\/29\/2）/u)
  assert.doesNotMatch(content, /订单数据｜待设备更新后重新采集/u)
})

test('legacy redacted snapshot is unavailable instead of false zero orders', () => {
  const payloads = createReportMonitorWeComPayloads(monitor, {
    snapshot: { ...snapshot, orders: [] },
    orderDataRedacted: true,
  })
  const content = payloads[0].text.content
  assert.match(content, /订单数据｜待设备更新后重新采集/u)
  assert.doesNotMatch(content, /今日有效｜0（0\/0\/0\/0）/u)
})

test('Luopan brief treats its three enabled core sources as complete', () => {
  const payloads = createReportMonitorWeComPayloads({
    ...monitor,
    sources: monitor.sources.slice(0, 3),
  }, {
    snapshot,
    briefId: 'brief-luopan-3-of-3',
  })

  assert.match(payloads[0].text.content, /采集 02:02（3\/3完整）/)
  assert.doesNotMatch(payloads[0].text.content, /部分|缺失/)
})

test('08:00 first brief labels the 01:00 to 08:00 pause summary', () => {
  const payloads = createReportMonitorWeComPayloads({
    ...monitor,
    cutoffAt: '2026-07-26T08:00:03+08:00',
    hourlyDelta: {
      ...monitor.hourlyDelta,
      aggregationWindow: 'PAUSE_TO_FIRST_BRIEF',
      intervalStartAt: '2026-07-26T01:00:00+08:00',
      intervalEndAt: '2026-07-26T08:00:03+08:00',
    },
  }, {
    snapshot: {
      ...snapshot,
      observedAt: '2026-07-26T08:00:18+08:00',
    },
  })
  assert.match(payloads[0].text.content, /✅停播汇总｜01:00→08:00/)
})

test('ordinary morning cadence labels a two-hour order interval', () => {
  const payloads = createReportMonitorWeComPayloads({
    ...monitor,
    cutoffAt: '2026-09-10T11:00:03+08:00',
    hourlyDelta: {
      ...monitor.hourlyDelta,
      aggregationWindow: 'TWO_HOUR',
      intervalStartAt: '2026-09-10T09:00:00+08:00',
      intervalEndAt: '2026-09-10T11:00:03+08:00',
    },
  }, { snapshot })
  assert.match(payloads[0].text.content, /✅两小时进单｜09:00→11:00/)
})

test('hot-selling room names stay out of the today brief', () => {
  const manyRooms = Array.from({ length: 30 }, (_, index) => ({
    displayName: `非常非常长的测试实体房型名称-${index + 1}`,
    primaryAvailableRooms: 0,
    otaAvailableRooms: {},
  }))
  const payload = createReportMonitorWeComPayloads({
    ...monitor,
    inventory: manyRooms,
    hotSellingAlerts: manyRooms.map((room) => ({
      displayName: room.displayName,
      availableRooms: 0,
      state: 'SOLD_OUT',
    })),
  }, { snapshot })[0]
  assert.equal(payload.text.content.includes('非常非常长的测试实体房型名称'), false)
  assert.ok(
    Buffer.byteLength(payload.text.content, 'utf8')
      <= reportMonitorBriefLimits.maxMessageBytes,
  )
})

const dailySection = (content) => content.split('【订单汇报')[1].split('\n\n')[0]
const hourlySection = (content) => content.split('✅小时进单')[1].split('\n\n')[0]
const legacySummaryFor = (value) => {
  const summary = structuredClone(createDailyOrderSummary({
    orders: value.orders, businessDate: value.businessDate,
  }))
  for (const channel of ['CTRIP', 'FRONT_DESK', 'WEDDING']) {
    for (const field of Object.keys(summary.byChannel.OTHER)) {
      summary.byChannel.OTHER[field] += summary.byChannel[channel][field]
    }
    delete summary.byChannel[channel]
  }
  summary.basis = LEGACY_DAILY_ORDER_SUMMARY_BASIS
  return summary
}

const yilianDailySnapshot = {
  ...snapshot,
  orders: [
    { channel: 'CTRIP', roomNights: 2, arrivalClass: 'TODAY' },
    { channel: 'CTRIP', roomNights: 6, arrivalClass: 'FUTURE' },
    { channel: 'DOUYIN', roomNights: 1, arrivalClass: 'TODAY' },
  ].map((row) => ({ ...row, orderDate: snapshot.businessDate, status: 'ACTIVE' })),
}

test('015-style legacy snapshots show Ctrip and Douyin from details, not zero channels or OTHER', () => {
  const input = {
    ...yilianDailySnapshot,
    dailyOrderSummary: legacySummaryFor(yilianDailySnapshot),
  }
  const before = structuredClone(input)
  const content = createReportMonitorWeComPayloads(monitor, { snapshot: input })[0].text.content
  const daily = dailySection(content)
  assert.match(daily, /渠道顺序｜携程\/抖音/)
  assert.match(daily, /今日有效｜9（8\/1）/)
  assert.match(daily, /当日入住｜3（2\/1）/)
  assert.match(daily, /远期入住｜6（6\/0）/)
  assert.match(daily, /当前取消｜0（0\/0）/)
  assert.doesNotMatch(daily, /美团|飞猪|其他/)
  assert.deepEqual(input, before)
})

test('redacted V2 snapshots show separate Ctrip without requiring order identities', () => {
  const content = createReportMonitorWeComPayloads(monitor, {
    snapshot: {
      ...yilianDailySnapshot,
      dailyOrderSummary: createDailyOrderSummary({
        orders: yilianDailySnapshot.orders,
        businessDate: yilianDailySnapshot.businessDate,
      }),
      orders: [],
    },
    orderDataRedacted: true,
  })[0].text.content
  assert.match(dailySection(content), /渠道顺序｜携程\/抖音\n今日有效｜9（8\/1）/)
})

test('legacy aggregates without details show totals and an explicit collection-upgrade notice', () => {
  for (const orderDataRedacted of [true, false]) {
    const content = createReportMonitorWeComPayloads(monitor, {
      snapshot: {
        ...yilianDailySnapshot,
        dailyOrderSummary: legacySummaryFor(yilianDailySnapshot),
        orders: [],
      },
      orderDataRedacted,
    })[0].text.content
    const daily = dailySection(content)
    assert.match(daily, /旧汇总未拆分携程/)
    assert.match(daily, /今日有效｜9\n/)
    assert.doesNotMatch(daily, /渠道顺序|其他|（8\/1）/)
  }
})

test('channels appear after their first same-day order, including cancellation-only and unknown channels', () => {
  const input = structuredClone(yilianDailySnapshot)
  input.orders.push({
    channel: 'MEITUAN', roomNights: 99, arrivalClass: 'TODAY',
    status: 'ACTIVE', orderDate: '2026-07-24',
  })
  let daily = dailySection(createReportMonitorWeComPayloads(monitor, { snapshot: input })[0].text.content)
  assert.doesNotMatch(daily, /美团|飞猪|其他/)
  input.orders.push(
    { channel: 'MEITUAN', roomNights: 0.5, arrivalClass: 'TODAY', status: 'ACTIVE', orderDate: snapshot.businessDate },
    { channel: 'FEIZHU', roomNights: 1, arrivalClass: 'TODAY', status: 'CANCELLED', orderDate: snapshot.businessDate },
    { channel: 'UNKNOWN', roomNights: 2, arrivalClass: 'FUTURE', status: 'ACTIVE', orderDate: snapshot.businessDate },
  )
  daily = dailySection(createReportMonitorWeComPayloads(monitor, { snapshot: input })[0].text.content)
  assert.match(daily, /渠道顺序｜携程\/美团\/飞猪\/抖音\/其他/)
  assert.match(daily, /今日有效｜11\.50（8\/0\.50\/0\/1\/2）/)
  assert.match(daily, /当前取消｜1（0\/0\/1\/0\/0）/)
})

test('all-zero daily and hourly data omit channel placeholders without hiding the zero totals', () => {
  const zeroDelta = {
    newRoomNights: 0, todayRoomNights: 0, futureRoomNights: 0, canceledRoomNights: 0,
  }
  const content = createReportMonitorWeComPayloads({
    ...monitor,
    hourlyDelta: {
      ...monitor.hourlyDelta,
      totals: zeroDelta,
      byChannel: Object.fromEntries(DAILY_ORDER_CHANNELS.map((channel) => [channel, zeroDelta])),
    },
  }, { snapshot: { ...snapshot, orders: [] } })[0].text.content
  assert.match(content, /订单渠道｜今日暂无订单\n今日有效｜0/)
  assert.match(content, /本时段暂无订单变动\n新增｜0｜当日｜0/)
  assert.doesNotMatch(content, /渠道顺序|美团|飞猪|抖音|携程|其他|（0\/0/)
})

test('hourly Ctrip stays separate, with cancellations retained and empty channels omitted', () => {
  const content = createReportMonitorWeComPayloads({
    ...monitor,
    hourlyDelta: {
      ...monitor.hourlyDelta,
      totals: { newRoomNights: 3, todayRoomNights: 1, futureRoomNights: 2, canceledRoomNights: 1 },
      byChannel: {
        CTRIP: { newRoomNights: 3, todayRoomNights: 1, futureRoomNights: 2, canceledRoomNights: 0 },
        FEIZHU: { newRoomNights: 0, todayRoomNights: 0, futureRoomNights: 0, canceledRoomNights: 1 },
        MEITUAN: { newRoomNights: 0, todayRoomNights: 0, futureRoomNights: 0, canceledRoomNights: 0 },
      },
    },
  }, { snapshot: yilianDailySnapshot })[0].text.content
  const hourly = hourlySection(content)
  assert.match(hourly, /渠道顺序｜携程\/飞猪/)
  assert.match(hourly, /新增｜3（3\/0）｜当日｜1（1\/0）/)
  assert.match(hourly, /远期｜2（2\/0）｜取消｜1（0\/1）/)
  assert.doesNotMatch(hourly, /美团|抖音|其他/)
})

test('all supported display buckets fit the confirmed WeCom byte budget', () => {
  const orders = DAILY_ORDER_CHANNELS.map((channel) => ({
    channel, status: 'ACTIVE', roomNights: 12, arrivalClass: 'TODAY', orderDate: snapshot.businessDate,
  }))
  const content = createReportMonitorWeComPayloads({
    ...monitor,
    hourlyDelta: {
      ...monitor.hourlyDelta,
      totals: { newRoomNights: 84, todayRoomNights: 84, futureRoomNights: 0, canceledRoomNights: 0 },
      byChannel: Object.fromEntries(DAILY_ORDER_CHANNELS.map((channel) => [channel, {
        newRoomNights: 12, todayRoomNights: 12, futureRoomNights: 0, canceledRoomNights: 0,
      }])),
    },
  }, { snapshot: { ...snapshot, orders } })[0].text.content
  assert.equal(content.match(/渠道顺序｜携程\/美团\/飞猪\/抖音\/前台\/婚宴\/其他/g).length, 2)
  assert.ok(Buffer.byteLength(content, 'utf8') <= reportMonitorBriefLimits.maxMessageBytes)
})
