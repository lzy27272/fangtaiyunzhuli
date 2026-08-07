const COMPLETENESS_RANK = Object.freeze({
  UNAVAILABLE: 0,
  PARTIAL: 1,
  COMPLETE: 2,
})

const snapshotHourKey = (snapshot) => {
  const match = String(snapshot?.observedAt ?? '').match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}):(\d{2})/,
  )
  if (!match) return null
  const minute = Number(match[2])
  if (!Number.isInteger(minute) || minute > 29) return null
  return match[1]
}

const rank = (snapshot) =>
  COMPLETENESS_RANK[snapshot?.completeness] ?? -1

const prefer = (candidate, current) => {
  if (!current) return true
  if (
    candidate.snapshot?.businessDate
    !== current.snapshot?.businessDate
  ) {
    return String(candidate.snapshot?.observedAt ?? '')
      .localeCompare(String(current.snapshot?.observedAt ?? '')) > 0
  }
  const rankDifference = rank(candidate.snapshot) - rank(current.snapshot)
  if (rankDifference !== 0) return rankDifference > 0
  return String(candidate.snapshot?.observedAt ?? '')
    .localeCompare(String(current.snapshot?.observedAt ?? '')) > 0
}

export const selectHourlyDeliveryCandidates = ({
  hotelId,
  snapshots,
  deliveredMessageKeys = new Set(),
  businessDayControl = null,
  messageKeySuffix = 'HOURLY_UAT_V1',
  limit = 4,
}) => {
  if (
    typeof hotelId !== 'string'
    || !Array.isArray(snapshots)
    || typeof messageKeySuffix !== 'string'
    || !/^[A-Z0-9_]{3,40}$/.test(messageKeySuffix)
  ) {
    return []
  }
  const currentBusinessDate =
    typeof businessDayControl?.businessDate === 'string'
      ? businessDayControl.businessDate
      : null
  const businessDateStartedAtMs =
    typeof businessDayControl?.businessDateStartedAt === 'string'
      ? new Date(businessDayControl.businessDateStartedAt).getTime()
      : Number.NaN
  const deliveredHourSlots = new Set(
    [...deliveredMessageKeys]
      .map((messageKey) => String(messageKey).split(':'))
      .filter(
        (parts) =>
          parts.length === 4
          && parts[0] === hotelId
          && parts[3] === messageKeySuffix,
      )
      .map((parts) => `${hotelId}:${parts[2]}`),
  )
  const selectedByHourSlot = new Map()
  for (const snapshot of snapshots) {
    const snapshotHour = snapshotHourKey(snapshot)
    if (!snapshotHour || typeof snapshot?.businessDate !== 'string') continue
    const observedAtMs = new Date(snapshot.observedAt).getTime()
    if (
      currentBusinessDate
      && Number.isFinite(businessDateStartedAtMs)
      && Number.isFinite(observedAtMs)
      && observedAtMs >= businessDateStartedAtMs
      && snapshot.businessDate !== currentBusinessDate
    ) {
      continue
    }
    const hourSlot = `${hotelId}:${snapshotHour}`
    if (deliveredHourSlots.has(hourSlot)) continue
    const messageKey =
      `${hotelId}:${snapshot.businessDate}:`
      + `${snapshotHour}:${messageKeySuffix}`
    const candidate = { snapshot, snapshotHour, messageKey }
    if (prefer(candidate, selectedByHourSlot.get(hourSlot))) {
      selectedByHourSlot.set(hourSlot, candidate)
    }
  }
  return [...selectedByHourSlot.values()]
    .sort((left, right) => {
      const hourOrder = left.snapshotHour.localeCompare(right.snapshotHour)
      if (hourOrder !== 0) return hourOrder
      return left.messageKey.localeCompare(right.messageKey)
    })
    .slice(0, Math.max(0, limit))
}
