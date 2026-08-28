import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createReportMonitorWeComPayloads,
  reportMonitorBriefLimits,
} from '../../../tools/uat/wecom/src/report-monitor-brief.mjs'

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

test('confirmed 1900-byte monitor template produces one sanitized @all message', () => {
  const payloads = createReportMonitorWeComPayloads(monitor, {
    snapshot,
    briefId: 'brief-001',
    messagePrefix: '手动通道测试',
  })
  const content = payloads[0].text.content

  assert.equal(payloads.length, reportMonitorBriefLimits.partCount)
  assert.equal(payloads[0].msgtype, 'text')
  assert.deepEqual(payloads[0].text.mentioned_list, ['@all'])
  assert.match(content, /^喷水池态六酒店｜今日收益分析/)
  assert.doesNotMatch(content, /UAT测试｜非经营指令/)
  assert.match(content, /喷水池态六酒店｜今日收益分析/)
  assert.doesNotMatch(content, /手动通道测试/)
  assert.doesNotMatch(content, /^用途｜/m)
  assert.doesNotMatch(content, /隐私处理｜已过滤姓名/)
  assert.match(
    content,
    /⏰截止 07-26 02:00｜营业日 07-25｜采集 02:02（4\/4完整）/,
  )
  assert.match(content, /房费｜¥18,440.65（↑166.00）/)
  assert.doesNotMatch(content, /售罄｜/)
  assert.doesNotMatch(content, /热销库存｜/)
  assert.doesNotMatch(content, /TAI-PLUS大床房|TAI-PRO双床房/)
  assert.match(content, /今日有效｜64（33\/0\/29\/2）/)
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
