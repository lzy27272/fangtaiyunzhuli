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
const outputPath = path.join(runtimeRoot, 'navigation-schema.json')
const browserExecutable =
  process.env.UAT_BROWSER_EXECUTABLE
  ?? [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find(existsSync)
const baseUrl = 'http://bj.chinapms.com:8880'
const targets = [
  '/pms-web/home/hg_index.do',
  '/pms-web/post/room_forecast.do',
  '/pms-web/room/room_availability.do',
  '/pms-web/room_order/room_order_search.do',
  '/pms-web/report/index.do',
]
const reportKeyword =
  /(?:报表|营业|收入|房费|房价|房态|库存|可售|预订|订单|取消|预测|远期|夜审|出租率|平均房价|revpar|adr)/i

if (!browserExecutable || !existsSync(browserExecutable)) {
  throw new Error('LUOPAN_INSPECTION_BROWSER_NOT_FOUND')
}
if (!existsSync(profileRoot)) {
  throw new Error('LUOPAN_INSPECTION_PROFILE_NOT_FOUND')
}

await mkdir(runtimeRoot, { recursive: true })

const safeEndpoint = (rawUrl) =>
  isLuopanUrl(rawUrl)
    ? sanitizeNetworkUrl(rawUrl).endpoint
    : null

const inspectFrame = async (frame) => {
  const raw = await frame.evaluate((keywordSource) => {
    const keyword = new RegExp(keywordSource, 'i')
    const text = (element) =>
      String(element?.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)
    const links = [...document.querySelectorAll('a[href]')]
      .map((anchor) => ({
        text: text(anchor),
        href: anchor.getAttribute('href') ?? '',
      }))
      .filter((link) =>
        keyword.test(link.text) || keyword.test(link.href))
      .slice(0, 200)
    const forms = [...document.forms].slice(0, 30).map((form) => ({
      action: form.getAttribute('action') ?? '',
      method: (form.getAttribute('method') ?? 'GET').toUpperCase(),
      fields: [
        ...form.querySelectorAll('input[name], select[name], textarea[name]'),
      ].slice(0, 200).map((field) => ({
        name: field.getAttribute('name') ?? '',
        type:
          field.tagName === 'INPUT'
            ? field.getAttribute('type') ?? 'text'
            : field.tagName.toLowerCase(),
      })),
      buttons: [
        ...form.querySelectorAll('button, input[type="submit"]'),
      ].map(text).filter(Boolean).slice(0, 30),
    }))
    const actionElements = [
      ...document.querySelectorAll(
        'button, [onclick], [data-url], [data-href], '
          + '[data-report-id], [data-report-code], li',
      ),
    ].map((element) => {
      const elementText = text(element)
      if (!keyword.test(elementText)) return null
      const attributes = {}
      for (const name of [
        'id',
        'data-id',
        'data-report-id',
        'data-report-code',
        'data-url',
        'data-href',
        'href',
        'onclick',
      ]) {
        const value = element.getAttribute(name)
        if (!value) continue
        if (name === 'onclick') {
          attributes[name] = [
            ...value.matchAll(
              /['"]([^'"]+\.(?:do|json)(?:\?[^'"]*)?)['"]/gi,
            ),
          ].map((match) => match[1]).slice(0, 10)
        } else {
          attributes[name] = value.slice(0, 200)
        }
      }
      return {
        tag: element.tagName.toLowerCase(),
        text: elementText,
        attributes,
      }
    }).filter(Boolean).slice(0, 300)
    return {
      title: document.title.slice(0, 160),
      headings: [
        ...document.querySelectorAll('h1, h2, h3, legend, .title'),
      ].map(text).filter(Boolean).slice(0, 100),
      tableHeaders: [
        ...document.querySelectorAll('table th'),
      ].map(text).filter(Boolean).slice(0, 200),
      links,
      forms,
      actionElements,
    }
  }, reportKeyword.source)

  const frameUrl = frame.url()
  const resolveHref = (href) => {
    if (!href || /^javascript:/i.test(href)) return null
    try {
      const resolved = new URL(href, frameUrl).toString()
      return safeEndpoint(resolved)
    } catch {
      return null
    }
  }
  return {
    endpoint: safeEndpoint(frameUrl),
    title: raw.title,
    headings: [...new Set(raw.headings)],
    tableHeaders: [...new Set(raw.tableHeaders)],
    links: raw.links
      .map((link) => ({
        text: link.text,
        endpoint: resolveHref(link.href),
      }))
      .filter((link) => link.text || link.endpoint),
    forms: raw.forms.map((form) => ({
      endpoint: resolveHref(form.action) ?? safeEndpoint(frameUrl),
      method: form.method,
      fields: form.fields.map((field) => ({
        name: String(field.name).slice(0, 120),
        type: String(field.type).slice(0, 40),
      })),
      buttons: form.buttons,
    })),
    actionElements: raw.actionElements.map((element) => {
      const attributes = {}
      for (const [name, value] of Object.entries(element.attributes)) {
        if (Array.isArray(value)) {
          attributes[name] = value
            .map(resolveHref)
            .filter(Boolean)
        } else if (/(?:url|href)$/i.test(name)) {
          attributes[name] = resolveHref(value)
        } else if (/^[\w.-]{1,120}$/.test(value)) {
          attributes[name] = value
        }
      }
      return {
        tag: element.tag,
        text: element.text,
        attributes,
      }
    }),
  }
}

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
const inspected = []
let reauthenticationRequired = false

try {
  for (const target of targets) {
    const requestedEndpoint = `${baseUrl}${target}`
    await page.goto(requestedEndpoint, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    await page.waitForTimeout(1_000)
    const finalUrl = page.url()
    if (isAuthenticationUrl(finalUrl)) {
      reauthenticationRequired = true
      inspected.push({
        requestedEndpoint,
        finalEndpoint: safeEndpoint(finalUrl),
        reauthenticationRequired: true,
        frames: [],
      })
      break
    }
    const frames = []
    for (const frame of page.frames()) {
      if (!isLuopanUrl(frame.url())) continue
      frames.push(await inspectFrame(frame))
    }
    inspected.push({
      requestedEndpoint,
      finalEndpoint: safeEndpoint(finalUrl),
      reauthenticationRequired: false,
      frames,
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
  storesTableCells: false,
  storesCredentials: false,
  targets: inspected,
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
  targetCount: inspected.length,
  frameCount: inspected.reduce(
    (total, target) => total + target.frames.length,
    0,
  ),
  outputPath,
})}\n`)
