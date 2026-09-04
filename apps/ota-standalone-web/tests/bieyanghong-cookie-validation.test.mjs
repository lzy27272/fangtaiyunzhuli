import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeBieyanghongCookieHeader,
  validateBieyanghongCookieAccess,
} from '../../../tools/uat/bieyanghong-cookie-validation.mjs'

const hotel = {
  tenantId: 'tenant-001',
  hotelId: 'hotel-001',
  hotelName: '001 测试门店',
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

const responseFor = (path) => {
  if (path.includes('/night/audit/businessDate')) {
    return { code: 10000, data: { businessDate: 20260904 } }
  }
  if (path.endsWith('/jd01')) {
    return { code: 10000, data: { dataList: [] } }
  }
  if (path.endsWith('/jy09')) {
    return {
      code: 10000,
      data: {
        dataList: [{
          estimatedDate: '2026-09-04',
          roomCount: 10,
          availableRoom: 3,
          saleRoom: 7,
          estimatedRoomFee: 1200,
          estimatedRoomNights: 7,
          estimatedRentRate: 0.7,
          estimatedAvgRoomPrice: 171.43,
          estimatedRevpar: 120,
        }],
      },
    }
  }
  return {
    code: 10000,
    data: [{
      roomName: '测试房型',
      roomNum: 10,
      availableRoomNum: 3,
      estimatedRoomNights: 7,
      estimatedRoomAmt: 1200,
      estimatedAvgRoomPrice: 171.43,
    }],
  }
}

test('001 Cookie validation performs a read-only complete collection without returning the Cookie', async () => {
  const requests = []
  const result = await validateBieyanghongCookieAccess({
    hotel,
    sources,
    cookieHeader: cookie,
    expectedHotelId: '602758915',
    secretKey: 'validation-secret-key',
    reportDate: '2026-09-04',
    now: new Date('2026-09-04T08:00:00Z'),
    fetchImpl: async (url) => {
      const path = new URL(url).pathname
      requests.push(path)
      return new Response(JSON.stringify(responseFor(path)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  assert.equal(result.status, 'SUCCEEDED')
  assert.equal(result.businessDate, '2026-09-04')
  assert.equal(result.sourceCount, 3)
  assert.equal(result.successfulSourceCount, 3)
  assert.equal(result.outboundDeliveryAttempted, false)
  assert.equal(requests.length, 4)
  assert.equal(JSON.stringify(result).includes('test-only-token-value'), false)
})

test('Cookie validation rejects cross-store and unsafe values before provider access', async () => {
  let providerCalls = 0
  await assert.rejects(
    validateBieyanghongCookieAccess({
      hotel,
      sources,
      cookieHeader: cookie,
      expectedHotelId: 'different-store',
      secretKey: 'validation-secret-key',
      reportDate: '2026-09-04',
      fetchImpl: async () => {
        providerCalls += 1
        throw new Error('must not run')
      },
    }),
    /BIEYANGHONG_STORE_SCOPE_INVALID/u,
  )
  assert.throws(
    () => normalizeBieyanghongCookieHeader(`Cookie: ${cookie}`),
    /BIEYANGHONG_COOKIE_INVALID/u,
  )
  assert.equal(providerCalls, 0)
})
