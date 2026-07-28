import assert from 'node:assert/strict'
import test from 'node:test'
import {
  futureBookingAiConfigFromEnv,
  futureBookingAiPublicStatus,
  generateFutureBookingAiActionLines,
} from '../../../tools/uat/wecom/src/future-booking-ai-advice.mjs'
import {
  createFutureBookingWeComPayloads,
  createFutureBookingWeComPayloadsWithAi,
} from '../../../tools/uat/wecom/src/future-booking-brief.mjs'

const addDays = (dateText, days) => {
  const date = new Date(`${dateText}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const hotel = {
  hotelId: 'hotel-001',
  hotelName: '测试酒店',
}

const dailyRows = Array.from({ length: 14 }, (_, index) => ({
  stayDate: addDays('2026-07-29', index + 1),
  roomCount: 50,
  availableRooms: index === 2 ? 13 : 40 - index,
  bookedRoomNights: index === 2 ? 37 : 10 + index,
  occupancyPercent: index === 2 ? 74 : 20 + index,
  adr: 260 + index,
  hourlyNetRoomNights: index === 2 ? 1 : 0,
  previousDayNetRoomNights: index % 3,
}))

const snapshot = {
  collectionRunId: 'run-ai-001',
  businessDate: '2026-07-29',
  observedAt: '2026-07-29T12:02:00+08:00',
  futureBookingChanges: {
    hourlyBaselineAt: '2026-07-29T11:02:00+08:00',
    previousDayEndAt: '2026-07-28T23:42:00+08:00',
    daily: dailyRows,
  },
}

const config = Object.freeze({
  enabled: true,
  ready: true,
  reasonCode: 'AI_ADVICE_READY',
  baseUrl: 'https://api.example.com/v1',
  model: 'hotel-advice-model',
  apiKey: 'test-only-api-key',
  timeoutMs: 8_000,
})

const modelLines = Object.freeze([
  '先做｜收益经理30分钟内核对高售卖日渠道结构和可售房态。',
  '策略｜若2小时净增继续为正，仅人工评估一个价格变量。',
  '复盘｜2小时后看净增间夜、ADR和余房，无新增则撤回。',
])

const successfulFetch = (capture = null) => async (url, options) => {
  if (capture) {
    capture.url = url.toString()
    capture.options = options
  }
  return {
    ok: true,
    status: 200,
    headers: {
      get: () => null,
    },
    text: async () => JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              lines: modelLines,
            }),
          },
        },
      ],
    }),
  }
}

const publicLookup = async () => [
  {
    address: '203.0.113.10',
    family: 4,
  },
]

test('AI configuration stays disabled by default and public status has no secret', () => {
  const disabled = futureBookingAiConfigFromEnv({})
  assert.equal(disabled.enabled, false)
  assert.equal(disabled.ready, false)

  const configured = futureBookingAiConfigFromEnv({
    OTA_REVIEW_AI_ENABLED: 'true',
    OTA_REVIEW_AI_BASE_URL: 'https://api.example.com/v1',
    OTA_REVIEW_AI_MODEL: 'hotel-advice-model',
    OTA_REVIEW_AI_API_KEY_B64:
      Buffer.from('server-only-api-key', 'utf8').toString('base64'),
    OTA_REVIEW_AI_TIMEOUT_MS: '8000',
  })
  assert.equal(configured.ready, true)
  const status = futureBookingAiPublicStatus(configured)
  assert.deepEqual(status, {
    enabled: true,
    ready: true,
    reasonCode: 'AI_ADVICE_READY',
    modelConfigured: true,
  })
  assert.doesNotMatch(JSON.stringify(status), /server-only|example\.com/)

  const unsafe = futureBookingAiConfigFromEnv({
    OTA_REVIEW_AI_ENABLED: 'true',
    OTA_REVIEW_AI_BASE_URL: 'http://127.0.0.1:9000/v1',
    OTA_REVIEW_AI_MODEL: 'hotel-advice-model',
    OTA_REVIEW_AI_API_KEY_B64:
      Buffer.from('server-only-api-key', 'utf8').toString('base64'),
  })
  assert.equal(unsafe.ready, false)
  assert.equal(unsafe.reasonCode, 'AI_BASE_URL_UNSAFE')
})

test('AI request contains only aggregate operating facts and no hotel identity', async () => {
  const capture = {}
  const ruleContent = createFutureBookingWeComPayloads(
    hotel,
    snapshot,
  )[0].text.content
  const ruleAdviceLines = ruleContent
    .split('\n')
    .slice(
      ruleContent.split('\n').indexOf('🤖AI建议') + 1,
      ruleContent.split('\n').indexOf('🤖AI建议') + 5,
    )
  const result = await generateFutureBookingAiActionLines({
    config,
    businessDate: snapshot.businessDate,
    rows: dailyRows,
    ruleAdviceLines,
    fetchImpl: successfulFetch(capture),
    lookupImpl: publicLookup,
  })
  assert.deepEqual(result, modelLines)
  assert.equal(
    capture.url,
    'https://api.example.com/v1/chat/completions',
  )
  const body = JSON.parse(capture.options.body)
  const modelInput = body.messages[1].content
  assert.match(modelInput, /occupancyPercent/)
  assert.match(modelInput, /remainingRooms/)
  assert.doesNotMatch(
    modelInput,
    /测试酒店|hotelId|cookie|password|phone|guest|order/i,
  )
})

test('AI advice keeps the deterministic conclusion and replaces only action lines', async () => {
  let applied = 0
  const payloads = await createFutureBookingWeComPayloadsWithAi(
    hotel,
    snapshot,
    {
      aiConfig: config,
      fetchImpl: successfulFetch(),
      lookupImpl: publicLookup,
      onAiApplied: () => {
        applied += 1
      },
    },
  )
  const content = payloads[0].text.content
  assert.equal(applied, 1)
  assert.match(content, /🤖AI建议（模型增强）/)
  assert.match(
    content,
    /结论｜08-01售卖率74%，余13间，高需求但当前未触发加速/,
  )
  for (const line of modelLines) assert.match(content, new RegExp(line))
  assert.doesNotMatch(content, /无新增则稳价，不提前封死渠道/)
})

test('unsafe endpoint or invalid model output falls back to rule advice', async () => {
  let privateFetchCalled = false
  await assert.rejects(
    generateFutureBookingAiActionLines({
      config,
      businessDate: snapshot.businessDate,
      rows: dailyRows,
      ruleAdviceLines: [
        '结论｜规则事实。',
        '先做｜规则动作。',
        '策略｜规则策略。',
        '复盘｜规则复盘。',
      ],
      fetchImpl: async () => {
        privateFetchCalled = true
        throw new Error('must not fetch')
      },
      lookupImpl: async () => [
        {
          address: '127.0.0.1',
          family: 4,
        },
      ],
    }),
    (error) => error?.reasonCode === 'AI_PRIVATE_NETWORK_BLOCKED',
  )
  assert.equal(privateFetchCalled, false)

  let fallbackReason = null
  const fallback = await createFutureBookingWeComPayloadsWithAi(
    hotel,
    snapshot,
    {
      aiConfig: config,
      lookupImpl: publicLookup,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: {
          get: () => null,
        },
        text: async () => JSON.stringify({
          choices: [
            {
              message: {
                content: '{"lines":["随意执行调价"]}',
              },
            },
          ],
        }),
      }),
      onAiFallback: (reasonCode) => {
        fallbackReason = reasonCode
      },
    },
  )
  assert.match(fallback[0].text.content, /🤖AI建议（规则回退）/)
  assert.match(
    fallback[0].text.content,
    /无新增则稳价，不提前封死渠道/,
  )
  assert.equal(fallbackReason, 'AI_ADVICE_SCHEMA_INVALID')
})
