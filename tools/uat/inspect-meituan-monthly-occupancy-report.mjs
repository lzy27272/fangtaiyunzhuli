#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { decryptCookie } from './report-source-cookie-crypto.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.UAT_PLAYWRIGHT_MODULE ?? 'playwright',
)

const configPath = process.env.OTA_REVIEW_PROBE_CONFIG_PATH
const cookieSecretsPath = process.env.OTA_REVIEW_PROBE_COOKIE_SECRETS_PATH
const cookieSecretKey = process.env.OTA_REVIEW_PROBE_SECRET_KEY
const hotelId = process.env.OTA_REVIEW_PROBE_HOTEL_ID
const browserExecutable = process.env.UAT_BROWSER_EXECUTABLE
  ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

if (
  !configPath
  || !cookieSecretsPath
  || !cookieSecretKey
  || !hotelId
  || !existsSync(browserExecutable)
) throw new Error('MEITUAN_MONTHLY_OCCUPANCY_INSPECTION_CONFIG_INVALID')

const configs = JSON.parse(readFileSync(configPath, 'utf8'))[hotelId]
const secrets = JSON.parse(readFileSync(cookieSecretsPath, 'utf8'))[hotelId]
const source = configs?.find((item) =>
  item.enabled
  && new URL(item.endpointUrl).hostname === 'pms.meituan.com'
  && secrets?.[item.sourceId])
if (!source) throw new Error('MEITUAN_MONTHLY_OCCUPANCY_SOURCE_MISSING')

const rawCookie = decryptCookie(
  secrets[source.sourceId],
  cookieSecretKey,
  `${hotelId}:${source.sourceId}`,
)
const cookies = rawCookie.split(';').map((part) => part.trim()).filter(Boolean)
  .map((part) => {
    const separator = part.indexOf('=')
    return separator <= 0 ? null : {
      name: part.slice(0, separator),
      value: part.slice(separator + 1),
      domain: 'pms.meituan.com',
      path: '/',
      secure: true,
      sameSite: 'Lax',
    }
  }).filter(Boolean)

const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable,
  args: ['--no-first-run', '--no-default-browser-check'],
})
const context = await browser.newContext({
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  viewport: { width: 1440, height: 1000 },
})

const safeEndpoint = (value) => {
  try {
    const url = new URL(value)
    return url.hostname === 'pms.meituan.com'
      ? `${url.origin}${url.pathname}`
      : null
  } catch {
    return null
  }
}

const events = []
const reportResponseShapes = []
const aggregateMetricEvidence = []
const reportFieldLabels = []
const directOccupancyEvidence = []
const loginContextContracts = []
try {
  await context.addCookies(cookies)
  let page = context.pages()[0] ?? await context.newPage()
  let openedReports = false
  let openedBusinessReports = false
  let reportMenuStructure = null
  let currentReportName = null
  const observeResponse = async (response) => {
    const request = response.request()
    const endpoint = safeEndpoint(response.url())
    if (!endpoint || !['xhr', 'fetch', 'document'].includes(request.resourceType())) return
    events.push({
      endpoint,
      method: request.method(),
      status: response.status(),
      resourceType: request.resourceType(),
    })
    if (/\/hotel(pms)?\/api\/v1\/loginPms$/i.test(endpoint)
      || /\/hotelpms\/api\/v1\/loginPms$/i.test(endpoint)) {
      const url = new URL(request.url())
      const safeQuery = Object.fromEntries([...url.searchParams.entries()]
        .filter(([key]) => /(?:org|hotel|tenant|type|shift)/i.test(key)))
      const headers = request.headers()
      const safeHeaders = Object.fromEntries(Object.entries(headers)
        .filter(([key]) => /^(?:hotelpms-login-(?:org|hotel)-(?:id|type)|hotelpms-tenant-id|hotelpms-platform)$/i.test(key)))
      loginContextContracts.push({
        endpoint,
        method: request.method(),
        query: safeQuery,
        headers: safeHeaders,
      })
    }
    if (
      openedBusinessReports
      && ['xhr', 'fetch'].includes(request.resourceType())
      && /\/report\//i.test(endpoint)
      && /json/i.test(response.headers()['content-type'] ?? '')
    ) {
      try {
        const root = await response.json()
        const paths = []
        const visit = (value, path, depth) => {
          if (depth > 6 || paths.length >= 300 || value === null) return
          if (Array.isArray(value)) {
            paths.push(`${path}[]`)
            if (value.length) visit(value[0], `${path}[]`, depth + 1)
            return
          }
          if (typeof value !== 'object') return
          for (const [key, child] of Object.entries(value)) {
            const childPath = path ? `${path}.${key}` : key
            paths.push(childPath)
            visit(child, childPath, depth + 1)
          }
        }
        visit(root, '', 0)
        reportResponseShapes.push({ endpoint, paths })
        if (/\/report\/jy05$/i.test(endpoint)) {
          const rows = root?.data?.data?.monthSummaryDetailList
          if (Array.isArray(rows)) {
            aggregateMetricEvidence.push({
              endpoint,
              rows: rows.filter((row) =>
                /2026(?:-|\/|年)?0?7/.test(String(row?.businessDateMonth ?? '')))
                .map((row) => ({
                  businessDateMonth: row.businessDateMonth,
                  roomCount: row.roomCount,
                  roomPoint: row.roomPoint,
                  freeRoomCount: row.freeRoomCount,
                  freeRoomPoint: row.freeRoomPoint,
                  internalRoomCount: row.internalRoomCount,
                  internalRoomPoint: row.internalRoomPoint,
                  maintainRoomCount: row.maintainRoomCount,
                  nightRoomCount: row.nightRoomCount,
                  nightRoomPoint: row.nightRoomPoint,
                  roomRent: row.roomRent,
                })),
            })
          }
        }
        if (/\/report\/jy07$/i.test(endpoint)) {
          const rows = root?.data?.roomStatistics
          if (Array.isArray(rows)) {
            aggregateMetricEvidence.push({
              endpoint,
              rows: rows.map((row) => ({
                groupName: row.groupName,
                category: row.category,
                statistics: row.statistics,
                secondStatistics: row.secondStatistics,
                currentPeriod: row.currentPeriod,
              })).filter((row) =>
                /(?:出租|客房|房晚|间夜|入住|维修|自用|钟点|过夜)/
                  .test([row.groupName, row.category, row.statistics, row.secondStatistics]
                    .filter(Boolean).join(' '))),
            })
          }
        }
        if (/\/report\/jy07$/i.test(endpoint)) {
          const matches = []
          const findOccupancy = (value, depth = 0) => {
            if (depth > 8 || matches.length >= 12 || value === null) return
            if (Array.isArray(value)) {
              for (const item of value) findOccupancy(item, depth + 1)
              return
            }
            if (typeof value !== 'object') return
            if (Object.values(value).some((item) =>
              typeof item === 'string' && /出租率/.test(item))) {
              matches.push(Object.fromEntries([
                'name', 'label', 'title', 'category', 'statistics',
                'secondStatistics', 'field', 'fieldName', 'column',
                'code', 'currentPeriod',
              ].filter((key) => Object.hasOwn(value, key))
                .map((key) => [key, value[key]])))
            }
            for (const child of Object.values(value)) {
              findOccupancy(child, depth + 1)
            }
          }
          findOccupancy(root)
          let requestContract = null
          try {
            const payload = request.postDataJSON()
            if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
              requestContract = Object.fromEntries(Object.entries(payload)
                .filter(([key, value]) =>
                  !/(?:token|cookie|name|guest|mobile|phone|remark|order)/i.test(key)
                  && (value === null
                    || typeof value === 'string'
                    || typeof value === 'number'
                    || typeof value === 'boolean'
                    || (Array.isArray(value)
                      && value.length <= 20
                      && value.every((item) =>
                        typeof item === 'string' || typeof item === 'number')))))
            }
          } catch {
            // Request contract capture is best effort.
          }
          directOccupancyEvidence.push({
            reportName: currentReportName,
            endpoint,
            requestContract,
            requestHeaderNames: Object.keys(request.headers())
              .filter((key) => !/(?:cookie|token|authorization)/i.test(key))
              .sort(),
            requestContextHeaders: Object.fromEntries(Object.entries(request.headers())
              .filter(([key]) => /^(?:hotelpms-(?:client-id|platform|login-(?:hotel|org)-(?:id|type)|tenant-id)|m-appkey|content-type)$/i.test(key))),
            matches,
          })
        }
        if (/\/report\/column\/queryColumn$/i.test(endpoint)) {
          const labels = []
          const collectLabels = (value, depth = 0) => {
            if (depth > 8 || labels.length >= 400 || value === null) return
            if (Array.isArray(value)) {
              for (const item of value) collectLabels(item, depth + 1)
              return
            }
            if (typeof value !== 'object') return
            for (const [key, child] of Object.entries(value)) {
              if (
                typeof child === 'string'
                && /(?:name|label|title|field|column|code|statistics)/i.test(key)
                && /(?:出租|客房|房晚|间夜|入住|维修|自用|钟点|过夜)/.test(child)
              ) labels.push({ key, value: child.slice(0, 160) })
              else collectLabels(child, depth + 1)
            }
          }
          collectLabels(root)
          reportFieldLabels.push({ endpoint, labels })
        }
      } catch {
        // Shape-only inspection is best effort.
      }
    }
  }
  context.on('response', (response) => {
    void observeResponse(response)
  })
  await page.goto('https://pms.meituan.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  await page.waitForTimeout(2_000)

  let selectedHotel = false
  if (/\/account\/selectorg/.test(page.url())) {
    const selector = page.getByText(/选\s*择/, { exact: true })
    if (await selector.count()) {
      await selector.last().click()
      selectedHotel = true
    }
    if (selectedHotel) {
      await page.waitForTimeout(5_000)
    }
  }

  if (!/\/account\/selectorg/.test(page.url())) {
    const reports = page.getByText('报表', { exact: true })
    if (await reports.count()) {
      await reports.first().hover()
      await reports.first().click()
      await page.waitForTimeout(3_000)
      const pages = context.pages()
      page = pages[pages.length - 1]
      await page.waitForLoadState('domcontentloaded').catch(() => {})
      await page.waitForTimeout(1_000)
      openedReports = true
      reportMenuStructure = await reports.first().evaluate((element) => {
        const describe = (node) => {
          if (!(node instanceof Element)) return null
          const attributes = {}
          for (const name of [
            'id', 'class', 'href', 'data-url', 'data-href',
            'data-key', 'data-code', 'data-menu-code', 'role',
          ]) {
            const value = node.getAttribute(name)
            if (value) attributes[name] = value.slice(0, 240)
          }
          return {
            tag: node.tagName.toLowerCase(),
            text: String(node.textContent ?? '')
              .replace(/\s+/g, ' ').trim().slice(0, 500),
            attributes,
          }
        }
        const ancestors = []
        let current = element
        for (let index = 0; current && index < 4; index += 1) {
          ancestors.push(describe(current))
          current = current.parentElement
        }
        const descendants = [...(element.parentElement ?? element)
          .querySelectorAll('a, button, li, [role="menuitem"]')]
          .map(describe).filter(Boolean).slice(0, 80)
        return { ancestors, descendants }
      })
    }
  }

  if (openedReports) {
    const businessReports = page.getByText('经营报表', { exact: true })
    if (await businessReports.count()) {
      await businessReports.first().click()
      await page.waitForTimeout(2_000)
      openedBusinessReports = true
    }
  }

  const inspectedReports = []
  if (openedBusinessReports) {
    for (const reportName of [
      'JY07经理报表(月报)(固化)',
    ]) {
      const target = page.getByText(reportName, { exact: true })
      if (!await target.count()) {
        inspectedReports.push({ reportName, status: 'NOT_FOUND' })
        continue
      }
      const eventStart = events.length
      const shapeStart = reportResponseShapes.length
      currentReportName = reportName
      await target.first().click()
      await page.waitForTimeout(2_000)
      const reportPages = context.pages()
      page = reportPages[reportPages.length - 1]
      await page.waitForLoadState('domcontentloaded').catch(() => {})
      await page.waitForTimeout(1_000)
      if (reportName.startsWith('JY07')) {
        const startMonth = page.getByPlaceholder('开始月份')
        const endMonth = page.getByPlaceholder('结束月份')
        if (await startMonth.count() && await endMonth.count()) {
          await startMonth.fill('2026-07')
          await startMonth.press('Enter')
          await endMonth.fill('2026-07')
          await endMonth.press('Enter')
          const query = page.getByText('查询', { exact: true })
          if (await query.count()) {
            await query.last().click()
            await page.waitForTimeout(2_000)
          }
        }
      }
      const uiSchema = await page.evaluate(() => ({
        title: document.title.slice(0, 160),
        headings: [...document.querySelectorAll('h1, h2, h3, h4')]
          .map((item) => String(item.textContent ?? '').replace(/\s+/g, ' ').trim())
          .filter(Boolean).slice(0, 80),
        tableHeaders: [...document.querySelectorAll('th')]
          .map((item) => String(item.textContent ?? '').replace(/\s+/g, ' ').trim())
          .filter(Boolean).slice(0, 160),
        formFields: [...document.querySelectorAll('input, select, textarea')]
          .map((item) => ({
            name: item.getAttribute('name'),
            placeholder: item.getAttribute('placeholder'),
            type: item.getAttribute('type') ?? item.tagName.toLowerCase(),
          })).slice(0, 100),
      }))
      inspectedReports.push({
        reportName,
        status: 'OPENED',
        endpoint: safeEndpoint(page.url()),
        uiSchema,
        events: events.slice(eventStart),
        responseShapes: reportResponseShapes.slice(shapeStart),
      })
      if (!/\/home\/report\/?$/.test(new URL(page.url()).pathname)) {
        await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {})
        await page.waitForTimeout(1_000)
        const businessReports = page.getByText('经营报表', { exact: true })
        if (await businessReports.count()) {
          await businessReports.first().click()
          await page.waitForTimeout(1_000)
        }
      }
    }
  }

  const candidates = await page.evaluate(() => {
    const keyword = /(?:报表|出租率|经营|营业|收益|分析|月报|间夜|房晚|房价|RevPAR|ADR)/i
    const visible = (element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0
    }
    return [...document.querySelectorAll(
      'a, button, li, span, p, div, [role="menuitem"], [onclick]',
    )]
      .filter(visible)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        text: String(element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
        href: element instanceof HTMLAnchorElement ? element.getAttribute('href') : null,
      }))
      .filter((item) =>
        item.text
        && item.text.length <= 120
        && keyword.test(item.text))
      .slice(0, 120)
  })

  process.stdout.write(`${JSON.stringify({
    mode: 'READ_ONLY_BROWSER_REPORT_DISCOVERY',
    finalEndpoint: safeEndpoint(page.url()),
    title: await page.title(),
    selectedHotel,
    openedReports,
    openedBusinessReports,
    reportMenuStructure,
    inspectedReports,
    aggregateMetricEvidence,
    reportFieldLabels,
    directOccupancyEvidence,
    loginContextContracts,
    candidates,
    events: [...new Map(events.map((item) => [
      `${item.method}:${item.endpoint}:${item.status}`,
      item,
    ])).values()].slice(0, 160),
    storesCookies: false,
    storesResponseBodies: false,
  }, null, 2)}\n`)
} finally {
  await context.close()
  await browser.close()
}
