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
const outputPath = path.join(runtimeRoot, 'forecast-sample.json')
const browserExecutable =
  process.env.UAT_BROWSER_EXECUTABLE
  ?? [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find(existsSync)
const forecastUrl =
  'http://bj.chinapms.com:8880/pms-web/post/room_forecast.do'

if (!browserExecutable || !existsSync(browserExecutable)) {
  throw new Error('LUOPAN_FORECAST_BROWSER_NOT_FOUND')
}
if (!existsSync(profileRoot)) {
  throw new Error('LUOPAN_FORECAST_PROFILE_NOT_FOUND')
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
await page.goto(forecastUrl, {
  waitUntil: 'domcontentloaded',
  timeout: 30_000,
})
await page.waitForTimeout(2_000)

let status = 'COMPLETE'
let frames = []
if (isAuthenticationUrl(page.url())) {
  status = 'REAUTH_REQUIRED'
} else {
  for (const frame of page.frames()) {
    if (!isLuopanUrl(frame.url())) continue
    const sample = await frame.evaluate(() => {
      const clean = (value) =>
        String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
      const tables = [...document.querySelectorAll('table')]
        .slice(0, 30)
        .map((table) => ({
          headers: [...table.querySelectorAll('thead th, tr:first-child th')]
            .map((cell) => clean(cell.textContent))
            .filter(Boolean)
            .slice(0, 100),
          rows: [...table.querySelectorAll('tbody tr, tr')]
            .slice(0, 200)
            .map((row) => [...row.querySelectorAll('th, td')]
              .map((cell) => clean(cell.textContent))
              .slice(0, 100))
            .filter((row) => row.some(Boolean)),
        }))
        .filter((table) => table.headers.length || table.rows.length)
      const forms = [...document.forms].slice(0, 20).map((form) => ({
        action: form.getAttribute('action') ?? '',
        method: (form.getAttribute('method') ?? 'GET').toUpperCase(),
        fields: [
          ...form.querySelectorAll('input[name], select[name]'),
        ].slice(0, 100).map((field) => ({
          name: field.getAttribute('name') ?? '',
          type:
            field.tagName === 'SELECT'
              ? 'select'
              : field.getAttribute('type') ?? 'text',
          optionCount:
            field.tagName === 'SELECT'
              ? [...field.options].filter((option) =>
                  String(option.value ?? '').trim()
                  || clean(option.textContent)).length
              : null,
        })),
      }))
      return {
        title: document.title.slice(0, 160),
        tables,
        forms,
      }
    })
    frames.push({
      endpoint: sanitizeNetworkUrl(frame.url()).endpoint,
      ...sample,
    })
  }
}

await context.close()

const output = {
  status,
  profileName,
  inspectedAt: new Date().toISOString(),
  containsOnlyForecastAggregatePage: true,
  storesCredentials: false,
  storesCookies: false,
  frames,
}
const temporaryPath = `${outputPath}.${process.pid}.tmp`
await writeFile(
  temporaryPath,
  `${JSON.stringify(output, null, 2)}\n`,
  'utf8',
)
await rename(temporaryPath, outputPath)
process.stdout.write(`${JSON.stringify({
  status,
  profileName,
  tableCount:
    frames.reduce((sum, frame) => sum + frame.tables.length, 0),
  rowCount:
    frames.reduce(
      (sum, frame) =>
        sum + frame.tables.reduce(
          (tableSum, table) => tableSum + table.rows.length,
          0,
        ),
      0,
    ),
  outputPath,
})}\n`)
