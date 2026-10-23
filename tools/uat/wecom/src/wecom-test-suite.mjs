import { createFutureBookingWeComPayloads } from './future-booking-brief.mjs'
import {
  createFutureDemandP1WeComPayloads,
  selectFutureDemandRiskCandidates,
} from './future-demand-risk.mjs'

const messagePrefix = '手动安全模板测试'

const finiteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const hasUsableFutureRow = (snapshot) => {
  const businessDateMs = Date.parse(`${snapshot.businessDate}T00:00:00Z`)
  return (snapshot.futureBookingChanges?.daily ?? []).some((row) => {
    const stayDate = row?.stayDate
    if (typeof stayDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(stayDate)) return false
    const stayDateMs = Date.parse(`${stayDate}T00:00:00Z`)
    const dayOffset = (stayDateMs - businessDateMs) / 86_400_000
    if (!Number.isInteger(dayOffset) || dayOffset < 1 || dayOffset > 14
      || new Date(stayDateMs).toISOString().slice(0, 10) !== stayDate) return false
    const booked = finiteNumber(row.bookedRoomNights)
    const available = finiteNumber(row.availableRooms)
    const roomCount = finiteNumber(row.roomCount)
    return booked !== null && booked >= 0
      && ((available !== null && available >= 0) || (roomCount !== null && roomCount > 0))
  })
}

export const createWeComTestSuitePlan = ({ hotelId, snapshot }) => {
  if (
    typeof hotelId !== 'string'
    || !hotelId.trim()
    || !snapshot
    || typeof snapshot.businessDate !== 'string'
  ) {
    throw new Error('WECOM_TEST_SUITE_INPUT_INVALID')
  }

  const templates = [{
    templateCode: 'TODAY_REVENUE',
    deliveryType: 'TODAY_REVENUE_TEST',
    messagePrefix,
    payloadFactory: null,
  }]
  const skippedTemplates = []
  if (Array.isArray(snapshot.futureBookingChanges?.daily) && hasUsableFutureRow(snapshot)) {
    templates.push({
      templateCode: 'FUTURE_14D',
      deliveryType: 'FUTURE_14D_TEST',
      messagePrefix,
      payloadFactory: ({ hotel: selected, snapshot: current }) =>
        createFutureBookingWeComPayloads(selected, current, {
          messagePrefix,
        }),
    })
  } else {
    skippedTemplates.push({
      templateCode: 'FUTURE_14D',
      reasonCode: 'FUTURE_BOOKING_SNAPSHOT_REQUIRED',
    })
  }

  const futureDemandCandidates = selectFutureDemandRiskCandidates({
    hotelId,
    snapshot,
    riskStates: {},
  })
  if (futureDemandCandidates.length > 0) {
    templates.push({
      templateCode: 'P1_FUTURE_DEMAND',
      deliveryType: 'P1_FUTURE_DEMAND_TEST',
      messagePrefix,
      payloadFactory: ({ hotel: selected, snapshot: current }) =>
        createFutureDemandP1WeComPayloads(
          selected,
          current,
          futureDemandCandidates,
          { testMode: true },
        ),
    })
  } else {
    skippedTemplates.push({
      templateCode: 'P1_FUTURE_DEMAND',
      reasonCode: 'NO_CURRENT_RISK',
    })
  }

  return {
    requestedTemplateCount: 3,
    templates,
    skippedTemplates,
  }
}
