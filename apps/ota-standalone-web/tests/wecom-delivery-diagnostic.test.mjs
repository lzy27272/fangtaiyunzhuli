import assert from 'node:assert/strict'
import test from 'node:test'
import { weComDeliveryDiagnostic } from '../src/ui/businessDisplay.ts'

test('WeCom delivery diagnostics distinguish safe failure classes', () => {
  assert.equal(
    weComDeliveryDiagnostic({ deliveryStatus: 'DELIVERED' }),
    '企业微信已确认接收。',
  )
  assert.match(weComDeliveryDiagnostic({
    deliveryStatus: 'AMBIGUOUS',
    reasonCode: 'WECOM_NETWORK_RESULT_UNKNOWN',
  }), /不会自动重发/u)
  assert.match(weComDeliveryDiagnostic({
    deliveryStatus: 'REJECTED',
    reasonCode: 'WECOM_PAYLOAD_INVALID',
    networkAttempted: false,
  }), /尚未请求企业微信/u)
  assert.match(weComDeliveryDiagnostic({
    deliveryStatus: 'REJECTED',
    reasonCode: 'WECOM_HTTP_REJECTED',
    httpStatus: 400,
  }), /HTTP 400/u)
  assert.match(weComDeliveryDiagnostic({
    deliveryStatus: 'REJECTED',
    reasonCode: 'WECOM_BUSINESS_REJECTED',
    weComCode: 93000,
  }), /错误码 93000/u)
})

test('partial delivery and rate limiting produce non-duplicate guidance', () => {
  assert.match(weComDeliveryDiagnostic({
    deliveryStatus: 'PARTIAL',
    reasonCode: 'WECOM_REPAIR_BOT_PARTIAL',
    deliveredPartCount: 1,
    partCount: 2,
  }), /已有 1\/2 段送达.*不会重发/u)
  const limited = weComDeliveryDiagnostic({
    deliveryStatus: 'REJECTED',
    reasonCode: 'WECOM_BUSINESS_REJECTED',
    weComCode: 45009,
  })
  assert.match(limited, /发送频率受限/u)
  assert.match(limited, /不会自动重发/u)
})
