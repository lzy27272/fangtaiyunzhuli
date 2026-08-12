import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createOtaAlertNotificationPlan,
  otaAlertNotificationRoute,
  shouldQueueOtaAlertWeComNotification,
} from '../src/ota-alert-notification-policy.mjs'

test('P2 creates a task and immediate in-app and WeCom notifications', () => {
  const plan = createOtaAlertNotificationPlan({
    alertId: 'hotel-014:meituan:traffic-drop:2026-08-11T14',
    severity: 'P2',
  })

  assert.equal(plan.createTask, true)
  assert.equal(plan.createInAppNotification, true)
  assert.equal(plan.queueWeComNotification, true)
  assert.equal(plan.stage, 'INITIAL')
  assert.equal(
    plan.idempotencyKey,
    'ota-alert:hotel-014:meituan:traffic-drop:2026-08-11T14:P2:INITIAL',
  )
})

test('P2 keeps the overdue WeCom escalation after immediate notification', () => {
  assert.equal(shouldQueueOtaAlertWeComNotification({
    severity: 'P2',
    stage: 'INITIAL',
  }), true)
  assert.equal(shouldQueueOtaAlertWeComNotification({
    severity: 'P2',
    stage: 'OVERDUE',
  }), true)
})

test('P1 stays immediate and P3 stays dashboard plus daily digest only', () => {
  assert.deepEqual(otaAlertNotificationRoute('P1').weComStages, [
    'INITIAL',
    'OVERDUE',
  ])
  assert.deepEqual(otaAlertNotificationRoute('P3').weComStages, [
    'DAILY_DIGEST',
  ])

  const p3Initial = createOtaAlertNotificationPlan({
    alertId: 'hotel-014:meituan:minor-trend:2026-08-11',
    severity: 'P3',
  })
  assert.equal(p3Initial.createTask, false)
  assert.equal(p3Initial.createInAppNotification, false)
  assert.equal(p3Initial.queueWeComNotification, false)

  const p3Digest = createOtaAlertNotificationPlan({
    alertId: 'hotel-014:meituan:minor-trend:2026-08-11',
    severity: 'P3',
    stage: 'DAILY_DIGEST',
  })
  assert.equal(p3Digest.queueWeComNotification, true)
})

test('unknown severities and unsafe alert identifiers fail closed', () => {
  assert.throws(
    () => otaAlertNotificationRoute('P4'),
    /OTA_ALERT_SEVERITY_UNSUPPORTED/,
  )
  assert.throws(
    () => createOtaAlertNotificationPlan({
      alertId: 'contains spaces',
      severity: 'P2',
    }),
    /OTA_ALERT_ID_INVALID/,
  )
})
