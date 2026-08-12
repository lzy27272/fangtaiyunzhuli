export const OTA_ALERT_NOTIFICATION_POLICY_VERSION =
  '2026-08-11-p2-wecom-immediate-v1'

const freezeRoute = (route) => Object.freeze({
  ...route,
  weComStages: Object.freeze([...route.weComStages]),
})

const ROUTES = Object.freeze({
  P1: freezeRoute({
    createTask: true,
    inAppMode: 'IMMEDIATE',
    weComStages: ['INITIAL', 'OVERDUE'],
  }),
  P2: freezeRoute({
    createTask: true,
    inAppMode: 'IMMEDIATE',
    weComStages: ['INITIAL', 'OVERDUE'],
  }),
  P3: freezeRoute({
    createTask: false,
    inAppMode: 'DASHBOARD',
    weComStages: ['DAILY_DIGEST'],
  }),
})

const normalizeSeverity = (value) => {
  const severity = String(value ?? '').trim().toUpperCase()
  if (!Object.hasOwn(ROUTES, severity)) {
    throw new Error('OTA_ALERT_SEVERITY_UNSUPPORTED')
  }
  return severity
}

const normalizeStage = (value) => {
  const stage = String(value ?? '').trim().toUpperCase()
  if (!['INITIAL', 'OVERDUE', 'DAILY_DIGEST'].includes(stage)) {
    throw new Error('OTA_ALERT_NOTIFICATION_STAGE_UNSUPPORTED')
  }
  return stage
}

export const otaAlertNotificationRoute = (severity) =>
  ROUTES[normalizeSeverity(severity)]

export const shouldQueueOtaAlertWeComNotification = ({
  severity,
  stage,
}) => otaAlertNotificationRoute(severity).weComStages.includes(
  normalizeStage(stage),
)

export const createOtaAlertNotificationPlan = ({
  alertId,
  severity,
  stage = 'INITIAL',
}) => {
  const normalizedAlertId = String(alertId ?? '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(normalizedAlertId)) {
    throw new Error('OTA_ALERT_ID_INVALID')
  }

  const normalizedSeverity = normalizeSeverity(severity)
  const normalizedStage = normalizeStage(stage)
  const route = ROUTES[normalizedSeverity]

  return Object.freeze({
    policyVersion: OTA_ALERT_NOTIFICATION_POLICY_VERSION,
    alertId: normalizedAlertId,
    severity: normalizedSeverity,
    stage: normalizedStage,
    createTask: normalizedStage === 'INITIAL' && route.createTask,
    createInAppNotification:
      normalizedStage === 'INITIAL' && route.inAppMode === 'IMMEDIATE',
    queueWeComNotification: route.weComStages.includes(normalizedStage),
    idempotencyKey:
      `ota-alert:${normalizedAlertId}:${normalizedSeverity}:${normalizedStage}`,
  })
}
