import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractRoomTypeCatalog,
  mergeRoomTypeCatalogs,
  mergeRoomTypeCatalogsPreserving,
  validateRoomTypeMappings,
} from '../../../tools/uat/room-type-catalog.mjs'

test('room catalog keeps only allowlisted room labels and opaque identifiers', () => {
  const catalog = extractRoomTypeCatalog([{
    roomTypeId: 'room-1',
    roomTypeName: '豪华大床房',
    roomName: '非权威房型备注',
    productId: 'package-1',
    productName: '连住套餐',
    guestName: '不应进入目录',
    orderNo: 'ORDER-SECRET',
  }], { platformCode: 'MEITUAN', allowProductNames: true })

  assert.equal(catalog.length, 1)
  assert.equal(catalog[0].displayName, '豪华大床房')
  assert.match(catalog[0].roomTypeCode, /^OBS-[a-f0-9]{20}$/u)
  assert.equal(JSON.stringify(catalog).includes('连住套餐'), false)
  assert.equal(JSON.stringify(catalog).includes('不应进入目录'), false)
  assert.equal(JSON.stringify(catalog).includes('ORDER-SECRET'), false)
  assert.equal(JSON.stringify(catalog).includes('room-1'), false)
})

test('stable OTA room identifier survives a display-name change', () => {
  const before = extractRoomTypeCatalog({
    roomTypeId: 'room-1',
    roomTypeName: '大床房',
  }, { platformCode: 'CTRIP' })
  const after = extractRoomTypeCatalog({
    roomTypeId: 'room-1',
    roomTypeName: '雅致大床房',
  }, { platformCode: 'CTRIP' })

  assert.equal(before[0].roomTypeCode, after[0].roomTypeCode)
  assert.equal(after[0].displayName, '雅致大床房')
})

test('blank preferred identifiers do not hide a later stable room code', () => {
  const before = extractRoomTypeCatalog({
    roomTypeId: '   ',
    roomTypeCode: 'stable-room-code',
    roomTypeName: '大床房',
  }, { platformCode: 'MEITUAN' })
  const after = extractRoomTypeCatalog({
    roomTypeId: '',
    roomTypeCode: 'stable-room-code',
    roomTypeName: '雅致大床房',
  }, { platformCode: 'MEITUAN' })

  assert.equal(before[0].roomTypeCode, after[0].roomTypeCode)
})

test('catalog extraction is bounded before later array items are visited', () => {
  const catalog = extractRoomTypeCatalog(
    Array.from({ length: 350 }, (_, index) => ({
      roomTypeId: `room-${index}`,
      roomTypeName: `房型${index}`,
    })),
    { platformCode: 'CTRIP' },
  )

  assert.equal(catalog.length, 200)
})

test('production-style HMAC identifiers are isolated by hotel and source', () => {
  const root = { roomTypeId: '1', roomTypeName: '大床房' }
  const options = {
    platformCode: 'MEITUAN',
    hmacKey: 'synthetic-server-only-key',
  }
  const first = extractRoomTypeCatalog(root, {
    ...options,
    scope: 'hotel-001:source-001',
  })[0]
  const second = extractRoomTypeCatalog(root, {
    ...options,
    scope: 'hotel-002:source-001',
  })[0]

  assert.notEqual(first.roomTypeCode, second.roomTypeCode)
  assert.match(first.roomTypeCode, /^OBS-[a-f0-9]{20}$/u)
  assert.notEqual(first.roomTypeCode, 'OBS-1')
})

test('generic responses do not promote product labels without room semantics', () => {
  assert.deepEqual(extractRoomTypeCatalog({
    productId: 'package-1',
    productName: '早餐套餐',
  }, { platformCode: 'OTHER' }), [])
})

test('product identity takes priority over rate-plan labels', () => {
  const catalog = extractRoomTypeCatalog([
    {
      productId: 'product-1',
      productName: '豪华大床房',
      rateId: 'rate-1',
      rateName: '无早',
    },
    {
      productId: 'product-1',
      productName: '豪华大床房',
      rateId: 'rate-2',
      rateName: '双早',
    },
  ], { platformCode: 'FLIGGY', allowProductNames: true })

  assert.equal(catalog.length, 1)
  assert.equal(catalog[0].displayName, '豪华大床房')
})

test('mapping validation allows many OTA products per PMS room and refreshes names', () => {
  const catalog = extractRoomTypeCatalog([
    { roomTypeId: 'ota-1', roomTypeName: '大床房（无早）' },
    { roomTypeId: 'ota-2', roomTypeName: '大床房（含早）' },
  ], { platformCode: 'CTRIP' })
  const validated = validateRoomTypeMappings({
    input: catalog.map((roomType) => ({
      physicalRoomTypeCode: 'PMS-ROOM-1',
      sourceId: 'ctrip-main',
      platformCode: 'CTRIP',
      otaRoomTypeCode: roomType.roomTypeCode,
      otaRoomTypeName: '旧名称',
      matchMethod: 'MANUAL',
    })),
    knownPhysicalRoomTypeCodes: new Set(['PMS-ROOM-1']),
    otaSources: [{
      sourceId: 'ctrip-main',
      platformCode: 'CTRIP',
      enabled: true,
    }],
    catalogsBySourceId: new Map([['ctrip-main', catalog]]),
  })

  assert.equal(validated.length, 2)
  assert.deepEqual(
    validated.map((mapping) => mapping.otaRoomTypeName).sort(),
    ['大床房(含早)', '大床房(无早)'],
  )
  assert.equal(mergeRoomTypeCatalogs(catalog, catalog).length, 2)
})

test('latest observations replace names and enter a bounded historical catalog', () => {
  const historical = Array.from({ length: 200 }, (_, index) => ({
    roomTypeCode: `OBS-${index.toString(16).padStart(20, '0')}`,
    displayName: `历史房型${index}`,
  }))
  const refreshedName = {
    roomTypeCode: historical[99].roomTypeCode,
    displayName: '最新名称',
  }
  const newlyObserved = {
    roomTypeCode: 'OBS-ffffffffffffffffffff',
    displayName: '本次新发现房型',
  }
  const merged = mergeRoomTypeCatalogs(
    historical,
    [refreshedName, newlyObserved],
  )

  assert.equal(merged.length, 200)
  assert.equal(merged.some((item) => item.displayName === '最新名称'), true)
  assert.equal(
    merged.some((item) => item.roomTypeCode === newlyObserved.roomTypeCode),
    true,
  )
})

test('catalog growth never evicts a room type used by a saved mapping', () => {
  const historical = Array.from({ length: 200 }, (_, index) => ({
    roomTypeCode: `OBS-${index.toString(16).padStart(20, '0')}`,
    displayName: `历史房型${index}`,
  }))
  const newlyObserved = Array.from({ length: 200 }, (_, index) => ({
    roomTypeCode: `OBS-${(index + 300).toString(16).padStart(20, '0')}`,
    displayName: `新发现房型${index}`,
  }))
  const pinnedCode = historical[0].roomTypeCode
  const merged = mergeRoomTypeCatalogsPreserving(
    [historical, newlyObserved],
    [pinnedCode],
  )

  assert.equal(merged.length, 200)
  assert.equal(
    merged.some((item) => item.roomTypeCode === pinnedCode),
    true,
  )
  assert.equal(
    merged.some((item) => item.roomTypeCode === newlyObserved[199].roomTypeCode),
    true,
  )
})

test('one OTA room product cannot belong to two PMS rooms', () => {
  const [roomType] = extractRoomTypeCatalog({
    roomTypeId: 'ota-1',
    roomTypeName: '大床房',
  }, { platformCode: 'MEITUAN' })
  assert.throws(() => validateRoomTypeMappings({
    input: ['PMS-ROOM-1', 'PMS-ROOM-2'].map((physicalRoomTypeCode) => ({
      physicalRoomTypeCode,
      sourceId: 'meituan-main',
      platformCode: 'MEITUAN',
      otaRoomTypeCode: roomType.roomTypeCode,
      otaRoomTypeName: roomType.displayName,
      matchMethod: 'MANUAL',
    })),
    knownPhysicalRoomTypeCodes: new Set(['PMS-ROOM-1', 'PMS-ROOM-2']),
    otaSources: [{
      sourceId: 'meituan-main',
      platformCode: 'MEITUAN',
      enabled: true,
    }],
    catalogsBySourceId: new Map([['meituan-main', [roomType]]]),
  }), /ROOM_TYPE_MAPPING_CONFLICT/u)
})
