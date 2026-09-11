import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fingerprintWeComWebhook,
  SafeWeComError,
  sendWeComGroupRobotMessage,
} from '../src/wecom-group-robot.mjs'
import { createCombinedOperationsWeComPayloads } from '../src/combined-operations-brief.mjs'
import { createFutureDemandP1WeComPayloads } from '../src/future-demand-risk.mjs'
import { createHotSellingSoldOutWeComPayloads } from '../src/hot-selling-sold-out-alert.mjs'

const webhook =
  'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=00000000-0000-0000-0000-000000000000'
const payload = {
  msgtype: 'text',
  text: {
    content: '测试酒店｜今日收益分析\n简报内容',
    mentioned_list: [],
  },
}
const endpointSha256 = fingerprintWeComWebhook(webhook)
const operationalPayload = {
  msgtype: 'text',
  text: {
    content: '测试酒店｜今日收益分析\n经营数据',
    mentioned_list: [],
  },
}
const hotSellingMonitor = {
  hotelName: '测试酒店',
  businessDate: '2026-09-11',
  cutoffAt: '2026-09-11T11:00:00+08:00',
  hotSellingAlerts: [{
    physicalRoomTypeCode: 'HOT-001',
    displayName: '无界大床房',
    availableRooms: 0,
    state: 'SOLD_OUT',
  }],
}
const hotSellingAtAllPayload = createHotSellingSoldOutWeComPayloads(
  hotSellingMonitor,
)[0]
const mappedHotSellingAtAllPayload = createHotSellingSoldOutWeComPayloads(
  hotSellingMonitor,
  {
    messagePrefix: '人工复核重试',
    roomTypeMappings: [{
      physicalRoomTypeCode: 'HOT-001',
      platformCode: 'CTRIP',
      otaRoomTypeName: '无界大床房套餐',
    }],
  },
)[0]
const combinedOperationsAtAllPayload = createCombinedOperationsWeComPayloads({
  hotel: { hotelName: '测试酒店' },
  monitor: {
    completeness: 'COMPLETE',
    sources: [{ completeness: 'COMPLETE' }],
    metrics: {
      totalRevenue: { value: 12_680 },
      adr: { value: 428 },
      revPar: { value: 282 },
      soldRooms: { value: 29 },
      availableRooms: { value: 16 },
      sellProgress: { value: 64 },
    },
    hourlyDelta: {
      basis: 'HOURLY_SNAPSHOT_DIFF',
      intervalStartAt: '2026-09-11T10:00:00+08:00',
      intervalEndAt: '2026-09-11T11:00:00+08:00',
      totals: {
        newRoomNights: 2,
        canceledRoomNights: 1,
        todayRoomNights: 1,
      },
    },
  },
  snapshot: {
    businessDate: '2026-09-11',
    observedAt: '2026-09-11T11:00:00+08:00',
    orders: null,
    futureBookingChanges: {
      daily: Array.from({ length: 15 }, (_, index) => ({
        stayDate: `2026-09-${String(11 + index).padStart(2, '0')}`,
        roomCount: 45,
        bookedRoomNights: 20 + index,
        availableRooms: 25 - index,
        occupancyPercent: ((20 + index) / 45) * 100,
        adr: 400 + index,
        hourlyNetRoomNights: index === 2 ? 2 : 0,
        cumulativeNetRoomNights: index,
        previousDayNetRoomNights: index % 3,
      })),
    },
  },
  messagePrefix: '正式合并版',
})[0]

const payloadWithContent = (source, content) => ({
  msgtype: source.msgtype,
  text: {
    content,
    mentioned_list: [...source.text.mentioned_list],
  },
})

const response = (body, { status = 200, ok = true } = {}) => ({
  status,
  ok,
  text: async () => JSON.stringify(body),
})

test('accepts only the exact official webhook shape', () => {
  assert.match(fingerprintWeComWebhook(webhook), /^[a-f0-9]{64}$/)
})

test('rejects non-official hosts and extra query parameters', () => {
  assert.throws(
    () =>
      fingerprintWeComWebhook(
        'https://example.com/cgi-bin/webhook/send?key=00000000-0000-0000-0000-000000000000',
      ),
    (error) =>
      error instanceof SafeWeComError &&
      error.reasonCode === 'WECOM_WEBHOOK_NOT_OFFICIAL',
  )
  assert.throws(
    () =>
      fingerprintWeComWebhook(
        `${webhook}&redirect=https://example.com`,
      ),
    (error) =>
      error instanceof SafeWeComError &&
      error.reasonCode === 'WECOM_WEBHOOK_QUERY_INVALID',
  )
})

test('sends exact text payload without removed decorations through injected fetch', async () => {
  let captured
  const result = await sendWeComGroupRobotMessage({
    rawWebhook: webhook,
    payload,
    expectedEndpointSha256: endpointSha256,
    networkAuthorized: true,
    fetchImpl: async (url, init) => {
      captured = { url, init }
      return response({ errcode: 0, errmsg: 'ok' })
    },
  })
  assert.equal(result.deliveryStatus, 'DELIVERED')
  assert.equal(result.weComCode, 0)
  assert.equal(captured.init.redirect, 'error')
  assert.deepEqual(JSON.parse(captured.init.body), payload)
})

test('approved operational brief does not require visible UAT or privacy lines', async () => {
  let captured
  const result = await sendWeComGroupRobotMessage({
    rawWebhook: webhook,
    payload: operationalPayload,
    expectedEndpointSha256: endpointSha256,
    networkAuthorized: true,
    fetchImpl: async (url, init) => {
      captured = { url, init }
      return response({ errcode: 0, errmsg: 'ok' })
    },
  })
  assert.equal(result.deliveryStatus, 'DELIVERED')
  assert.deepEqual(JSON.parse(captured.init.body), operationalPayload)
})

test('complete generated combined operations brief is approved for at-all', async () => {
  let captured
  const result = await sendWeComGroupRobotMessage({
    rawWebhook: webhook,
    payload: combinedOperationsAtAllPayload,
    deliveryType: 'COMBINED_OPERATIONS',
    expectedEndpointSha256: endpointSha256,
    networkAuthorized: true,
    fetchImpl: async (url, init) => {
      captured = { url, init }
      return response({ errcode: 0, errmsg: 'ok' })
    },
  })
  assert.equal(result.deliveryStatus, 'DELIVERED')
  assert.deepEqual(
    JSON.parse(captured.init.body),
    combinedOperationsAtAllPayload,
  )
})

test('complete generated hot-selling alert is approved for at-all', async () => {
  for (const generatedPayload of [
    hotSellingAtAllPayload,
    mappedHotSellingAtAllPayload,
  ]) {
    let captured
    const result = await sendWeComGroupRobotMessage({
      rawWebhook: webhook,
      payload: generatedPayload,
      deliveryType: 'HOT_SELLING_SOLD_OUT',
      expectedEndpointSha256: endpointSha256,
      networkAuthorized: true,
      fetchImpl: async (url, init) => {
        captured = { url, init }
        return response({ errcode: 0, errmsg: 'ok' })
      },
    })
    assert.equal(result.deliveryStatus, 'DELIVERED')
    assert.equal(result.networkAttempted, true)
    assert.deepEqual(JSON.parse(captured.init.body), generatedPayload)
  }
})

test('at-all warning requires its trusted delivery type before HTTP', async () => {
  let attempts = 0
  await assert.rejects(
    sendWeComGroupRobotMessage({
      rawWebhook: webhook,
      payload: hotSellingAtAllPayload,
      deliveryType: 'TODAY_REVENUE',
      expectedEndpointSha256: endpointSha256,
      networkAuthorized: true,
      fetchImpl: async () => {
        attempts += 1
        return response({ errcode: 0, errmsg: 'ok' })
      },
    }),
    (error) =>
      error instanceof SafeWeComError
      && error.reasonCode === 'WECOM_PAYLOAD_INVALID',
  )
  assert.equal(attempts, 0)
})

test('truncated, forged, and extended at-all templates fail before HTTP', async () => {
  const hotLines = hotSellingAtAllPayload.text.content.split('\n')
  const combinedLines = combinedOperationsAtAllPayload.text.content.split('\n')
  const invalidCases = [
    {
      name: 'truncated hot-selling body',
      deliveryType: 'HOT_SELLING_SOLD_OUT',
      payload: payloadWithContent(
        hotSellingAtAllPayload,
        hotLines.slice(0, -1).join('\n'),
      ),
    },
    {
      name: 'registered hot-selling first line with forged body',
      deliveryType: 'HOT_SELLING_SOLD_OUT',
      payload: payloadWithContent(
        hotSellingAtAllPayload,
        '【热销房型售罄预警】\n任意伪造正文',
      ),
    },
    {
      name: 'lookalike hot-selling first line',
      deliveryType: 'HOT_SELLING_SOLD_OUT',
      payload: payloadWithContent(
        hotSellingAtAllPayload,
        hotSellingAtAllPayload.text.content.replace(
          '【热销房型售罄预警】',
          '【热销房型售罄预警】伪造',
        ),
      ),
    },
    {
      name: 'extra hot-selling line',
      deliveryType: 'HOT_SELLING_SOLD_OUT',
      payload: payloadWithContent(
        hotSellingAtAllPayload,
        `${hotSellingAtAllPayload.text.content}\n额外未登记内容`,
      ),
    },
    {
      name: 'truncated combined operations body',
      deliveryType: 'COMBINED_OPERATIONS',
      payload: payloadWithContent(
        combinedOperationsAtAllPayload,
        combinedLines.slice(0, -1).join('\n'),
      ),
    },
    {
      name: 'registered combined first line with forged body',
      deliveryType: 'COMBINED_OPERATIONS',
      payload: payloadWithContent(
        combinedOperationsAtAllPayload,
        `${combinedLines[0]}\n任意伪造正文`,
      ),
    },
    {
      name: 'lookalike combined first line',
      deliveryType: 'COMBINED_OPERATIONS',
      payload: payloadWithContent(
        combinedOperationsAtAllPayload,
        combinedOperationsAtAllPayload.text.content.replace(
          '｜经营综合简报',
          '｜经营综合简报伪造',
        ),
      ),
    },
    {
      name: 'extra combined operations line',
      deliveryType: 'COMBINED_OPERATIONS',
      payload: payloadWithContent(
        combinedOperationsAtAllPayload,
        `${combinedOperationsAtAllPayload.text.content}\n额外未登记内容`,
      ),
    },
  ]
  let attempts = 0
  for (const invalid of invalidCases) {
    await assert.rejects(
      sendWeComGroupRobotMessage({
        rawWebhook: webhook,
        payload: invalid.payload,
        deliveryType: invalid.deliveryType,
        expectedEndpointSha256: endpointSha256,
        networkAuthorized: true,
        fetchImpl: async () => {
          attempts += 1
          return response({ errcode: 0, errmsg: 'ok' })
        },
      }),
      (error) =>
        error instanceof SafeWeComError
        && error.reasonCode === 'WECOM_PAYLOAD_INVALID',
      invalid.name,
    )
  }
  assert.equal(attempts, 0)
})

test('P1 future demand alert is an approved operational template', async () => {
  const [p1Payload] = createFutureDemandP1WeComPayloads(
    { hotelName: '测试酒店' },
    { observedAt: '2026-09-07T14:00:00+08:00' },
    [{
      stayDate: '2026-10-01',
      dayOffset: 24,
      reasons: ['CROSS_20_PERCENT'],
      row: {
        bookedRoomNights: 6,
        availableRooms: 14,
        roomCount: 20,
        occupancyPercent: 30,
        hourlyNetRoomNights: 3,
      },
    }],
  )
  let captured
  const result = await sendWeComGroupRobotMessage({
    rawWebhook: webhook,
    payload: p1Payload,
    expectedEndpointSha256: endpointSha256,
    networkAuthorized: true,
    fetchImpl: async (url, init) => {
      captured = { url, init }
      return response({ errcode: 0, errmsg: 'ok' })
    },
  })
  assert.equal(result.deliveryStatus, 'DELIVERED')
  assert.deepEqual(JSON.parse(captured.init.body), p1Payload)
})

test('P1 test mode is visibly marked and remains a non-all template', async () => {
  const [p1Payload] = createFutureDemandP1WeComPayloads(
    { hotelName: '测试酒店' },
    { observedAt: '2026-09-07T14:00:00+08:00' },
    [{
      stayDate: '2026-10-01',
      dayOffset: 24,
      reasons: ['CROSS_20_PERCENT'],
      row: {
        bookedRoomNights: 6,
        availableRooms: 14,
        roomCount: 20,
        occupancyPercent: 30,
        hourlyNetRoomNights: 3,
      },
    }],
    { testMode: true },
  )
  let attempts = 0
  const result = await sendWeComGroupRobotMessage({
    rawWebhook: webhook,
    payload: p1Payload,
    expectedEndpointSha256: endpointSha256,
    networkAuthorized: true,
    fetchImpl: async () => {
      attempts += 1
      return response({ errcode: 0, errmsg: 'ok' })
    },
  })
  assert.match(p1Payload.text.content, /^🧪测试消息｜P1远期需求异动\n/u)
  assert.deepEqual(p1Payload.text.mentioned_list, [])
  assert.equal(attempts, 1)
  assert.equal(result.deliveryStatus, 'DELIVERED')
})

test('P1 allowlist still rejects a lookalike unregistered heading', async () => {
  let attempts = 0
  await assert.rejects(
    sendWeComGroupRobotMessage({
      rawWebhook: webhook,
      payload: {
        ...operationalPayload,
        text: {
          ...operationalPayload.text,
          content: '🚨P1远期需求异动测试\n任意内容',
        },
      },
      expectedEndpointSha256: endpointSha256,
      networkAuthorized: true,
      fetchImpl: async () => {
        attempts += 1
        return response({ errcode: 0 })
      },
    }),
    (error) =>
      error instanceof SafeWeComError
      && error.reasonCode === 'WECOM_TEMPLATE_POLICY_REQUIRED',
  )
  assert.equal(attempts, 0)
})

test('registered repair lifecycle notices are approved without group mentions', async () => {
  const headings = [
    '【PMS需要修复处理】',
    '【门店晨间修复完成】',
    '【门店晨间修复未完成】',
    '【罗盘简报自动修复完成】',
    '【罗盘简报自动修复未完成】',
    '【罗盘简报需要人工验证】',
  ]
  let attempts = 0
  for (const heading of headings) {
    const repairPayload = {
      msgtype: 'text',
      text: {
        content: `${heading}\n门店：013 · 测试门店\n处理：登录后台按指引修复。`,
        mentioned_list: [],
      },
    }
    const result = await sendWeComGroupRobotMessage({
      rawWebhook: webhook,
      payload: repairPayload,
      expectedEndpointSha256: endpointSha256,
      networkAuthorized: true,
      fetchImpl: async () => {
        attempts += 1
        return response({ errcode: 0, errmsg: 'ok' })
      },
    })
    assert.equal(result.deliveryStatus, 'DELIVERED')
  }
  assert.equal(attempts, headings.length)
})

test('unregistered markerless text is rejected before HTTP', async () => {
  let attempts = 0
  await assert.rejects(
    sendWeComGroupRobotMessage({
      rawWebhook: webhook,
      payload: {
        ...operationalPayload,
        text: { ...operationalPayload.text, content: '任意未登记消息' },
      },
      expectedEndpointSha256: endpointSha256,
      networkAuthorized: true,
      fetchImpl: async () => {
        attempts += 1
        return response({ errcode: 0 })
      },
    }),
    (error) =>
      error instanceof SafeWeComError
      && error.reasonCode === 'WECOM_TEMPLATE_POLICY_REQUIRED',
  )
  assert.equal(attempts, 0)
})

test('HTTP 200 with nonzero errcode is rejected without exposing errmsg', async () => {
  const secretErrorText = 'secret diagnostic from remote'
  const result = await sendWeComGroupRobotMessage({
    rawWebhook: webhook,
    payload,
    expectedEndpointSha256: endpointSha256,
    networkAuthorized: true,
    fetchImpl: async () =>
      response({ errcode: 93000, errmsg: secretErrorText }),
  })
  assert.equal(result.deliveryStatus, 'REJECTED')
  assert.equal(result.weComCode, 93000)
  assert.equal(JSON.stringify(result).includes(secretErrorText), false)
  assert.equal(JSON.stringify(result).includes('00000000-'), false)
})

test('known WeCom busy and rate-limit codes are definitive rejections', async () => {
  for (const weComCode of [-1, 45009]) {
    const result = await sendWeComGroupRobotMessage({
      rawWebhook: webhook,
      payload,
      expectedEndpointSha256: endpointSha256,
      networkAuthorized: true,
      fetchImpl: async () => response({
        errcode: weComCode,
        errmsg: 'remote detail must stay hidden',
      }),
    })
    assert.equal(result.deliveryStatus, 'REJECTED')
    assert.equal(result.reasonCode, 'WECOM_BUSINESS_REJECTED')
    assert.equal(result.weComCode, weComCode)
    assert.equal(result.networkAttempted, true)
  }
})

test('an unreadable successful response is ambiguous without raw body', async () => {
  const rawRemoteBody = 'remote-body-that-must-not-be-logged'
  const result = await sendWeComGroupRobotMessage({
    rawWebhook: webhook,
    payload,
    expectedEndpointSha256: endpointSha256,
    networkAuthorized: true,
    fetchImpl: async () => ({
      status: 200,
      ok: true,
      text: async () => rawRemoteBody,
    }),
  })
  assert.equal(result.deliveryStatus, 'AMBIGUOUS')
  assert.equal(result.reasonCode, 'WECOM_RESPONSE_UNREADABLE')
  assert.equal(JSON.stringify(result).includes(rawRemoteBody), false)
})

test('5xx is ambiguous while a definitive 4xx is rejected', async () => {
  const serverFailure = await sendWeComGroupRobotMessage({
    rawWebhook: webhook,
    payload,
    expectedEndpointSha256: endpointSha256,
    networkAuthorized: true,
    fetchImpl: async () => response({}, { status: 503, ok: false }),
  })
  assert.equal(serverFailure.deliveryStatus, 'AMBIGUOUS')
  assert.equal(serverFailure.reasonCode, 'WECOM_HTTP_RESULT_UNKNOWN')

  const clientFailure = await sendWeComGroupRobotMessage({
    rawWebhook: webhook,
    payload,
    expectedEndpointSha256: endpointSha256,
    networkAuthorized: true,
    fetchImpl: async () => response({}, { status: 400, ok: false }),
  })
  assert.equal(clientFailure.deliveryStatus, 'REJECTED')
  assert.equal(clientFailure.reasonCode, 'WECOM_HTTP_REJECTED')
})

test('network failures are ambiguous and are not retried', async () => {
  let attempts = 0
  const result = await sendWeComGroupRobotMessage({
    rawWebhook: webhook,
    payload,
    expectedEndpointSha256: endpointSha256,
    networkAuthorized: true,
    fetchImpl: async () => {
      attempts += 1
      throw new Error('network failed after request')
    },
  })
  assert.equal(attempts, 1)
  assert.equal(result.deliveryStatus, 'AMBIGUOUS')
  assert.equal(result.reasonCode, 'WECOM_NETWORK_RESULT_UNKNOWN')
  assert.equal(JSON.stringify(result).includes('00000000-'), false)
})

test('rejects a payload that reintroduces removed decorations before HTTP', async () => {
  let attempts = 0
  await assert.rejects(
    sendWeComGroupRobotMessage({
      rawWebhook: webhook,
      payload: {
        msgtype: 'text',
        text: {
          content: '【UAT测试｜非经营指令】\nmessage',
          mentioned_list: [],
        },
      },
      expectedEndpointSha256: endpointSha256,
      networkAuthorized: true,
      fetchImpl: async () => {
        attempts += 1
        return response({ errcode: 0 })
      },
    }),
    (error) =>
      error instanceof SafeWeComError &&
      error.reasonCode === 'WECOM_REMOVED_DECORATION_PRESENT',
  )
  assert.equal(attempts, 0)
})

test('rejects at-all mentions for a non-whitelisted template before HTTP', async () => {
  let attempts = 0
  await assert.rejects(
    sendWeComGroupRobotMessage({
      rawWebhook: webhook,
      payload: {
        msgtype: 'text',
        text: {
          content: '门店｜测试酒店\n简报内容',
          mentioned_list: ['@all'],
        },
      },
      expectedEndpointSha256: endpointSha256,
      networkAuthorized: true,
      fetchImpl: async () => {
        attempts += 1
        return response({ errcode: 0 })
      },
    }),
    (error) =>
      error instanceof SafeWeComError &&
      error.reasonCode === 'WECOM_PAYLOAD_INVALID',
  )
  assert.equal(attempts, 0)
})

test('direct import cannot use a real fetch without explicit network authorization', async () => {
  let attempts = 0
  await assert.rejects(
    sendWeComGroupRobotMessage({
      rawWebhook: webhook,
      payload,
      expectedEndpointSha256: endpointSha256,
      fetchImpl: async () => {
        attempts += 1
        return response({ errcode: 0 })
      },
    }),
    (error) =>
      error instanceof SafeWeComError &&
      error.reasonCode === 'WECOM_NETWORK_NOT_AUTHORIZED',
  )
  assert.equal(attempts, 0)
})

test('endpoint fingerprint mismatch fails before HTTP', async () => {
  let attempts = 0
  await assert.rejects(
    sendWeComGroupRobotMessage({
      rawWebhook: webhook,
      payload,
      expectedEndpointSha256: 'f'.repeat(64),
      networkAuthorized: true,
      fetchImpl: async () => {
        attempts += 1
        return response({ errcode: 0 })
      },
    }),
    (error) =>
      error instanceof SafeWeComError &&
      error.reasonCode === 'WECOM_ENDPOINT_FINGERPRINT_MISMATCH',
  )
  assert.equal(attempts, 0)
})

test('response stream is cancelled at the byte limit', async () => {
  let cancelled = false
  let emitted = false
  const result = await sendWeComGroupRobotMessage({
    rawWebhook: webhook,
    payload,
    expectedEndpointSha256: endpointSha256,
    networkAuthorized: true,
    fetchImpl: async () => ({
      status: 200,
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            if (emitted) return { done: true, value: undefined }
            emitted = true
            return {
              done: false,
              value: new Uint8Array(5000),
            }
          },
          cancel: async () => {
            cancelled = true
          },
        }),
      },
    }),
  })
  assert.equal(cancelled, true)
  assert.equal(result.deliveryStatus, 'AMBIGUOUS')
  assert.equal(result.reasonCode, 'WECOM_RESPONSE_UNREADABLE')
})
