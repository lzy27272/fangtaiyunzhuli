import { existsSync } from 'node:fs'
import {
  mkdir,
  rename,
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
const outputPath = path.join(runtimeRoot, 'report-catalog.json')
const browserExecutable =
  process.env.UAT_BROWSER_EXECUTABLE
  ?? [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find(existsSync)
const reportCenterUrl =
  'http://bj.chinapms.com:8880/pms-web/report/index.do'
const categories = ['收入', '预订', '库存']

if (!browserExecutable || !existsSync(browserExecutable)) {
  throw new Error('LUOPAN_REPORT_CATALOG_BROWSER_NOT_FOUND')
}
if (!existsSync(profileRoot)) {
  throw new Error('LUOPAN_REPORT_CATALOG_PROFILE_NOT_FOUND')
}

await mkdir(runtimeRoot, { recursive: true })

const context = await chromium.launchPersistentContext(profileRoot, {
  headless: true,
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

const page = context.pages()[0] ?? await context.newPage()
const networkEvents = []
page.on('response', (response) => {
  if (!isLuopanUrl(response.url())) return
  const request = response.request()
  if (!['xhr', 'fetch'].includes(request.resourceType())) return
  const sanitized = sanitizeNetworkUrl(response.url())
  networkEvents.push({
    observedAt: new Date().toISOString(),
    endpoint: sanitized.endpoint,
    queryKeys: sanitized.queryKeys,
    method: request.method(),
    status: response.status(),
    contentType:
      response.headers()['content-type']?.toLowerCase() ?? '',
  })
})

const visibleCatalogItems = async () =>
  page.evaluate(() => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return (
        style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0
      )
    }
    const cleanText = (element) =>
      String(element.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160)
    const candidates = [
      ...document.querySelectorAll(
        'a, button, li, td, [onclick], [data-url], [data-report-id]',
      ),
    ]
    const values = []
    for (const element of candidates) {
      if (!isVisible(element)) continue
      const text = cleanText(element)
      if (
        text.length < 2
        || text.length > 120
        || /@/.test(text)
        || /\d{9,}/.test(text.replace(/\s/g, ''))
      ) continue
      values.push(text)
    }
    return [...new Set(values)].slice(0, 500)
  })

const categoryRegion = async (category) =>
  page.evaluate((categoryName) => {
    const normalized = (element) =>
      String(element.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim()
    const visible = (element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return (
        style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0
      )
    }
    const pattern = new RegExp(`^${categoryName}\\s*\\d+$`)
    const target = [
      ...document.querySelectorAll('li, a, button, div, span'),
    ].find((element) =>
      visible(element) && pattern.test(normalized(element)))
    if (!target) return null
    const levels = []
    let current = target
    for (let depth = 0; current && depth < 5; depth += 1) {
      const items = [
        ...current.querySelectorAll('a, button, li, td, span'),
      ].filter(visible).map(normalized).filter((text) =>
        text.length >= 2
        && text.length <= 120
        && !/@/.test(text)
        && !/\d{9,}/.test(text.replace(/\s/g, '')))
      levels.push({
        depth,
        tag: current.tagName.toLowerCase(),
        id: String(current.id ?? '').slice(0, 80),
        className: String(current.className ?? '').slice(0, 160),
        items: [...new Set(items)].slice(0, 500),
      })
      current = current.parentElement
    }
    return levels
  }, category)

const catalog = []
let reauthenticationRequired = false

try {
  for (const category of categories) {
    await page.goto(reportCenterUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    await page.waitForTimeout(1_000)
    if (isAuthenticationUrl(page.url())) {
      reauthenticationRequired = true
      break
    }
    const before = new Set(await visibleCatalogItems())
    const networkStart = networkEvents.length
    const clicked = await page.evaluate((categoryName) => {
      const normalized = (element) =>
        String(element.textContent ?? '')
          .replace(/\s+/g, ' ')
          .trim()
      const visible = (element) => {
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return (
          style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0
        )
      }
      const pattern = new RegExp(`^${categoryName}\\s*\\d+$`)
      const target = [
        ...document.querySelectorAll('li, a, button, div, span'),
      ].find((element) =>
        visible(element) && pattern.test(normalized(element)))
      if (!target) return false
      target.click()
      return true
    }, category)
    if (!clicked) {
      catalog.push({
        category,
        status: 'CATEGORY_NOT_FOUND',
        items: [],
      })
      continue
    }
    await page.waitForTimeout(1_500)
    const after = await visibleCatalogItems()
    const addedItems = after.filter((item) => !before.has(item))
    const region = await categoryRegion(category)
    catalog.push({
      category,
      status: addedItems.length > 0
        ? 'COMPLETE'
        : 'NO_NEW_VISIBLE_ITEMS',
      items: addedItems,
      region,
      networkEvents: networkEvents.slice(networkStart),
    })
  }
} finally {
  await context.close()
}

const output = {
  status:
    reauthenticationRequired ? 'REAUTH_REQUIRED' : 'COMPLETE',
  profileName,
  inspectedAt: new Date().toISOString(),
  storesCookies: false,
  storesReportValues: false,
  storesCredentials: false,
  catalog,
}
const temporaryPath = `${outputPath}.${process.pid}.tmp`
await writeFile(
  temporaryPath,
  `${JSON.stringify(output, null, 2)}\n`,
  'utf8',
)
await rename(temporaryPath, outputPath)
process.stdout.write(`${JSON.stringify({
  status: output.status,
  categories: catalog.map((entry) => ({
    category: entry.category,
    status: entry.status,
    itemCount: entry.items.length,
  })),
  outputPath,
})}\n`)
