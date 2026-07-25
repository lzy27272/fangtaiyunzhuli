#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { decryptCookie } from './report-source-cookie-crypto.mjs'

const configPath = process.env.OTA_REVIEW_PROBE_CONFIG_PATH
const cookieSecretsPath = process.env.OTA_REVIEW_PROBE_COOKIE_SECRETS_PATH
const cookieSecretKey = process.env.OTA_REVIEW_PROBE_SECRET_KEY
const hotelId = process.env.OTA_REVIEW_PROBE_HOTEL_ID

if (!configPath || !cookieSecretsPath || !cookieSecretKey || !hotelId) {
  process.stderr.write('CONTRACT_DISCOVERY_CONFIGURATION_INVALID\n')
  process.exit(2)
}

const configByHotel = JSON.parse(readFileSync(configPath, 'utf8'))
const secretsByHotel = JSON.parse(readFileSync(cookieSecretsPath, 'utf8'))
const sources = configByHotel[hotelId]
const secrets = secretsByHotel[hotelId]
if (!Array.isArray(sources) || !secrets || typeof secrets !== 'object') {
  process.stderr.write('CONTRACT_DISCOVERY_HOTEL_CONFIGURATION_MISSING\n')
  process.exit(3)
}

const source = sources.find(
  (item) =>
    item.enabled
    && new URL(item.endpointUrl).hostname === 'pms.meituan.com'
    && secrets[item.sourceId],
)
if (!source) {
  process.stderr.write('CONTRACT_DISCOVERY_SOURCE_MISSING\n')
  process.exit(4)
}

const cookie = decryptCookie(
  secrets[source.sourceId],
  cookieSecretKey,
  `${hotelId}:${source.sourceId}`,
)
const origin = 'https://pms.meituan.com'
const allowedStaticHosts = new Set([
  's3.meituan.net',
  's3plus.meituan.net',
])
const MAX_DOCUMENT_BYTES = 3 * 1024 * 1024
const MAX_ASSET_BYTES = 12 * 1024 * 1024
const MAX_TOTAL_ASSET_BYTES = 40 * 1024 * 1024
const NEEDLES = [
  '/hotelpms/api/v1/report/jd01',
  '/hotelpms/api/v1/report/lion/manager/workbench/room',
  '/hotelpms/api/v2/report/jy09',
  'lion/manager/workbench/room',
  'report/jy09',
  'report/JY09',
]

const readLimitedText = async (response, limit) => {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) {
        await reader.cancel()
        throw new Error('DISCOVERY_RESPONSE_TOO_LARGE')
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return text
  } finally {
    reader.releaseLock()
  }
}

const fetchSameOrigin = async (url, limit) => {
  const target = new URL(url, origin)
  if (target.origin !== origin) {
    throw new Error('DISCOVERY_CROSS_ORIGIN_BLOCKED')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/javascript,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Cookie: cookie,
        Referer: `${origin}/`,
        'User-Agent': 'Mozilla/5.0 ContractDiscovery/0.1',
      },
    })
    if (new URL(response.url).origin !== origin) {
      throw new Error('DISCOVERY_CROSS_ORIGIN_REDIRECT_BLOCKED')
    }
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      finalPath: new URL(response.url).pathname,
      text: await readLimitedText(response, limit),
    }
  } finally {
    clearTimeout(timer)
  }
}

const fetchPublicStaticAsset = async (url, limit) => {
  const target = new URL(url)
  if (target.protocol !== 'https:' || !allowedStaticHosts.has(target.host)) {
    throw new Error('DISCOVERY_STATIC_HOST_BLOCKED')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'application/javascript,text/javascript,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'User-Agent': 'Mozilla/5.0 ContractDiscovery/0.1',
      },
    })
    const finalUrl = new URL(response.url)
    if (
      finalUrl.protocol !== 'https:'
      || !allowedStaticHosts.has(finalUrl.host)
    ) {
      throw new Error('DISCOVERY_STATIC_REDIRECT_BLOCKED')
    }
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      finalPath: finalUrl.pathname,
      text: await readLimitedText(response, limit),
    }
  } finally {
    clearTimeout(timer)
  }
}

const redactSnippet = (text) =>
  text
    .replace(/https?:\/\/[^"'`\s)]+/gi, '<URL>')
    .replace(/[A-Za-z0-9_=-]{32,}/g, '<OPAQUE>')
    .replace(/\b\d{6,}\b/g, '<NUM>')
    .replace(/\s+/g, ' ')
    .slice(0, 900)

const documents = []
const assetUrls = new Set()
for (const entryPath of ['/', '/pms-web/']) {
  try {
    const document = await fetchSameOrigin(entryPath, MAX_DOCUMENT_BYTES)
    const resourceRefs = []
    for (const match of document.text.matchAll(
      /<(?:script|link)\b[^>]+?(?:src|href)=["']([^"']+)["']/gi,
    )) {
      try {
        const resourceUrl = new URL(
          match[1],
          `${origin}${document.finalPath}`,
        )
        resourceRefs.push({
          host: resourceUrl.host,
          path: resourceUrl.pathname,
        })
        if (
          (
            resourceUrl.origin === origin
            || allowedStaticHosts.has(resourceUrl.host)
          )
          && /\.(?:js|mjs)$/i.test(resourceUrl.pathname)
        ) {
          assetUrls.add(resourceUrl.href)
        }
      } catch {
        // Ignore malformed optional resource references.
      }
    }
    documents.push({
      entryPath,
      status: document.status,
      finalPath: document.finalPath,
      contentType: document.contentType,
      bytes: Buffer.byteLength(document.text, 'utf8'),
      resourceRefs: resourceRefs.slice(0, 80),
    })
  } catch (error) {
    documents.push({
      entryPath,
      errorCode: error instanceof Error ? error.message : 'DISCOVERY_FAILED',
    })
  }
}

const matches = []
let scannedBytes = 0
let scannedAssets = 0
for (const assetUrl of [...assetUrls].slice(0, 120)) {
  if (scannedBytes >= MAX_TOTAL_ASSET_BYTES) break
  try {
    const asset =
      new URL(assetUrl).origin === origin
        ? await fetchSameOrigin(assetUrl, MAX_ASSET_BYTES)
        : await fetchPublicStaticAsset(assetUrl, MAX_ASSET_BYTES)
    scannedAssets += 1
    scannedBytes += Buffer.byteLength(asset.text, 'utf8')
    for (const needle of NEEDLES) {
      let index = asset.text.indexOf(needle)
      while (index >= 0 && matches.length < 40) {
        matches.push({
          assetPath: new URL(assetUrl).pathname,
          needle,
          snippet: redactSnippet(
            asset.text.slice(Math.max(0, index - 350), index + needle.length + 550),
          ),
        })
        index = asset.text.indexOf(needle, index + needle.length)
      }
    }
  } catch {
    // Individual optional chunks may be unavailable; discovery remains best effort.
  }
}

process.stdout.write(`${JSON.stringify({
  mode: 'READ_ONLY_STATIC_FRONTEND_CONTRACT_DISCOVERY',
  documents,
  discoveredAssetCount: assetUrls.size,
  scannedAssets,
  scannedBytes,
  matches,
}, null, 2)}\n`)
