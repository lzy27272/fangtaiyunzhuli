import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
const CONFIRMATION = 'ISOLATED-CLOSED-LOOP'
const EXPECTED_AUDIENCE = 'hotel-ai-os-api'
const REQUIRED_RUN_PREFIX = 'CL-UAT-'
const DENIED_PORTS = new Set([18080, 4180])
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..')
const FIXED_STATE_FILE = path.join(REPO_ROOT, 'docs', 'uat', 'evidence', 'runtime', 'uat-processes.json')

const ROLE_MATRIX = [
  {
    key: 'front-desk',
    expectedRole: 'FRONT_DESK',
    assignmentRequired: true,
    reportMode: 'HOTEL_POSITION',
    taskReviewer: 'front-supervisor',
  },
  {
    key: 'front-supervisor',
    expectedRole: 'FRONT_OFFICE_SUPERVISOR',
    assignmentRequired: true,
    reportMode: 'HOTEL_POSITION',
    taskReviewer: 'general-manager',
  },
  {
    key: 'housekeeping-supervisor',
    expectedRole: 'HOUSEKEEPING_SUPERVISOR',
    assignmentRequired: true,
    reportMode: 'HOTEL_POSITION',
    taskReviewer: 'general-manager',
  },
  {
    key: 'assistant-gm',
    expectedRole: 'ASSISTANT_GENERAL_MANAGER',
    assignmentRequired: true,
    reportMode: 'HOTEL_POSITION',
    taskReviewer: 'general-manager',
  },
  {
    key: 'general-manager',
    expectedRole: 'GENERAL_MANAGER',
    assignmentRequired: true,
    reportMode: 'HOTEL_POSITION',
    taskReviewer: null,
    taskSkipReason: 'No higher hotel reviewer assignment is present in the frozen UAT role fixture.',
  },
  {
    key: 'ota-assistant',
    expectedRole: 'OTA_OPERATION_ASSISTANT',
    assignmentRequired: true,
    reportMode: 'REGIONAL_SKIP',
    reportSkipReason: 'The OTA assignment belongs to the regional management organization, not a hotel position. A hotel daily report is not fabricated.',
    taskReviewer: 'ota-manager',
  },
  {
    key: 'ota-manager',
    expectedRole: 'OTA_OPERATION_MANAGER',
    assignmentRequired: true,
    reportMode: 'REGIONAL_SKIP',
    reportSkipReason: 'The OTA assignment belongs to the regional management organization, not a hotel position. A hotel daily report is not fabricated.',
    taskReviewer: null,
    taskSkipReason: 'No higher regional reviewer assignment is present in the frozen UAT role fixture.',
  },
  {
    key: 'ceo',
    expectedRole: 'CEO',
    assignmentRequired: false,
    reportMode: 'GOVERNANCE_SKIP',
    reportSkipReason: 'CEO has tenant governance scope and no position assignment; no employee daily report is fabricated.',
    taskReviewer: null,
    taskSkipReason: 'CEO has no employee position assignment and is tested only as the governance task creator.',
  },
]

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (!current.startsWith('--')) throw new Error(`Unexpected argument: ${current}`)
    const name = current.slice(2)
    if (name === 'self-test') {
      args.selfTest = true
      continue
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`)
    args[name] = value
    index += 1
  }
  return args
}

function asArray(value) {
  if (value == null) return []
  if (Array.isArray(value)) return value
  if (Array.isArray(value.value)) return value.value
  return [value]
}

function field(value, ...names) {
  if (!value || typeof value !== 'object') return undefined
  for (const name of names) {
    if (Object.hasOwn(value, name)) return value[name]
  }
  return undefined
}

function redact(value) {
  const text = String(value ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/("?(?:accessToken|refreshToken|password|token)"?\s*[:=]\s*")[^"]+/gi, '$1[REDACTED]')
  return text.length > 500 ? text.slice(0, 500) : text
}

function parseJsonText(text) {
  return JSON.parse(String(text).replace(/^\uFEFF/, '').trim())
}

function isProcessRunning(pid) {
  const numeric = Number(pid)
  if (!Number.isInteger(numeric) || numeric <= 0) return false
  try {
    process.kill(numeric, 0)
    return true
  } catch {
    return false
  }
}

function assertRunId(runId) {
  if (!runId?.startsWith(REQUIRED_RUN_PREFIX)) {
    throw new Error(`RunId must start with ${REQUIRED_RUN_PREFIX}.`)
  }
  if (!/^[A-Za-z0-9._-]{10,80}$/.test(runId)) {
    throw new Error('RunId must be 10-80 characters and contain only letters, digits, dot, underscore or hyphen.')
  }
}

function normalizeApiBase(value) {
  const api = new URL(value)
  if (api.protocol !== 'http:' || !LOOPBACK_HOSTS.has(api.hostname)) {
    throw new Error(`Mutating UAT requires a loopback HTTP API, received ${api.origin}.`)
  }
  if (api.pathname.replace(/\/$/, '') !== '/api/v1') {
    throw new Error('ApiBase must end with /api/v1.')
  }
  const port = Number(api.port)
  if (!Number.isInteger(port) || port <= 0 || DENIED_PORTS.has(port)) {
    throw new Error('ApiBase must use a dynamically assigned isolated port; ports 18080 and 4180 are explicitly denied.')
  }
  api.pathname = '/api/v1'
  api.search = ''
  api.hash = ''
  return api
}

function databaseIsDisposable(marker) {
  const normalized = String(marker ?? '').toLowerCase()
  const positive = normalized.includes('hotel_ai_os_uat') || normalized.includes('embedded postgresql')
  const negative = normalized.includes('pilot') || normalized.includes('sifangguanhotelaios')
  return positive && !negative
}

function stateContainsPilotMarker(state) {
  return Object.entries(state ?? {}).some(([key, value]) => {
    if (/pilot/i.test(key)) return true
    if (typeof value === 'string') return /pilot/i.test(value)
    if (value && typeof value === 'object') return stateContainsPilotMarker(value)
    return false
  })
}

function validateStateObject({ state, api, runId, now = Date.now() }) {
  if (state.purpose !== 'ISOLATED_UAT') throw new Error('State must declare purpose=ISOLATED_UAT.')
  if (state.environmentType !== 'embedded-postgresql') {
    throw new Error('Only environmentType=embedded-postgresql is approved for mutating role UAT.')
  }
  if (stateContainsPilotMarker(state)) throw new Error('State contains a forbidden Pilot marker.')
  if (state.authenticationMode !== 'bearer-jwt' || state.devHeaderAuthEnabled !== false) {
    throw new Error('State must use signed bearer JWT with development header authentication disabled.')
  }
  const expiresAt = Date.parse(state.expiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error('Disposable UAT state has expired.')
  if (state.runId !== runId) {
    throw new Error(`RunId does not match the active disposable environment (${state.runId ?? 'missing'}).`)
  }
  const stateOrigin = new URL(state.apiUrl)
  if (stateOrigin.protocol !== 'http:' || !LOOPBACK_HOSTS.has(stateOrigin.hostname)) {
    throw new Error('State API is not a loopback HTTP target.')
  }
  if (api.origin !== stateOrigin.origin) throw new Error('ApiBase does not match the active disposable UAT state.')
  if (DENIED_PORTS.has(Number(stateOrigin.port))) throw new Error('State API uses an explicitly denied shared-Pilot port.')
  if (!databaseIsDisposable(state.database)) {
    throw new Error('State database marker is not an approved disposable database. Shared Pilot targets are rejected.')
  }
  if (!Number.isInteger(Number(state.apiPid)) || Number(state.apiPid) <= 0 || !isProcessRunning(state.apiPid)) {
    throw new Error('State must identify a positive, currently running isolated API process.')
  }
}

async function validateTarget({ apiBase, stateFile, tokenFile, runId, confirmation, now = Date.now() }) {
  if (confirmation !== CONFIRMATION) {
    throw new Error(`Mutation requires the exact confirmation ${CONFIRMATION}.`)
  }
  assertRunId(runId)
  if (!existsSync(stateFile)) throw new Error(`Disposable UAT state is missing: ${stateFile}`)
  if (!existsSync(tokenFile)) throw new Error(`Ephemeral UAT token file is missing: ${tokenFile}`)

  const resolvedStateFile = await realpath(stateFile)
  const fixedStateFile = await realpath(FIXED_STATE_FILE).catch(() => FIXED_STATE_FILE)
  if (path.normalize(resolvedStateFile).toLowerCase() !== path.normalize(fixedStateFile).toLowerCase()) {
    throw new Error(`StateFile must be the managed runtime state: ${FIXED_STATE_FILE}`)
  }

  const api = normalizeApiBase(apiBase)
  const state = parseJsonText(await readFile(resolvedStateFile, 'utf8'))
  validateStateObject({ state, api, runId, now })

  const resolvedTokenFile = await realpath(tokenFile)
  const tokenRoot = await realpath(path.join(REPO_ROOT, '.uat-runtime', 'identity'))
    .catch(() => null)
  if (!tokenRoot || (resolvedTokenFile !== tokenRoot && !resolvedTokenFile.startsWith(`${tokenRoot}${path.sep}`))) {
    throw new Error('TokenFile must stay inside the ignored .uat-runtime/identity directory.')
  }
  const tokenDocument = parseJsonText(await readFile(resolvedTokenFile, 'utf8'))
  if (tokenDocument.audience !== EXPECTED_AUDIENCE || !tokenDocument.tokens) {
    throw new Error('TokenFile has the wrong audience or no token map.')
  }
  if (state.jwtIssuer && tokenDocument.issuer !== state.jwtIssuer) {
    throw new Error('Token issuer does not match the active disposable UAT state.')
  }
  return { api, state, tokenDocument, resolvedTokenFile }
}

function buildSelfTestState() {
  return {
    purpose: 'ISOLATED_UAT',
    environmentType: 'embedded-postgresql',
    runId: 'CL-UAT-static-001',
    authenticationMode: 'bearer-jwt',
    devHeaderAuthEnabled: false,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    apiUrl: 'http://127.0.0.1:54321',
    apiPid: process.pid,
    database: 'embedded PostgreSQL (real non-superuser runtime role)',
  }
}

function runSelfTest() {
  assertRunId('CL-UAT-static-001')
  normalizeApiBase('http://127.0.0.1:54321/api/v1')
  if (!databaseIsDisposable(buildSelfTestState().database)) throw new Error('Disposable database self-test failed.')
  if (databaseIsDisposable('127.0.0.1:5432/pilot')) throw new Error('Shared Pilot database guard self-test failed.')
  for (const unsafe of ['https://www.sfgzt.cn/api/v1', 'http://127.0.0.1:54321/not-api', 'http://127.0.0.1:18080/api/v1', 'http://127.0.0.1:4180/api/v1']) {
    let rejected = false
    try { normalizeApiBase(unsafe) } catch { rejected = true }
    if (!rejected) throw new Error(`Unsafe API target was accepted: ${unsafe}`)
  }
  const validApi = normalizeApiBase('http://127.0.0.1:54321/api/v1')
  validateStateObject({ state: buildSelfTestState(), api: validApi, runId: 'CL-UAT-static-001' })
  for (const mutation of [
    (state) => { state.apiPid = null },
    (state) => { state.environmentType = 'docker-compose' },
    (state) => { state.database = '127.0.0.1:5432/pilot' },
    (state) => { state.apiUrl = 'http://127.0.0.1:18080' },
    (state) => { state.fixture = 'pilot-fixture.sql' },
  ]) {
    const forged = buildSelfTestState()
    mutation(forged)
    let rejected = false
    try { validateStateObject({ state: forged, api: validApi, runId: 'CL-UAT-static-001' }) } catch { rejected = true }
    if (!rejected) throw new Error(`Forged state was accepted: ${JSON.stringify(forged)}`)
  }
  if (ROLE_MATRIX.length !== 8) throw new Error('Role matrix must contain exactly eight roles.')
  process.stdout.write('isolated-v21-role-closed-loop self-test: PASS\n')
}

function safePath(requestPath) {
  return requestPath.replace(/[?&](?:token|password)=[^&]*/gi, '')
}

function valueForInputType(inputType, runId) {
  switch (String(inputType ?? '').toUpperCase()) {
    case 'NUMBER': return 1
    case 'BOOLEAN': return true
    case 'DATE': return new Date().toISOString().slice(0, 10)
    case 'MULTI_SELECT': return ['UAT']
    case 'SINGLE_SELECT': return 'UAT'
    default: return `${runId} completed`
  }
}

async function main(args) {
  for (const required of ['api-base', 'state-file', 'token-file', 'run-id', 'confirm-mutation']) {
    if (!args[required]) throw new Error(`--${required} is required.`)
  }
  const repoRoot = REPO_ROOT
  const runId = args['run-id']
  const target = await validateTarget({
    apiBase: args['api-base'],
    stateFile: path.resolve(args['state-file']),
    tokenFile: path.resolve(args['token-file']),
    runId,
    confirmation: args['confirm-mutation'],
  })
  const evidenceRoot = path.resolve(args['evidence-root'] ?? path.join(repoRoot, 'docs', 'uat', 'evidence', runId, 'closed-loop'))
  await mkdir(evidenceRoot, { recursive: true })

  const tokenMap = new Map()
  for (const role of ROLE_MATRIX) {
    const property = target.tokenDocument.tokens[role.key]
    if (typeof property === 'string' && property.length > 20) tokenMap.set(role.key, property)
  }
  const checks = []
  const blockers = []
  const requestLog = []
  const identities = new Map()
  const artifacts = { tasks: [], dailyReports: [], cleanupPerformed: false }
  let publisherActors = []

  function addCheck(name, result, details = {}) {
    checks.push({ name, result, passed: result === 'PASS' ? true : result === 'FAIL' || result === 'BLOCKED' ? false : null, details })
  }

  function addBlocker(code, message, roles = []) {
    const existing = blockers.find((item) => item.code === code)
    if (existing) {
      existing.roles = [...new Set([...existing.roles, ...roles])]
    } else {
      blockers.push({ code, message, roles: [...new Set(roles)] })
    }
  }

  async function api(roleKey, requestPath, { method = 'GET', body, key, expected = [200] } = {}) {
    const token = tokenMap.get(roleKey)
    if (!token) throw new Error(`No signed token is available for ${roleKey}.`)
    const correlationId = randomUUID()
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'X-Correlation-Id': correlationId,
    }
    if (key) headers['Idempotency-Key'] = key
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    let response
    let responseText = ''
    try {
      response = await fetch(new URL(`${target.api.pathname}${requestPath}`, target.api.origin), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
      responseText = await response.text()
    } finally {
      clearTimeout(timeout)
      headers.Authorization = 'Bearer [CLEARED]'
    }
    let parsed = null
    if (responseText.trim()) {
      try { parsed = JSON.parse(responseText) } catch { parsed = responseText }
    }
    requestLog.push({
      role: roleKey,
      method,
      path: safePath(requestPath),
      status: response.status,
      expected,
      passed: expected.includes(response.status),
      correlationId,
    })
    if (!expected.includes(response.status)) {
      throw new Error(`${roleKey} ${method} ${safePath(requestPath)} returned HTTP ${response.status}: ${redact(responseText)}`)
    }
    return { status: response.status, body: parsed, correlationId }
  }

  try {
    const anonymous = await fetch(new URL(`${target.api.pathname}/iam/me`, target.api.origin))
    addCheck('anonymous_access_denied', anonymous.status === 401 ? 'PASS' : 'FAIL', { expectedStatus: 401, actualStatus: anonymous.status })
    if (anonymous.status !== 401) throw new Error('Anonymous /iam/me was not rejected with HTTP 401.')

    for (const role of ROLE_MATRIX) {
      if (!tokenMap.has(role.key)) {
        addCheck(`identity_${role.key}`, 'BLOCKED', { reason: 'Signed token is missing from the isolated runtime token file.' })
        addBlocker('MISSING_ROLE_TOKEN', 'One or more isolated role tokens are missing.', [role.key])
        continue
      }
      const me = (await api(role.key, '/iam/me')).body
      const assignments = asArray(field(me, 'positionAssignments', 'position_assignments'))
      const roleMatches = field(me, 'primaryRole', 'primary_role') === role.expectedRole
      const assignmentMatches = !role.assignmentRequired || assignments.length > 0
      const result = roleMatches && assignmentMatches ? 'PASS' : 'BLOCKED'
      addCheck(`identity_${role.key}`, result, {
        expectedRole: role.expectedRole,
        actualRole: field(me, 'primaryRole', 'primary_role'),
        assignmentCount: assignments.length,
        tenantScope: Boolean(field(me, 'tenantScope', 'tenant_scope')),
      })
      if (result !== 'PASS') {
        addBlocker('ROLE_IDENTITY_MISMATCH', 'A role identity or required assignment is missing.', [role.key])
        continue
      }
      const preferred = assignments.find((item) => field(item, 'primary')) ?? assignments[0] ?? null
      identities.set(role.key, {
        me,
        assignment: preferred,
        permissions: new Set(asArray(field(me, 'permissions'))),
      })
    }

    if (identities.size !== ROLE_MATRIX.length) throw new Error('Eight-role identity preflight did not pass.')

    const ceoIdentity = identities.get('ceo')
    const ceoAssignments = asArray(field(ceoIdentity.me, 'positionAssignments', 'position_assignments'))
    const ceoAssignmentPass = ceoAssignments.length === 0
    addCheck('ceo_no_fabricated_assignment', ceoAssignmentPass ? 'PASS' : 'BLOCKED', { assignmentCount: ceoAssignments.length })
    if (!ceoAssignmentPass) addBlocker('CEO_ASSIGNMENT_UNEXPECTED', 'CEO governance identity unexpectedly has an employee assignment.', ['ceo'])

    publisherActors = [...identities.entries()]
      .filter(([, identity]) => identity.permissions.has('daily-report-template.review') && identity.permissions.has('daily-report-template.publish'))
      .map(([key]) => key)
    addCheck('independent_template_publishers', publisherActors.length >= 2 ? 'PASS' : 'BLOCKED', {
      distinctQualifiedActors: publisherActors,
      requiredDistinctActors: 2,
    })
    if (publisherActors.length < 2) {
      addBlocker(
        'DAILY_REPORT_TEMPLATE_MAKER_CHECKER_GAP',
        'A new template cannot be safely published: the isolated role set has fewer than two distinct actors with review and publish permission.',
        ROLE_MATRIX.filter((role) => role.reportMode === 'HOTEL_POSITION').map((role) => role.key),
      )
    }

    const workPackages = asArray((await api('ceo', '/work-packages')).body)
    const templates = asArray((await api('ceo', '/daily-report-templates')).body)
    const reportCandidates = []
    for (const role of ROLE_MATRIX) {
      const identity = identities.get(role.key)
      if (role.reportMode !== 'HOTEL_POSITION') {
        addCheck(`daily_report_${role.key}`, 'SKIPPED', { reason: role.reportSkipReason })
        continue
      }
      const assignment = identity.assignment
      const positionId = String(field(assignment, 'positionId', 'position_id'))
      const packageRow = workPackages.find((item) =>
        String(field(item, 'position_id', 'positionId')) === positionId
        && String(field(item, 'lifecycle_status', 'lifecycleStatus')).toUpperCase() === 'PUBLISHED')
      const templateRow = templates.find((item) =>
        String(field(item, 'positionId', 'position_id')) === positionId
        && String(field(item, 'status')).toUpperCase() === 'ACTIVE'
        && String(field(item, 'latestVersionStatus', 'latest_version_status')).toUpperCase() === 'PUBLISHED')
      if (!packageRow) {
        addCheck(`daily_report_${role.key}`, 'BLOCKED', { reason: 'No published position work package is visible.', positionId })
        addBlocker('MISSING_PUBLISHED_WORK_PACKAGE', 'A hotel role has no published work package.', [role.key])
        continue
      }
      if (!templateRow) {
        addCheck(`daily_report_${role.key}`, 'BLOCKED', {
          reason: 'No published daily-report template resolves for the position. Draft creation is deliberately skipped because independent publication is unavailable.',
          positionId,
          workPackageVersionId: field(packageRow, 'latest_version_id', 'latestVersionId'),
        })
        addBlocker('MISSING_PUBLISHED_DAILY_REPORT_TEMPLATE', 'A hotel role has no published daily-report template.', [role.key])
        continue
      }
      const orgUnitId = String(field(assignment, 'organizationId', 'organization_id'))
      const assignmentId = String(field(assignment, 'id'))
      const businessDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
      const resolution = await api(role.key, `/daily-report-templates/resolve?orgUnitId=${encodeURIComponent(orgUnitId)}&positionAssignmentId=${encodeURIComponent(assignmentId)}&businessDate=${businessDate}`, { expected: [200, 400] })
      if (resolution.status !== 200 || !field(resolution.body, 'selectedTemplateVersionId', 'selected_template_version_id')) {
        addCheck(`daily_report_${role.key}`, 'BLOCKED', {
          reason: 'A published template exists but does not resolve for this assignment and business date.',
          positionId,
          resolveHttpStatus: resolution.status,
        })
        addBlocker('DAILY_REPORT_TEMPLATE_NOT_RESOLVABLE', 'A published template does not resolve for a hotel assignment.', [role.key])
        continue
      }
      reportCandidates.push({ role, identity, templateRow, packageRow, resolution: resolution.body })
    }

    for (const candidate of reportCandidates) {
      const { role, identity, resolution } = candidate
      const assignment = identity.assignment
      const orgUnitId = String(field(assignment, 'organizationId', 'organization_id'))
      const assignmentId = String(field(assignment, 'id'))
      const businessDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
      const createBody = { orgUnitId, positionAssignmentId: assignmentId, businessDate, templateVersionId: field(resolution, 'selectedTemplateVersionId', 'selected_template_version_id') }
      const createKey = `cl-uat:${runId}:${role.key}:daily-report:create`
      const created = await api(role.key, '/daily-reports', { method: 'POST', body: createBody, key: createKey, expected: [201] })
      const replay = await api(role.key, '/daily-reports', { method: 'POST', body: createBody, key: createKey, expected: [201] })
      if (field(created.body, 'id') !== field(replay.body, 'id')) throw new Error(`Daily-report idempotency replay failed for ${role.key}.`)
      const revision = asArray(field(created.body, 'revisions'))[0]
      const snapshot = field(revision, 'payloadSnapshot', 'payload_snapshot') ?? {}
      const resolved = field(snapshot, 'resolvedTemplate', 'resolved_template') ?? {}
      const templateItems = asArray(field(resolved, 'sections')).flatMap((section) => asArray(field(section, 'items')))
      if (templateItems.length === 0) throw new Error(`Resolved daily-report template has no items for ${role.key}.`)
      const draftItems = templateItems.map((item) => ({
        templateItemId: field(item, 'id'),
        value: valueForInputType(field(item, 'valueType', 'inputType', 'input_type'), runId),
        confirmed: true,
        exception: false,
        comment: `${runId} isolated UAT`,
      }))
      const draft = await api(role.key, `/daily-reports/${field(created.body, 'id')}/draft`, {
        method: 'PUT',
        key: `cl-uat:${runId}:${role.key}:daily-report:draft`,
        body: { revisionId: field(created.body, 'currentRevisionId', 'current_revision_id'), items: draftItems, narrative: `${runId} role daily report`, expectedVersion: Number(field(created.body, 'rowVersion', 'row_version') ?? 0) },
      })
      const stale = await api(role.key, `/daily-reports/${field(created.body, 'id')}/actions/submit`, {
        method: 'POST',
        key: `cl-uat:${runId}:${role.key}:daily-report:stale`,
        body: { revisionId: field(created.body, 'currentRevisionId', 'current_revision_id'), expectedVersion: Number(field(created.body, 'rowVersion', 'row_version') ?? 0) },
        expected: [409],
      })
      const submitted = await api(role.key, `/daily-reports/${field(created.body, 'id')}/actions/submit`, {
        method: 'POST',
        key: `cl-uat:${runId}:${role.key}:daily-report:submit`,
        body: { revisionId: field(created.body, 'currentRevisionId', 'current_revision_id'), expectedVersion: Number(field(draft.body, 'rowVersion', 'row_version')) },
      })
      const pass = String(field(submitted.body, 'reportStatus', 'report_status')).toUpperCase() === 'SUBMITTED'
      addCheck(`daily_report_${role.key}`, pass ? 'PASS' : 'FAIL', { reportId: field(created.body, 'id'), idempotencyReplay: true, staleWriteStatus: stale.status, status: field(submitted.body, 'reportStatus', 'report_status') })
      artifacts.dailyReports.push({ role: role.key, reportId: field(created.body, 'id') })
    }

    const ceoTargets = asArray((await api('ceo', '/tasks/targets')).body)
    for (const role of ROLE_MATRIX) {
      if (!role.taskReviewer) {
        addCheck(`task_flow_${role.key}`, 'SKIPPED', { reason: role.taskSkipReason })
        continue
      }
      const assigneeIdentity = identities.get(role.key)
      const reviewerIdentity = identities.get(role.taskReviewer)
      const assignee = assigneeIdentity.assignment
      const reviewer = reviewerIdentity.assignment
      if (!assignee || !reviewer) {
        addCheck(`task_flow_${role.key}`, 'BLOCKED', { reason: 'Assignee or reviewer assignment is missing.', reviewerRole: role.taskReviewer })
        addBlocker('TASK_PARTICIPANT_ASSIGNMENT_MISSING', 'A task assignee or reviewer assignment is missing.', [role.key, role.taskReviewer])
        continue
      }
      const assigneeId = String(field(assignee, 'id'))
      const reviewerId = String(field(reviewer, 'id'))
      const targetVisible = ceoTargets.some((item) => String(field(item, 'assignment_id', 'assignmentId')) === assigneeId)
      if (!targetVisible) {
        addCheck(`task_flow_${role.key}`, 'BLOCKED', { reason: 'Assignee is not visible in CEO task targets.', assigneeAssignmentId: assigneeId })
        addBlocker('TASK_TARGET_NOT_VISIBLE', 'A planned assignee is not visible to the governance creator.', [role.key])
        continue
      }
      const taskBody = {
        orgUnitId: String(field(assignee, 'organizationId', 'organization_id')),
        assigneeAssignmentId: assigneeId,
        reviewerAssignmentId: reviewerId,
        standardVersionId: null,
        workRecordId: null,
        title: `[${runId}] ${role.key} closed-loop task`,
        description: 'Isolated UAT: acknowledge, submit, rework, resubmit and approve.',
        priority: 'NORMAL',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        sourceSnapshot: { source: 'ISOLATED_CLOSED_LOOP_UAT', runId, role: role.key, taskPolicy: { narrativeRequired: true, attachmentRequired: false, maxAttachments: 10 } },
        creatorAssignmentId: null,
        dispatchNow: true,
      }
      const taskKey = `cl-uat:${runId}:${role.key}:task:create`
      const created = await api('ceo', '/tasks', { method: 'POST', body: taskBody, key: taskKey, expected: [201] })
      const replay = await api('ceo', '/tasks', { method: 'POST', body: taskBody, key: taskKey, expected: [201] })
      const taskId = String(field(created.body, 'id'))
      if (!taskId || taskId !== String(field(replay.body, 'id'))) throw new Error(`Task idempotency replay failed for ${role.key}.`)

      const mine = asArray((await api(role.key, '/tasks?view=mine')).body)
      const notifications = asArray((await api(role.key, '/notifications?unreadOnly=false')).body)
      const taskVisible = mine.some((item) => String(field(item, 'id')) === taskId)
      const assignmentNotificationCount = notifications.filter((item) => String(field(item, 'source_id', 'sourceId')) === taskId && String(field(item, 'notification_type', 'notificationType')) === 'TASK_ASSIGNED').length
      const assignmentNotification = assignmentNotificationCount === 1
      if (!taskVisible || !assignmentNotification) throw new Error(`${role.key} did not receive exactly one task assignment notification.`)

      const createdVersion = Number(field(created.body, 'row_version', 'rowVersion'))
      const acknowledged = await api(role.key, `/tasks/${taskId}/actions/ACKNOWLEDGE`, {
        method: 'POST',
        key: `cl-uat:${runId}:${role.key}:task:ack`,
        body: { expectedVersion: createdVersion, actorAssignmentId: assigneeId, payload: { note: `${runId} acknowledged` } },
      })
      const acknowledgedVersion = Number(field(acknowledged.body, 'row_version', 'rowVersion'))
      const stale = await api(role.key, `/tasks/${taskId}/actions/SUBMIT_RESULT`, {
        method: 'POST',
        key: `cl-uat:${runId}:${role.key}:task:stale`,
        body: { expectedVersion: createdVersion, actorAssignmentId: assigneeId, payload: { result: { summary: 'stale write must fail' } } },
        expected: [409],
      })
      await api(role.key, `/tasks/${taskId}/evidence`, {
        method: 'POST',
        expected: [201],
        body: { submittedByAssignmentId: assigneeId, evidenceType: 'STRUCTURED', objectKey: null, originalName: null, mediaType: 'application/json', sizeBytes: 0, sha256: null, structuredResult: { runId, stage: 'FIRST_ATTEMPT' } },
      })
      const firstSubmit = await api(role.key, `/tasks/${taskId}/actions/SUBMIT_RESULT`, {
        method: 'POST',
        key: `cl-uat:${runId}:${role.key}:task:submit-1`,
        body: { expectedVersion: acknowledgedVersion, actorAssignmentId: assigneeId, payload: { result: { summary: `${runId} first result` } } },
      })
      const rework = await api(role.taskReviewer, `/tasks/${taskId}/actions/REWORK`, {
        method: 'POST',
        key: `cl-uat:${runId}:${role.key}:task:rework`,
        body: { expectedVersion: Number(field(firstSubmit.body, 'row_version', 'rowVersion')), actorAssignmentId: reviewerId, payload: { note: `${runId} rework requested` } },
      })
      const restarted = await api(role.key, `/tasks/${taskId}/actions/START`, {
        method: 'POST',
        key: `cl-uat:${runId}:${role.key}:task:restart`,
        body: { expectedVersion: Number(field(rework.body, 'row_version', 'rowVersion')), actorAssignmentId: assigneeId, payload: { note: `${runId} rework started` } },
      })
      const secondSubmit = await api(role.key, `/tasks/${taskId}/actions/SUBMIT_RESULT`, {
        method: 'POST',
        key: `cl-uat:${runId}:${role.key}:task:submit-2`,
        body: { expectedVersion: Number(field(restarted.body, 'row_version', 'rowVersion')), actorAssignmentId: assigneeId, payload: { result: { summary: `${runId} corrected result`, reworkCompleted: true } } },
      })
      const approved = await api(role.taskReviewer, `/tasks/${taskId}/actions/APPROVE`, {
        method: 'POST',
        key: `cl-uat:${runId}:${role.key}:task:approve`,
        body: { expectedVersion: Number(field(secondSubmit.body, 'row_version', 'rowVersion')), actorAssignmentId: reviewerId, payload: { note: `${runId} approved`, reviewMode: 'MANUAL_NO_STANDARD' } },
      })
      const timeline = asArray((await api(role.taskReviewer, `/tasks/${taskId}/timeline`)).body)
      const commandCounts = timeline.reduce((counts, item) => {
        const command = String(field(item, 'command')).toUpperCase()
        counts[command] = (counts[command] ?? 0) + 1
        return counts
      }, {})
      const expectedCommandCounts = { CREATE: 1, DISPATCH: 1, ACKNOWLEDGE: 1, SUBMIT_RESULT: 2, REWORK: 1, START: 1, APPROVE: 1 }
      const timelinePass = Object.entries(expectedCommandCounts).every(([command, count]) => commandCounts[command] === count)
      const completed = String(field(approved.body, 'lifecycle_status', 'lifecycleStatus')).toUpperCase() === 'COMPLETED'
      addCheck(`task_flow_${role.key}`, completed && timelinePass ? 'PASS' : 'FAIL', {
        taskId,
        reviewerRole: role.taskReviewer,
        idempotencyReplay: true,
        staleWriteStatus: stale.status,
        assignmentNotificationCount,
        lifecycleStatus: field(approved.body, 'lifecycle_status', 'lifecycleStatus'),
        timelineCommandCounts: commandCounts,
        expectedTimelineCommandCounts: expectedCommandCounts,
        auditBoundary: 'The task timeline proves transition persistence and idempotency. It is not a direct audit_log table verification.',
      })
      artifacts.tasks.push({ role: role.key, reviewerRole: role.taskReviewer, taskId })
    }

    const front = identities.get('front-desk')
    const frontAssignment = front.assignment
    const frontReviewer = identities.get('front-supervisor').assignment
    const forbiddenBody = {
      orgUnitId: field(frontAssignment, 'organizationId', 'organization_id'),
      assigneeAssignmentId: field(frontAssignment, 'id'),
      reviewerAssignmentId: field(frontReviewer, 'id'),
      title: `[${runId}] forbidden task create`,
      description: 'Must be rejected before mutation.',
      priority: 'NORMAL',
      sourceSnapshot: { source: 'ISOLATED_CLOSED_LOOP_FORBIDDEN_PROBE', runId },
      creatorAssignmentId: field(frontAssignment, 'id'),
      dispatchNow: false,
    }
    const forbiddenTask = await api('front-desk', '/tasks', { method: 'POST', body: forbiddenBody, key: `cl-uat:${runId}:forbidden:task`, expected: [403] })
    addCheck('front_task_create_forbidden', 'PASS', { expectedStatus: 403, actualStatus: forbiddenTask.status })

    const forbiddenTemplate = await api('front-desk', '/daily-report-templates', {
      method: 'POST',
      key: `cl-uat:${runId}:forbidden:template`,
      expected: [403],
      body: {
        code: `${runId}-FORBIDDEN`,
        name: 'Forbidden template probe',
        description: 'Must be rejected before mutation.',
        positionId: field(frontAssignment, 'positionId', 'position_id'),
        ownerOrgUnitId: field(frontAssignment, 'organizationId', 'organization_id'),
        templateOrigin: 'STORE',
      },
    })
    addCheck('front_template_create_forbidden', 'PASS', { expectedStatus: 403, actualStatus: forbiddenTemplate.status })
    addCheck('audit_log_table_verification', 'SKIPPED', {
      reason: 'No authorized read-only audit_log API is exposed. Task timeline evidence must not be represented as direct audit_log table verification.',
    })
  } catch (error) {
    addCheck('fatal_error', 'FAIL', { message: redact(error?.message ?? error) })
  } finally {
    for (const key of tokenMap.keys()) tokenMap.set(key, '[CLEARED]')
    if (target.tokenDocument?.tokens) {
      for (const key of Object.keys(target.tokenDocument.tokens)) target.tokenDocument.tokens[key] = '[CLEARED]'
    }
  }

  const hotelReportChecks = checks.filter((check) => check.name.startsWith('daily_report_') && check.result !== 'SKIPPED')
  const requiredTaskChecks = checks.filter((check) => check.name.startsWith('task_flow_') && check.result !== 'SKIPPED')
  const failed = checks.filter((check) => check.result === 'FAIL').length
  const blocked = checks.filter((check) => check.result === 'BLOCKED').length
  const capabilityMatrixPassed = failed === 0 && blocked === 0 && hotelReportChecks.length > 0 && hotelReportChecks.every((item) => item.result === 'PASS') && requiredTaskChecks.every((item) => item.result === 'PASS')
  const result = failed > 0 ? 'FAIL' : capabilityMatrixPassed ? 'CAPABILITY_PASS' : 'BLOCKED'
  const report = {
    schemaVersion: 1,
    version: 'V21-ISOLATED-EIGHT-ROLE-CAPABILITY-MATRIX',
    runId,
    generatedAt: new Date().toISOString(),
    target: {
      purpose: target.state.purpose,
      apiOrigin: target.api.origin,
      apiBasePath: target.api.pathname,
      databaseMarker: target.state.database,
      authenticationMode: target.state.authenticationMode,
      sharedPilotRejectedByPolicy: true,
    },
    mutationConfirmed: true,
    credentialsPersistedInEvidence: false,
    result,
    fullDailyOperationsClosedLoopResult: 'NOT_TESTED',
    summary: {
      roleCount: ROLE_MATRIX.length,
      passedChecks: checks.filter((item) => item.result === 'PASS').length,
      skippedChecks: checks.filter((item) => item.result === 'SKIPPED').length,
      blockedChecks: blocked,
      failedChecks: failed,
      taskFlowsPassed: requiredTaskChecks.filter((item) => item.result === 'PASS').length,
      taskFlowsRequired: requiredTaskChecks.length,
      hotelReportFlowsPassed: hotelReportChecks.filter((item) => item.result === 'PASS').length,
      hotelReportFlowsRequired: hotelReportChecks.length,
    },
    roleMatrix: ROLE_MATRIX.map((role) => ({
      roleKey: role.key,
      expectedRole: role.expectedRole,
      identity: checks.find((item) => item.name === `identity_${role.key}`)?.result ?? 'NOT_RUN',
      dailyReport: checks.find((item) => item.name === `daily_report_${role.key}`)?.result ?? 'NOT_RUN',
      task: checks.find((item) => item.name === `task_flow_${role.key}`)?.result ?? 'NOT_RUN',
    })),
    blockers,
    capabilityCoverage: {
      templatePublicationMakerChecker: publisherActors?.length >= 2 ? 'AVAILABLE_NOT_EXECUTED' : 'BLOCKED',
      hotelRoleDailyReportSubmission: hotelReportChecks.length > 0 && hotelReportChecks.every((item) => item.result === 'PASS') ? 'PASS' : 'BLOCKED',
      manualHotelTaskLifecycle: requiredTaskChecks.filter((item) => item.name !== 'task_flow_ota-assistant').every((item) => item.result === 'PASS') ? 'PASS' : 'BLOCKED',
      manualOtaTaskLifecycle: checks.find((item) => item.name === 'task_flow_ota-assistant')?.result ?? 'NOT_RUN',
      manualTaskLifecycleOverall: requiredTaskChecks.length > 0 && requiredTaskChecks.every((item) => item.result === 'PASS') ? 'PASS' : 'BLOCKED',
      dailyOperationAggregationAndSourceReferences: 'NOT_TESTED',
      aiRecommendationAnalysis: 'NOT_TESTED',
      supervisorConfirmationToTaskCandidate: 'NOT_TESTED',
      slaOverdueEscalationNotifications: 'NOT_TESTED',
      operationSnapshotAndExport: 'NOT_TESTED',
      auditLogTableVerification: 'NOT_TESTED_NO_API',
    },
    evidenceLimitations: [
      'This is a capability matrix, not a PASS claim for the full daily-operations main closed loop.',
      'CEO-created manual tasks do not prove AI recommendation, supervisor confirmation, or task-candidate promotion.',
      'Task timeline evidence is not direct audit_log table verification.',
      'SLA overdue escalation, operation snapshot, and export are outside this run.',
    ],
    checks,
    requestLog,
    artifacts: {
      ...artifacts,
      retentionNote: 'Artifacts exist only in the disposable UAT database and are removed when that database is reset or destroyed.',
    },
  }
  const reportPath = path.join(evidenceRoot, 'isolated-v21-eight-role-closed-loop.json')
  const markdownPath = path.join(evidenceRoot, 'isolated-v21-eight-role-closed-loop.md')
  const markdown = [
    `# ${report.version}`,
    '',
    `- RunId: \`${runId}\``,
    `- Result: **${report.result}**`,
    `- Target: \`${report.target.apiOrigin}${report.target.apiBasePath}\``,
    `- Database: \`${report.target.databaseMarker}\``,
    `- Credentials persisted: **NO**`,
    '',
    '| Role | Identity | Daily report | Task |',
    '|---|---:|---:|---:|',
    ...report.roleMatrix.map((row) => `| ${row.roleKey} | ${row.identity} | ${row.dailyReport} | ${row.task} |`),
    '',
    '## Capability coverage',
    '',
    ...Object.entries(report.capabilityCoverage).map(([name, status]) => `- ${name}: **${status}**`),
    `- fullDailyOperationsClosedLoop: **${report.fullDailyOperationsClosedLoopResult}**`,
    '',
    ...report.evidenceLimitations.map((item) => `- Limitation: ${item}`),
    '',
    '## Blockers',
    '',
    ...(blockers.length ? blockers.map((item) => `- **${item.code}**: ${item.message} (${item.roles.join(', ') || 'all'})`) : ['- None.']),
    '',
    '## Evidence boundary',
    '',
    '- The run is allowed only against a loopback API whose active state declares `purpose=ISOLATED_UAT` and a disposable database marker.',
    '- CEO and regional OTA identities are not given fabricated hotel assignments.',
    '- Tokens, passwords and authorization headers are never written to this report.',
    '- Generated artifacts remain in the disposable database; reset or destroy it after review.',
    '',
  ].join('\n')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(markdownPath, markdown, 'utf8')
  process.stdout.write(`${JSON.stringify({ result: report.result, reportPath, markdownPath, summary: report.summary })}\n`)
  if (report.result === 'FAIL') process.exitCode = 1
  else if (report.result === 'BLOCKED') process.exitCode = 2
}

const args = parseArgs(process.argv.slice(2))
if (args.selfTest) runSelfTest()
else await main(args)
