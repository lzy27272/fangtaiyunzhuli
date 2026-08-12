#!/usr/bin/env node

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { validateLuopanBrowserSession } from './luopan-controlled-browser-collector.mjs'

const toolRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(toolRoot, '..', '..')
const runtimeRoot = path.join(repoRoot, '.uat-runtime', 'ota-review')
const hotelCatalogPath = path.join(runtimeRoot, 'simulation-hotels.json')
const configPath = path.join(runtimeRoot, 'luopan-browser-configs.json')
const HOTEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PROFILE_REF = /^[a-z0-9][a-z0-9_-]{0,39}$/

const argument = (name) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
    .trim()

const hotelId = argument('hotel-id') ?? ''
const profileRef = (argument('profile') ?? '').toLowerCase()

if (!HOTEL_ID.test(hotelId) || !PROFILE_REF.test(profileRef)) {
  throw new Error('LUOPAN_HOTEL_CONFIGURATION_ARGUMENT_INVALID')
}
if (!existsSync(hotelCatalogPath)) {
  throw new Error('LUOPAN_HOTEL_CATALOG_NOT_FOUND')
}

const hotelCatalog = JSON.parse(readFileSync(hotelCatalogPath, 'utf8'))
if (
  !Array.isArray(hotelCatalog)
  || !hotelCatalog.some((hotel) => hotel?.hotelId === hotelId)
) {
  throw new Error('LUOPAN_TARGET_HOTEL_NOT_FOUND')
}

let configs = {}
if (existsSync(configPath)) {
  configs = JSON.parse(readFileSync(configPath, 'utf8'))
  if (!configs || typeof configs !== 'object' || Array.isArray(configs)) {
    throw new Error('LUOPAN_CONFIG_STORE_INVALID')
  }
}

const existing = configs[hotelId]
const validation = await validateLuopanBrowserSession({ profileRef })
const sameScope =
  existing?.profileRef === validation.profileRef
  && existing?.expectedHotelFingerprint === validation.hotelFingerprint

configs[hotelId] = {
  providerCode: 'LUOPAN_CLOUD',
  portalUrl: 'http://bj.chinapms.com:8880/pms-web/login/login.do',
  enabled: true,
  profileRef: validation.profileRef,
  expectedHotelFingerprint: validation.hotelFingerprint,
  scopeStatus: validation.scopeStatus,
  pollIntervalMinutes: 30,
  lastValidatedAt: validation.validatedAt,
  lastBusinessDate: validation.businessDate,
  lastCollectionStatus:
    sameScope && ['NEVER', 'COMPLETE', 'PARTIAL', 'FAILED'].includes(
      existing.lastCollectionStatus,
    )
      ? existing.lastCollectionStatus
      : 'NEVER',
  lastCollectionAt: sameScope ? existing.lastCollectionAt ?? null : null,
  lastErrorCode: null,
  rowVersion:
    Number.isInteger(existing?.rowVersion) && existing.rowVersion >= 0
      ? existing.rowVersion + 1
      : 1,
}

mkdirSync(runtimeRoot, { recursive: true })
const temporaryPath = `${configPath}.${process.pid}.tmp`
writeFileSync(
  temporaryPath,
  `${JSON.stringify(configs, null, 2)}\n`,
  { encoding: 'utf8', mode: 0o600 },
)
renameSync(temporaryPath, configPath)
try {
  chmodSync(configPath, 0o600)
} catch {
  // Windows ACLs remain authoritative when POSIX mode bits are unavailable.
}

process.stdout.write(`${JSON.stringify({
  configured: true,
  enabled: true,
  hotelId,
  profileRef: validation.profileRef,
  scopeStatus: validation.scopeStatus,
  businessDate: validation.businessDate,
  lastCollectionStatus: configs[hotelId].lastCollectionStatus,
})}\n`)
