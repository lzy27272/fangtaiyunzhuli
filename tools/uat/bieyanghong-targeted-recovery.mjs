const HOTEL_CODE = /^\d{3}$/
const OPERATION_KEY = /^[A-Z0-9][A-Z0-9_-]{7,95}$/
const SAFE_REASON_CODE = /^[A-Z0-9][A-Z0-9_:-]{2,127}$/

export const BIEYANGHONG_RECOVERY_EXCLUDED_HOTEL_CODE = '001'
export const BIEYANGHONG_RECOVERY_HOTEL_CODES = Object.freeze(['003', '013'])

const fail = (reasonCode) => {
  throw new Error(reasonCode)
}

export const normalizeBieyanghongRecoveryRequest = (body) => {
  const operationKey = typeof body?.operationKey === 'string'
    ? body.operationKey.trim()
    : ''
  const requestedCodes = Array.isArray(body?.hotelCodes)
    ? body.hotelCodes.map((value) => String(value).trim())
    : []
  if (!OPERATION_KEY.test(operationKey)) {
    fail('BIEYANGHONG_RECOVERY_OPERATION_KEY_INVALID')
  }
  if (
    requestedCodes.length === 0
    || requestedCodes.length > 20
    || requestedCodes.some((hotelCode) => !HOTEL_CODE.test(hotelCode))
    || new Set(requestedCodes).size !== requestedCodes.length
  ) {
    fail('BIEYANGHONG_RECOVERY_HOTEL_CODES_INVALID')
  }
  if (requestedCodes.includes(BIEYANGHONG_RECOVERY_EXCLUDED_HOTEL_CODE)) {
    fail('BIEYANGHONG_RECOVERY_PILOT_001_EXCLUDED')
  }
  return {
    operationKey,
    hotelCodes: [...requestedCodes].sort(),
  }
}

export const resolveBieyanghongRecoveryTargets = ({
  hotels,
  hotelCodes,
}) => {
  if (!Array.isArray(hotels) || !Array.isArray(hotelCodes)) {
    fail('BIEYANGHONG_RECOVERY_TARGETS_INVALID')
  }
  const targets = hotelCodes.map((hotelCode) => {
    const matches = hotels.filter((hotel) => hotel?.hotelCode === hotelCode)
    if (matches.length !== 1) {
      fail('BIEYANGHONG_RECOVERY_HOTEL_NOT_UNIQUE')
    }
    const hotel = matches[0]
    if (
      hotel.hotelCode === BIEYANGHONG_RECOVERY_EXCLUDED_HOTEL_CODE
      || hotel.pmsSystemCode !== 'MEITUAN_BIEYANGHONG'
    ) {
      fail('BIEYANGHONG_RECOVERY_SCOPE_INVALID')
    }
    if (!hotel.collectionEnabled || !hotel.cookieConfigured) {
      fail('BIEYANGHONG_RECOVERY_COLLECTION_NOT_READY')
    }
    if (
      !hotel.messageEnabled
      || !hotel.weComEnabled
      || !hotel.weComWebhookConfigured
    ) {
      fail('BIEYANGHONG_RECOVERY_DELIVERY_NOT_READY')
    }
    return hotel
  })
  return targets
}

export const safeBieyanghongRecoveryReason = (error) => {
  const candidate = String(error?.message ?? '')
  return SAFE_REASON_CODE.test(candidate)
    ? candidate
    : 'BIEYANGHONG_RECOVERY_FAILED_CLOSED'
}

export const recoveryDeliveryDecision = (delivery) => {
  if (!delivery) return 'SEND_MISSING'
  if (delivery.deliveryStatus === 'DELIVERED') return 'ALREADY_DELIVERED'
  if (
    delivery.deliveryStatus === 'AMBIGUOUS'
    || delivery.deliveryStatus === 'SENDING'
  ) {
    return 'MANUAL_RECONCILIATION_REQUIRED'
  }
  return 'REJECTED_NO_AUTOMATIC_RETRY'
}
