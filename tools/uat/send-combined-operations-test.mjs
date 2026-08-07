#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { decryptCookie } from './report-source-cookie-crypto.mjs'
import { monitorFromSnapshot } from './live-report-collector.mjs'
import {
  createCombinedOperationsWeComPayloads,
} from './wecom/src/combined-operations-brief.mjs'
import {
  fingerprintWeComWebhook,
  sendWeComGroupRobotMessage,
  sha256,
} from './wecom/src/wecom-group-robot.mjs'

const hotelCode = String(process.argv[2] ?? '').trim().padStart(3, '0')
const dataPath = process.env.OTA_REVIEW_DATA_PATH?.trim()
const secretKey = process.env.OTA_REVIEW_SECRET_KEY?.trim()

if (!/^\d{3}$/u.test(hotelCode) || !dataPath || !secretKey) {
  process.stderr.write('COMBINED_TEST_CONFIGURATION_INVALID\n')
  process.exit(2)
}

const dataDirectory = dirname(dataPath)
const hotelPath = join(dataDirectory, 'simulation-hotels.json')
const snapshotPath = join(dataDirectory, 'live-report-snapshots.json')
const configPath = join(dataDirectory, 'wecom-configs.json')
const secretPath = join(dataDirectory, 'wecom-webhook-secrets.json')
const auditPath = join(dataDirectory, 'wecom-combined-test-deliveries.json')

const requiredPaths = [hotelPath, snapshotPath, configPath, secretPath]
if (requiredPaths.some((path) => !existsSync(path))) {
  process.stderr.write('COMBINED_TEST_RUNTIME_DATA_MISSING\n')
  process.exit(2)
}

const loadJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const hotels = loadJson(hotelPath)
const snapshotsByHotel = loadJson(snapshotPath)
const configsByHotel = loadJson(configPath)
const secretsByHotel = loadJson(secretPath)
const hotel = Array.isArray(hotels)
  ? hotels.find((candidate) => candidate?.hotelCode === hotelCode)
  : null

if (!hotel?.hotelId) {
  process.stderr.write('COMBINED_TEST_HOTEL_NOT_FOUND\n')
  process.exit(2)
}

const snapshots = snapshotsByHotel[hotel.hotelId]
const snapshot = Array.isArray(snapshots) ? snapshots.at(-1) : null
const config = configsByHotel[hotel.hotelId]
const encryptedSecret = secretsByHotel[hotel.hotelId]
if (!snapshot) {
  process.stderr.write('COMBINED_TEST_SNAPSHOT_REQUIRED\n')
  process.exit(2)
}
if (!config?.endpointSha256 || !encryptedSecret) {
  process.stderr.write('COMBINED_TEST_WECOM_NOT_CONFIGURED\n')
  process.exit(2)
}

const webhook = decryptCookie(
  encryptedSecret,
  secretKey,
  `wecom-webhook:${hotel.hotelId}`,
)
const endpointSha256 = fingerprintWeComWebhook(webhook)
if (endpointSha256 !== String(config.endpointSha256).toLowerCase()) {
  process.stderr.write('COMBINED_TEST_ENDPOINT_FINGERPRINT_MISMATCH\n')
  process.exit(2)
}

const monitor = monitorFromSnapshot(snapshot, hotel, null, [])
const payloads = createCombinedOperationsWeComPayloads({
  hotel,
  monitor,
  snapshot,
  messagePrefix: '合并版预览',
})
if (payloads.length !== 1) {
  process.stderr.write('COMBINED_TEST_SINGLE_MESSAGE_REQUIRED\n')
  process.exit(2)
}

const messageKey = `${hotel.hotelId}:COMBINED_TEST:${randomUUID()}`
const attemptedAt = new Date().toISOString()
const result = await sendWeComGroupRobotMessage({
  rawWebhook: webhook,
  payload: payloads[0],
  expectedEndpointSha256: endpointSha256,
  fetchImpl: globalThis.fetch,
  networkAuthorized: true,
})
const completedAt = new Date().toISOString()
const record = {
  deliveryId: randomUUID(),
  messageKey,
  deliveryType: 'COMBINED_OPERATIONS_TEST',
  hotelId: hotel.hotelId,
  hotelCode,
  businessDate: snapshot.businessDate,
  cutoffAt: snapshot.observedAt,
  attemptedAt,
  completedAt,
  deliveryStatus: result.deliveryStatus,
  reasonCode: result.reasonCode,
  endpointSha256,
  messageSha256: sha256(payloads[0].text.content),
  messageBytes: Buffer.byteLength(payloads[0].text.content, 'utf8'),
  partCount: 1,
  deliveredPartCount: result.deliveryStatus === 'DELIVERED' ? 1 : 0,
  httpStatus: result.httpStatus,
  weComCode: result.weComCode,
}
const auditRecords = existsSync(auditPath) ? loadJson(auditPath) : []
const nextRecords = [
  ...(Array.isArray(auditRecords) ? auditRecords : []),
  record,
].slice(-500)
mkdirSync(dataDirectory, { recursive: true })
const temporaryPath = `${auditPath}.${process.pid}.tmp`
writeFileSync(
  temporaryPath,
  `${JSON.stringify(nextRecords, null, 2)}\n`,
  { encoding: 'utf8', mode: 0o600 },
)
renameSync(temporaryPath, auditPath)

process.stdout.write(`${JSON.stringify({
  hotelId: record.hotelId,
  hotelCode: record.hotelCode,
  deliveryType: record.deliveryType,
  deliveryStatus: record.deliveryStatus,
  reasonCode: record.reasonCode,
  httpStatus: record.httpStatus,
  weComCode: record.weComCode,
  partCount: record.partCount,
  deliveredPartCount: record.deliveredPartCount,
  completedAt: record.completedAt,
  messageBytes: record.messageBytes,
})}\n`)

if (record.deliveryStatus !== 'DELIVERED') process.exitCode = 1
