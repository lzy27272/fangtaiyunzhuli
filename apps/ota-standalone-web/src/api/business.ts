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
  requestPayloadJson: string
  cookieConfigured: boolean
  cookieUpdatedAt: string | null
  definitionLocked: boolean
  definitionTemplateHotelCode: string
  enabledToggleOnly: boolean
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
  requestPayloadJson: string
  cookieUpdate: ReportSourceCookieUpdate
  enabled: boolean
  rowVersion: number
}

export interface PmsLoginConfigView {
  configured: boolean
  updatedAt: string | null
  loginMode: 'CONTROLLED_BROWSER' | 'STORE_TRUSTED_DEVICE'
  loginExecutionEnabled: boolean
}

export type PmsLoginCredentialUpdate =
  | { action: 'KEEP' }
  | { action: 'CLEAR' }
  | { action: 'REPLACE'; username: string; password: string }

export interface PmsCookieValidationView {
  status: 'SUCCEEDED'
  validatedAt: string
  businessDate: string
  sourceCount: number
  successfulSourceCount: number
  replacedSourceCount: number
  outboundDeliveryAttempted: false
}

export interface LuopanBrowserConfigView {
  providerCode: 'LUOPAN_CLOUD'
  portalUrl: string
  enabled: boolean
  profileRef: string
  hotelFingerprintConfigured: boolean
  scopeStatus: 'NOT_VALIDATED' | 'SINGLE_HOTEL_CONFIRMED'
  pollIntervalMinutes: 30
  lastValidatedAt: string | null
  lastBusinessDate: string | null
  lastCollectionStatus: 'NEVER' | 'COMPLETE' | 'PARTIAL' | 'FAILED'
  lastCollectionAt: string | null
  lastErrorCode: string | null
  loginMode: 'CONTROLLED_BROWSER_MANUAL_SESSION'
  automaticCredentialLoginEnabled: false
  rowVersion: number
}

export interface LuopanBrowserRepairView {
  providerCode: 'LUOPAN_CLOUD'
  portalUrl: string
  enabled: boolean
  profileConfigured: boolean
  scopeStatus: 'NOT_VALIDATED' | 'SINGLE_HOTEL_CONFIRMED'
  lastValidatedAt: string | null
  lastBusinessDate: string | null
  lastCollectionStatus: 'NEVER' | 'COMPLETE' | 'PARTIAL' | 'FAILED'
  lastCollectionAt: string | null
  lastErrorCode: string | null
}

export type OtaPlatformCode =
  | 'CTRIP'
  | 'MEITUAN'
  | 'FLIGGY'
  | 'DOUYIN'
  | 'QUNAR'
  | 'TONGCHENG'
  | 'OTHER'

export type OtaPeerRankMetricCode =
  | 'OVERALL'
  | 'ORDER_COUNT'
  | 'REVIEW_SCORE'
  | 'STAY_ROOM_NIGHTS'
  | 'ROOM_REVENUE'
  | 'SOLD_ROOM_NIGHTS'
  | 'GMV'
  | 'EXPOSURE'
  | 'VIEWS'
  | 'VIEW_CONVERSION'
  | 'PAYMENT_CONVERSION'

export interface OtaPeerRankMetric {
  code: OtaPeerRankMetricCode
  rank: number | null
}

export interface OtaPeerRankingSummary {
  provider: 'MEITUAN' | 'FLIGGY'
  metrics: OtaPeerRankMetric[]
}

export interface OtaReviewMetricsSummary {
  provider: 'MEITUAN' | 'DOUYIN' | 'FLIGGY'
  metricBasis?:
    | 'MEITUAN_STAR_THRESHOLDS'
    | 'DOUYIN_NATIVE_ATTITUDE'
    | 'FLIGGY_STAR_THRESHOLDS'
  businessDate: string
  businessDateBasis: 'PMS_CONFIRMED' | 'SYSTEM_DATE_FALLBACK'
  previousBusinessDate: string
  monthStart: string
  monthlyGoodCount: number
  monthlyNegativeCount: number
  yesterdayNegativeCount: number
  goodCountThroughPreviousBusinessDate: number
  negativeCountThroughPreviousBusinessDate: number
  validStayedOrderCountThroughPreviousBusinessDate: number | null
  eligibleOtaOrderCountThroughPreviousBusinessDate?: number | null
  goodRatePercent: number | null
  negativeRatePermille: number | null
  denominatorSource?: 'MATCHED_OTA_ORDER_SOURCE'
  denominatorStatus:
    | 'PMS_VALID_STAYED_ORDER_COUNT_UNAVAILABLE'
    | 'AVAILABLE'
    | 'ZERO_DENOMINATOR'
    | 'ORDER_SOURCE_MISSING'
    | 'ORDER_DATA_INCOMPLETE'
    | 'REVIEW_SCORE_METRICS_UNAVAILABLE'
    | 'PERIOD_MISMATCH'
  totalAllTime: number | null
  fetchedRowCount: number
  fetchedPageCount: number
  paginationComplete: boolean
  aggregationVersion?: number
}

export interface OtaProviderDatasetSummary {
  provider: 'MEITUAN' | 'DOUYIN' | 'FLIGGY'
  dataset: 'ORDER' | 'REVIEW'
  scope: 'BUSINESS_MONTH_TO_DATE' | 'ENDPOINT_TOTAL_AND_CURRENT_PAGE'
  periodBasis?:
    | 'THROUGH_PREVIOUS_BUSINESS_DATE'
    | 'THROUGH_CURRENT_BUSINESS_DATE'
  rangeStart?: string
  rangeEnd?: string
  totalCount: number | null
  returnedCount: number
  canceledCount?: number
  nonCanceledCount?: number
  hasMore?: boolean
  duplicateCount?: number
  aggregationVersion?: number
  safeDiagnosticsVersion?: number
  scoreFieldProfiles?: Array<{
    fieldPath: string
    observedCount: number
    distinctValues: number[]
  }>
  paginationFieldTypes?: Record<string, string>
  fetchedPageCount?: number
  paginationComplete?: boolean
  oldestObservedDate?: string | null
  attitudeCounts?: Record<string, number>
  monthlyAttitudeCounts?: Record<string, number>
  throughPreviousBusinessDateAttitudeCounts?: Record<string, number>
  yesterdayAttitudeCounts?: Record<string, number>
  schemaDiagnosticsVersion?: number
  identityFieldProfiles?: Array<{
    fieldPath: string
    observedCount: number
    distinctCount: number
  }>
  dateFieldProfiles?: Array<{
    fieldPath: string
    observedCount: number
    earliestDate: string
    latestDate: string
  }>
  classificationMetadata?: Array<{
    fieldPath: string
    value: string
  }>
  classificationFieldProfiles?: Array<{
    attitude: number
    fieldPath: string
    value: string
    count: number
  }>
  attitudeSignalProfiles?: Array<{
    attitude: number
    count: number
    scoreTagSubTypes: Record<string, number>
    reviewSources: Record<string, number>
    complainStatuses: Record<string, number>
  }>
}

export interface OtaReviewOrderPairingSummary {
  provider: 'MEITUAN' | 'DOUYIN' | 'FLIGGY'
  orderSourceId: string | null
  orderCountDefinition: 'NON_CANCELED_OTA_ORDERS'
  periodStart: string | null
  periodEnd: string | null
  denominatorCount: number | null
  orderDataComplete: boolean
  scoreMetricsAvailable: boolean
  status:
    | 'AVAILABLE'
    | 'ZERO_DENOMINATOR'
    | 'ORDER_SOURCE_MISSING'
    | 'ORDER_DATA_INCOMPLETE'
    | 'REVIEW_SCORE_METRICS_UNAVAILABLE'
    | 'PERIOD_MISMATCH'
}

export interface OtaRefreshSummary {
  observedAt: string
  httpStatus: number
  rootType: string
  recordPath: string | null
  recordCount: number
  detectedDimensions: string[]
  detectedFields: string[]
  peerRanking?: OtaPeerRankingSummary
  reviewMetrics?: OtaReviewMetricsSummary
  providerDataset?: OtaProviderDatasetSummary
  reviewOrderPairing?: OtaReviewOrderPairingSummary
}

export interface OtaSourceView {
  sourceId: string
  displayName: string
  platformCode: OtaPlatformCode
  portalUrl: string
  dataEndpointUrl: string
  requestMethod: 'GET' | 'POST'
  requestPayloadJson: string
  pollIntervalMinutes: number
  enabled: boolean
  cookieConfigured: boolean
  cookieUpdatedAt: string | null
  credentialsConfigured: boolean
  credentialsUpdatedAt: string | null
  loginMode:
    | 'CONTROLLED_LOGIN_PENDING'
    | 'CONTROLLED_BROWSER_CREDENTIALS'
  loginExecutionEnabled: boolean
  autoLoginEnabled?: boolean
  lastLoginStatus?: OtaControlledLoginStatus
  lastLoginAttemptAt?: string | null
  lastLoginAt?: string | null
  lastLoginErrorCode?: string | null
  lastRefreshStatus: 'NEVER' | 'COMPLETE' | 'FAILED'
  lastRefreshAt: string | null
  lastErrorCode: string | null
  lastSummary: OtaRefreshSummary | null
  rowVersion: number
}

export type OtaControlledLoginStatus =
  | 'NEVER'
  | 'RUNNING'
  | 'AUTHENTICATED'
  | 'VERIFICATION_REQUIRED'
  | 'EXTERNAL_VERIFICATION_REQUIRED'
  | 'FAILED'
  | 'RATE_LIMITED'

export interface OtaControlledLoginProfile {
  platformCode: 'FLIGGY'
  loginMode: 'CONTROLLED_BROWSER_CREDENTIALS'
  supported: true
  credentialSourceCount: number
  credentialsConfigured: boolean
  sessionSourceCount: number
  sessionConfigured: boolean
  autoRenewEnabled: boolean
  status: OtaControlledLoginStatus
  lastAttemptAt: string | null
  lastAuthenticatedAt: string | null
  lastErrorCode: string | null
  nextAttemptAt: string | null
  attemptCount: number
  maxAttempts: number
  challengeActive: boolean
}

export interface OtaControlledLoginResult {
  profile: OtaControlledLoginProfile | null
  status:
    | 'AUTHENTICATED'
    | 'VERIFICATION_REQUIRED'
    | 'EXTERNAL_VERIFICATION_REQUIRED'
    | 'FAILED'
  reasonCode: string | null
  attemptId: string | null
  challengeType: 'CODE' | 'IMAGE_CODE' | 'SLIDER' | 'QR' | null
  captchaImageDataUrl: string | null
  refreshedSources: OtaSourceView[]
}

export type OtaCookieUpdate =
  | { action: 'KEEP' }
  | { action: 'CLEAR' }
  | { action: 'REPLACE'; value: string }

export type OtaCredentialUpdate =
  | { action: 'KEEP' }
  | { action: 'CLEAR' }
  | { action: 'REPLACE'; account: string; password: string }

export interface OtaSourceInput {
  sourceId: string
  displayName: string
  platformCode: OtaPlatformCode
  portalUrl: string
  dataEndpointUrl: string
  requestMethod: 'GET' | 'POST'
  requestPayloadJson: string
  pollIntervalMinutes: number
  enabled: boolean
  cookieUpdate: OtaCookieUpdate
  credentialUpdate: OtaCredentialUpdate
  rowVersion: number
}

export interface SourceHealth {
  sourceId: string
  sourceCode: string
  reportType: ReportType
  completeness: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE'
  sourceObservedAt?: string
  ingestedAt?: string
  errorCode?: string | null
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
  hotSelling?: boolean
  hotSellingAlertState?: 'SOLD_OUT' | 'AVAILABLE' | 'UNAVAILABLE' | null
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
  hotSellingAlerts?: Array<{
    physicalRoomTypeCode: string
    displayName: string
    availableRooms: number | null
    state: 'SOLD_OUT' | 'AVAILABLE' | 'UNAVAILABLE'
    shouldNotify: boolean
    message: string
  }>
  businessDateBasis?: 'PMS_CONFIRMED' | 'CALENDAR_FALLBACK'
  revenueSemantics?: 'REPORT_ESTIMATED_ROOM_FEE'
  collectionRunId?: string
  hourlyDelta?: {
    basis: 'HOURLY_SNAPSHOT_DIFF' | 'BASELINE_PENDING'
    aggregationWindow: 'HOURLY' | 'PAUSE_TO_FIRST_BRIEF' | null
    intervalStartAt: string | null
    intervalEndAt: string | null
    totals: {
      newRoomNights: number
      todayRoomNights: number
      futureRoomNights: number
      canceledRoomNights: number
    } | null
    byChannel: Record<string, {
      newRoomNights: number
      todayRoomNights: number
      futureRoomNights: number
      canceledRoomNights: number
    }> | null
    metricDelta: {
      roomFee: number | null
      adr: number | null
      revPar: number | null
      roomNights: number | null
    } | null
  }
}

export interface LiveCollectionRunView {
  runId: string
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED'
  requestedAt: string
  completedAt: string
  businessDate: string
  sourceCount: number
  successfulSourceCount: number
  outboundDeliveryAttempted: false
  monitor: MonitorView
  otaRefreshes?: OtaSourceView[]
}

export interface BusinessDayControlView {
  businessDate: string | null
  mode: 'PMS_CONFIRMED' | 'UNCONFIRMED'
  source?: 'PMS_NIGHT_AUDIT_API' | 'LUOPAN_CLOUD' | 'MANUAL_SEED' | null
  businessDateStartedAt?: string | null
  updatedAt: string | null
}

export interface HotSellingRoomTypeConfigView {
  roomTypeCodes: string[]
  rowVersion: number
  updatedAt: string | null
}

export interface ObservedOtaRoomTypeView {
  roomTypeCode: string
  displayName: string
}

export interface RoomTypeCatalogSourceView {
  sourceId: string
  displayName: string
  platformCode: OtaPlatformCode
  observedAt: string | null
  refreshStatus: 'NEVER' | 'COMPLETE' | 'FAILED'
  roomTypes: ObservedOtaRoomTypeView[]
}

export interface PmsRoomTypeCatalogItemView {
  physicalRoomTypeCode: string
  displayName: string
  primaryAvailableRooms: number | null
}

export interface RoomTypeMappingView {
  physicalRoomTypeCode: string
  sourceId: string
  platformCode: OtaPlatformCode
  otaRoomTypeCode: string
  otaRoomTypeName: string
  matchMethod: 'AUTO_NAME' | 'MANUAL'
}

export interface RoomTypeConfigurationView {
  rowVersion: number
  updatedAt: string | null
  pmsObservedAt: string | null
  pmsRoomTypes: PmsRoomTypeCatalogItemView[]
  otaSources: RoomTypeCatalogSourceView[]
  mappings: RoomTypeMappingView[]
  hotSellingRoomTypeCodes: string[]
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

export interface WeComDeliveryView {
  deliveryId: string
  messageKey: string
  deliveryType: string
  hotelId: string
  businessDate: string
  cutoffAt: string
  attemptedAt: string
  completedAt: string | null
  deliveryStatus: 'SENDING' | 'DELIVERED' | 'REJECTED' | 'AMBIGUOUS'
  reasonCode: string
  endpointSha256: string
  messageSha256: string
  httpStatus: number | null
  weComCode: number | null
  automaticRetryAttempted: false
  partCount?: number
  deliveredPartCount?: number
  parts?: Array<{
    partNo: number
    messageSha256: string
    deliveryStatus: 'DELIVERED' | 'REJECTED' | 'AMBIGUOUS'
    reasonCode: string
    httpStatus: number | null
    weComCode: number | null
  }>
  bodyPreview: string
}

export interface WeComTestSuiteTemplateResult {
  templateCode: string
  reasonCode: string
}

export interface WeComTestSuiteView {
  collectionRun: LiveCollectionRunView
  requestedTemplateCount: number
  deliveries: WeComDeliveryView[]
  skippedTemplates: WeComTestSuiteTemplateResult[]
  failedTemplates: WeComTestSuiteTemplateResult[]
}

export interface WeComManualReplayDeliveryView {
  deliveryType: string
  deliveryStatus: WeComDeliveryView['deliveryStatus']
  reasonCode: string
  attemptedAt?: string | null
  completedAt?: string | null
  partCount: number
  deliveredPartCount: number
}

export interface WeComManualReplayView {
  operationKey: string
  collectionRunId: string
  cutoffAt: string
  replayed: boolean
  overallStatus: 'COMPLETE' | 'PARTIAL'
  deliveries: WeComManualReplayDeliveryView[]
  skippedTemplates: WeComTestSuiteTemplateResult[]
  failedTemplates: WeComTestSuiteTemplateResult[]
}

export interface WeComConfigView {
  enabled: boolean
  sendMinute: 6
  futureBriefSendMinute: 8
  hotSellingSoldOutAlertSendMinute: 9
  deliveryMode: 'UAT_SANITIZED_AT_ALL'
  webhookConfigured: boolean
  endpointSha256: string | null
  updatedAt: string | null
  lastDelivery: WeComDeliveryView | null
}

export interface WeComRepairBotConfigView {
  enabled: boolean
  credentialConfigured: boolean
  paired: boolean
  pairedUserCount: number
  pairedUserCapacity: 2
  hotelPairedUserCount: number
  hotelBindings: Array<{
    hotelId: string
    hotelCode: string
    displayName: string
    pairedUserCount: number
    pairedUserCapacity: number
    userFingerprints: string[]
  }>
  botIdFingerprint: string | null
  allowedUserFingerprint: string | null
  allowedUserFingerprints: string[]
  updatedAt: string | null
  connectionStatus:
    | 'DISABLED'
    | 'STARTING'
    | 'NOT_CONFIGURED'
    | 'CONNECTING'
    | 'AUTHENTICATED'
    | 'DISCONNECTED'
    | 'ERROR'
  connected: boolean
  lastAuthenticatedAt: string | null
  lastDisconnectedAt: string | null
  lastErrorCode: string | null
  pairing: {
    active: boolean
    expiresAt: string | null
    attemptsRemaining: number
    scope?: { type: 'GLOBAL' } | { type: 'HOTEL'; hotelId: string }
  }
}

export type WeComRepairBotCredentialUpdate =
  | { action: 'KEEP' }
  | { action: 'CLEAR' }
  | { action: 'REPLACE'; botId: string; secret: string }

export interface WeComRepairBotPairingView {
  pairingCode: string
  expiresAt: string
  attemptsRemaining: number
  hotelId: string
  hotelCode: string
  displayName: string
  pairedUserCount: number
  pairedUserCapacity: number
}

export type WeComWebhookUpdate =
  | { action: 'KEEP' }
  | { action: 'CLEAR' }
  | { action: 'REPLACE'; value: string }

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
  ownershipType: HotelOwnershipType
  pmsSystemCode: PmsSystemCode
  pmsSystemName: string
  timezone: string
  lifecycleStatus: string
  collectionEnabled: boolean
  messageEnabled: false
  configuredMockConnectors: number
  simulationOnly: boolean
  rowVersion: number
}

export type HotelOwnershipType = 'DIRECT' | 'NON_DIRECT'

export type PmsSystemCode =
  | 'MEITUAN_BIEYANGHONG'
  | 'LUOPAN_CLOUD'
  | 'OTHER'

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

export function loadPmsLoginConfig(
  context: HotelContext,
): Promise<PmsLoginConfigView> {
  return authenticatedRequest(scopedPath(context, '/pms-login-config'))
}

export function savePmsLoginConfig(
  context: HotelContext,
  credentialUpdate: PmsLoginCredentialUpdate,
): Promise<PmsLoginConfigView> {
  return postCommand(scopedPath(context, '/pms-login-config'), {
    credentialUpdate,
    reasonCode: 'UPDATE_PMS_LOGIN_CREDENTIALS',
  })
}

export function validateAndUpdatePmsCookie(
  context: HotelContext,
  cookieHeader: string,
): Promise<PmsCookieValidationView> {
  return postCommand(scopedPath(context, '/pms-cookie-validation'), {
    cookieHeader,
    reasonCode: 'VALIDATE_AND_UPDATE_PMS_COOKIE',
  })
}

export function loadLuopanBrowserConfig(
  context: HotelContext,
): Promise<LuopanBrowserConfigView> {
  return authenticatedRequest(
    scopedPath(context, '/luopan-browser-config'),
  )
}

export function saveLuopanBrowserConfig(
  context: HotelContext,
  input: {
    enabled: boolean
    profileRef: string
    rowVersion: number
  },
): Promise<LuopanBrowserConfigView> {
  return postCommand(
    scopedPath(context, '/luopan-browser-config'),
    {
      ...input,
      reasonCode: 'UPDATE_LUOPAN_BROWSER_CONFIG',
    },
  )
}

export function validateLuopanBrowserConfig(
  context: HotelContext,
): Promise<LuopanBrowserConfigView> {
  return postCommand(
    scopedPath(context, '/luopan-browser-session-validations'),
    {
      reasonCode: 'VALIDATE_LUOPAN_BROWSER_SESSION',
    },
  )
}

export function loadLuopanBrowserRepair(
  context: HotelContext,
): Promise<LuopanBrowserRepairView> {
  return authenticatedRequest(
    scopedPath(context, '/luopan-browser-repair'),
  )
}

export function validateLuopanBrowserRepair(
  context: HotelContext,
): Promise<LuopanBrowserRepairView> {
  return postCommand(
    scopedPath(context, '/luopan-browser-session-validations'),
    {
      reasonCode: 'VALIDATE_LUOPAN_BROWSER_SESSION',
    },
  )
}

export function loadOtaSources(
  context: HotelContext,
): Promise<OtaSourceView[]> {
  return authenticatedRequest(scopedPath(context, '/ota-sources'))
}

export function saveOtaSources(
  context: HotelContext,
  sources: OtaSourceInput[],
  deletedSources: Array<{
    sourceId: string
    expectedRowVersion: number
  }> = [],
): Promise<OtaSourceView[]> {
  return postCommand<OtaSourceView[]>(
    scopedPath(context, '/ota-sources'),
    {
      sources,
      deletedSources,
      reasonCode: 'UPDATE_OTA_SOURCE_CONFIG',
    },
  )
}

export function refreshOtaSource(
  context: HotelContext,
  sourceId: string,
): Promise<OtaSourceView> {
  return postCommand<OtaSourceView>(
    scopedPath(context, '/ota-source-refreshes'),
    {
      sourceId,
      reasonCode: 'MANUAL_OTA_SOURCE_REFRESH',
    },
  )
}

export function loadOtaControlledLogins(
  context: HotelContext,
): Promise<OtaControlledLoginProfile[]> {
  return authenticatedRequest(scopedPath(context, '/ota-controlled-logins'))
}

export function startOtaControlledLogin(
  context: HotelContext,
  platformCode: 'FLIGGY',
): Promise<OtaControlledLoginResult> {
  return postCommand<OtaControlledLoginResult>(
    scopedPath(context, '/ota-controlled-logins'),
    {
      platformCode,
      reasonCode: 'MANUAL_OTA_CONTROLLED_LOGIN',
    },
  )
}

export function submitOtaControlledLoginVerification(
  context: HotelContext,
  platformCode: 'FLIGGY',
  attemptId: string,
  answer: string,
): Promise<OtaControlledLoginResult> {
  return postCommand<OtaControlledLoginResult>(
    scopedPath(context, '/ota-controlled-login-verifications'),
    {
      platformCode,
      attemptId,
      answer,
      reasonCode: 'SUBMIT_OTA_LOGIN_VERIFICATION',
    },
  )
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
  hotelDisplayName: string
  ownershipType: HotelOwnershipType
  pmsSystemCode: PmsSystemCode
  pmsSystemName?: string
  pmsUsername?: string
  pmsPassword?: string
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

export function loadBusinessDayControl(
  context: HotelContext,
): Promise<BusinessDayControlView> {
  return authenticatedRequest(scopedPath(context, '/business-day-control'))
}

export function saveBusinessDayControl(
  context: HotelContext,
  businessDate: string,
): Promise<BusinessDayControlView> {
  return postCommand<BusinessDayControlView>(
    scopedPath(context, '/business-day-control'),
    {
      businessDate,
      reasonCode: 'CONFIRM_PMS_BUSINESS_DAY',
    },
  )
}

export function loadHotSellingRoomTypes(
  context: HotelContext,
): Promise<HotSellingRoomTypeConfigView> {
  return authenticatedRequest(
    scopedPath(context, '/hot-selling-room-types'),
  )
}

export function saveHotSellingRoomTypes(
  context: HotelContext,
  roomTypeCodes: string[],
  expectedRowVersion: number,
): Promise<HotSellingRoomTypeConfigView> {
  return postCommand<HotSellingRoomTypeConfigView>(
    scopedPath(context, '/hot-selling-room-types'),
    {
      roomTypeCodes,
      expectedRowVersion,
      reasonCode: 'UPDATE_HOT_SELLING_ROOM_TYPES',
    },
  )
}

export function loadRoomTypeConfiguration(
  context: HotelContext,
): Promise<RoomTypeConfigurationView> {
  return authenticatedRequest(
    scopedPath(context, '/room-type-configuration'),
  )
}

export function saveRoomTypeConfiguration(
  context: HotelContext,
  input: {
    expectedRowVersion: number
    mappings: RoomTypeMappingView[]
    hotSellingRoomTypeCodes: string[]
  },
): Promise<RoomTypeConfigurationView> {
  return postCommand<RoomTypeConfigurationView>(
    scopedPath(context, '/room-type-configuration'),
    {
      ...input,
      reasonCode: 'UPDATE_ROOM_TYPE_CONFIGURATION',
    },
  )
}

export function triggerLiveCollection(
  context: HotelContext,
): Promise<LiveCollectionRunView> {
  return postCommand<LiveCollectionRunView>(
    scopedPath(context, '/live-collection-runs'),
    { reasonCode: 'MANUAL_LIVE_COLLECTION' },
  )
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

export function loadWeComConfig(
  context: HotelContext,
): Promise<WeComConfigView> {
  return authenticatedRequest(scopedPath(context, '/wecom-config'))
}

export function loadWeComRepairBotConfig(
  context: HotelContext,
): Promise<WeComRepairBotConfigView> {
  return authenticatedRequest(
    scopedPath(context, '/wecom-repair-bot-config'),
  )
}

export function saveWeComRepairBotConfig(
  enabled: boolean,
  credentialUpdate: WeComRepairBotCredentialUpdate,
): Promise<WeComRepairBotConfigView> {
  return postCommand<WeComRepairBotConfigView>(
    '/ota/wecom-repair-bot-config',
    {
      enabled,
      credentialUpdate,
      reasonCode: 'UPDATE_WECOM_REPAIR_BOT_CONFIG',
    },
  )
}

export function startWeComRepairBotPairing(
  context: HotelContext,
): Promise<WeComRepairBotPairingView> {
  return postCommand<WeComRepairBotPairingView>(
    scopedPath(context, '/wecom-repair-bot-pairing'),
    { reasonCode: 'START_WECOM_REPAIR_BOT_PAIRING' },
  )
}

export function saveWeComConfig(
  context: HotelContext,
  enabled: boolean,
  webhookUpdate: WeComWebhookUpdate,
): Promise<WeComConfigView> {
  return postCommand<WeComConfigView>(
    scopedPath(context, '/wecom-config'),
    {
      enabled,
      webhookUpdate,
      reasonCode: 'UPDATE_WECOM_UAT_AUTOMATION',
    },
  )
}

export function sendWeComTestSuite(
  context: HotelContext,
): Promise<WeComTestSuiteView> {
  return postCommand<WeComTestSuiteView>(
    scopedPath(context, '/wecom-test-suite-deliveries'),
    { reasonCode: 'SEND_WECOM_UAT_TEST_SUITE' },
  )
}

export function replayLatestWeComBrief(
  context: HotelContext,
  expectedCollectionRunId: string,
  operationKey: string,
): Promise<WeComManualReplayView> {
  return postCommand<WeComManualReplayView>(
    scopedPath(context, '/wecom-manual-replay-deliveries'),
    {
      expectedCollectionRunId,
      operationKey,
      reasonCode: 'MANUAL_REPLAY_LATEST_COMPLETE',
    },
  )
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
