import { existsSync } from 'node:fs'
import {
  appendFile,
  mkdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  isAuthenticationUrl,
  isLuopanUrl,
  sanitizeNetworkUrl,
  summarizeJsonShape,
  summarizeRequestPayload,
} from './luopan-network-sanitizer.mjs'
import {
  luopanProfileName,
  luopanProfilePaths,
} from './luopan-profile.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.UAT_PLAYWRIGHT_MODULE ?? 'playwright',
)
const toolRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(toolRoot, '..', '..')
const profileName = luopanProfileName()
const {
  runtimeRoot,
  profileRoot,
} = luopanProfilePaths({ repoRoot, profileName })
const statusPath = path.join(runtimeRoot, 'status.json')
const eventPath = path.join(runtimeRoot, 'network-events.jsonl')
const logPath = path.join(runtimeRoot, 'discovery.log')
const loginUrl =
  'http://bj.chinapms.com:8880/pms-web/login/login.do'
const browserExecutable =
  process.env.UAT_BROWSER_EXECUTABLE
  ?? [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find(existsSync)
const MAX_JSON_BYTES = 2 * 1024 * 1024
const interestingResourceTypes = new Set([
  'document',
  'xhr',
  'fetch',
])

if (!browserExecutable || !existsSync(browserExecutable)) {
  throw new Error('LUOPAN_DISCOVERY_BROWSER_NOT_FOUND')
}

await mkdir(runtimeRoot, { recursive: true })
await mkdir(profileRoot, { recursive: true })
await rm(eventPath, { force: true })

let eventCount = 0
let captureErrors = 0
let writeQueue = Promise.resolve()
let context
let closing = false

const writeStatus = async (status, detail = {}) => {
  const temporaryPath = `${statusPath}.${process.pid}.tmp`
  await writeFile(
    temporaryPath,
    `${JSON.stringify({
      status,
      pid: process.pid,
      startedAt,
      updatedAt: new Date().toISOString(),
      loginEndpoint: sanitizeNetworkUrl(loginUrl).endpoint,
      profileName,
      eventCount,
      captureErrors,
      storesCredentials: false,
      storesCookiesInLog: false,
      ...detail,
    }, null, 2)}\n`,
    'utf8',
  )
  await rename(temporaryPath, statusPath)
}

const appendLog = (message) => {
  writeQueue = writeQueue.then(() =>
    appendFile(
      logPath,
      `${new Date().toISOString()} ${message}\n`,
      'utf8',
    ))
  return writeQueue
}

const appendEvent = (event) => {
  eventCount += 1
  writeQueue = writeQueue.then(() =>
    appendFile(
      eventPath,
      `${JSON.stringify(event)}\n`,
      'utf8',
    ))
  return writeQueue
}

const startedAt = new Date().toISOString()
await writeStatus('STARTING')
await appendLog(
  'DISCOVERY_START credentials=false cookieHeaders=false rawBodies=false',
)

const safeFrameEndpoint = (request) => {
  try {
    const frameUrl = request.frame()?.url()
    return isLuopanUrl(frameUrl)
      ? sanitizeNetworkUrl(frameUrl).endpoint
      : null
  } catch {
    return null
  }
}

const captureResponse = async (response) => {
  const rawUrl = response.url()
  if (!isLuopanUrl(rawUrl)) return
  const request = response.request()
  const resourceType = request.resourceType()
  const contentType =
    response.headers()['content-type']?.toLowerCase() ?? ''
  const contentDisposition =
    response.headers()['content-disposition']?.toLowerCase() ?? ''
  const isDataResponse =
    interestingResourceTypes.has(resourceType)
    || /json|csv|excel|spreadsheet/.test(contentType)
    || /attachment/.test(contentDisposition)
  if (!isDataResponse) return

  const sanitized = sanitizeNetworkUrl(rawUrl)
  const authenticationFlow = isAuthenticationUrl(rawUrl)
  const requestContentType =
    request.headers()['content-type']?.toLowerCase() ?? ''
  const event = {
    observedAt: new Date().toISOString(),
    kind: 'RESPONSE',
    endpoint: sanitized.endpoint,
    queryKeys: sanitized.queryKeys,
    pageEndpoint: safeFrameEndpoint(request),
    resourceType,
    method: request.method(),
    status: response.status(),
    contentType,
    authenticationFlow,
    requestPayload: authenticationFlow
      ? '[REDACTED_AUTH_FLOW]'
      : summarizeRequestPayload({
          postData: request.postData(),
          contentType: requestContentType,
        }),
    responseShape: null,
    responseBodyStored: false,
  }

  if (
    !authenticationFlow
    && /(?:application|text)\/(?:[\w.+-]*\+)?json/i.test(contentType)
  ) {
    try {
      const lengthHeader = Number(response.headers()['content-length'])
      if (
        !Number.isFinite(lengthHeader)
        || lengthHeader <= MAX_JSON_BYTES
      ) {
        const body = await response.body()
        if (body.byteLength <= MAX_JSON_BYTES) {
          event.responseShape = summarizeJsonShape(
            JSON.parse(body.toString('utf8')),
          )
        } else {
          event.responseShape = {
            skipped: 'BODY_TOO_LARGE',
            byteLength: body.byteLength,
          }
        }
      } else {
        event.responseShape = {
          skipped: 'CONTENT_LENGTH_TOO_LARGE',
          byteLength: lengthHeader,
        }
      }
    } catch {
      captureErrors += 1
      event.responseShape = { skipped: 'JSON_PARSE_FAILED' }
    }
  } else if (
    /csv|excel|spreadsheet/.test(contentType)
    || /attachment/.test(contentDisposition)
  ) {
    event.responseShape = { exportCandidate: true }
  }

  await appendEvent(event)
  await writeStatus('WAITING_FOR_USER', {
    instruction:
      '请手动登录并依次打开需要采集的报表；完成后关闭浏览器。',
  })
}

context = await chromium.launchPersistentContext(profileRoot, {
  headless: false,
  executablePath: browserExecutable,
  acceptDownloads: false,
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  viewport: { width: 1440, height: 960 },
  args: [
    '--disable-features=PasswordManagerOnboarding,PasswordLeakDetection',
    '--disable-save-password-bubble',
    '--no-default-browser-check',
    '--no-first-run',
  ],
})

context.on('response', (response) => {
  void captureResponse(response).catch(async (error) => {
    captureErrors += 1
    await appendLog(
      `RESPONSE_CAPTURE_FAILED code=${error?.name ?? 'Error'}`,
    )
  })
})

context.on('requestfailed', (request) => {
  if (!isLuopanUrl(request.url())) return
  const sanitized = sanitizeNetworkUrl(request.url())
  void appendEvent({
    observedAt: new Date().toISOString(),
    kind: 'REQUEST_FAILED',
    endpoint: sanitized.endpoint,
    queryKeys: sanitized.queryKeys,
    pageEndpoint: safeFrameEndpoint(request),
    resourceType: request.resourceType(),
    method: request.method(),
    errorCode: request.failure()?.errorText ?? 'UNKNOWN',
    requestPayload: isAuthenticationUrl(request.url())
      ? '[REDACTED_AUTH_FLOW]'
      : null,
  })
})

const closeDiscovery = async (reason) => {
  if (closing) return
  closing = true
  await writeQueue
  await writeStatus('COMPLETED', {
    completedAt: new Date().toISOString(),
    completionReason: reason,
  })
  await appendLog(
    `DISCOVERY_COMPLETED reason=${reason} eventCount=${eventCount}`,
  )
}

context.on('close', () => {
  void closeDiscovery('BROWSER_CLOSED')
})

process.on('SIGINT', () => {
  void context.close()
})
process.on('SIGTERM', () => {
  void context.close()
})

const pages = context.pages()
const page = pages[0] ?? await context.newPage()
page.on('close', () => {
  if (context.pages().length === 0) {
    void context.close()
  }
})
await page.goto(loginUrl, {
  waitUntil: 'domcontentloaded',
  timeout: 30_000,
})
await page.bringToFront()
await writeStatus('WAITING_FOR_USER', {
  instruction:
    '请手动登录并依次打开需要采集的报表；完成后关闭浏览器。',
})
await appendLog('LOGIN_PAGE_OPENED')

await new Promise((resolve) => {
  context.once('close', resolve)
})
await closeDiscovery('BROWSER_CLOSED')
