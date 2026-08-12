export type KpiPeriod = {
  id: string
  monthStart: string
  status: string
  draftDueAt: string
  disputeDueAt: string
  confirmationDueAt: string
  lockDueAt: string
  scorecardCount: number
  pendingCount: number
  rowVersion: number
}
export type KpiScorecard = {
  id: string
  periodId: string
  cardType: 'WEEK' | 'MONTH'
  weekNo?: number
  periodStart: string
  periodEnd: string
  status: string
  currentRevisionNo: number
  baseScore?: number
  extraScore?: number
  finalScore?: number
  warningLevel: string
  generatedAt?: string
  rowVersion: number
  employeeId: string
  employeeNo: string
  employeeName: string
  positionName: string
  orgName: string
  templateName: string
}

export type KpiIndicator = {
  id: string
  indicatorRuleId: string
  sectionCode: string
  indicatorCode: string
  name: string
  targetValue?: number
  actualValue?: number
  numerator?: number
  denominator?: number
  score?: number
  maxScore: number
  minScore?: number
  dataState: string
  outcome: string
  details?: Record<string, unknown>
}

export type KpiScorecardDetail = KpiScorecard & {
  revisions: Array<Record<string, unknown>>
  indicators: KpiIndicator[]
  reviews: Array<Record<string, unknown>>
  disputes: Array<Record<string, unknown>>
  corrections: Array<Record<string, unknown>>
}

export type KpiTemplate = {
  id: string
  code: string
  name: string
  templateOrigin: string
  positionName?: string
  ownerOrgName?: string
  currentVersionId?: string
  currentVersionNo?: number
  lifecycleStatus?: string
  effectiveMonth?: string
  status: string
}

export type KpiRelation = {
  id: string
  employeeId: string
  employeeNo: string
  employeeName: string
  positionAssignmentId: string
  positionCode: string
  positionName: string
  orgUnitId: string
  orgName: string
  templateId: string
  templateCode: string
  templateName: string
  validFrom: string
  validTo?: string
  status: string
}

export type KpiSettlement = {
  id: string
  periodId: string
  employeeNo: string
  employeeName: string
  finalScore: number
  originalBonusBase: number
  bonusAdjustment: number
  adjustedBonusBase: number
  performanceCoefficient: number
  attendanceCoefficient: number
  payableBonus: number
  status: string
}

export type InspectionSchedule = {
  id: string
  timeSlot: string
  opensAt: string
  cutoffAt: string
  requiredChecks: string[]
  active: boolean
  rowVersion: number
}

export type InspectionSubmission = {
  id: string
  employeeId: string
  assignmentId: string
  orgUnitId: string
  employeeName: string
  orgName: string
  businessDate: string
  timeSlot: string
  channelCode: string
  result: string
  checkItems: Array<{ code: string; status: string; note?: string }>
  abnormalityLevel?: string
  abnormalityDescription?: string
  firstAction?: string
  signedName: string
  signedAt: string
  correctionReason?: string
  breachCount: number
  verificationDecision?: string
}
