import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createWeComTextPayload,
  parsePmsJsonText,
  SafePmsJsonError,
  summarizePmsDocument,
} from '../src/pms-json-summary.mjs'

const document = {
  code: 10000,
  data: {
    variables: {
      currentTime: '2026-07-25 15:39:18',
      bussinessDate: null,
      currentUser: null,
      startDate: '2026-07-25',
      endDate: '2026-07-25',
      dateType: null,
      orgId: 'hotel-internal-id',
      memberLevel: null,
      integratedBusiness: null,
      isSplited: false,
    },
    dataList: [
      {
        orderSource: '中介直连',
        orderNo: 'sensitive-order-number',
        orderDate: '2026-07-25',
        contractName: 'sensitive-guest-name',
        source: '中介',
        customerLevel: '美团',
        estArriveTime: '2026-07-25 15:00:00',
        estDepatureTime: '2026-07-26 14:00:00',
        roomType: '测试房型A',
        roomCount: 1,
        roomPrice: 399.81,
        roomPriceType: '自定义价',
        prePayAmount: null,
        expireKeepTime: '2026-07-26 12:00:00',
        orderStatus: '预订中',
        remark: 'sensitive-remark',
        operator: 'sensitive-operator',
        url: '/private/order/path',
        phoneNumber: null,
        prePaymentType: '全额担保',
      },
      {
        orderSource: '中介直连',
        orderNo: 'another-sensitive-order',
        orderDate: '2026-07-25',
        contractName: 'another-sensitive-name',
        source: '中介',
        customerLevel: '未知会员值',
        estArriveTime: '2026-07-25 16:00:00',
        estDepatureTime: '2026-07-27 14:00:00',
        roomType: '测试房型B',
        roomCount: 2,
        roomPrice: 499,
        roomPriceType: '自定义价',
        prePayAmount: null,
        expireKeepTime: null,
        orderStatus: '预订中',
        remark: null,
        operator: 'system',
        url: '/private/order/path-2',
        phoneNumber: null,
        prePaymentType: '无担保',
      },
    ],
  },
}

test('parses a complete UTF-8 PMS JSON document', () => {
  const result = parsePmsJsonText(JSON.stringify(document))
  assert.equal(result.recoveredTruncatedRoot, false)
  assert.equal(result.document.data.dataList.length, 2)
})

test('recovers only the observed trailing root comma truncation', () => {
  const complete = JSON.stringify(document)
  const truncated = `${complete.slice(0, -1)},`
  const result = parsePmsJsonText(truncated)
  assert.equal(result.recoveredTruncatedRoot, true)
  assert.equal(result.document.code, 10000)
})

test('rejects unrelated malformed JSON', () => {
  assert.throws(
    () => parsePmsJsonText('{"code":10000,"data":'),
    (error) =>
      error instanceof SafePmsJsonError &&
      error.reasonCode === 'PMS_JSON_PARSE_FAILED',
  )
})

test('fails closed when an unknown row field appears', () => {
  const changed = structuredClone(document)
  changed.data.dataList[0].unexpected = 'must-not-pass'
  assert.throws(
    () => parsePmsJsonText(JSON.stringify(changed)),
    (error) =>
      error instanceof SafePmsJsonError &&
      error.reasonCode === 'PMS_JSON_ROW_FIELD_UNKNOWN',
  )
})

test('rejects nested root metadata even though it is not emitted', () => {
  const changed = structuredClone(document)
  changed.message = { nested: 'must-not-pass' }
  assert.throws(
    () => parsePmsJsonText(JSON.stringify(changed)),
    (error) =>
      error instanceof SafePmsJsonError &&
      error.reasonCode === 'PMS_JSON_ROOT_VALUE_INVALID',
  )
})

test('rejects an unsuccessful PMS business response', () => {
  const changed = structuredClone(document)
  changed.code = 50000
  assert.throws(
    () => parsePmsJsonText(JSON.stringify(changed)),
    (error) =>
      error instanceof SafePmsJsonError &&
      error.reasonCode === 'PMS_JSON_BUSINESS_NOT_SUCCESSFUL',
  )

  changed.code = 10000
  changed.success = false
  assert.throws(
    () => parsePmsJsonText(JSON.stringify(changed)),
    (error) =>
      error instanceof SafePmsJsonError &&
      error.reasonCode === 'PMS_JSON_BUSINESS_NOT_SUCCESSFUL',
  )
})

test('summary emits only safe aggregates and buckets unknown channels', () => {
  const summary = summarizePmsDocument(document)
  assert.equal(summary.recordCount, 2)
  assert.equal(summary.roomCountTotal, 3)
  assert.equal(summary.roomTypeDistinctCount, 2)
  assert.deepEqual(summary.channelCounts, [
    { channel: '美团', count: 1 },
    { channel: '其他/未识别', count: 1 },
  ])
  assert.equal(JSON.stringify(summary).includes('sensitive'), false)
})

test('WeCom text payload forces at-all and excludes sensitive row values', () => {
  const summary = summarizePmsDocument(document)
  const payload = createWeComTextPayload(summary, {
    hotelName: '喷水池态六酒店',
  })
  assert.deepEqual(payload.text.mentioned_list, ['@all'])
  assert.equal(
    payload.text.content.startsWith('【UAT测试｜非经营指令】\n'),
    true,
  )
  assert.equal(payload.text.content.includes('喷水池态六酒店'), true)
  assert.equal(payload.text.content.includes('sensitive'), false)
  assert.equal(payload.text.content.includes('/private/'), false)
  assert.equal(Buffer.byteLength(payload.text.content, 'utf8') < 1900, true)
})

test('hotel name rejects bidi and line-separator control characters', () => {
  const summary = summarizePmsDocument(document)
  for (const unsafeName of [
    '酒店\u202E伪装',
    '酒店\u2028订单号',
  ]) {
    assert.throws(
      () =>
        createWeComTextPayload(summary, {
          hotelName: unsafeName,
        }),
      (error) =>
        error instanceof SafePmsJsonError &&
        error.reasonCode === 'HOTEL_NAME_INVALID',
    )
  }
})
