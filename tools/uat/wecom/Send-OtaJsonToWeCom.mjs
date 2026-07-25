#!/usr/bin/env node

import {
  lstat,
  readFile,
  realpath,
} from 'node:fs/promises'
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
} from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  acquireDeliveryClaim,
  SafeDeliveryClaimError,
} from './src/delivery-claim.mjs'
import {
  createWeComTextPayload,
  limits,
  normalizeHotelName,
  parsePmsJsonText,
  SafePmsJsonError,
  summarizePmsDocument,
} from './src/pms-json-summary.mjs'
import {
  fingerprintWeComWebhook,
  SafeWeComError,
  sendWeComGroupRobotMessage,
  sha256,
} from './src/wecom-group-robot.mjs'

const SEND_GATE_ENV = 'OTA_WECOM_UAT_SEND_ENABLED'
const WEBHOOK_ENV = 'WECOM_GROUP_ROBOT_WEBHOOK'
const ENDPOINT_FINGERPRINT_ENV =
  'WECOM_GROUP_ROBOT_ENDPOINT_SHA256'
const EXPECTED_HOTEL_ENV = 'WECOM_UAT_EXPECTED_HOTEL_NAME'
const APPROVED_INPUT_SHA_ENV = 'OTA_WECOM_UAT_APPROVED_INPUT_SHA256'
const WRAPPER_NONCE_ENV = 'OTA_WECOM_UAT_WRAPPER_NONCE'
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(scriptDirectory, '../../..')
const runtimeRoot = resolve(workspaceRoot, '.uat-runtime', 'wecom')
const inboxRoot = resolve(runtimeRoot, 'inbox')
const deliveryClaimsRoot = resolve(runtimeRoot, 'delivery-claims')

const safeFailure = (reasonCode, exitCode = 2) => {
  process.stderr.write(
    `${JSON.stringify({ status: 'FAILED', reasonCode })}\n`,
  )
  process.exitCode = exitCode
}

const parseArguments = (args) => {
  const options = {
    dryRunRequested: false,
    sendRequested: false,
    allowTruncatedRootRecovery: false,
    wrapperNonce: null,
  }

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--input') {
      options.input = args[++index]
    } else if (argument === '--hotel') {
      options.hotelName = args[++index]
    } else if (argument === '--dry-run') {
      options.dryRunRequested = true
    } else if (argument === '--send') {
      options.sendRequested = true
    } else if (argument === '--allow-truncated-root-recovery') {
      options.allowTruncatedRootRecovery = true
    } else if (argument === '--wrapper-nonce') {
      options.wrapperNonce = args[++index]
    } else {
      throw new Error('CLI_ARGUMENT_INVALID')
    }
  }

  if (options.dryRunRequested && options.sendRequested) {
    throw new Error('CLI_MODE_CONFLICT')
  }
  if (!options.input || !options.hotelName) {
    throw new Error('CLI_REQUIRED_ARGUMENT_MISSING')
  }
  options.mode = options.sendRequested ? 'SEND' : 'DRY_RUN'
  return options
}

const isInside = (rootPath, childPath) => {
  const childRelativePath = relative(rootPath, childPath)
  return (
    childRelativePath !== '' &&
    !childRelativePath.startsWith('..') &&
    !isAbsolute(childRelativePath)
  )
}

const readSafeInput = async (inputPath) => {
  if (
    typeof inputPath !== 'string' ||
    /^(?:\\\\|\/\/)/.test(inputPath) ||
    /^(?:\\\\[?.]\\)/.test(inputPath)
  ) {
    throw new Error('INPUT_PATH_NOT_LOCAL')
  }

  const absolutePath = resolve(inputPath)
  if (!isInside(inboxRoot, absolutePath)) {
    throw new Error('INPUT_OUTSIDE_UAT_INBOX')
  }

  const inboxMetadata = await lstat(inboxRoot)
  if (inboxMetadata.isSymbolicLink() || !inboxMetadata.isDirectory()) {
    throw new Error('INPUT_INBOX_INVALID')
  }
  const metadata = await lstat(absolutePath)
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('INPUT_FILE_TYPE_INVALID')
  }
  if (metadata.size <= 0 || metadata.size > limits.maxInputBytes) {
    throw new Error('INPUT_FILE_SIZE_INVALID')
  }

  const [realInboxRoot, realInputPath, realWorkspaceRoot] =
    await Promise.all([
      realpath(inboxRoot),
      realpath(absolutePath),
      realpath(workspaceRoot),
    ])
  if (
    !isInside(realWorkspaceRoot, realInboxRoot) ||
    !isInside(realInboxRoot, realInputPath)
  ) {
    throw new Error('INPUT_REALPATH_OUTSIDE_UAT_INBOX')
  }

  return readFile(realInputPath, 'utf8')
}

const main = async () => {
  let options
  try {
    options = parseArguments(process.argv.slice(2))
  } catch (error) {
    safeFailure(error.message)
    return
  }

  let payload
  let summary
  let rawText
  try {
    rawText = await readSafeInput(options.input)
    const parsed = parsePmsJsonText(rawText)
    summary = summarizePmsDocument(parsed.document, {
      recoveredTruncatedRoot: parsed.recoveredTruncatedRoot,
    })
    payload = createWeComTextPayload(summary, {
      hotelName: options.hotelName,
    })
  } catch (error) {
    const reasonCode =
      error instanceof SafePmsJsonError
        ? error.reasonCode
        : 'INPUT_FILE_READ_FAILED'
    safeFailure(reasonCode)
    return
  }

  const messageSha256 = sha256(payload.text.content)
  const inputSha256 = sha256(rawText)
  const messageBytes = Buffer.byteLength(payload.text.content, 'utf8')

  if (options.mode === 'DRY_RUN') {
    process.stdout.write(
      `${JSON.stringify(
        {
          status: 'DRY_RUN_OK',
          networkCalled: false,
          sensitivity: 'INTERNAL_UAT_SANITIZED',
          inputSha256,
          messageSha256,
          messageBytes,
          recoveredTruncatedRoot: summary.recoveredTruncatedRoot,
          recordCount: summary.recordCount,
          roomCountTotal: summary.roomCountTotal,
          preview: payload.text.content,
          mentionedList: ['@all'],
        },
        null,
        2,
      )}\n`,
    )
    return
  }

  if (process.env[SEND_GATE_ENV] !== 'true') {
    safeFailure('WECOM_UAT_SEND_GATE_DISABLED')
    return
  }
  if (
    typeof options.wrapperNonce !== 'string' ||
    !/^[a-f0-9]{32}$/i.test(options.wrapperNonce) ||
    process.env[WRAPPER_NONCE_ENV] !== options.wrapperNonce
  ) {
    safeFailure('WECOM_UAT_WRAPPER_HANDOFF_REQUIRED')
    return
  }
  const expectedHotelName = process.env[EXPECTED_HOTEL_ENV]
  if (
    typeof expectedHotelName !== 'string' ||
    expectedHotelName.trim().length === 0
  ) {
    safeFailure('WECOM_UAT_EXPECTED_HOTEL_REQUIRED')
    return
  }
  let normalizedHotelName
  let normalizedExpectedHotelName
  try {
    normalizedHotelName = normalizeHotelName(options.hotelName)
    normalizedExpectedHotelName = normalizeHotelName(expectedHotelName)
  } catch {
    safeFailure('WECOM_UAT_EXPECTED_HOTEL_INVALID')
    return
  }
  if (normalizedHotelName !== normalizedExpectedHotelName) {
    safeFailure('WECOM_UAT_HOTEL_BINDING_MISMATCH')
    return
  }

  const approvedInputSha256 = process.env[APPROVED_INPUT_SHA_ENV]
  if (
    typeof approvedInputSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(approvedInputSha256) ||
    approvedInputSha256.toLowerCase() !== inputSha256
  ) {
    safeFailure('PMS_JSON_INPUT_SHA_MISMATCH')
    return
  }

  if (summary.recoveredTruncatedRoot) {
    if (!options.allowTruncatedRootRecovery) {
      safeFailure('PMS_JSON_RECOVERY_EXPLICIT_APPROVAL_REQUIRED')
      return
    }
  }

  const rawWebhook = process.env[WEBHOOK_ENV]
  if (!rawWebhook) {
    safeFailure('WECOM_WEBHOOK_ENV_MISSING')
    return
  }
  const expectedEndpointSha256 =
    process.env[ENDPOINT_FINGERPRINT_ENV]
  let endpointSha256
  try {
    endpointSha256 = fingerprintWeComWebhook(rawWebhook)
  } catch (error) {
    const reasonCode =
      error instanceof SafeWeComError
        ? error.reasonCode
        : 'WECOM_WEBHOOK_INVALID'
    safeFailure(reasonCode, 3)
    return
  }
  if (
    typeof expectedEndpointSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(expectedEndpointSha256)
  ) {
    safeFailure('WECOM_ENDPOINT_FINGERPRINT_REQUIRED', 3)
    return
  }
  if (endpointSha256 !== expectedEndpointSha256.toLowerCase()) {
    safeFailure('WECOM_ENDPOINT_FINGERPRINT_MISMATCH', 3)
    return
  }

  let result
  let deliveryClaim
  try {
    deliveryClaim = await acquireDeliveryClaim({
      claimsRoot: deliveryClaimsRoot,
      workspaceRoot,
      endpointSha256,
      messageSha256,
      inputSha256,
    })
    result = await sendWeComGroupRobotMessage({
      rawWebhook,
      payload,
      expectedEndpointSha256,
      fetchImpl: globalThis.fetch,
      networkAuthorized: true,
    })
  } catch (error) {
    const reasonCode =
      error instanceof SafeWeComError
        ? error.reasonCode
        : error instanceof SafeDeliveryClaimError
          ? error.reasonCode
          : 'WECOM_SEND_FAILED_CLOSED'
    safeFailure(reasonCode, 3)
    return
  } finally {
    if (deliveryClaim && !result) {
      await deliveryClaim.close()
    }
  }

  try {
    await deliveryClaim.complete(result)
  } catch {
    safeFailure('WECOM_UAT_DELIVERY_CLAIM_UPDATE_FAILED', 4)
    return
  } finally {
    await deliveryClaim.close()
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        status: result.deliveryStatus,
        reasonCode: result.reasonCode,
        messageSha256,
        endpointSha256: result.endpointSha256,
        httpStatus: result.httpStatus,
        weComCode: result.weComCode,
        automaticRetryAttempted: false,
      },
      null,
      2,
    )}\n`,
  )
  if (result.deliveryStatus === 'AMBIGUOUS') process.exitCode = 4
  if (result.deliveryStatus === 'REJECTED') process.exitCode = 3
}

await main()
