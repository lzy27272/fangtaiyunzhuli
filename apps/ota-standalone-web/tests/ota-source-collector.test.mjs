import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyOtaRedirect,
  collectOtaSource,
  otaProviderBooleanTrue,
  summarizeOtaJson,
} from '../../../tools/uat/ota-source-collector.mjs'
import {
  fliggyBuiltInFallbackSource,
  sanitizeFliggyEndpointUrl,
} from '../../../tools/uat/fliggy-source-collector.mjs'

test('provider boolean normalization accepts common pagination encodings', () => {
  assert.equal(otaProviderBooleanTrue(true), true)
  assert.equal(otaProviderBooleanTrue(1), true)
  assert.equal(otaProviderBooleanTrue('true'), true)
  assert.equal(otaProviderBooleanTrue('1'), true)
  assert.equal(otaProviderBooleanTrue(' TRUE '), true)
  assert.equal(otaProviderBooleanTrue(false), false)
  assert.equal(otaProviderBooleanTrue(0), false)
  assert.equal(otaProviderBooleanTrue('false'), false)
})

test('Douyin pagination fails closed when an encoded has-more page is empty', async () => {
  const common = {
    cookie: 'session=synthetic-douyin-cookie',
    businessDate: '2026-08-12',
    lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
  }
  await assert.rejects(collectOtaSource({
    ...common,
    source: {
      platformCode: 'DOUYIN',
      requestMethod: 'POST',
      dataEndpointUrl:
        'https://life.douyin.com/life/trade_view/v1/workbench/book/query/list',
      requestPayloadJson: '{}',
    },
    fetchImpl: async () => new Response(JSON.stringify({
      status_code: 0,
      data: { data: [], pagination: { has_more: 'true' } },
    }), { status: 200 }),
  }), /OTA_DOUYIN_ORDER_PAGINATION_STALLED/u)

  await assert.rejects(collectOtaSource({
    ...common,
    source: {
      platformCode: 'DOUYIN',
      requestMethod: 'GET',
      dataEndpointUrl:
        'https://life.douyin.com/life/infra/v1/review/get_review_list/',
      requestPayloadJson: '',
    },
    fetchImpl: async () => new Response(JSON.stringify({
      status_code: 0,
      data: { reviews: [], has_more: '1', next_cursor: 'next' },
    }), { status: 200 }),
  }), /OTA_DOUYIN_REVIEW_PAGINATION_STALLED/u)
})

test('OTA JSON refresh stores only data-shape summary and detected dimensions', async () => {
  let observedRoomTypes = []
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
    onRoomTypeCatalog: (roomTypes) => {
      observedRoomTypes = roomTypes
    },
  })

  assert.equal(result.recordPath, '$.data')
  assert.equal(result.recordCount, 1)
  assert.deepEqual(
    result.detectedDimensions,
    ['DATE', 'ROOM_TYPE', 'INVENTORY', 'PRICE', 'CHANNEL'],
  )
  assert.equal(JSON.stringify(result).includes('secret-cookie-value'), false)
  assert.equal(JSON.stringify(result).includes('大床房'), false)
  assert.equal(observedRoomTypes.length, 1)
  assert.equal(observedRoomTypes[0].displayName, '大床房')
  assert.match(observedRoomTypes[0].roomTypeCode, /^OBS-[a-f0-9]{20}$/u)
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
      return new Response(JSON.stringify({
        data: {
          peerRankResult: [
            {
              metric: '入住间夜',
              rank: '1',
              bestPeerPoiId: 'must-not-be-retained',
            },
            { metric: '曝光', rank: null },
            { metric: '未知指标', rank: '2' },
          ],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })
  assert.equal(result.httpStatus, 200)
  assert.deepEqual(result.detectedDimensions, ['RANK'])
  assert.deepEqual(result.peerRanking, {
    provider: 'MEITUAN',
    metrics: [
      { code: 'STAY_ROOM_NIGHTS', rank: 1 },
      { code: 'EXPOSURE', rank: null },
    ],
  })
  assert.equal(JSON.stringify(result).includes('must-not-be-retained'), false)
  assert.equal(JSON.stringify(result).includes('未知指标'), false)
})

test('Meituan peer ranking projection is closed for unapproved endpoints', async () => {
  const result = await collectOtaSource({
    source: {
      platformCode: 'MEITUAN',
      requestMethod: 'GET',
      dataEndpointUrl: 'https://eb.meituan.com/api/other/rank',
      requestPayloadJson: '',
    },
    cookie: 'session=synthetic-meituan-cookie',
    lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
    fetchImpl: async () => new Response(JSON.stringify({
      data: { peerRankResult: [{ metric: '销售额', rank: '8' }] },
    }), { status: 200 }),
  })
  assert.equal(result.peerRanking, undefined)
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

test('Fliggy login redirect is classified as an expired session', async () => {
  await assert.rejects(
    collectOtaSource({
      source: {
        platformCode: 'FLIGGY',
        requestMethod: 'POST',
        dataEndpointUrl:
          'https://hotel.fliggy.com/ebooking/guestReviewV3.do',
        requestPayloadJson: '{"hid":"10001"}',
      },
      cookie: 'session=synthetic-fliggy-cookie',
      lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
      fetchImpl: async (_url, options) => {
        assert.equal(options.redirect, 'manual')
        return new Response('', {
          status: 302,
          headers: { Location: 'https://login.taobao.com/member/login.jhtml' },
        })
      },
    }),
    /OTA_SESSION_INVALID/,
  )
})

test('Fliggy official authentication redirects are classified conservatively', () => {
  const endpoint = 'https://hotel.fliggy.com/ebooking/review/guestReviewV3.do'
  assert.equal(classifyOtaRedirect({
    endpoint,
    location: 'https://passport.fliggy.com/login.htm',
  }), 'OTA_SESSION_INVALID')
  assert.equal(classifyOtaRedirect({
    endpoint,
    location: '/ebooking/login.htm',
  }), 'OTA_SESSION_INVALID')
  assert.equal(classifyOtaRedirect({
    endpoint,
    location: 'https://hotel.fliggy.com/ebooking/review/newReview.do',
  }), 'OTA_HTTP_REDIRECT')
  assert.equal(classifyOtaRedirect({
    endpoint,
    location: 'https://untrusted.example/login',
  }), 'OTA_HTTP_REDIRECT')
})

test('Fliggy stale custom endpoint can fall back only to its built-in read-only endpoint', () => {
  const source = {
    platformCode: 'FLIGGY',
    displayName: '飞猪评价',
    requestMethod: 'POST',
    dataEndpointUrl: 'https://hotel.fliggy.com/old/review.do',
  }
  assert.deepEqual(fliggyBuiltInFallbackSource({
    source,
    errorCode: 'OTA_HTTP_REDIRECT',
  }), {
    ...source,
    dataEndpointUrl: '',
  })
  assert.equal(fliggyBuiltInFallbackSource({
    source,
    errorCode: 'OTA_HTTP_403',
  }), null)
  assert.equal(fliggyBuiltInFallbackSource({
    source: { ...source, platformCode: 'MEITUAN' },
    errorCode: 'OTA_HTTP_REDIRECT',
  }), null)
})

test('OTA source without an optional data endpoint stays unconfigured', async () => {
  await assert.rejects(
    collectOtaSource({
      source: {
        platformCode: 'FLIGGY',
        requestMethod: 'GET',
        dataEndpointUrl: '',
        requestPayloadJson: '',
      },
      cookie: '',
    }),
    /OTA_SOURCE_NOT_CONFIGURED/,
  )
})

const fliggyEndpoint = ({ api, data }) => {
  const endpoint = new URL(`https://h5api.m.fliggy.com/h5/${api}/1.0/`)
  endpoint.searchParams.set('appKey', '12574478')
  endpoint.searchParams.set('api', api)
  endpoint.searchParams.set('v', '1.0')
  endpoint.searchParams.set('type', 'originaljson')
  endpoint.searchParams.set('data', JSON.stringify(data))
  return endpoint.toString()
}

test('Fliggy endpoint persistence removes only ephemeral signature parameters', () => {
  const endpoint = new URL(fliggyEndpoint({
    api: 'mtop.taobao.hotel.ebooking.order.list.get',
    data: { pageIndex: 1 },
  }))
  endpoint.searchParams.set('t', '1780000000000')
  endpoint.searchParams.set('sign', 'must-not-be-persisted')
  endpoint.searchParams.set('bx-ua', 'must-not-be-persisted')
  endpoint.searchParams.set('bx-umidtoken', 'must-not-be-persisted')
  const sanitized = new URL(sanitizeFliggyEndpointUrl(endpoint))
  assert.equal(sanitized.searchParams.get('appKey'), '12574478')
  assert.ok(sanitized.searchParams.get('data'))
  assert.equal(sanitized.searchParams.has('t'), false)
  assert.equal(sanitized.searchParams.has('sign'), false)
  assert.equal(sanitized.searchParams.has('bx-ua'), false)
  assert.equal(sanitized.searchParams.has('bx-umidtoken'), false)
})

test('Fliggy order source is signed, paged and projected into an order dashboard', async () => {
  let requestUrl
  const result = await collectOtaSource({
    source: {
      displayName: '飞猪订单',
      platformCode: 'FLIGGY',
      requestMethod: 'GET',
      dataEndpointUrl: fliggyEndpoint({
        api: 'mtop.taobao.hotel.ebooking.order.list.get',
        data: {
          pageIndex: 1,
          pageSize: 10,
          startDate: '2026-07-01',
          endDate: '2026-08-14',
        },
      }),
      requestPayloadJson: '',
    },
    cookie: '_m_h5_tk=synthetic_1780000000000; session=not-retained',
    businessDate: '2026-08-14',
    lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
    fetchImpl: async (url) => {
      requestUrl = new URL(url)
      return new Response(JSON.stringify({
        ret: ['SUCCESS::调用成功'],
        data: {
          totalCount: 2,
          hasMore: false,
          orders: [
            { orderId: 'raw-order-1', createTime: '2026-08-02', status: 'CONFIRMED' },
            { orderId: 'raw-order-2', createTime: '2026-08-03', status: 'CANCELLED' },
          ],
        },
      }), { status: 200 })
    },
    now: () => new Date('2026-08-14T02:00:00.000Z'),
  })

  assert.ok(requestUrl.searchParams.get('sign'))
  assert.equal(requestUrl.searchParams.get('t'), '1786672800000')
  const requestData = JSON.parse(requestUrl.searchParams.get('data'))
  assert.equal(requestData.pageSize, 50)
  assert.equal(requestData.startDate, '2026-08-01')
  assert.equal(requestData.endDate, '2026-08-13')
  assert.deepEqual(result.providerDataset, {
    provider: 'FLIGGY',
    dataset: 'ORDER',
    scope: 'BUSINESS_MONTH_TO_DATE',
    periodBasis: 'THROUGH_PREVIOUS_BUSINESS_DATE',
    rangeStart: '2026-08-01',
    rangeEnd: '2026-08-13',
    totalCount: 2,
    returnedCount: 2,
    canceledCount: 1,
    nonCanceledCount: 1,
    hasMore: false,
    fetchedPageCount: 1,
    paginationComplete: true,
    duplicateCount: 0,
    aggregationVersion: 6,
  })
  assert.equal(JSON.stringify(result).includes('raw-order'), false)
  assert.equal(JSON.stringify(result).includes('not-retained'), false)
})

test('Fliggy order can use the built-in read-only endpoint when URL is omitted', async () => {
  let requestedUrl = null
  const result = await collectOtaSource({
    source: {
      displayName: '飞猪订单',
      platformCode: 'FLIGGY',
      requestMethod: 'GET',
      dataEndpointUrl: '',
      requestPayloadJson: '',
    },
    cookie: '_m_h5_tk=synthetic_1780000000000',
    businessDate: '2026-08-14',
    lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
    fetchImpl: async (url) => {
      requestedUrl = new URL(url)
      return new Response(JSON.stringify({
        ret: ['SUCCESS::调用成功'],
        data: { totalCount: 0, orders: [] },
      }), { status: 200 })
    },
    now: () => new Date('2026-08-14T02:00:00.000Z'),
  })

  assert.equal(requestedUrl.hostname, 'h5api.m.fliggy.com')
  assert.equal(
    requestedUrl.searchParams.get('api'),
    'mtop.taobao.hotel.ebooking.order.list.get',
  )
  assert.equal(result.providerDataset.provider, 'FLIGGY')
  assert.equal(result.providerDataset.dataset, 'ORDER')
})

test('Fliggy review can use the built-in endpoint and fully paginate legacy form data', async () => {
  const requests = []
  const pages = [
    {
      success: true,
      data: {
        totalCount: 3,
        hasMore: true,
        rows: [
          { reviewId: 'legacy-1', gmtCreate: '2026-08-01', score: 5 },
          { reviewId: 'legacy-2', gmtCreate: '2026-08-02', score: 4.8 },
        ],
      },
    },
    {
      success: true,
      data: {
        totalCount: 3,
        hasMore: false,
        rows: [
          { reviewId: 'legacy-3', gmtCreate: '2026-08-03', score: 2 },
        ],
      },
    },
  ]
  const result = await collectOtaSource({
    source: {
      displayName: '飞猪评价',
      platformCode: 'FLIGGY',
      requestMethod: 'POST',
      dataEndpointUrl: '',
      requestPayloadJson: JSON.stringify({
        hid: 'synthetic-hotel',
        pageNo: 1,
        pageSize: 2,
      }),
    },
    cookie: 'session=synthetic-direct-fliggy-cookie',
    businessDate: '2026-08-14',
    lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
    fetchImpl: async (url, init) => {
      requests.push({ url: new URL(url), body: init.body })
      return new Response(JSON.stringify(pages[requests.length - 1]), {
        status: 200,
      })
    },
    now: () => new Date('2026-08-14T02:00:00.000Z'),
  })

  assert.equal(requests.length, 2)
  assert.equal(requests[0].url.hostname, 'hotel.fliggy.com')
  assert.equal(
    requests[0].url.pathname,
    '/ebooking/review/guestReviewV3.do',
  )
  assert.equal(new URLSearchParams(requests[0].body).get('pageNo'), '1')
  assert.equal(new URLSearchParams(requests[1].body).get('pageNo'), '2')
  assert.equal(result.providerDataset.paginationComplete, true)
  assert.equal(result.providerDataset.fetchedPageCount, 2)
  assert.deepEqual(result.reviewMetricCoverage, {
    totalRowCount: 3,
    datedRowCount: 3,
    scoredRowCount: 3,
    usableRowCount: 3,
    paginationComplete: true,
  })
  assert.equal(result.reviewMetrics.monthlyGoodCount, 2)
  assert.equal(result.reviewMetrics.monthlyNegativeCount, 1)
})

test('Fliggy review source forms star-threshold metrics after complete pagination', async () => {
  const result = await collectOtaSource({
    source: {
      displayName: '飞猪评价',
      platformCode: 'FLIGGY',
      requestMethod: 'GET',
      dataEndpointUrl: fliggyEndpoint({
        api: 'mtop.taobao.hotel.ebooking.review.list.get',
        data: { pageIndex: 1, pageSize: 10 },
      }),
      requestPayloadJson: '',
    },
    cookie: '_m_h5_tk=synthetic_1780000000000',
    businessDate: '2026-08-14',
    lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
    fetchImpl: async () => new Response(JSON.stringify({
      ret: ['SUCCESS::调用成功'],
      data: {
        totalCount: 3,
        hasMore: false,
        reviews: [
          { reviewId: 'review-1', publishTime: '2026-08-01', score: 5 },
          { reviewId: 'review-2', publishTime: '2026-08-10', score: 4.8 },
          { reviewId: 'review-3', publishTime: '2026-08-13', score: 2.5 },
        ],
      },
    }), { status: 200 }),
    now: () => new Date('2026-08-14T02:00:00.000Z'),
  })

  assert.equal(result.providerDataset.provider, 'FLIGGY')
  assert.equal(result.providerDataset.dataset, 'REVIEW')
  assert.equal(result.reviewMetrics.metricBasis, 'FLIGGY_STAR_THRESHOLDS')
  assert.equal(result.reviewMetrics.monthlyGoodCount, 2)
  assert.equal(result.reviewMetrics.monthlyNegativeCount, 1)
  assert.equal(result.reviewMetrics.yesterdayNegativeCount, 1)
  assert.equal(result.reviewMetrics.denominatorStatus, 'ORDER_SOURCE_MISSING')
  assert.equal(JSON.stringify(result).includes('review-1'), false)
})

test('Fliggy official direct JSON source forms a review board without unsafe rates', async () => {
  const result = await collectOtaSource({
    source: {
      displayName: '飞猪评价',
      platformCode: 'FLIGGY',
      requestMethod: 'GET',
      dataEndpointUrl: 'https://hotel.fliggy.com/api/reviews',
      requestPayloadJson: '',
    },
    cookie: 'session=synthetic-direct-fliggy-cookie',
    businessDate: '2026-08-14',
    lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
    fetchImpl: async () => new Response(JSON.stringify({
      data: {
        totalCount: 36,
        reviews: Array.from({ length: 10 }, (_, index) => ({
          reviewId: `direct-review-${index}`,
          publishTime: '2026-08-10',
          score: 5,
        })),
      },
    }), { status: 200 }),
    now: () => new Date('2026-08-14T02:00:00.000Z'),
  })

  assert.equal(result.providerDataset.provider, 'FLIGGY')
  assert.equal(result.providerDataset.dataset, 'REVIEW')
  assert.equal(result.providerDataset.totalCount, 36)
  assert.equal(result.providerDataset.returnedCount, 10)
  assert.equal(result.providerDataset.paginationComplete, false)
  assert.equal(result.reviewMetrics, undefined)
  assert.equal(JSON.stringify(result).includes('direct-review'), false)
})

test('Fliggy empty direct response keeps only safe structural diagnostics', async () => {
  const result = await collectOtaSource({
    source: {
      displayName: '飞猪评价',
      platformCode: 'FLIGGY',
      requestMethod: 'POST',
      dataEndpointUrl:
        'https://hotel.fliggy.com/ebooking/review/guestReviewV3.do',
      requestPayloadJson: '',
    },
    cookie: 'session=synthetic-direct-fliggy-cookie',
    businessDate: '2026-08-14',
    lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
    fetchImpl: async () => new Response(JSON.stringify({
      success: true,
      data: { rows: [], totalCount: 0, hasMore: false },
      ignoredMessage: 'must never be retained',
    }), { status: 200 }),
    now: () => new Date('2026-08-14T02:00:00.000Z'),
  })

  assert.deepEqual(result.responseShape.rootKeys, [
    'data',
    'ignoredMessage',
    'success',
  ])
  assert.deepEqual(result.responseShape.arrays, [
    { path: '$.data.rows', length: 0 },
  ])
  assert.equal(JSON.stringify(result).includes('must never be retained'), false)
})

test('Fliggy HTTP 200 error envelope fails with a safe classified code', async () => {
  await assert.rejects(
    collectOtaSource({
      source: {
        displayName: '飞猪评价',
        platformCode: 'FLIGGY',
        requestMethod: 'POST',
        dataEndpointUrl:
          'https://hotel.fliggy.com/ebooking/review/guestReviewV3.do',
        requestPayloadJson: '',
      },
      cookie: 'session=synthetic-direct-fliggy-cookie',
      lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
      fetchImpl: async () => new Response(JSON.stringify({
        code: 'LOGIN_REQUIRED',
        errorCode: 'SESSION_EXPIRED',
        msg: 'synthetic sensitive provider detail',
        ret: 'FAIL',
      }), { status: 200 }),
    }),
    /OTA_FLIGGY_SESSION_INVALID/,
  )
})

test('Fliggy legacy review POST payload is form encoded automatically', async () => {
  let request = null
  await collectOtaSource({
    source: {
      displayName: '飞猪评价',
      platformCode: 'FLIGGY',
      requestMethod: 'POST',
      dataEndpointUrl:
        'https://hotel.fliggy.com/ebooking/review/guestReviewV3.do',
      requestPayloadJson: JSON.stringify({ currentPage: 1, pageSize: 20 }),
    },
    cookie: 'session=synthetic-direct-fliggy-cookie',
    businessDate: '2026-08-14',
    lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
    fetchImpl: async (_url, init) => {
      request = init
      return new Response(JSON.stringify({
        success: true,
        data: { rows: [], totalCount: 0, hasMore: false },
      }), { status: 200 })
    },
  })

  assert.equal(
    request.headers['Content-Type'],
    'application/x-www-form-urlencoded;charset=UTF-8',
  )
  assert.match(request.body, /(?:^|&)currentPage=1(?:&|$)/)
  assert.match(request.body, /(?:^|&)pageSize=20(?:&|$)/)
})

test('Fliggy rank source forms a provider ranking dashboard', async () => {
  const result = await collectOtaSource({
    source: {
      displayName: '飞猪排名',
      platformCode: 'FLIGGY',
      requestMethod: 'GET',
      dataEndpointUrl: fliggyEndpoint({
        api: 'mtop.taobao.hotel.ebooking.rank.list.get',
        data: { pageIndex: 1, pageSize: 10 },
      }),
      requestPayloadJson: '',
    },
    cookie: '_m_h5_tk=synthetic_1780000000000',
    lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
    fetchImpl: async () => new Response(JSON.stringify({
      ret: ['SUCCESS::调用成功'],
      data: {
        ranks: [{ overallRank: 7, orderRank: 9, reviewRank: 3 }],
      },
    }), { status: 200 }),
    now: () => new Date('2026-08-14T02:00:00.000Z'),
  })

  assert.equal(result.peerRanking.provider, 'FLIGGY')
  assert.deepEqual(result.peerRanking.metrics, [
    { code: 'OVERALL', rank: 7 },
    { code: 'ORDER_COUNT', rank: 9 },
    { code: 'REVIEW_SCORE', rank: 3 },
  ])
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

test('Douyin review projection selects reviews instead of complaint dictionaries', async () => {
  const requests = []
  const result = await collectOtaSource({
    source: {
      platformCode: 'DOUYIN',
      requestMethod: 'GET',
      dataEndpointUrl:
        'https://life.douyin.com/life/infra/v1/review/get_review_list/?poi_id=synthetic',
      requestPayloadJson: '',
    },
    cookie: 'session=synthetic-douyin-cookie',
    businessDate: '2026-08-12',
    lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
    fetchImpl: async (url) => {
      const cursor = new URL(url).searchParams.get('cursor')
      requests.push(cursor)
      const firstPage = cursor === null
      const dates = firstPage
        ? ['2026-08-10', '2026-08-09']
        : ['2026-08-01', '2026-07-31']
      return new Response(JSON.stringify({
        status_code: 0,
        data: {
          complain_type_list: Array.from({ length: 12 }, (_, index) => ({
            key: `metadata-${index}`,
          })),
          reviews: dates.map((date, index) => ({
            review_id: `${cursor ?? 'first'}-${index}`,
            attitude: firstPage ? (index === 0 ? 1 : 3) : index + 1,
            publiced_time: Date.parse(`${date}T12:00:00+08:00`) / 1_000,
            review_source: 10,
            nested: { star_score: index === 0 ? 5 : 4 },
            content: 'must-not-be-retained',
          })),
          total_count: 1_482,
          has_more: firstPage,
          next_cursor: firstPage ? 10 : 20,
          search_after: firstPage ? 'opaque-next-page' : 'opaque-final-page',
        },
      }), { status: 200 })
    },
  })

  assert.deepEqual(requests, [null, '10'])
  assert.equal(result.recordPath, '$.data.reviews')
  assert.equal(result.recordCount, 4)
  assert.deepEqual(result.detectedDimensions, ['REVIEW', 'DATE'])
  assert.deepEqual(result.providerDataset, {
    provider: 'DOUYIN',
    dataset: 'REVIEW',
    scope: 'BUSINESS_MONTH_TO_DATE',
    periodBasis: 'THROUGH_CURRENT_BUSINESS_DATE',
    rangeStart: '2026-08-01',
    rangeEnd: '2026-08-12',
    totalCount: 1_482,
    returnedCount: 4,
    hasMore: false,
    fetchedPageCount: 2,
    paginationComplete: true,
    oldestObservedDate: '2026-07-31',
    duplicateCount: 0,
    aggregationVersion: 1,
  })
  assert.deepEqual(result.reviewMetrics, {
    provider: 'DOUYIN',
    metricBasis: 'DOUYIN_NATIVE_ATTITUDE',
    businessDate: '2026-08-12',
    businessDateBasis: 'PMS_CONFIRMED',
    previousBusinessDate: '2026-08-11',
    monthStart: '2026-08-01',
    monthlyGoodCount: 2,
    monthlyNegativeCount: 1,
    yesterdayNegativeCount: 0,
    goodCountThroughPreviousBusinessDate: 2,
    negativeCountThroughPreviousBusinessDate: 1,
    validStayedOrderCountThroughPreviousBusinessDate: null,
    eligibleOtaOrderCountThroughPreviousBusinessDate: null,
    goodRatePercent: null,
    negativeRatePermille: null,
    denominatorSource: 'MATCHED_OTA_ORDER_SOURCE',
    denominatorStatus: 'ORDER_SOURCE_MISSING',
    totalAllTime: 1_482,
    fetchedRowCount: 4,
    fetchedPageCount: 2,
    paginationComplete: true,
    aggregationVersion: 1,
  })
  assert.equal(JSON.stringify(result).includes('must-not-be-retained'), false)
  assert.equal(JSON.stringify(result).includes('metadata-'), false)
})

test('Douyin order projection decodes JSON-string rows without retaining order data', async () => {
  const encodedRows = [
    JSON.stringify({
      order_base_info: {
        order_id: 'order-1',
        create_time: Date.parse('2026-08-10T12:00:00+08:00') / 1_000,
      },
      play_methods_v2: { is_cancel: false },
      book_detail_info: { book_room_count: 1, book_night_count: 2 },
      guest_info: { name: 'must-not-be-retained' },
    }),
    JSON.stringify({
      play_methods_v2: { is_cancel: true },
      order_base_info: {
        order_id: 'must-not-be-retained',
        create_time: Date.parse('2026-08-09T12:00:00+08:00') / 1_000,
      },
    }),
  ]
  const result = await collectOtaSource({
    source: {
      platformCode: 'DOUYIN',
      requestMethod: 'POST',
      dataEndpointUrl:
        'https://life.douyin.com/life/trade_view/v1/workbench/book/query/list',
      requestPayloadJson: '{}',
    },
    cookie: 'session=synthetic-douyin-cookie',
    businessDate: '2026-08-12',
    lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
    fetchImpl: async (url, options) => {
      const pageIndex = Number(new URL(url).searchParams.get('page_index'))
      const body = JSON.parse(options.body)
      assert.equal(body.page_index, pageIndex)
      assert.equal(body.page_size, 100)
      return new Response(JSON.stringify({
        status_code: 0,
        data: {
          data: pageIndex === 1
            ? encodedRows
            : [JSON.stringify({
                order_base_info: {
                  order_id: 'older-order',
                  create_time:
                    Date.parse('2026-07-31T12:00:00+08:00') / 1_000,
                },
                play_methods_v2: { is_cancel: false },
              })],
          pagination: { total_count: 8_575, has_more: pageIndex === 1 ? 1 : 0 },
        },
      }), { status: 200 })
    },
  })

  assert.equal(result.recordPath, '$.data.data')
  assert.equal(result.recordCount, 2)
  assert.deepEqual(result.providerDataset, {
    provider: 'DOUYIN',
    dataset: 'ORDER',
    scope: 'BUSINESS_MONTH_TO_DATE',
    periodBasis: 'THROUGH_PREVIOUS_BUSINESS_DATE',
    rangeStart: '2026-08-01',
    rangeEnd: '2026-08-11',
    totalCount: 2,
    returnedCount: 3,
    canceledCount: 1,
    nonCanceledCount: 1,
    hasMore: false,
    fetchedPageCount: 2,
    paginationComplete: true,
    duplicateCount: 0,
    aggregationVersion: 1,
  })
  assert.equal(JSON.stringify(result).includes('must-not-be-retained'), false)
})

test('Meituan order projection uses POST month range and a separate canceled query', async () => {
  const requests = []
  const result = await collectOtaSource({
    source: {
      platformCode: 'MEITUAN',
      requestMethod: 'GET',
      dataEndpointUrl: 'https://eb.meituan.com/api/v1/ebooking/orders/list',
      requestPayloadJson: '',
    },
    cookie: 'session=synthetic-meituan-cookie',
    businessDate: '2026-08-12',
    lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body)
      requests.push({ method: options.method, payload })
      assert.equal(options.method, 'POST')
      assert.equal(typeof payload.startTime, 'number')
      assert.equal(typeof payload.endTime, 'number')
      return new Response(JSON.stringify({
        status: 0,
        data: {
          total: payload.orderStatus === 'CANCELED' ? 92 : 401,
          results: [{ guestName: 'must-not-be-retained' }],
        },
      }), { status: 200 })
    },
  })

  assert.equal(requests.length, 2)
  assert.equal(requests[0].payload.orderStatus, undefined)
  assert.equal(requests[1].payload.orderStatus, 'CANCELED')
  assert.deepEqual(result.providerDataset, {
    provider: 'MEITUAN',
    dataset: 'ORDER',
    scope: 'BUSINESS_MONTH_TO_DATE',
    periodBasis: 'THROUGH_PREVIOUS_BUSINESS_DATE',
    rangeStart: '2026-08-01',
    rangeEnd: '2026-08-11',
    totalCount: 401,
    returnedCount: 1,
    canceledCount: 92,
    nonCanceledCount: 309,
  })
  assert.equal(JSON.stringify(result).includes('must-not-be-retained'), false)
})

test('provider business errors fail refresh despite HTTP 200', async () => {
  await assert.rejects(
    collectOtaSource({
      source: {
        platformCode: 'MEITUAN',
        requestMethod: 'GET',
        dataEndpointUrl: 'https://eb.meituan.com/api/v1/ebooking/orders/list',
        requestPayloadJson: '',
      },
      cookie: 'session=synthetic-meituan-cookie',
      businessDate: '2026-08-12',
      lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
      fetchImpl: async () => new Response(JSON.stringify({
        status: 507,
        message: 'sensitive platform diagnostic must not escape',
      }), { status: 200 }),
    }),
    /OTA_MEITUAN_ORDER_BUSINESS_ERROR/,
  )
})
