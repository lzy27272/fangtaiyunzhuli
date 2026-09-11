#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { monitorFromSnapshot } from './live-report-collector.mjs'
import {
  createCombinedOperationsWeComPayloads,
} from './wecom/src/combined-operations-brief.mjs'

const hotelCode = String(process.argv[2] ?? '').trim().padStart(3, '0')
const dataPath = process.env.OTA_REVIEW_DATA_PATH?.trim()

if (!/^\d{3}$/u.test(hotelCode) || !dataPath) {
  process.stderr.write('COMBINED_PREVIEW_CONFIGURATION_INVALID\n')
  process.exit(2)
}

const dataDirectory = dirname(dataPath)
const hotelPath = join(dataDirectory, 'simulation-hotels.json')
const snapshotPath = join(dataDirectory, 'live-report-snapshots.json')

if ([hotelPath, snapshotPath].some((path) => !existsSync(path))) {
  process.stderr.write('COMBINED_PREVIEW_RUNTIME_DATA_MISSING\n')
  process.exit(2)
}

const loadJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const hotels = loadJson(hotelPath)
const snapshotsByHotel = loadJson(snapshotPath)
const hotel = Array.isArray(hotels)
  ? hotels.find((candidate) => candidate?.hotelCode === hotelCode)
  : null

if (!hotel?.hotelId) {
  process.stderr.write('COMBINED_PREVIEW_HOTEL_NOT_FOUND\n')
  process.exit(2)
}

const snapshots = snapshotsByHotel[hotel.hotelId]
const snapshot = Array.isArray(snapshots) ? snapshots.at(-1) : null
if (!snapshot) {
  process.stderr.write('COMBINED_PREVIEW_SNAPSHOT_REQUIRED\n')
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
  process.stderr.write('COMBINED_PREVIEW_SINGLE_MESSAGE_REQUIRED\n')
  process.exit(2)
}

const payload = payloads[0]
const content = payload?.text?.content ?? ''
const messageSha256 = createHash('sha256').update(content).digest('hex')

process.stdout.write(`${JSON.stringify({
  hotelId: hotel.hotelId,
  hotelCode,
  deliveryType: 'COMBINED_OPERATIONS_PREVIEW',
  deliveryStatus: 'PREVIEW_ONLY',
  businessDate: snapshot.businessDate,
  cutoffAt: snapshot.observedAt,
  messageSha256,
  messageBytes: Buffer.byteLength(content, 'utf8'),
  mentionedList: payload?.text?.mentioned_list ?? [],
  partCount: payloads.length,
})}\n`)
