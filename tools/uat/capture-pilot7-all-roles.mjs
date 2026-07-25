import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.UAT_PLAYWRIGHT_MODULE ?? 'playwright')
const toolRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(toolRoot, '..', '..')
const webBase = (process.env.PILOT_WEB_BASE ?? 'https://www.sfgzt.cn').replace(/\/$/, '')
const accountFile = process.env.PILOT_ACCOUNT_FILE ?? 'D:\\SifangguanHotelAIOS\\Pilot-Account-Access.txt'
const outputRoot = path.resolve(process.env.UAT_EVIDENCE_ROOT ?? path.join(repoRoot, 'docs', 'uat', 'evidence', 'pilot7-all-roles'))
const browserExecutable = process.env.UAT_BROWSER_EXECUTABLE
  ?? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync)

const productVersion = 'TECH-V0.2-PILOT.7'
const databaseTarget = 'V22'
const authHeaderName = 'x-hotel-ai-authorization'
const tokenStorageKey = 'hotel-ai-os-access-token'
const allowedLoginPostPath = '/api/v1/auth/login'
const safeReadMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

if (!browserExecutable || !existsSync(browserExecutable) || !existsSync(accountFile)) throw new Error('Browser and protected account file are required.')
const rows = (await readFile(accountFile, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => line.split('\t')).filter((parts) => parts.length >= 3)
const accounts = new Map(rows.map((parts) => [parts[1], parts[2]]))

const operatorRequired = [
  'daily-report.read',
  'daily-report.submit',
  'daily-report-template.read',
  'daily-operation.read',
  'task-candidate.read',
  'ai-recommendation.read',
  'ai-recommendation.feedback',
]
const managerRequired = [
  ...operatorRequired,
  'daily-report.team-read',
  'daily-report.review',
  'daily-report.revision-review',
  'daily-report-template.store-supplement',
  'issue.confirm',
  'issue.assign',
  'issue.close',
  'issue.reopen',
  'task-candidate.manage',
  'task-candidate.confirm',
  'task-candidate.reject',
  'task-candidate.retry',
  'operation-snapshot.read',
  'operation-snapshot.retry',
  'operation-snapshot.compare',
  'operation-export.create',
  'operation-export.download',
  'ai-recommendation.adopt',
]
const v18PermissionUniverse = [
  'daily-report.read',
  'daily-report.submit',
  'daily-report.team-read',
  'daily-report.review',
  'daily-report.revision-review',
  'daily-report-template.read',
  'daily-report-template.manage',
  'daily-report-template.review',
  'daily-report-template.publish',
  'daily-report-template.store-supplement',
  'daily-operation.read',
  'daily-operation.cross-hotel-read',
  'issue.confirm',
  'issue.assign',
  'issue.close',
  'issue.reopen',
  'task-candidate.read',
  'task-candidate.manage',
  'task-candidate.confirm',
  'task-candidate.reject',
  'task-candidate.retry',
  'evidence.sensitive.read',
  'operation-snapshot.read',
  'operation-snapshot.retry',
  'operation-snapshot.compare',
  'operation-export.create',
  'operation-export.download',
  'operation-export.sensitive',
  'ai-recommendation.read',
  'ai-recommendation.feedback',
  'ai-recommendation.adopt',
  'audit.cross-org-read',
]

const roles = [
  { login: 'front.demo', slug: 'front-desk', roleCode: 'FRONT_DESK', canCreate: false, home: 'workbench', expectAssignment: true, accessProfile: 'operator' },
  { login: 'fo.supervisor', slug: 'front-office-supervisor', roleCode: 'FRONT_OFFICE_SUPERVISOR', canCreate: true, home: 'workbench', expectAssignment: true, accessProfile: 'manager' },
  { login: 'hk.supervisor', slug: 'housekeeping-supervisor', roleCode: 'HOUSEKEEPING_SUPERVISOR', canCreate: true, home: 'workbench', expectAssignment: true, accessProfile: 'manager' },
  { login: 'assistant.gm', slug: 'assistant-general-manager', roleCode: 'ASSISTANT_GENERAL_MANAGER', canCreate: true, home: 'hotel-dashboard', expectAssignment: true, accessProfile: 'manager' },
  { login: 'gm.hz', slug: 'general-manager', roleCode: 'GENERAL_MANAGER', canCreate: true, home: 'hotel-dashboard', expectAssignment: true, accessProfile: 'manager' },
  { login: 'ota.assistant', slug: 'ota-assistant', roleCode: 'OTA_OPERATION_ASSISTANT', canCreate: true, home: 'tasks?view=team', expectAssignment: true, accessProfile: 'operator' },
  { login: 'ota.manager', slug: 'ota-manager', roleCode: 'OTA_OPERATION_MANAGER', canCreate: true, home: 'operations-dashboard', expectAssignment: true, accessProfile: 'manager' },
  { login: 'ceo.demo', slug: 'ceo', roleCode: 'CEO', canCreate: true, home: 'hotel-dashboard', expectAssignment: false, accessProfile: 'ceo' },
]
for (const role of roles) if (!accounts.has(role.login)) throw new Error(`Credential missing for ${role.login}`)

const governedRoutes = [
  { id: 'snapshot', hash: 'daily-operations/snapshots', requestSuffix: '/daily-operation-snapshots' },
  { id: 'snapshot-mode', hash: 'daily-operations?mode=SNAPSHOT', requestSuffix: '/daily-operations', denyOnly: true },
  { id: 'team', hash: 'daily-reports/team?orgUnitId=:orgUnitId', requestSuffix: '/daily-reports/team' },
  { id: 'export', hash: 'daily-operations/exports', requestSuffix: '/daily-operations/exports' },
  { id: 'operations-dashboard', hash: 'operations-dashboard', requestSuffix: '/dashboards/operations', allowedRole: 'OTA_OPERATION_MANAGER' },
  { id: 'my-work', hash: 'my-work', requestSuffix: '/my/work-expectations', requiresAssignment: true },
]

function expectedRouteAccess(role, route) {
  if (route.allowedRole) return role.roleCode === route.allowedRole
  if (route.requiresAssignment) return role.expectAssignment
  return role.accessProfile !== 'operator'
}

function resolveGovernedRoute(route, rawIdentity) {
  if (!route.hash.includes(':orgUnitId')) return route
  const assignmentOrg = rawIdentity?.positionAssignments?.[0]?.organizationId
  const orgUnitId = assignmentOrg ?? '12000000-0000-0000-0000-000000000003'
  return { ...route, hash: route.hash.replace(':orgUnitId', encodeURIComponent(orgUnitId)) }
}

function requestPath(url) {
  try { return new URL(url).pathname } catch { return '' }
}

function isApiPath(pathname) {
  return pathname.includes('/api/')
}

function isLoginPath(pathname) {
  return pathname === allowedLoginPostPath
}

function isMePath(pathname) {
  return pathname.endsWith('/iam/me')
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
}

function permissionProfile(role) {
  const expected = role.accessProfile === 'operator'
    ? operatorRequired
    : role.accessProfile === 'manager' ? managerRequired : v18PermissionUniverse
  return { expected, forbidden: v18PermissionUniverse.filter((permission) => !expected.includes(permission)) }
}

function assertPermissions(rawPermissions, role) {
  const permissions = new Set(Array.isArray(rawPermissions) ? rawPermissions.map(String) : [])
  const profile = permissionProfile(role)
  const wildcard = permissions.has('*')
  const missingRequired = wildcard ? [] : profile.expected.filter((permission) => !permissions.has(permission))
  const unexpectedForbidden = wildcard ? profile.forbidden : profile.forbidden.filter((permission) => permissions.has(permission))
  return {
    profile: role.accessProfile,
    permissionCount: permissions.size,
    v18PermissionUniverse,
    expectedV18Permissions: profile.expected,
    forbiddenSubset: profile.forbidden,
    missingRequired,
    unexpectedForbidden,
    passed: missingRequired.length === 0 && unexpectedForbidden.length === 0,
  }
}

function assertIdentity(rawIdentity, role) {
  const account = rawIdentity?.account && typeof rawIdentity.account === 'object' ? rawIdentity.account : {}
  const roleCodes = Array.isArray(rawIdentity?.roles) ? rawIdentity.roles.map(String) : []
  const assignments = Array.isArray(rawIdentity?.positionAssignments) ? rawIdentity.positionAssignments : []
  const positionCodes = assignments.map((assignment) => String(assignment?.positionCode ?? '')).filter(Boolean)
  const matchingAssignmentCount = positionCodes.filter((code) => code === role.roleCode).length
  const assignmentExpectationMet = role.expectAssignment ? matchingAssignmentCount > 0 : assignments.length === 0
  const actualLoginName = String(account.loginName ?? '')
  const actualPrimaryRole = String(rawIdentity?.primaryRole ?? '')
  const roleListed = roleCodes.includes(role.roleCode)
  return {
    expectedLoginName: role.login,
    actualLoginName,
    expectedPrimaryRole: role.roleCode,
    actualPrimaryRole,
    roleListed,
    expectedAssignment: role.expectAssignment,
    assignmentCount: assignments.length,
    matchingAssignmentCount,
    assignmentPositionCodes: positionCodes,
    tenantScope: Boolean(rawIdentity?.tenantScope),
    passed: actualLoginName === role.login && actualPrimaryRole === role.roleCode && roleListed && assignmentExpectationMet,
  }
}

async function assertAssignmentSelector(page, rawIdentity, role) {
  const expectedIds = (Array.isArray(rawIdentity?.positionAssignments) ? rawIdentity.positionAssignments : [])
    .filter((assignment) => String(assignment?.positionCode ?? '') === role.roleCode)
    .map((assignment) => String(assignment.id))
    .sort()
  const selector = page.locator('label.context-select').filter({ hasText: '当前任职' }).locator('select')
  const selectorCount = await selector.count()
  const visibleIds = selectorCount
    ? (await selector.locator('option').evaluateAll((options) => options.map((option) => option.value))).sort()
    : []
  return {
    rawAssignmentCount: Array.isArray(rawIdentity?.positionAssignments) ? rawIdentity.positionAssignments.length : 0,
    expectedCompatibleAssignmentIds: expectedIds,
    visibleAssignmentIds: visibleIds,
    incompatibleAssignmentsHidden: expectedIds.length === visibleIds.length && expectedIds.every((id, index) => id === visibleIds[index]),
  }
}

async function installReadOnlyApiGuard(context) {
  const state = {
    apiRequests: [],
    apiFailures: [],
    forbiddenWriteRequests: [],
    loginPostCount: 0,
    meAuthorizationChecks: [],
  }

  const expectedOrigin = new URL(webBase).origin
  await context.route('**/*', async (route) => {
    const request = route.request()
    const method = request.method().toUpperCase()
    const requestUrl = new URL(request.url())
    const pathname = requestUrl.pathname
    const apiRequest = isApiPath(pathname)
    if (apiRequest) state.apiRequests.push({ method, path: pathname })

    if (apiRequest && isMePath(pathname)) {
      const headers = request.headers()
      const authorization = headers[authHeaderName]
      state.meAuthorizationChecks.push({
        present: typeof authorization === 'string' && authorization.length > 0,
        bearerSchemeValid: typeof authorization === 'string' && /^Bearer\s+\S+$/i.test(authorization),
      })
    }

    if (method === 'POST' && requestUrl.origin === expectedOrigin && isLoginPath(pathname)) {
      state.loginPostCount += 1
      await route.continue()
      return
    }
    if (!safeReadMethods.has(method)) {
      state.forbiddenWriteRequests.push({ method, path: pathname, sameOrigin: requestUrl.origin === expectedOrigin })
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })
  return state
}

function observeApiFailures(page, state) {
  page.on('response', (response) => {
    const pathname = requestPath(response.url())
    if (isApiPath(pathname) && response.status() >= 400) {
      const search = new URL(response.url()).search
      state.apiFailures.push({ status: response.status(), path: pathname, search })
    }
  })
}

function unexpectedApiFailures(state) {
  return state.apiFailures
}

async function gotoWithRetry(page, url, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    } catch (error) {
      lastError = error
      if (attempt === attempts) throw error
      await page.waitForTimeout(attempt * 1_000)
    }
  }
  throw lastError
}

async function openLogin(page) {
  await gotoWithRetry(page, `${webBase}/#/workbench`)
  await page.locator('.login-card').waitFor({ state: 'visible', timeout: 30_000 })
}

async function loginAndLoadIdentity(page, loginName, password) {
  const meResponsePromise = page.waitForResponse((response) => isMePath(requestPath(response.url())) && response.request().method() === 'GET', { timeout: 30_000 })
  await page.locator('input[autocomplete="username"]').fill(loginName)
  await page.locator('input[autocomplete="current-password"]').fill(password)
  await page.locator('button.login-submit').click()
  const meResponse = await meResponsePromise
  if (!meResponse.ok()) throw new Error(`/iam/me returned HTTP ${meResponse.status()} for ${loginName}`)
  const identity = await meResponse.json()
  await page.locator('.shell').waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.sidebar-footer').filter({ hasText: productVersion }).waitFor({ state: 'visible', timeout: 20_000 })
  return identity
}

function countBusinessRequests(state, suffix) {
  return state.apiRequests.filter((request) => request.method === 'GET' && request.path.endsWith(suffix)).length
}

async function verifyGovernedRoute(page, state, role, route, expectedAllowed) {
  const before = countBusinessRequests(state, route.requestSuffix)
  let pageTitle
  let boundaryVisible = false
  let responseStatus
  let responseOk
  let error
  try {
    const responsePromise = expectedAllowed
      ? page.waitForResponse((response) => response.request().method() === 'GET' && requestPath(response.url()).endsWith(route.requestSuffix), { timeout: 30_000 })
      : undefined
    await gotoWithRetry(page, `${webBase}/#/${route.hash}`)
    const accessDenied = page.locator('.state-card.error-state[role="alert"]').filter({ hasText: '无权访问此页面' })
    if (expectedAllowed) {
      const response = await responsePromise
      responseStatus = response.status()
      responseOk = response.ok()
      if (!responseOk) throw new Error(`${route.requestSuffix} returned HTTP ${responseStatus}`)
      await page.locator('main h1').first().waitFor({ state: 'visible', timeout: 30_000 })
      boundaryVisible = await accessDenied.isVisible().catch(() => false)
      pageTitle = await page.locator('main h1').first().innerText()
    } else {
      await accessDenied.waitFor({ state: 'visible', timeout: 30_000 })
      await page.waitForTimeout(500)
      boundaryVisible = true
    }
  } catch (reason) {
    error = safeError(reason)
  }
  const after = countBusinessRequests(state, route.requestSuffix)
  const businessRequestCount = after - before
  await page.screenshot({ path: path.join(outputRoot, `${role.slug}-${route.id}.png`), fullPage: true })
  const passed = !error && (expectedAllowed
    ? businessRequestCount > 0 && responseOk && !boundaryVisible
    : businessRequestCount === 0 && boundaryVisible)
  return {
    route: route.hash,
    expectedAllowed,
    localBoundaryVisible: boundaryVisible,
    businessRequestSent: businessRequestCount > 0,
    businessRequestCount,
    responseStatus,
    responseOk,
    pageTitle,
    error,
    passed,
  }
}

async function verifyAccountSwitch(browser) {
  const frontRole = roles.find((role) => role.login === 'front.demo')
  const ceoRole = roles.find((role) => role.login === 'ceo.demo')
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  const state = await installReadOnlyApiGuard(context)
  const page = await context.newPage()
  observeApiFailures(page, state)
  try {
    await openLogin(page)
    const frontHeaderStart = state.meAuthorizationChecks.length
    const frontIdentityRaw = await loginAndLoadIdentity(page, frontRole.login, accounts.get(frontRole.login))
    const frontIdentity = assertIdentity(frontIdentityRaw, frontRole)
    const frontHeaderChecks = state.meAuthorizationChecks.slice(frontHeaderStart)
    const frontHeaderPassed = frontHeaderChecks.some((check) => check.present && check.bearerSchemeValid)
    const frontToken = await page.evaluate((key) => window.localStorage.getItem(key), tokenStorageKey)
    const tokenPresentBeforeLogout = Boolean(frontToken)

    await page.locator('button.logout-button').click()
    await page.locator('.login-card').waitFor({ state: 'visible', timeout: 30_000 })
    const tokenClearedAfterLogout = await page.evaluate((key) => window.localStorage.getItem(key) === null, tokenStorageKey)

    const ceoHeaderStart = state.meAuthorizationChecks.length
    const ceoIdentityRaw = await loginAndLoadIdentity(page, ceoRole.login, accounts.get(ceoRole.login))
    const ceoIdentity = assertIdentity(ceoIdentityRaw, ceoRole)
    const ceoHeaderChecks = state.meAuthorizationChecks.slice(ceoHeaderStart)
    const ceoHeaderPassed = ceoHeaderChecks.some((check) => check.present && check.bearerSchemeValid)
    const ceoToken = await page.evaluate((key) => window.localStorage.getItem(key), tokenStorageKey)
    const tokenChanged = Boolean(frontToken && ceoToken && frontToken !== ceoToken)
    const passed = frontIdentity.passed && ceoIdentity.passed && frontHeaderPassed && ceoHeaderPassed &&
      tokenPresentBeforeLogout && tokenClearedAfterLogout && tokenChanged && state.loginPostCount === 2 &&
      state.forbiddenWriteRequests.length === 0 && unexpectedApiFailures(state).length === 0
    return {
      contextReused: true,
      sequence: ['front.demo', 'logout', 'ceo.demo'],
      frontIdentity,
      ceoIdentity,
      customAuthorizationHeader: {
        name: 'X-Hotel-AI-Authorization',
        frontIamMePresentWithBearerScheme: frontHeaderPassed,
        ceoIamMePresentWithBearerScheme: ceoHeaderPassed,
        valuesPersistedInEvidence: false,
      },
      tokenPresentBeforeLogout,
      tokenClearedAfterLogout,
      tokenChanged,
      tokenValuesPersistedInEvidence: false,
      loginPostCount: state.loginPostCount,
      forbiddenWriteRequests: state.forbiddenWriteRequests,
      apiFailures: state.apiFailures,
      unexpectedApiFailures: unexpectedApiFailures(state),
      passed,
    }
  } catch (error) {
    return {
      contextReused: true,
      sequence: ['front.demo', 'logout', 'ceo.demo'],
      error: safeError(error),
      loginPostCount: state.loginPostCount,
      forbiddenWriteRequests: state.forbiddenWriteRequests,
      apiFailures: state.apiFailures,
      tokenValuesPersistedInEvidence: false,
      passed: false,
    }
  } finally {
    await context.close()
  }
}

await mkdir(outputRoot, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
const results = []
let accountSwitch
try {
  for (const role of roles) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
    const state = await installReadOnlyApiGuard(context)
    const page = await context.newPage()
    observeApiFailures(page, state)
    try {
      await openLogin(page)
      const meHeaderStart = state.meAuthorizationChecks.length
      const rawIdentity = await loginAndLoadIdentity(page, role.login, accounts.get(role.login))
      const identity = assertIdentity(rawIdentity, role)
      const permissionAudit = assertPermissions(rawIdentity?.permissions, role)
      const assignmentSelector = await assertAssignmentSelector(page, rawIdentity, role)
      const meHeaderChecks = state.meAuthorizationChecks.slice(meHeaderStart)
      const customAuthorizationHeaderPassed = meHeaderChecks.some((check) => check.present && check.bearerSchemeValid)

      await gotoWithRetry(page, `${webBase}/#/${role.home}`)
      await page.locator('main h1').first().waitFor({ state: 'visible', timeout: 30_000 })
      await page.waitForTimeout(800)
      const homeTitle = await page.locator('main h1').first().innerText()
      await page.screenshot({ path: path.join(outputRoot, `${role.slug}-home.png`), fullPage: true })

      await gotoWithRetry(page, `${webBase}/#/tasks?view=${role.login === 'ceo.demo' ? 'team' : 'mine'}`)
      await page.locator('main h1').first().waitFor({ state: 'visible', timeout: 30_000 })
      await page.waitForTimeout(800)
      const createButtonVisible = await page.locator('.page-title button.primary').count() > 0
      const permissionMatch = createButtonVisible === role.canCreate
      await page.screenshot({ path: path.join(outputRoot, `${role.slug}-tasks.png`), fullPage: true })

      const routeAccess = []
      for (const route of governedRoutes) {
        const resolvedRoute = resolveGovernedRoute(route, rawIdentity)
        const expectedAllowed = expectedRouteAccess(role, route)
        if (route.denyOnly && expectedAllowed) {
          routeAccess.push({
            route: resolvedRoute.hash,
            expectedAllowed,
            result: 'SKIPPED',
            reason: 'No seeded immutable snapshot id; authorized snapshot list access is validated separately.',
          })
        } else {
          const check = await verifyGovernedRoute(page, state, role, resolvedRoute, expectedAllowed)
          routeAccess.push({ ...check, result: check.passed ? 'PASS' : 'FAILED' })
        }
      }

      const passed = identity.passed && permissionAudit.passed && assignmentSelector.incompatibleAssignmentsHidden && customAuthorizationHeaderPassed && permissionMatch &&
        routeAccess.every((check) => check.result !== 'FAILED') && unexpectedApiFailures(state).length === 0 &&
        state.forbiddenWriteRequests.length === 0 && state.loginPostCount === 1
      results.push({
        login: role.login,
        home: role.home,
        homeTitle,
        identity,
        permissionAudit,
        assignmentSelector,
        expectedCanCreate: role.canCreate,
        createButtonVisible,
        permissionMatch,
        customAuthorizationHeader: {
          name: 'X-Hotel-AI-Authorization',
          presentForIamMe: customAuthorizationHeaderPassed,
          bearerSchemeValidForIamMe: customAuthorizationHeaderPassed,
          valuePersistedInEvidence: false,
        },
        routeAccess,
        readOnlyNetworkPolicy: {
          loginPostCount: state.loginPostCount,
          forbiddenWriteRequests: state.forbiddenWriteRequests,
          passed: state.loginPostCount === 1 && state.forbiddenWriteRequests.length === 0,
        },
        apiFailures: state.apiFailures,
        unexpectedApiFailures: unexpectedApiFailures(state),
        passed,
      })
    } catch (error) {
      results.push({
        login: role.login,
        expectedRole: role.roleCode,
        expectedCanCreate: role.canCreate,
        apiFailures: state.apiFailures,
        forbiddenWriteRequests: state.forbiddenWriteRequests,
        error: safeError(error),
        passed: false,
      })
    } finally {
      await context.close()
    }
  }
  accountSwitch = await verifyAccountSwitch(browser)
} finally {
  await browser.close()
}

const passed = results.length === roles.length && results.every((result) => result.passed) && accountSwitch?.passed === true
const report = {
  generatedAt: new Date().toISOString(),
  version: productVersion,
  databaseTarget,
  profile: 'V22_BROWSER_READ_ONLY',
  webBase,
  passed,
  summary: {
    passed: results.filter((result) => result.passed).length,
    total: results.length,
    failed: results.filter((result) => !result.passed).length,
    accountSwitchPassed: accountSwitch?.passed === true,
  },
  results,
  accountSwitch,
  evidenceSafety: {
    businessWritesAllowed: false,
    onlyAllowedPostPath: allowedLoginPostPath,
    credentialsPersistedInEvidence: false,
    tokensPersistedInEvidence: false,
    authorizationHeaderValuesPersistedInEvidence: false,
  },
}
const reportJson = JSON.stringify(report, null, 2)
const credentialLeak = [...accounts.values()].some((secret) => secret && secret.length >= 8 && reportJson.includes(secret))
const jwtLeak = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(reportJson)
if (credentialLeak || jwtLeak) throw new Error('Evidence safety check rejected a credential or token-like value.')
await writeFile(path.join(outputRoot, 'pilot7-all-roles.json'), reportJson, 'utf8')
console.log(JSON.stringify({ version: report.version, databaseTarget: report.databaseTarget, passed: report.passed, summary: report.summary, outputRoot }))
if (!passed) process.exit(1)
