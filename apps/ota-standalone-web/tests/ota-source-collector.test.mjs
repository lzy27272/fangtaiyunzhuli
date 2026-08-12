import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectOtaSource,
  summarizeOtaJson,
} from '../../../tools/uat/ota-source-collector.mjs'

test('OTA JSON refresh stores only data-shape summary and detected dimensions', async () => {
  const result = await collectOtaSource({
    source: {
      requestMethod: 'POST',
      dataEndpointUrl: 'https://ota.example.test/api/inventory',
      requestPayloadJson: '{"hotelCode":"H001"}',
    },
    cookie: 'session=secret-cookie-value',
    lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.Cookie, 'session=secret-cookie-value')
      assert.equal(options.headers.Referer, undefined)
      assert.equal(options.headers['User-Agent'], undefined)
      return new Response(JSON.stringify({
        data: [{
          stayDate: '2026-07-29',
          roomTypeName: '大床房',
          availableRooms: 3,
          price: 399,
          channel: 'TEST_OTA',
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
    now: () => new Date('2026-07-28T03:00:00.000Z'),
  })

  assert.equal(result.recordPath, '$.data')
  assert.equal(result.recordCount, 1)
  assert.deepEqual(
    result.detectedDimensions,
    ['DATE', 'ROOM_TYPE', 'INVENTORY', 'PRICE', 'CHANNEL'],
  )
  assert.equal(JSON.stringify(result).includes('secret-cookie-value'), false)
  assert.equal(JSON.stringify(result).includes('大床房'), false)
})

test('Meituan e-booking refresh adds only its fixed browser context', async () => {
  const result = await collectOtaSource({
    source: {
      platformCode: 'MEITUAN',
      requestMethod: 'GET',
      dataEndpointUrl:
        'https://eb.meituan.com/api/v1/ebooking/business/peer/rank/data/result',
      requestPayloadJson: '',
    },
    cookie: 'session=synthetic-meituan-cookie',
    lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
    fetchImpl: async (url, options) => {
      assert.equal(url.hostname, 'eb.meituan.com')
      assert.equal(options.headers.Cookie, 'session=synthetic-meituan-cookie')
      assert.equal(options.headers.Referer, 'https://eb.meituan.com/')
      assert.match(options.headers['User-Agent'], /^Mozilla\/5\.0/)
      assert.equal(options.headers.Origin, undefined)
      return new Response(JSON.stringify({ data: [{ orderRank: 7 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })
  assert.equal(result.httpStatus, 200)
  assert.deepEqual(result.detectedDimensions, ['SALES', 'RANK'])
})

test('OTA HTTP failures retain the safe status code', async () => {
  await assert.rejects(
    collectOtaSource({
      source: {
        platformCode: 'MEITUAN',
        requestMethod: 'GET',
        dataEndpointUrl: 'https://eb.meituan.com/api/forbidden',
        requestPayloadJson: '',
      },
      cookie: 'session=synthetic-meituan-cookie',
      lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
      fetchImpl: async () => new Response('', { status: 403 }),
    }),
    /OTA_HTTP_403/,
  )
})

test('OTA refresh blocks private-network endpoints before fetch', async () => {
  await assert.rejects(
    collectOtaSource({
      source: {
        requestMethod: 'GET',
        dataEndpointUrl: 'https://ota.example.test/api/data',
        requestPayloadJson: '',
      },
      cookie: 'session=safe',
      lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }],
      fetchImpl: async () => {
        throw new Error('fetch must not run')
      },
    }),
    /OTA_ENDPOINT_PRIVATE_NETWORK_BLOCKED/,
  )
})

test('OTA summary never keeps record values', () => {
  const result = summarizeOtaJson({
    rows: [{
      roomTypeName: '敏感房型名称',
      guestName: '不应保存',
      availableRooms: 2,
    }],
  })
  assert.equal(result.recordCount, 1)
  assert.ok(result.detectedFields.includes('guestName'))
  assert.equal(JSON.stringify(result).includes('不应保存'), false)
})

test('OTA summary detects peer ranking dimensions without retaining values', () => {
  const result = summarizeOtaJson({
    data: [{
      exposureCount: 1_200,
      visitorCount: 80,
      bookingConversionRate: 0.08,
      orderRank: 7,
      peerHotelCount: 30,
    }],
  })
  assert.deepEqual(
    result.detectedDimensions,
    ['SALES', 'RANK', 'EXPOSURE', 'TRAFFIC', 'CONVERSION', 'PEER_SET_SIZE'],
  )
  assert.equal(JSON.stringify(result).includes('1200'), false)
  assert.equal(JSON.stringify(result).includes('0.08'), false)
})
