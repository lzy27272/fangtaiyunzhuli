import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  collectYilianCloudReports,
  normalizeYilianAccessToken,
  validateYilianAccessToken,
} from '../../../tools/uat/yilian-cloud-collector.mjs'

const hotel = {
  tenantId: 'tenant-015',
  hotelId: 'hotel-015',
  hotelCode: '015',
  hotelName: '015 测试门店',
  timezone: 'Asia/Shanghai',
  pmsSystemCode: 'YILIAN_CLOUD',
}

const sources = [
  {
    sourceId: '34000000-0000-4000-8000-000000000001',
    displayName: '实时数据',
    endpointUrl:
      'https://pms.ygjpms.com/newPms/forwardRoomState/nowRoomState?manageHotelCode=',
    reportType: 'CUSTOM_REPORT',
    calculationRole: 'PRIMARY_CALCULATION',
    enabled: true,
  },
  {
    sourceId: '27f5ead0-11a3-4131-87ce-7ba9d7ff0ce0',
    displayName: '订单明细',
    endpointUrl:
      'https://pms.ygjpms.com/newPms/orderManage/selectAll?pageNum=1&pageSize=1&recState=2',
    reportType: 'ORDER_DETAIL',
    calculationRole: 'AUXILIARY_CALCULATION',
    enabled: true,
  },
  {
    sourceId: '94c0b6ee-2ee4-421f-a9e8-d1fa38a352a9',
    displayName: '远期房态',
    endpointUrl:
      'https://pms.ygjpms.com/newPms/reportAPP/rateCalendarReport?startDate=2020-01-01&endDate=2020-01-02',
    reportType: 'PHYSICAL_INVENTORY',
    calculationRole: 'PRIMARY_CALCULATION',
    enabled: true,
  },
]

const token = 'synthetic-yilian-access-token-000000000000000001'

const fixtureFor = (url) => {
  const parsed = new URL(url)
  if (parsed.pathname.endsWith('/nowRoomState')) {
    return {
      code: 200,
      data: [{
        roomClassId: 1,
        roomClassName: '测试大床房',
        allCount: 10,
        canSellCount: 7,
        serviceCount: 0,
        reserveCount: 2,
        passNightCount: 1,
        checkInCount: 2,
        roomIncome: 750,
        avgRoomCharge: 250,
      }],
    }
  }
  if (parsed.pathname.endsWith('/selectAll')) {
    const page = Number(parsed.searchParams.get('pageNum'))
    return {
      code: 200,
      data: {
        total: 2,
        list: [{
          orderId: `secret-order-${page}`,
          channelName: page === 1 ? '携程' : '美团',
          recState: 'Expected',
          createTime: '2026-09-06 10:00:00',
          etaTime: page === 1 ? '2026-09-07 14:00:00' : '2026-09-08 14:00:00',
          dueOutTime: '2026-09-09 12:00:00',
          list: [{ roomCount: 1, price: [{ date: '2026-09-07' }] }],
        }],
      },
    }
  }
  return {
    code: 200,
    data: [{
      nowDate: '2026-09-07',
      list: [{
        roomClass: '测试大床房',
        sumRoomClassNum: 10,
        rateCalendarDetailDtoList: [
          {
            nowDate: '2026-09-07',
            sumRoomClassNum: 7,
            useIngNum: 3,
            serviceCount: 0,
            retainCount: 0,
            checkIn: 1,
          },
          {
            nowDate: '2026-09-08',
            sumRoomClassNum: 5,
            useIngNum: 5,
            serviceCount: 0,
            retainCount: 0,
            checkIn: 2,
          },
        ],
      }],
    }],
  }
}

test('Yilian collection uses access_token, refreshes dates, paginates, and persists no raw order identity', async () => {
  const requests = []
  const result = await collectYilianCloudReports({
    hotel,
    sources,
    accessTokensBySourceId: Object.fromEntries(
      sources.map((source) => [source.sourceId, token]),
    ),
    secretKey: 'synthetic-yilian-pseudonym-key',
    configuredReportDate: '2026-09-06',
    now: new Date('2026-09-07T02:00:00Z'),
    fetchImpl: async (url, options) => {
      const parsed = new URL(url)
      requests.push({ url: parsed, options })
      assert.equal(options.method, 'GET')
      assert.equal(options.headers.access_token, token)
      assert.equal(Object.hasOwn(options.headers, 'Cookie'), false)
      return new Response(JSON.stringify(fixtureFor(parsed)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  assert.equal(result.run.status, 'SUCCEEDED')
  assert.equal(result.run.sourceCount, 3)
  assert.equal(result.run.successfulSourceCount, 3)
  assert.equal(result.run.outboundDeliveryAttempted, false)
  assert.equal(result.snapshot.sourceSystem, 'YILIAN_CLOUD')
  assert.equal(result.snapshot.businessDate, '2026-09-07')
  assert.equal(result.snapshot.businessDateChanged, true)
  assert.equal(result.snapshot.overview.roomCount, 10)
  assert.equal(result.snapshot.overview.availableRooms, 7)
  assert.equal(result.snapshot.overview.roomNights, 3)
  assert.equal(result.snapshot.overview.roomFee, 750)
  assert.equal(result.snapshot.overview.adr, 250)
  assert.equal(result.snapshot.overview.revPar, 75)
  assert.equal(result.snapshot.physicalInventory[0].primaryAvailableRooms, 7)
  assert.equal(result.snapshot.futureDaily[0].stayDate, '2026-09-08')
  assert.equal(result.snapshot.futureDaily[0].availableRooms, 5)
  assert.equal(result.snapshot.futureDaily[0].roomNights, 5)
  assert.equal(result.snapshot.orders.length, 2)
  assert.equal(JSON.stringify(result).includes('secret-order-'), false)
  assert.equal(JSON.stringify(result).includes(token), false)
  assert.equal(requests.filter((item) => item.url.pathname.endsWith('/selectAll')).length, 2)
  const forecastRequest = requests.find(
    (item) => item.url.pathname.endsWith('/rateCalendarReport'),
  )
  assert.equal(forecastRequest.url.searchParams.get('startDate'), '2026-09-07')
  assert.equal(forecastRequest.url.searchParams.get('endDate'), '2026-09-20')
})

test('Yilian validation is read-only and returns only non-secret control metadata', async () => {
  const result = await validateYilianAccessToken({
    sources,
    accessToken: token,
    now: new Date('2026-09-07T02:00:00Z'),
    fetchImpl: async (url, options) => {
      assert.equal(options.headers.access_token, token)
      return new Response(JSON.stringify(fixtureFor(url)), { status: 200 })
    },
  })
  assert.deepEqual(result, {
    sourceCount: 3,
    successfulSourceCount: 3,
    businessDate: '2026-09-07',
    outboundDeliveryAttempted: false,
  })
  assert.equal(JSON.stringify(result).includes(token), false)
})

test('Yilian adapter fails closed for expired sessions and non-approved hosts', async () => {
  await assert.rejects(validateYilianAccessToken({
    sources,
    accessToken: token,
    now: new Date('2026-09-07T02:00:00Z'),
    fetchImpl: async () => new Response(JSON.stringify({ code: 202, msg: 'synthetic rejection' }), {
      status: 200,
    }),
  }), /YILIAN_SESSION_REAUTH_REQUIRED/u)

  for (const status of [302, 401, 403]) {
    await assert.rejects(validateYilianAccessToken({
      sources,
      accessToken: token,
      now: new Date('2026-09-07T02:00:00Z'),
      fetchImpl: async (_url, options) => {
        assert.equal(options.redirect, 'manual')
        return new Response(null, { status })
      },
    }), /YILIAN_SESSION_REAUTH_REQUIRED/u)
  }

  let called = false
  await assert.rejects(validateYilianAccessToken({
    sources: sources.map((source, index) => index === 0
      ? { ...source, endpointUrl: 'https://example.test/newPms/forwardRoomState/nowRoomState' }
      : source),
    accessToken: token,
    fetchImpl: async () => {
      called = true
      throw new Error('must not run')
    },
  }), /YILIAN_ENDPOINT_NOT_ALLOWED/u)
  assert.equal(called, false)
  assert.throws(
    () => normalizeYilianAccessToken('invalid\nheader'),
    /YILIAN_ACCESS_TOKEN_INVALID/u,
  )
})

test('Yilian production release includes encrypted capture and shadow-gated activation', async () => {
  const [publisher, capture, activation, api] = await Promise.all([
    readFile(new URL(
      '../../../infra/ota-standalone-server/scripts/Publish-OtaStandaloneServer.ps1',
      import.meta.url,
    ), 'utf8'),
    readFile(new URL(
      '../../../tools/uat/capture-yilian-cloud-session.mjs',
      import.meta.url,
    ), 'utf8'),
    readFile(new URL(
      '../../../tools/uat/activate-yilian-cloud-collection.mjs',
      import.meta.url,
    ), 'utf8'),
    readFile(new URL(
      '../../../tools/uat/ota-standalone-review-api.mjs',
      import.meta.url,
    ), 'utf8'),
  ])

  assert.match(publisher, /tools\/uat\/yilian-cloud-collector\.mjs/u)
  assert.match(publisher, /tools\/uat\/capture-yilian-cloud-session\.mjs/u)
  assert.match(publisher, /tools\/uat\/activate-yilian-cloud-collection\.mjs/u)
  assert.match(capture, /validateYilianAccessToken/u)
  assert.match(capture, /encryptCookie/u)
  assert.match(capture, /url\.pathname\.startsWith\('\/login\/pms\/'\)/u)
  assert.match(capture, /process\.exit\(0\)/u)
  assert.match(capture, /outboundDeliveryAttempted: false/u)
  assert.match(activation, /ACTIVATE_AFTER_SHADOW/u)
  assert.match(activation, /YILIAN_SHADOW_VALIDATION_FAILED/u)
  assert.match(activation, /outboundDeliveryAttempted: false/u)
  assert.match(api, /secretKey: pseudonymSecretKey/u)
})
