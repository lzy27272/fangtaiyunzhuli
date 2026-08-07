import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fingerprintWeComWebhook,
  SafeWeComError,
  sendWeComGroupRobotMessage,
} from '../src/wecom-group-robot.mjs'

const webhook =
  'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=00000000-0000-0000-0000-000000000000'
const payload = {
  msgtype: 'text',
  text: {
    content: [
      '【UAT测试｜非经营指令】',
      '隐私处理｜已过滤姓名、订单号、电话、备注、操作员及内部链接',
    ].join('\n'),
    mentioned_list: ['@all'],
  },
}
const endpointSha256 = fingerprintWeComWebhook(webhook)
const operationalPayload = {
  msgtype: 'text',
  text: {
    content: '测试酒店｜今日收益分析\n经营数据',
    mentioned_list: ['@all'],
  },
}

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

test('sends exact text payload with at-all through injected fetch', async () => {
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

test('rejects a payload without mandatory at-all before HTTP', async () => {
  let attempts = 0
  await assert.rejects(
    sendWeComGroupRobotMessage({
      rawWebhook: webhook,
      payload: {
        msgtype: 'text',
        text: { content: 'message', mentioned_list: [] },
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
