import { createHash, createHmac } from 'node:crypto'

const MAX_CATALOG_ITEMS = 200
const MAX_MAPPING_ITEMS = 120
const MAX_WALK_DEPTH = 6
const MAX_WALK_ITEMS = 500

const ROOM_FIELD_GROUPS = Object.freeze([
  {
    names: [
      'roomtypename',
      'roomtype',
      '房型名称',
      '售卖房型',
      '房型',
    ],
    codes: ['roomtypeid', 'roomtypecode', '房型id', '房型编码'],
  },
  {
    names: ['roomname'],
    codes: ['roomid', 'roomtypeid', 'roomtypecode'],
  },
])

const PRODUCT_FIELD_GROUPS = Object.freeze([
  {
    names: ['productname', '商品名称'],
    codes: ['productid', 'productcode', '商品id', '商品编码'],
  },
  {
    names: ['ratename'],
    codes: ['rateid', 'ratecode'],
  },
])

const PLATFORM_CODES = new Set([
  'CTRIP',
  'MEITUAN',
  'FLIGGY',
  'DOUYIN',
  'QUNAR',
  'TONGCHENG',
  'OTHER',
])

const normalizedKey = (value) => String(value)
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[\s_.:/\\-]+/gu, '')

const cleanRoomName = (value) => {
  if (typeof value !== 'string') return null
  const cleaned = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return cleaned.length >= 1 && cleaned.length <= 80 ? cleaned : null
}

const stableCatalogCode = ({
  platformCode,
  externalCode,
  displayName,
  scope,
  hmacKey,
}) => {
  const stableIdentity = externalCode
    ? `code:${externalCode}`
    : `name:${displayName.normalize('NFKC').toLocaleLowerCase('zh-CN')}`
  const input = `${scope}:${platformCode}:${stableIdentity}`
  const digest = (hmacKey
    ? createHmac('sha256', hmacKey)
    : createHash('sha256'))
    .update(input)
    .digest('hex')
    .slice(0, 20)
  return `OBS-${digest}`
}

const scalarText = (value) => {
  if (!['string', 'number'].includes(typeof value)) return null
  const cleaned = String(value)
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/gu, '')
    .trim()
    .slice(0, 120)
  return cleaned || null
}

export const extractRoomTypeCatalog = (
  root,
  {
    platformCode = 'OTHER',
    allowProductNames = false,
    scope = platformCode,
    hmacKey = null,
  } = {},
) => {
  const candidates = new Map()
  let walked = 0

  const visit = (value, depth) => {
    if (
      value === null
      || typeof value !== 'object'
      || depth > MAX_WALK_DEPTH
      || walked >= MAX_WALK_ITEMS
      || candidates.size >= MAX_CATALOG_ITEMS
    ) return
    walked += 1

    if (Array.isArray(value)) {
      for (const item of value.slice(0, MAX_WALK_ITEMS - walked)) {
        visit(item, depth + 1)
        if (
          walked >= MAX_WALK_ITEMS
          || candidates.size >= MAX_CATALOG_ITEMS
        ) break
      }
      return
    }

    const entries = Object.entries(value)
    const entryByKey = new Map(
      entries.map(([key, item]) => [normalizedKey(key), item]),
    )
    const addFromGroup = (group) => {
      const externalCode = group.codes
        .map((key) => scalarText(entryByKey.get(key)))
        .find((item) => item !== null) ?? null
      let added = false
      for (const key of group.names) {
        const displayName = cleanRoomName(entryByKey.get(key))
        if (!displayName) continue
        const roomTypeCode = stableCatalogCode({
          platformCode,
          externalCode,
          displayName,
          scope,
          hmacKey,
        })
        candidates.set(roomTypeCode, { roomTypeCode, displayName })
        added = true
        if (candidates.size >= MAX_CATALOG_ITEMS) break
      }
      return added
    }

    let hasRoomSemantic = false
    for (const group of ROOM_FIELD_GROUPS) {
      hasRoomSemantic = addFromGroup(group)
      if (hasRoomSemantic || candidates.size >= MAX_CATALOG_ITEMS) break
    }
    if (
      !hasRoomSemantic
      && allowProductNames
      && candidates.size < MAX_CATALOG_ITEMS
    ) {
      for (const group of PRODUCT_FIELD_GROUPS) {
        if (addFromGroup(group)) break
      }
    }

    if (candidates.size >= MAX_CATALOG_ITEMS) return
    for (const [, item] of entries) {
      visit(item, depth + 1)
      if (
        candidates.size >= MAX_CATALOG_ITEMS
        || walked >= MAX_WALK_ITEMS
      ) break
    }
  }

  visit(root, 0)
  return [...candidates.values()].sort((left, right) => (
    left.displayName.localeCompare(right.displayName, 'zh-CN')
    || left.roomTypeCode.localeCompare(right.roomTypeCode)
  ))
}

const mergeRoomTypeCatalogEntries = (catalogs, pinnedRoomTypeCodes = []) => {
  const merged = new Map()
  for (const catalog of catalogs) {
    for (const item of Array.isArray(catalog) ? catalog : []) {
      if (
        !item
        || typeof item.roomTypeCode !== 'string'
        || !/^OBS-[a-f0-9]{20}$/u.test(item.roomTypeCode)
      ) continue
      const displayName = cleanRoomName(item.displayName)
      if (!displayName) continue
      if (merged.has(item.roomTypeCode)) merged.delete(item.roomTypeCode)
      merged.set(item.roomTypeCode, {
        roomTypeCode: item.roomTypeCode,
        displayName,
      })
    }
  }
  const pinned = new Set(pinnedRoomTypeCodes)
  while (merged.size > MAX_CATALOG_ITEMS) {
    const removable = [...merged.keys()].find((code) => !pinned.has(code))
    if (!removable) break
    merged.delete(removable)
  }
  return [...merged.values()].sort((left, right) => (
    left.displayName.localeCompare(right.displayName, 'zh-CN')
    || left.roomTypeCode.localeCompare(right.roomTypeCode)
  ))
}

export const mergeRoomTypeCatalogs = (...catalogs) =>
  mergeRoomTypeCatalogEntries(catalogs)

export const mergeRoomTypeCatalogsPreserving = (
  catalogs,
  pinnedRoomTypeCodes,
) => mergeRoomTypeCatalogEntries(
  Array.isArray(catalogs) ? catalogs : [],
  Array.isArray(pinnedRoomTypeCodes) ? pinnedRoomTypeCodes : [],
)

export const normalizeStoredRoomTypeMappings = (input) => {
  if (!Array.isArray(input) || input.length > MAX_MAPPING_ITEMS) {
    throw new Error('ROOM_TYPE_MAPPINGS_INVALID')
  }
  const normalized = []
  const otaProductOwners = new Map()
  for (const mapping of input) {
    const otaRoomTypeName = cleanRoomName(mapping?.otaRoomTypeName)
    if (
      !mapping
      || typeof mapping !== 'object'
      || typeof mapping.physicalRoomTypeCode !== 'string'
      || !/^[A-Za-z0-9:_-]{3,100}$/u.test(mapping.physicalRoomTypeCode)
      || typeof mapping.sourceId !== 'string'
      || mapping.sourceId.length < 3
      || mapping.sourceId.length > 80
      || !PLATFORM_CODES.has(mapping.platformCode)
      || typeof mapping.otaRoomTypeCode !== 'string'
      || !/^OBS-[a-f0-9]{20}$/u.test(mapping.otaRoomTypeCode)
      || !otaRoomTypeName
      || !['AUTO_NAME', 'MANUAL'].includes(mapping.matchMethod)
    ) {
      throw new Error('ROOM_TYPE_MAPPINGS_INVALID')
    }
    const ownerKey = `${mapping.sourceId}:${mapping.otaRoomTypeCode}`
    const owner = otaProductOwners.get(ownerKey)
    if (owner && owner !== mapping.physicalRoomTypeCode) {
      throw new Error('ROOM_TYPE_MAPPING_CONFLICT')
    }
    otaProductOwners.set(ownerKey, mapping.physicalRoomTypeCode)
    const item = {
      physicalRoomTypeCode: mapping.physicalRoomTypeCode,
      sourceId: mapping.sourceId,
      platformCode: mapping.platformCode,
      otaRoomTypeCode: mapping.otaRoomTypeCode,
      otaRoomTypeName,
      matchMethod: mapping.matchMethod,
    }
    if (!normalized.some((current) => (
      current.physicalRoomTypeCode === item.physicalRoomTypeCode
      && current.sourceId === item.sourceId
      && current.otaRoomTypeCode === item.otaRoomTypeCode
    ))) normalized.push(item)
  }
  return normalized
}

export const validateRoomTypeMappings = ({
  input,
  knownPhysicalRoomTypeCodes,
  otaSources,
  catalogsBySourceId,
}) => {
  const normalized = normalizeStoredRoomTypeMappings(input)
  const physicalCodes = new Set(knownPhysicalRoomTypeCodes)
  const sourceById = new Map(
    otaSources
      .filter((source) => source?.enabled === true)
      .map((source) => [source.sourceId, source]),
  )
  for (const mapping of normalized) {
    const source = sourceById.get(mapping.sourceId)
    const catalog = catalogsBySourceId.get(mapping.sourceId) ?? []
    const observed = catalog.find((item) => (
      item.roomTypeCode === mapping.otaRoomTypeCode
    ))
    if (
      !physicalCodes.has(mapping.physicalRoomTypeCode)
      || !source
      || source.platformCode !== mapping.platformCode
      || !observed
    ) {
      throw new Error('ROOM_TYPE_MAPPINGS_INVALID')
    }
    mapping.otaRoomTypeName = observed.displayName
  }
  return normalized
}

export const roomTypeCatalogLimits = Object.freeze({
  maxCatalogItems: MAX_CATALOG_ITEMS,
  maxMappingItems: MAX_MAPPING_ITEMS,
})
