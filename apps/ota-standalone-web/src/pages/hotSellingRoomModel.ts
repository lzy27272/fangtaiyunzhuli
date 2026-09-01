import type {
  RoomTypeCatalogSourceView,
  RoomTypeConfigurationView,
  RoomTypeMappingView,
} from '../api/business'

export function observedOtaSources(
  sources: RoomTypeCatalogSourceView[],
): RoomTypeCatalogSourceView[] {
  return sources.filter((source) => source.roomTypes.length > 0)
}

export function normalizeRoomName(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s·•._()（）【】\[\]{}<>《》,，、/\\-]+/gu, '')
}

export function configurationDraft(
  configuration: RoomTypeConfigurationView,
): {
  mappings: RoomTypeMappingView[]
  hotSellingRoomTypeCodes: string[]
} {
  const mappings = [...configuration.mappings]
  const otaOwners = new Set(
    mappings.map((mapping) => (
      `${mapping.sourceId}:${mapping.otaRoomTypeCode}`
    )),
  )

  for (const pmsRoom of configuration.pmsRoomTypes) {
    const normalizedPmsName = normalizeRoomName(pmsRoom.displayName)
    for (const source of configuration.otaSources) {
      if (mappings.some((mapping) => (
        mapping.physicalRoomTypeCode === pmsRoom.physicalRoomTypeCode
        && mapping.sourceId === source.sourceId
      ))) continue
      const exactMatches = source.roomTypes.filter((roomType) => (
        normalizeRoomName(roomType.displayName) === normalizedPmsName
        && !otaOwners.has(`${source.sourceId}:${roomType.roomTypeCode}`)
      ))
      const exact = exactMatches.length === 1 ? exactMatches[0] : null
      if (!exact) continue
      mappings.push({
        physicalRoomTypeCode: pmsRoom.physicalRoomTypeCode,
        sourceId: source.sourceId,
        platformCode: source.platformCode,
        otaRoomTypeCode: exact.roomTypeCode,
        otaRoomTypeName: exact.displayName,
        matchMethod: 'AUTO_NAME',
      })
      otaOwners.add(`${source.sourceId}:${exact.roomTypeCode}`)
    }
  }

  return {
    mappings,
    hotSellingRoomTypeCodes: [
      ...new Set(configuration.hotSellingRoomTypeCodes),
    ],
  }
}

export function sameRoomTypeConfiguration(
  left: {
    mappings: RoomTypeMappingView[]
    hotSellingRoomTypeCodes: string[]
  },
  right: {
    mappings: RoomTypeMappingView[]
    hotSellingRoomTypeCodes: string[]
  },
): boolean {
  const mappingKey = (mapping: RoomTypeMappingView) => [
    mapping.physicalRoomTypeCode,
    mapping.sourceId,
    mapping.otaRoomTypeCode,
    mapping.matchMethod,
  ].join(':')
  return [...left.hotSellingRoomTypeCodes].sort().join('|')
    === [...right.hotSellingRoomTypeCodes].sort().join('|')
    && left.mappings.map(mappingKey).sort().join('|')
      === right.mappings.map(mappingKey).sort().join('|')
}

export function otaRoomTypeAvailable(
  mappings: RoomTypeMappingView[],
  sourceId: string,
  otaRoomTypeCode: string,
  physicalRoomTypeCode: string,
): boolean {
  return !mappings.some((mapping) => (
    mapping.sourceId === sourceId
    && mapping.otaRoomTypeCode === otaRoomTypeCode
    && mapping.physicalRoomTypeCode !== physicalRoomTypeCode
  ))
}
