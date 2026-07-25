#!/usr/bin/env node

import {
  fingerprintWeComWebhook,
  SafeWeComError,
} from './src/wecom-group-robot.mjs'

const rawWebhook = process.env.WECOM_GROUP_ROBOT_WEBHOOK
if (!rawWebhook) {
  process.stderr.write(
    `${JSON.stringify({
      status: 'FAILED',
      reasonCode: 'WECOM_WEBHOOK_ENV_MISSING',
    })}\n`,
  )
  process.exitCode = 2
} else {
  try {
    process.stdout.write(
      `${JSON.stringify(
        {
          status: 'FINGERPRINT_OK',
          networkCalled: false,
          endpointSha256: fingerprintWeComWebhook(rawWebhook),
        },
        null,
        2,
      )}\n`,
    )
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        status: 'FAILED',
        reasonCode:
          error instanceof SafeWeComError
            ? error.reasonCode
            : 'WECOM_WEBHOOK_INVALID',
      })}\n`,
    )
    process.exitCode = 2
  }
}
