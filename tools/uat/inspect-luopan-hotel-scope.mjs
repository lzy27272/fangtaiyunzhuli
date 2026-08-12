import { createHash } from 'node:crypto'
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
const outputPath = path.join(runtimeRoot, 'hotel-scope.json')
const browserExecutable =
  process.env.UAT_BROWSER_EXECUTABLE
  ?? [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find(existsSync)
const homeUrl =
  'http://bj.chinapms.com:8880/pms-web/home/hg_index.do'
const reportCenterUrl =
  'http://bj.chinapms.com:8880/pms-web/report/index.do'
const reportCode = 'Inc00-1'
const scopeNamePattern = /(?:hotel|store|tenant|property)/i

if (!browserExecutable || !existsSync(browserExecutable)) {
  throw new Error('LUOPAN_SCOPE_BROWSER_NOT_FOUND')
}
if (!existsSync(profileRoot)) {
  throw new Error('LUOPAN_SCOPE_PROFILE_NOT_FOUND')
}

await mkdir(runtimeRoot, { recursive: true })

const fingerprint = (value) =>
  createHash('sha256').update(value).digest('hex').slice(0, 16)

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
const pages = []

const collectScopeFields = async (label) => {
  for (const currentPage of context.pages()) {
    for (const frame of currentPage.frames()) {
      if (!isLuopanUrl(frame.url())) continue
      const rawFields = await frame.evaluate((patternSource) => {
        const pattern = new RegExp(patternSource, 'i')
        return [
          ...document.querySelectorAll(
            'select[name], input[name], select[id], input[id]',
          ),
        ].filter((field) => {
          const name = field.getAttribute('name') ?? ''
          const id = field.getAttribute('id') ?? ''
          return pattern.test(name) || pattern.test(id)
        }).slice(0, 100).map((field) => {
          const name =
            field.getAttribute('name')
            || field.getAttribute('id')
            || 'unnamed'
          if (field.tagName === 'SELECT') {
            const options = [...field.options]
              .filter((option) =>
                String(option.value ?? '').trim()
                || String(option.textContent ?? '').trim())
              .map((option) => ({
                value: String(option.value ?? ''),
                label: String(option.textContent ?? '')
                  .replace(/\s+/g, ' ')
                  .trim(),
                selected: option.selected,
              }))
            return {
              name,
              type: 'select',
              options,
              disabled: field.disabled,
            }
          }
          return {
            name,
            type: field.getAttribute('type') ?? 'text',
            value: String(field.value ?? ''),
            disabled: field.disabled,
          }
        })
      }, scopeNamePattern.source)
      const fields = rawFields.map((field) => {
        if (field.type === 'select') {
          const selected = field.options
            .filter((option) => option.selected)
            .map((option) => `${option.value}\u0000${option.label}`)
            .sort()
          const optionSet = field.options
            .map((option) => `${option.value}\u0000${option.label}`)
            .sort()
          return {
            name: field.name.slice(0, 120),
            type: 'select',
            disabled: Boolean(field.disabled),
            optionCount: optionSet.length,
            hasMultipleOptions: optionSet.length > 1,
            selectedCount: selected.length,
            selectedFingerprint:
              selected.length > 0 ? fingerprint(selected.join('\n')) : null,
            optionSetFingerprint:
              optionSet.length > 0 ? fingerprint(optionSet.join('\n')) : null,
          }
        }
        const normalizedValue = String(field.value ?? '')
        return {
          name: field.name.slice(0, 120),
          type: field.type.slice(0, 40),
          disabled: Boolean(field.disabled),
          valuePresent: Boolean(normalizedValue),
          valueFingerprint:
            normalizedValue ? fingerprint(normalizedValue) : null,
        }
      })
      pages.push({
        label,
        endpoint: sanitizeNetworkUrl(frame.url()).endpoint,
        fields,
      })
    }
  }
}

let status = 'COMPLETE'
await page.goto(homeUrl, {
  waitUntil: 'domcontentloaded',
  timeout: 30_000,
})
await page.waitForTimeout(1_000)
if (isAuthenticationUrl(page.url())) {
  status = 'REAUTH_REQUIRED'
} else {
  await collectScopeFields('HOME')
  await page.goto(reportCenterUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  await page.waitForTimeout(1_000)
  const clickResult = await page.evaluate((targetCode) => {
    const normalized = (element) =>
      String(element.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim()
    const codeElement = [
      ...document.querySelectorAll('a, span, div, td, li'),
    ].find((element) => normalized(element) === targetCode)
    if (!codeElement) return 'REPORT_CODE_NOT_FOUND'
    let container = codeElement
    for (let depth = 0; container && depth < 7; depth += 1) {
      const action = [
        ...container.querySelectorAll('a, button, span'),
      ].find((element) => normalized(element) === '查看')
      if (action) {
        action.click()
        return 'VIEW_CLICKED'
      }
      container = container.parentElement
    }
    return 'VIEW_ACTION_NOT_FOUND'
  }, reportCode)
  if (clickResult === 'VIEW_CLICKED') {
    await page.waitForTimeout(4_000)
    await collectScopeFields('MANAGER_REPORT_CONDITION')
  } else {
    status = clickResult
  }
}

await context.close()

const deduplicated = new Map()
for (const entry of pages) {
  const key = JSON.stringify(entry)
  deduplicated.set(key, entry)
}
const output = {
  status,
  profileName,
  inspectedAt: new Date().toISOString(),
  storesCredentials: false,
  storesCookies: false,
  storesHotelNames: false,
  storesHotelCodes: false,
  pages: [...deduplicated.values()],
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
  scopeFieldCount:
    output.pages.reduce((total, entry) => total + entry.fields.length, 0),
  outputPath,
})}\n`)
