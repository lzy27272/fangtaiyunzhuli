import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createOtaAlertNotificationPlan,
  otaAlertNotificationRoute,
  shouldQueueOtaAlertWeComNotification,
} from '../../../tools/uat/wecom/src/ota-alert-notification-policy.mjs'

test('P2 first notice creates task, in-app and WeCom exactly once', () => {
  const plan = createOtaAlertNotificationPlan({
    alertId: 'hotel-014:traffic-drop:2026-08-12T08',
    severity: 'P2',
    stage: 'INITIAL',
  })

  assert.equal(plan.createTask, true)
  assert.equal(plan.createInAppNotification, true)
  assert.equal(plan.queueWeComNotification, true)
  assert.equal(
    plan.idempotencyKey,
    'ota-alert:hotel-014:traffic-drop:2026-08-12T08:P2:INITIAL',
  )
})

test('P2 overdue escalation also queues WeCom', () => {
  assert.equal(shouldQueueOtaAlertWeComNotification({
    severity: 'P2',
    stage: 'OVERDUE',
  }), true)
})

test('P3 is dashboard plus one daily digest and never immediate WeCom', () => {
  const route = otaAlertNotificationRoute('P3')
  assert.equal(route.createTask, false)
  assert.equal(route.inAppMode, 'DASHBOARD')
  assert.deepEqual(route.weComStages, ['DAILY_DIGEST'])
  assert.equal(shouldQueueOtaAlertWeComNotification({
    severity: 'P3',
    stage: 'INITIAL',
  }), false)
})

test('unknown severity and malformed ids fail closed', () => {
  assert.throws(() => otaAlertNotificationRoute('P4'), /SEVERITY_UNSUPPORTED/)
  assert.throws(() => createOtaAlertNotificationPlan({
    alertId: 'bad id',
    severity: 'P2',
  }), /ALERT_ID_INVALID/)
})
