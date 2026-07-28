import { createFutureBookingWeComPayloads } from './future-booking-brief.mjs'
import {
  createFutureDemandP1WeComPayloads,
  selectFutureDemandRiskCandidates,
} from './future-demand-risk.mjs'

const messagePrefix = '手动全模板测试'

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
  const futureRows = snapshot.futureBookingChanges?.daily

  if (Array.isArray(futureRows) && futureRows.length > 0) {
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
      messagePrefix: null,
      payloadFactory: ({ hotel: selected, snapshot: current }) =>
        createFutureDemandP1WeComPayloads(
          selected,
          current,
          futureDemandCandidates,
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
