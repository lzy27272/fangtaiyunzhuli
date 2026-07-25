import { refreshSession } from './auth'
import { clearSession, getSession, setSession } from '../auth/session'

const API_BASE_URL = (import.meta.env.VITE_OTA_API_BASE_URL ?? '/api/v1').replace(/\/$/, '')

export interface AdapterSummary {
  code: string
  displayName: string
  sourceSystem: 'PMS' | 'CTRIP' | 'MEITUAN' | 'OFFICIAL_EXPORT'
  simulationOnly: boolean
  streams: string[]
}

export type ConnectorSourceCode = 'PMS' | 'CTRIP' | 'MEITUAN'

export type ConnectorConnectionMethod =
  | 'OFFICIAL_API'
  | 'READ_ONLY_DATABASE'
  | 'AUTOMATED_REPORT'
  | 'LOCAL_AGENT'
  | 'CONTROLLED_BROWSER'

export interface ConnectorOnboardingTemplate {
  templateCode: 'PMS_INTAKE' | 'CTRIP_INTAKE' | 'MEITUAN_INTAKE'
  displayName: string
  sourceCode: ConnectorSourceCode
  implementationStatus: 'DRAFT_INTAKE_ONLY'
  connectionMethods: ConnectorConnectionMethod[]
  allowedPollIntervalsMinutes: number[]
  acceptedFields: string[]
  executable: false
}

export interface ConnectorSecretBindingStatus {
  purpose: string
  providerCode: string
  configured: boolean
  status: 'NOT_CONFIGURED' | 'CONFIGURED' | 'ROTATION_REQUIRED' | 'REVOKED'
}

export interface ConnectorOnboardingView {
  connectorId: string
  templateCode: ConnectorOnboardingTemplate['templateCode']
  sourceCode: ConnectorSourceCode
  vendorCode: string
  vendorName: string
  productName: string
  productVersion: string
  connectionMethod: ConnectorConnectionMethod
  externalHotelCode: string
  accountAlias: string
  networkRouteCode: string
  pollIntervalMinutes: number
  lifecycle: 'DRAFT'
  readinessCode: 'DRAFT_INCOMPLETE' | 'CONFIGURATION_CAPTURED_RUNTIME_BLOCKED'
  runtimeBlocked: true
  blockers: string[]
  rowVersion: number
  secretBindings: ConnectorSecretBindingStatus[]
}

export type BrowserAuthorizationRehearsalStatus =
  | 'WAITING_FOR_OPERATOR'
  | 'OFFLINE_REHEARSAL_COMPLETE'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'FAILED'

export interface BrowserAuthorizationRehearsalView {
  tenantId: string
  hotelId: string
  connectorId: string
  connectorVersionId: string
  configVersion: number
  adapterCode: string
  adapterVersion: string
  authorizationAttemptId: string
  mode: 'OFFLINE_REHEARSAL'
  state: BrowserAuthorizationRehearsalStatus
  authorizationState: 'AUTH_REQUIRED'
  runtimeBlocked: true
  pmsConnected: false
  browserStarted: false
  credentialsRead: false
  requestedAt: string
  changedAt: string
  expiresAt: string
  terminalAt?: string | null
  rowVersion: number
  replayed: boolean
}

export interface ConnectorContractAdmissionView {
  tenantId: string
  hotelId: string
  connectorId: string
  connectorVersionId: string
  sourceCode: ConnectorSourceCode
  templateCode: ConnectorOnboardingTemplate['templateCode']
  adapterVersion: string
  admissionState: 'CANDIDATE_UNAVAILABLE'
  candidateAvailable: false
  approvalAvailable: false
  revocationAvailable: false
  runtimeBlocked: true
  admissionRowVersion: 0
  blockers: string[]
}

export interface ConnectorSecretBindingInput {
  purpose: string
  providerCode: string
  secretReference: string
  secretVersion: string
}

export interface ConnectorOnboardingInput {
  connectorId: string
  expectedRowVersion: number
  reasonCode: string
  templateCode: ConnectorOnboardingTemplate['templateCode']
  sourceCode: ConnectorSourceCode
  vendorCode: string
  vendorName: string
  productName: string
  productVersion: string
  connectionMethod: ConnectorConnectionMethod
  externalHotelCode: string
  accountAlias: string
  networkRouteCode: string
  pollIntervalMinutes: number
  secretBindings: ConnectorSecretBindingInput[]
}

export type ReportType =
  | 'ORDER_DETAIL'
  | 'ROOM_REVENUE'
  | 'PHYSICAL_INVENTORY'
  | 'OTA_PRODUCT_INVENTORY'
  | 'BUSINESS_DAY'
  | 'CUSTOM_REPORT'

export type CalculationRole =
  | 'PRIMARY_CALCULATION'
  | 'AUXILIARY_CALCULATION'

export interface ReportSourceView {
  sourceId: string
  displayName: string
  endpointUrl: string
  reportType: ReportType
  calculationRole: CalculationRole
  pollIntervalMinutes: number
  credentialAlias: string
  cookieConfigured: boolean
  cookieUpdatedAt: string | null
  enabled: boolean
  validationStatus: 'NOT_TESTED' | 'FORMAT_VALID'
  rowVersion: number
}

export type ReportSourceCookieUpdate =
  | { action: 'KEEP' }
  | { action: 'CLEAR' }
  | { action: 'REPLACE'; value: string }

export interface ReportSourceInput {
  sourceId: string
  displayName: string
  endpointUrl: string
  reportType: ReportType
  calculationRole: CalculationRole
  pollIntervalMinutes: number
  credentialAlias: string
  cookieUpdate: ReportSourceCookieUpdate
  enabled: boolean
  rowVersion: number
}

export interface SourceHealth {
  sourceCode: string
  completeness: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE'
  sourceObservedAt?: string
  ingestedAt?: string
}

export interface MetricValue {
  value?: string | number | null
  unit: string
  state: 'AVAILABLE' | 'NOT_APPLICABLE' | 'NOT_CONFIGURED' | 'UNAVAILABLE'
}

export interface InventoryLine {
  inventoryPoolId: string
  physicalRoomTypeCode: string
  displayName: string
  primaryAvailableRooms?: number | null
  otaAvailableRooms: Record<string, number>
  state: 'MATCHED' | 'P1_RISK' | 'UNAVAILABLE'
}

export interface MonitorView {
  tenantId: string
  hotelId: string
  hotelName: string
  businessDate?: string
  cutoffAt?: string
  completeness: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE'
  simulationMode: boolean
  sources: SourceHealth[]
  metrics: Record<string, MetricValue>
  inventory: InventoryLine[]
}

export interface BriefView {
  briefId: string
  businessDate: string
  cutoffAt: string
  revisionNo: number
  completenessCode: string
  content: string
  publishedAt: string
  simulationRunId: string
  deliveryStatus: string
  simulationMode: boolean
}

export interface IncidentView {
  incidentId: string
  type: string
  status: string
  sourceCode?: string
  directionCode?: string
  openedAt: string
  lastObservedAt: string
  taskId?: string
}

export interface OutboxPreview {
  eventId: string
  messageKey: string
  messageType: string
  createdAt: string
  deliveryBlocked: boolean
  deliveryStatus: string
  bodyPreview: string
}

export interface TenantView {
  tenantId: string
  tenantCode: string
  displayName: string
  timezone: string
  status: string
  rowVersion: number
}

export interface HotelView {
  tenantId: string
  hotelId: string
  hotelCode: string
  displayName: string
  timezone: string
  lifecycleStatus: string
  collectionEnabled: boolean
  messageEnabled: false
  rowVersion: number
}

export interface ConnectorView {
  connectorId: string
  adapterCode: string
  sourceCode: string
  enabled: boolean
  fixtureScenarioCode: string
  pollIntervalMinutes: number
  rowVersion: number
  secret: {
    referenceConfigured: boolean
    referenceFingerprint?: string
    authorizationStatus?: string
    lastCheckedAt?: string
  }
}

export interface InventoryPoolView {
  inventoryPoolId: string
  physicalRoomTypeCode: string
  displayName: string
  physicalRoomCount: number
  rowVersion: number
}

export interface SellableProductView {
  productId: string
  connectorId: string
  sourceCode: string
  externalProductCode: string
  displayName: string
  mealPlanCode: 'ROOM_ONLY' | 'BREAKFAST_INCLUDED'
  rowVersion: number
}

export interface ProductMappingView {
  mappingVersionId: string
  productId: string
  inventoryPoolId: string
  validFrom: string
  validUntil?: string
  rowVersion: number
}

export interface RevenueTargetView {
  targetVersionId: string
  businessDate: string
  roomRevenueTarget: string
  targetAdr: string
  rowVersion: number
}

export interface PaceCurveView {
  paceCurveVersionId: string
  curveCode: string
  validFrom: string
  validUntil?: string
  points: Array<{
    cutoffLocalTime: string
    revenueProgressPercent: string
    soldProgressPercent: string
  }>
  rowVersion: number
}

export interface SimulationConfiguration {
  tenant: TenantView
  hotel: HotelView
  connectors: ConnectorView[]
  inventoryPools: InventoryPoolView[]
  products: SellableProductView[]
  productMappings: ProductMappingView[]
  targets: RevenueTargetView[]
  paceCurves: PaceCurveView[]
  simulationMode: boolean
  outboundDeliveryBlocked: boolean
}

export interface SimulationRunView {
  runId: string
  scenarioCode: string
  status: 'REQUESTED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  fixedClockAt: string
  scheduledFor: string
  startedAt?: string
  completedAt?: string
  briefId?: string
  incidentIds?: string[]
  rowVersion: number
}

export interface SimulationHotelView {
  tenantId: string
  hotelId: string
  tenantCode: string
  tenantName: string
  hotelCode: string
  hotelName: string
  timezone: string
  lifecycleStatus: string
  collectionEnabled: boolean
  messageEnabled: false
  configuredMockConnectors: number
  simulationOnly: boolean
  rowVersion: number
}

export interface SimulationHotelDirectory {
  coverage: string
  hotels: SimulationHotelView[]
  failedTenantIds: string[]
}

export interface CommandReceipt {
  commandId: string
  resourceId: string
  resultingRowVersion: number
  replayed: boolean
}

export interface HotelContext {
  tenantId: string
  hotelId: string
}

function scopedPath(context: HotelContext, suffix: string): string {
  const tenantId = encodeURIComponent(context.tenantId)
  const hotelId = encodeURIComponent(context.hotelId)
  return `/ota/tenants/${tenantId}/hotels/${hotelId}${suffix}`
}

function requestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `web-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function parseFailure(response: Response): Promise<string> {
  try {
    const body = await response.json() as { detail?: string; title?: string; code?: string }
    return body.detail ?? body.title ?? body.code ?? `请求失败（${response.status}）`
  } catch {
    return `请求失败（${response.status}）`
  }
}

async function authenticatedRequest<T>(
  path: string,
  init: RequestInit = {},
  allowRefresh = true,
): Promise<T> {
  const session = getSession()
  if (!session) throw new Error('会话已失效，请重新登录')

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
      'X-Correlation-ID': requestId(),
      ...init.headers,
    },
  })

  if (response.status === 401 && allowRefresh) {
    try {
      const refreshed = await refreshSession()
      setSession(refreshed)
      return authenticatedRequest<T>(path, init, false)
    } catch (cause) {
      clearSession()
      throw cause
    }
  }
  if (!response.ok) throw new Error(await parseFailure(response))
  if (response.status === 204) return undefined as T
  const body = await response.json() as { data?: T }
  if (!Object.prototype.hasOwnProperty.call(body, 'data')) {
    throw new Error('服务响应缺少data字段')
  }
  return body.data as T
}

function writeHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'Idempotency-Key': requestId(),
  }
}

export function listAdapters(): Promise<AdapterSummary[]> {
  return authenticatedRequest('/ota/connector-adapters')
}

export function listConnectorOnboardingTemplates(): Promise<ConnectorOnboardingTemplate[]> {
  return authenticatedRequest('/ota/connector-onboarding/templates')
}

export function loadConnectorOnboarding(
  context: HotelContext,
): Promise<ConnectorOnboardingView[]> {
  return authenticatedRequest(scopedPath(context, '/connector-onboarding'))
}

export function loadConnectorContractAdmissions(
  context: HotelContext,
): Promise<ConnectorContractAdmissionView[]> {
  return authenticatedRequest(
    scopedPath(context, '/connector-contract-admissions'),
  )
}

export function upsertConnectorOnboarding(
  context: HotelContext,
  input: ConnectorOnboardingInput,
): Promise<CommandReceipt> {
  const { connectorId, ...body } = input
  return postCommand(
    scopedPath(
      context,
      `/connector-onboarding/${encodeURIComponent(connectorId)}`,
    ),
    body,
  )
}

function browserAuthorizationAttemptPath(
  context: HotelContext,
  connectorId: string,
  authorizationAttemptId?: string,
  action?: 'confirm' | 'cancel' | 'reauthenticate',
): string {
  const attemptSuffix = authorizationAttemptId
    ? `/${encodeURIComponent(authorizationAttemptId)}`
    : ''
  const actionSuffix = action ? `/${action}` : ''
  return scopedPath(
    context,
    `/connector-onboarding/${encodeURIComponent(connectorId)}`
      + `/browser-authorization-attempts${attemptSuffix}${actionSuffix}`,
  )
}

function requireOfflineRehearsalBoundary(
  view: BrowserAuthorizationRehearsalView,
): BrowserAuthorizationRehearsalView {
  const allowedStates: BrowserAuthorizationRehearsalStatus[] = [
    'WAITING_FOR_OPERATOR',
    'OFFLINE_REHEARSAL_COMPLETE',
    'CANCELLED',
    'EXPIRED',
    'FAILED',
  ]
  if (
    view.mode !== 'OFFLINE_REHEARSAL'
    || !allowedStates.includes(view.state)
    || view.authorizationState !== 'AUTH_REQUIRED'
    || view.runtimeBlocked !== true
    || view.pmsConnected !== false
    || view.browserStarted !== false
    || view.credentialsRead !== false
  ) {
    throw new Error('离线授权演练响应违反安全边界，已拒绝展示')
  }
  return view
}

export function startBrowserAuthorizationRehearsal(
  context: HotelContext,
  connectorId: string,
  expectedConfigVersion: number,
  reasonCode: string,
): Promise<BrowserAuthorizationRehearsalView> {
  return postCommand<BrowserAuthorizationRehearsalView>(
    browserAuthorizationAttemptPath(context, connectorId),
    { expectedConfigVersion, reasonCode },
  ).then(requireOfflineRehearsalBoundary)
}

export function loadLatestBrowserAuthorizationRehearsal(
  context: HotelContext,
  connectorId: string,
): Promise<BrowserAuthorizationRehearsalView | null> {
  return authenticatedRequest<BrowserAuthorizationRehearsalView | null>(
    browserAuthorizationAttemptPath(context, connectorId),
  ).then((view) => view === null
    ? null
    : requireOfflineRehearsalBoundary(view))
}

export function loadBrowserAuthorizationRehearsal(
  context: HotelContext,
  connectorId: string,
  authorizationAttemptId: string,
): Promise<BrowserAuthorizationRehearsalView> {
  return authenticatedRequest<BrowserAuthorizationRehearsalView>(
    browserAuthorizationAttemptPath(
      context,
      connectorId,
      authorizationAttemptId,
    ),
  ).then(requireOfflineRehearsalBoundary)
}

function transitionBrowserAuthorizationRehearsal(
  context: HotelContext,
  connectorId: string,
  authorizationAttemptId: string,
  action: 'confirm' | 'cancel' | 'reauthenticate',
  expectedRowVersion: number,
  reasonCode: string,
): Promise<BrowserAuthorizationRehearsalView> {
  return postCommand<BrowserAuthorizationRehearsalView>(
    browserAuthorizationAttemptPath(
      context,
      connectorId,
      authorizationAttemptId,
      action,
    ),
    { expectedRowVersion, reasonCode },
  ).then(requireOfflineRehearsalBoundary)
}

export function confirmBrowserAuthorizationRehearsal(
  context: HotelContext,
  connectorId: string,
  authorizationAttemptId: string,
  expectedRowVersion: number,
  reasonCode: string,
): Promise<BrowserAuthorizationRehearsalView> {
  return transitionBrowserAuthorizationRehearsal(
    context,
    connectorId,
    authorizationAttemptId,
    'confirm',
    expectedRowVersion,
    reasonCode,
  )
}

export function cancelBrowserAuthorizationRehearsal(
  context: HotelContext,
  connectorId: string,
  authorizationAttemptId: string,
  expectedRowVersion: number,
  reasonCode: string,
): Promise<BrowserAuthorizationRehearsalView> {
  return transitionBrowserAuthorizationRehearsal(
    context,
    connectorId,
    authorizationAttemptId,
    'cancel',
    expectedRowVersion,
    reasonCode,
  )
}

export function reauthenticateBrowserAuthorizationRehearsal(
  context: HotelContext,
  connectorId: string,
  authorizationAttemptId: string,
  expectedRowVersion: number,
  reasonCode: string,
): Promise<BrowserAuthorizationRehearsalView> {
  return transitionBrowserAuthorizationRehearsal(
    context,
    connectorId,
    authorizationAttemptId,
    'reauthenticate',
    expectedRowVersion,
    reasonCode,
  )
}

export function loadConfiguration(context: HotelContext): Promise<SimulationConfiguration> {
  return authenticatedRequest(scopedPath(context, '/configuration'))
}

export function loadReportSources(
  context: HotelContext,
): Promise<ReportSourceView[]> {
  return authenticatedRequest(scopedPath(context, '/report-sources'))
}

export function saveReportSources(
  context: HotelContext,
  sources: ReportSourceInput[],
  reasonCode: string,
): Promise<CommandReceipt> {
  return postCommand(scopedPath(context, '/report-sources'), {
    sources,
    reasonCode,
  })
}

function postCommand<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  return authenticatedRequest(path, {
    method: 'POST',
    headers: writeHeaders(),
    body: JSON.stringify(body),
  })
}

export function updateHotel(
  context: HotelContext,
  hotel: HotelView,
  reasonCode: string,
): Promise<CommandReceipt> {
  return postCommand(scopedPath(context, '/configuration/hotel'), {
    expectedRowVersion: hotel.rowVersion,
    reasonCode,
    hotelCode: hotel.hotelCode,
    displayName: hotel.displayName,
    timezone: hotel.timezone,
    lifecycleStatus: hotel.lifecycleStatus,
    collectionEnabled: hotel.collectionEnabled,
    messageEnabled: false,
  })
}

export function upsertConnector(
  context: HotelContext,
  connector: Omit<ConnectorView, 'secret'>,
  reasonCode: string,
): Promise<CommandReceipt> {
  return postCommand(scopedPath(context, `/configuration/connectors/${encodeURIComponent(connector.connectorId)}`), {
    expectedRowVersion: connector.rowVersion,
    reasonCode,
    adapterCode: connector.adapterCode,
    sourceCode: connector.sourceCode,
    enabled: connector.enabled,
    fixtureScenarioCode: connector.fixtureScenarioCode,
    pollIntervalMinutes: connector.pollIntervalMinutes,
  })
}

export function upsertInventoryPool(
  context: HotelContext,
  pool: InventoryPoolView,
  reasonCode: string,
): Promise<CommandReceipt> {
  return postCommand(scopedPath(context, `/configuration/inventory-pools/${encodeURIComponent(pool.inventoryPoolId)}`), {
    expectedRowVersion: pool.rowVersion,
    reasonCode,
    physicalRoomTypeCode: pool.physicalRoomTypeCode,
    displayName: pool.displayName,
    physicalRoomCount: pool.physicalRoomCount,
  })
}

export function upsertProduct(
  context: HotelContext,
  product: SellableProductView,
  reasonCode: string,
): Promise<CommandReceipt> {
  return postCommand(scopedPath(context, `/configuration/products/${encodeURIComponent(product.productId)}`), {
    expectedRowVersion: product.rowVersion,
    reasonCode,
    connectorId: product.connectorId,
    sourceCode: product.sourceCode,
    externalProductCode: product.externalProductCode,
    displayName: product.displayName,
    mealPlanCode: product.mealPlanCode,
  })
}

export function upsertProductMapping(
  context: HotelContext,
  mapping: ProductMappingView,
  reasonCode: string,
): Promise<CommandReceipt> {
  return postCommand(scopedPath(context, `/configuration/product-mappings/${encodeURIComponent(mapping.mappingVersionId)}`), {
    expectedRowVersion: mapping.rowVersion,
    reasonCode,
    productId: mapping.productId,
    inventoryPoolId: mapping.inventoryPoolId,
  })
}

export function upsertRevenueTarget(
  context: HotelContext,
  target: RevenueTargetView,
  reasonCode: string,
): Promise<CommandReceipt> {
  return postCommand(scopedPath(context, `/configuration/targets/${encodeURIComponent(target.targetVersionId)}`), {
    expectedRowVersion: target.rowVersion,
    reasonCode,
    businessDate: target.businessDate,
    roomRevenueTarget: target.roomRevenueTarget,
    targetAdr: target.targetAdr,
  })
}

export function upsertPaceCurve(
  context: HotelContext,
  curve: PaceCurveView,
  reasonCode: string,
): Promise<CommandReceipt> {
  return postCommand(scopedPath(context, `/configuration/pace-curves/${encodeURIComponent(curve.paceCurveVersionId)}`), {
    expectedRowVersion: curve.rowVersion,
    reasonCode,
    curveCode: curve.curveCode,
    validFrom: curve.validFrom,
    validUntil: curve.validUntil,
    points: curve.points,
  })
}

export function listSimulationHotels(): Promise<SimulationHotelDirectory> {
  return authenticatedRequest('/ota/simulation/hotels')
}

export function initializeSimulationHotel(input: {
  tenantCode: string
  tenantDisplayName: string
  hotelCode: string
  hotelDisplayName: string
  timezone: string
  reasonCode: string
}): Promise<CommandReceipt> {
  return postCommand('/ota/simulation/hotels', {
    ...input,
    expectedRowVersion: 0,
  })
}

export function loadMonitor(context: HotelContext): Promise<MonitorView> {
  return authenticatedRequest(scopedPath(context, '/monitor'))
}

export function loadBriefs(context: HotelContext): Promise<BriefView[]> {
  return authenticatedRequest(scopedPath(context, '/briefs'))
}

export function loadIncidents(context: HotelContext): Promise<IncidentView[]> {
  return authenticatedRequest(scopedPath(context, '/incidents'))
}

export function loadOutboxPreview(context: HotelContext): Promise<OutboxPreview[]> {
  return authenticatedRequest(scopedPath(context, '/outbox-preview'))
}

export function triggerSimulationRun(
  context: HotelContext,
  scenarioCode: 'BASELINE' | 'INVENTORY_MISMATCH' | 'SOURCE_UNAVAILABLE' | 'LATE_BRIEF_REPLAY',
): Promise<SimulationRunView> {
  return postCommand<CommandReceipt>(scopedPath(context, '/simulation-runs'), {
    scenarioCode,
    expectedRowVersion: 0,
    reasonCode: 'RUN_SPRINT1_SIMULATION',
  }).then((receipt) => authenticatedRequest(
    scopedPath(context, `/simulation-runs/${encodeURIComponent(receipt.resourceId)}`),
  ))
}
