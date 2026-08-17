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
const outputPath = path.join(runtimeRoot, 'manager-report-probe.json')
const browserExecutable =
  process.env.UAT_BROWSER_EXECUTABLE
  ?? [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find(existsSync)
const reportCenterUrl =
  'http://bj.chinapms.com:8880/pms-web/report/index.do'
const reportCodeArgument = process.argv.find((value) =>
  value.startsWith('--report-code='))
const reportCode = (
  reportCodeArgument?.slice('--report-code='.length)
  || 'Inc00-1'
).trim()
if (!/^[a-z0-9][a-z0-9-]{0,39}$/iu.test(reportCode)) {
  throw new Error('LUOPAN_REPORT_CODE_INVALID')
}
const submitReport = process.argv.includes('--submit')
const allowMultipleHotels = process.argv.includes('--allow-multi-hotel')
const reportDateArgument = process.argv.find((value) =>
  value.startsWith('--report-date='))
const reportDate = reportDateArgument
  ? reportDateArgument.slice('--report-date='.length).trim()
  : null
if (reportDate && !/^\d{4}-\d{2}-\d{2}$/u.test(reportDate)) {
  throw new Error('LUOPAN_REPORT_DATE_INVALID')
}
const periodStartArgument = process.argv.find((value) =>
  value.startsWith('--period-start='))
const periodEndArgument = process.argv.find((value) =>
  value.startsWith('--period-end='))
const periodStart = periodStartArgument
  ? periodStartArgument.slice('--period-start='.length).trim()
  : null
const periodEnd = periodEndArgument
  ? periodEndArgument.slice('--period-end='.length).trim()
  : null
if (
  Boolean(periodStart) !== Boolean(periodEnd)
  || (periodStart && !/^\d{4}-\d{2}-\d{2}$/u.test(periodStart))
  || (periodEnd && !/^\d{4}-\d{2}-\d{2}$/u.test(periodEnd))
  || (periodStart && periodEnd && periodStart > periodEnd)
) {
  throw new Error('LUOPAN_REPORT_PERIOD_INVALID')
}
const expectedHotelFingerprintArgument = process.argv.find((value) =>
  value.startsWith('--expected-hotel-fingerprint='))
const expectedHotelFingerprint = expectedHotelFingerprintArgument
  ? expectedHotelFingerprintArgument
      .slice('--expected-hotel-fingerprint='.length)
      .trim()
      .toLowerCase()
  : null
if (
  expectedHotelFingerprint
  && !/^[a-f0-9]{16}$/u.test(expectedHotelFingerprint)
) {
  throw new Error('LUOPAN_EXPECTED_HOTEL_FINGERPRINT_INVALID')
}
const captureAggregatePdf = process.argv.includes('--capture-aggregate-pdf')
const aggregatePdfOutputPath = captureAggregatePdf
  ? path.join(
      repoRoot,
      'tmp',
      'pdfs',
      `luopan-${profileName}-${reportCode}-${
        periodStart && periodEnd
          ? `${periodStart}_${periodEnd}`
          : reportDate ?? 'default'
      }.pdf`,
    )
  : null

if (!browserExecutable || !existsSync(browserExecutable)) {
  throw new Error('LUOPAN_MANAGER_REPORT_BROWSER_NOT_FOUND')
}
if (!existsSync(profileRoot)) {
  throw new Error('LUOPAN_MANAGER_REPORT_PROFILE_NOT_FOUND')
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

const networkEvents = []
const pdfCapturePromises = []
let aggregatePdfCaptured = false
const attachPage = (page) => {
  page.on('response', (response) => {
    if (!isLuopanUrl(response.url())) return
    const request = response.request()
    if (!['document', 'xhr', 'fetch'].includes(request.resourceType())) {
      return
    }
    const sanitized = sanitizeNetworkUrl(response.url())
    const authenticationFlow = isAuthenticationUrl(response.url())
    const contentType =
      response.headers()['content-type']?.toLowerCase() ?? ''
    networkEvents.push({
      observedAt: new Date().toISOString(),
      endpoint: sanitized.endpoint,
      queryKeys: sanitized.queryKeys,
      method: request.method(),
      resourceType: request.resourceType(),
      status: response.status(),
      contentType,
      authenticationFlow,
      requestPayload: authenticationFlow
        ? '[REDACTED_AUTH_FLOW]'
        : summarizeRequestPayload({
            postData: request.postData(),
            contentType:
              request.headers()['content-type']?.toLowerCase() ?? '',
          }),
      responseBodyStored: false,
    })
    if (
      captureAggregatePdf
      && !aggregatePdfCaptured
      && response.status() === 200
      && /application\/pdf/iu.test(contentType)
      && sanitized.endpoint === 'http://report.chinapms.com:8081/report/run'
    ) {
      aggregatePdfCaptured = true
      pdfCapturePromises.push(
        (async () => {
          let body = await response.body()
          if (!body.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
            const rawResponse = await context.request.get(response.url(), {
              failOnStatusCode: true,
            })
            body = await rawResponse.body()
          }
          if (
            !Buffer.isBuffer(body)
            || body.length < 100
            || !body.subarray(0, 5).equals(Buffer.from('%PDF-'))
          ) {
            throw new Error('LUOPAN_AGGREGATE_PDF_INVALID')
          }
          await mkdir(path.dirname(aggregatePdfOutputPath), {
            recursive: true,
          })
          await writeFile(aggregatePdfOutputPath, body)
        })(),
      )
    }
  })
}
context.on('page', attachPage)
for (const existingPage of context.pages()) attachPage(existingPage)

const page = context.pages()[0] ?? await context.newPage()
await page.goto(reportCenterUrl, {
  waitUntil: 'domcontentloaded',
  timeout: 30_000,
})
await page.waitForTimeout(1_000)

let status = 'COMPLETE'
let clickResult = 'NOT_ATTEMPTED'
let submitResult = 'NOT_REQUESTED'
let hotelScope = {
  requiredSingleHotel: !allowMultipleHotels,
  status: 'NOT_CHECKED',
  optionCount: null,
  selectedCount: null,
  selectedFingerprint: null,
  expectedFingerprintMatches: null,
}
if (isAuthenticationUrl(page.url())) {
  status = 'REAUTH_REQUIRED'
} else {
  clickResult = await page.evaluate((targetCode) => {
    const normalized = (element) =>
      String(element.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim()
    const candidates = [
      ...document.querySelectorAll('a, span, div, td, li'),
    ]
    const codeElement = candidates.find(
      (element) => normalized(element) === targetCode,
    )
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
  if (clickResult !== 'VIEW_CLICKED') {
    status = clickResult
  } else {
    await page.waitForTimeout(5_000)
    const rawHotelScope = await page.evaluate(() => {
      const form = [...document.forms].find((candidate) =>
        /\/report\/show_report\.do/i.test(
          candidate.getAttribute('action') ?? '',
        ))
      const select = form?.querySelector('select[name="hotel_id"]')
      if (!select) return null
      const selectableOptions = [...select.options]
        .filter((option) =>
          String(option.value ?? '').trim()
          || String(option.textContent ?? '').trim())
      if (
        selectableOptions.length === 1
        && !selectableOptions[0].selected
      ) {
        selectableOptions[0].selected = true
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }
      const options = [...select.options]
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
      return { options }
    })
    if (!rawHotelScope) {
      hotelScope = {
        ...hotelScope,
        status: 'UNVERIFIED',
      }
      if (!allowMultipleHotels) {
        status = 'LUOPAN_HOTEL_SCOPE_UNVERIFIED'
        submitResult = 'BLOCKED_HOTEL_SCOPE_UNVERIFIED'
      }
    } else {
      const selected = rawHotelScope.options
        .filter((option) => option.selected)
        .map((option) => `${option.value}\u0000${option.label}`)
        .sort()
      hotelScope = {
        ...hotelScope,
        status:
          rawHotelScope.options.length === 1 && selected.length === 1
            ? 'SINGLE_HOTEL_CONFIRMED'
            : 'AMBIGUOUS',
        optionCount: rawHotelScope.options.length,
        selectedCount: selected.length,
        selectedFingerprint:
          selected.length === 0
            ? null
            : createHash('sha256')
                .update(selected.join('\n'))
                .digest('hex')
                .slice(0, 16),
        expectedFingerprintMatches: null,
      }
      hotelScope.expectedFingerprintMatches = expectedHotelFingerprint
        ? hotelScope.selectedFingerprint === expectedHotelFingerprint
        : null
      if (
        !allowMultipleHotels
        && hotelScope.status !== 'SINGLE_HOTEL_CONFIRMED'
      ) {
        status = 'LUOPAN_HOTEL_SCOPE_AMBIGUOUS'
        submitResult = 'BLOCKED_HOTEL_SCOPE_AMBIGUOUS'
      } else if (hotelScope.expectedFingerprintMatches === false) {
        status = 'LUOPAN_HOTEL_SCOPE_MISMATCH'
        submitResult = 'BLOCKED_HOTEL_SCOPE_MISMATCH'
      }
    }
    if (submitReport && status === 'COMPLETE') {
      submitResult = await page.evaluate((targetPeriod) => {
        const normalized = (element) =>
          String(element.textContent ?? '')
            .replace(/\s+/g, ' ')
            .trim()
        const form = [...document.forms].find((candidate) =>
          /\/report\/show_report\.do/i.test(
            candidate.getAttribute('action') ?? '',
          ))
        if (!form) return 'REPORT_FORM_NOT_FOUND'
        if (targetPeriod.reportDate) {
          const dateField = form.querySelector('[name="today_date"]')
          if (!dateField) return 'REPORT_DATE_FIELD_NOT_FOUND'
          dateField.value = targetPeriod.reportDate
          dateField.dispatchEvent(new Event('input', { bubbles: true }))
          dateField.dispatchEvent(new Event('change', { bubbles: true }))
        }
        if (targetPeriod.periodStart && targetPeriod.periodEnd) {
          const startField = form.querySelector('[name="start_date"]')
          const endField = form.querySelector('[name="end_date"]')
          if (!startField || !endField) {
            return 'REPORT_PERIOD_FIELDS_NOT_FOUND'
          }
          startField.value = targetPeriod.periodStart
          endField.value = targetPeriod.periodEnd
          for (const field of [startField, endField]) {
            field.dispatchEvent(new Event('input', { bubbles: true }))
            field.dispatchEvent(new Event('change', { bubbles: true }))
          }
        }
        const submit = [
          ...form.querySelectorAll(
            'button, input[type="submit"], input[type="button"]',
          ),
        ].find((element) => normalized(element) === '提交')
        if (!submit) return 'SUBMIT_ACTION_NOT_FOUND'
        submit.click()
        return 'SUBMIT_CLICKED'
      }, { reportDate, periodStart, periodEnd })
      if (submitResult !== 'SUBMIT_CLICKED') {
        status = submitResult
      } else {
        await page.waitForTimeout(8_000)
      }
    }
  }
}

const documentSchemas = []
for (const currentPage of context.pages()) {
  for (const frame of currentPage.frames()) {
    if (!isLuopanUrl(frame.url())) continue
    const schema = await frame.evaluate(() => {
      const text = (element) =>
        String(element?.textContent ?? '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120)
      return {
        title: document.title.slice(0, 160),
        headings: [
          ...document.querySelectorAll('h1, h2, h3, legend, .title'),
        ].map(text).filter(Boolean).slice(0, 100),
        tableHeaders: [
          ...document.querySelectorAll('table th'),
        ].map(text).filter(Boolean).slice(0, 300),
        forms: [...document.forms].slice(0, 30).map((form) => ({
          action: form.getAttribute('action') ?? '',
          method: (form.getAttribute('method') ?? 'GET').toUpperCase(),
          fields: [
            ...form.querySelectorAll(
              'input[name], select[name], textarea[name]',
            ),
          ].slice(0, 200).map((field) => ({
            name: field.getAttribute('name') ?? '',
            type:
              field.tagName === 'INPUT'
                ? field.getAttribute('type') ?? 'text'
                : field.tagName.toLowerCase(),
          })),
          buttons: [
            ...form.querySelectorAll(
              'button, input[type="submit"], input[type="button"]',
            ),
          ].map(text).filter(Boolean).slice(0, 30),
        })),
      }
    })
    documentSchemas.push({
      endpoint: sanitizeNetworkUrl(frame.url()).endpoint,
      title: schema.title,
      headings: [...new Set(schema.headings)],
      tableHeaders: [...new Set(schema.tableHeaders)],
      forms: schema.forms.map((form) => {
        let endpoint = sanitizeNetworkUrl(frame.url()).endpoint
        try {
          const resolved = new URL(form.action, frame.url()).toString()
          if (isLuopanUrl(resolved)) {
            endpoint = sanitizeNetworkUrl(resolved).endpoint
          }
        } catch {
          // Keep the current frame endpoint.
        }
        return {
          endpoint,
          method: form.method,
          fields: form.fields,
          buttons: form.buttons,
        }
      }),
    })
  }
}

await Promise.all(pdfCapturePromises)
await context.close()

const output = {
  status,
  profileName,
  reportCode,
  clickResult,
  submitRequested: submitReport,
  submitResult,
  hotelScope,
  inspectedAt: new Date().toISOString(),
  storesCookies: false,
  storesCredentials: false,
  storesReportCells: false,
  storesAggregatePdf: Boolean(
    captureAggregatePdf && aggregatePdfCaptured),
  aggregatePdfOutputPath:
    captureAggregatePdf && aggregatePdfCaptured
      ? aggregatePdfOutputPath
      : null,
  networkEvents,
  documentSchemas,
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
  reportCode,
  clickResult,
  submitRequested: submitReport,
  submitResult,
  hotelScopeStatus: hotelScope.status,
  hotelOptionCount: hotelScope.optionCount,
  networkEventCount: networkEvents.length,
  documentSchemaCount: documentSchemas.length,
  aggregatePdfCaptured:
    captureAggregatePdf && aggregatePdfCaptured,
  aggregatePdfOutputPath:
    captureAggregatePdf && aggregatePdfCaptured
      ? aggregatePdfOutputPath
      : null,
  outputPath,
})}\n`)
