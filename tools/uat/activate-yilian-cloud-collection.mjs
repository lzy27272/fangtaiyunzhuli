#!/usr/bin/env node

import {
  lstatSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { decryptCookie } from './report-source-cookie-crypto.mjs'
import { collectYilianCloudReports } from './yilian-cloud-collector.mjs'

const hotelCode = String(process.env.YILIAN_ACTIVATION_HOTEL_CODE ?? '')
  .trim()
  .toUpperCase()
const activationMode = String(
  process.env.YILIAN_ACTIVATION_MODE ?? 'SHADOW_ONLY',
).trim()
const sourcesPath = process.env.OTA_REVIEW_DATA_PATH?.trim() ?? ''
const dataDirectory = sourcesPath ? dirname(sourcesPath) : ''
const hotelsPath = dataDirectory
  ? join(dataDirectory, 'simulation-hotels.json')
  : ''
const controlsPath = dataDirectory
  ? join(dataDirectory, 'business-day-controls.json')
  : ''
const secretsPath = process.env.OTA_REVIEW_COOKIE_SECRETS_PATH?.trim() ?? ''
const encryptionKey = process.env.OTA_REVIEW_SECRET_KEY?.trim() ?? ''
const pseudonymKey = process.env.OTA_REVIEW_PSEUDONYM_SECRET_KEY?.trim() ?? ''

if (
  !/^\d{3}$/u.test(hotelCode)
  || !['SHADOW_ONLY', 'ACTIVATE_AFTER_SHADOW'].includes(activationMode)
  || !sourcesPath
  || !hotelsPath
  || !secretsPath
  || Buffer.from(encryptionKey, 'base64url').length !== 32
  || Buffer.from(pseudonymKey, 'base64url').length !== 32
) throw new Error('YILIAN_ACTIVATION_CONFIGURATION_INVALID')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const hotels = readJson(hotelsPath)
if (!Array.isArray(hotels)) throw new Error('YILIAN_HOTEL_STORE_INVALID')
const matchingHotels = hotels.filter((hotel) => hotel?.hotelCode === hotelCode)
if (matchingHotels.length !== 1) throw new Error('YILIAN_HOTEL_SCOPE_INVALID')
const hotel = matchingHotels[0]
const legacyYilian = hotel.pmsSystemCode === 'OTHER'
  && /^(?:驿联云(?:\s*PMS)?|YILIAN(?:\s*CLOUD)?(?:\s*PMS)?)$/iu.test(
    String(hotel.pmsSystemName ?? '').trim(),
  )
if (hotel.pmsSystemCode !== 'YILIAN_CLOUD' && !legacyYilian) {
  throw new Error('YILIAN_PMS_SCOPE_INVALID')
}

const sourceStore = readJson(sourcesPath)
const sources = Array.isArray(sourceStore?.[hotel.hotelId])
  ? sourceStore[hotel.hotelId]
  : []
const enabledSources = sources.filter((source) => source?.enabled)
if (enabledSources.length !== 3) throw new Error('YILIAN_SOURCE_CONTRACT_INVALID')

const secretStore = readJson(secretsPath)
const encryptedBySourceId = secretStore?.[hotel.hotelId]
if (
  !encryptedBySourceId
  || typeof encryptedBySourceId !== 'object'
  || Array.isArray(encryptedBySourceId)
) throw new Error('YILIAN_ACCESS_TOKEN_REQUIRED')
const accessTokensBySourceId = {}
for (const source of enabledSources) {
  const record = encryptedBySourceId[source.sourceId]
  if (!record) throw new Error('YILIAN_ACCESS_TOKEN_REQUIRED')
  accessTokensBySourceId[source.sourceId] = decryptCookie(
    record,
    encryptionKey,
    `${hotel.hotelId}:${source.sourceId}`,
  )
}

let configuredReportDate = null
try {
  const controls = readJson(controlsPath)
  if (/^\d{4}-\d{2}-\d{2}$/u.test(controls?.[hotel.hotelId]?.businessDate)) {
    configuredReportDate = controls[hotel.hotelId].businessDate
  }
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const result = await collectYilianCloudReports({
  hotel: { ...hotel, pmsSystemCode: 'YILIAN_CLOUD' },
  sources: enabledSources,
  accessTokensBySourceId,
  previousSnapshots: [],
  secretKey: pseudonymKey,
  configuredReportDate,
})
const { snapshot, run } = result
const allowedOrderFields = new Set([
  'key',
  'channel',
  'status',
  'roomNights',
  'arrivalClass',
  'orderDate',
  'arrivalDate',
])
const overviewValues = [
  snapshot?.overview?.roomCount,
  snapshot?.overview?.availableRooms,
  snapshot?.overview?.soldRooms,
]
const safeOrders = Array.isArray(snapshot?.orders)
  && snapshot.orders.every((order) =>
    order
    && typeof order === 'object'
    && /^[a-f0-9]{32}$/u.test(order.key)
    && Object.keys(order).every((key) => allowedOrderFields.has(key)))
const serializedSnapshot = JSON.stringify(snapshot)
const containsAccessToken = Object.values(accessTokensBySourceId)
  .some((token) => serializedSnapshot.includes(token))
if (
  run?.status !== 'SUCCEEDED'
  || run.sourceCount !== 3
  || run.successfulSourceCount !== 3
  || run.outboundDeliveryAttempted !== false
  || snapshot?.completeness !== 'COMPLETE'
  || !Array.isArray(snapshot.sources)
  || snapshot.sources.length !== 3
  || snapshot.sources.some((source) => source.completeness !== 'COMPLETE')
  || !Array.isArray(snapshot.physicalInventory)
  || snapshot.physicalInventory.length < 1
  || !Array.isArray(snapshot.futureDaily)
  || snapshot.futureDaily.length < 1
  || overviewValues.some((value) => !Number.isFinite(value) || value < 0)
  || snapshot.overview.availableRooms + snapshot.overview.soldRooms
    > snapshot.overview.roomCount
  || !safeOrders
  || containsAccessToken
) throw new Error('YILIAN_SHADOW_VALIDATION_FAILED')

let state = 'YILIAN_SHADOW_VALIDATED'
let collectionEnabled = hotel.collectionEnabled === true
if (activationMode === 'ACTIVATE_AFTER_SHADOW') {
  const hotelIndex = hotels.indexOf(hotel)
  hotels[hotelIndex] = {
    ...hotel,
    pmsSystemCode: 'YILIAN_CLOUD',
    pmsSystemName: '驿联云 PMS',
    collectionEnabled: true,
    rowVersion: Number.isInteger(hotel.rowVersion) && hotel.rowVersion > 0
      ? hotel.rowVersion + 1
      : 1,
  }
  const hotelStats = lstatSync(hotelsPath)
  if (!hotelStats.isFile() || hotelStats.isSymbolicLink()) {
    throw new Error('YILIAN_HOTEL_STORE_PATH_UNSAFE')
  }
  const temporaryPath = `${hotelsPath}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(hotels, null, 2)}\n`,
    { encoding: 'utf8', mode: hotelStats.mode & 0o777 },
  )
  renameSync(temporaryPath, hotelsPath)
  state = 'YILIAN_SHADOW_VALIDATED_AND_ACTIVATED'
  collectionEnabled = true
}

process.stdout.write(`${JSON.stringify({
  state,
  hotelCode,
  sourceCount: run.sourceCount,
  successfulSourceCount: run.successfulSourceCount,
  businessDate: run.businessDate,
  completeness: snapshot.completeness,
  inventoryRoomTypeCount: snapshot.physicalInventory.length,
  futureDayCount: snapshot.futureDaily.length,
  pseudonymizedOrderCount: snapshot.orders.length,
  identityFieldsPersisted: false,
  outboundDeliveryAttempted: false,
  collectionEnabled,
})}\n`)
