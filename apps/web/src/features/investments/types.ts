export type PlanInput = {
  rentPerSqmMonth: number
  propertyAreaSqm: number
  propertyFeePerSqmMonth: number
  roomCount: number
  staffCount: number
  positioning: 'THREE_DIAMOND' | 'FOUR_DIAMOND'
  managementFeeRate: number
  sellingRoomRate: number
  investmentTotal: number
  notes?: string
  reviewedAnalysis?: string
}

export type CostParameterInput = {
  salaryPerPersonMonth: number
  consumablesPerRoomNight: number
  linenPerRoomNight: number
  utilitiesPerRoomNight: number
  threeDiamondOperationsPerRoomNight: number
  fourDiamondOperationsPerRoomNight: number
}

export type CostParameterVersion = CostParameterInput & {
  id: string
  versionNo: number
  lifecycleStatus: 'DRAFT' | 'ACTIVE' | 'RETIRED'
  rowVersion: number
  createdBy?: string
  activatedBy?: string
  createdAt: string
  activatedAt?: string
}

export type CalculationWarning = {
  code: string
  severity: 'WARNING' | 'BLOCKING'
  blocksFormalConfirmation: boolean
  message: string
}

export type ScenarioResult = {
  occupancyRate: number
  availableRoomNights: number
  soldRoomNights: number
  monthlySoldRoomNights: number
  annualRevenue: number
  monthlyRevenue: number
  annualPropertyCost: number
  annualLaborCost: number
  annualVariableCost: number
  annualCost: number
  monthlyCost: number
  annualManagementFee: number
  monthlyManagementFee: number
  annualProfit: number
  monthlyProfit: number
  investmentReturnRate: number
  paybackYears?: number
  rating: 'LOSS' | 'HIGH_RISK' | 'CAUTIOUS' | 'FEASIBLE' | 'QUALITY'
}

export type CalculationResult = {
  annualFixedCost: number
  annualPropertyCost: number
  annualLaborCost: number
  unitVariableCost: number
  breakEvenOccupancyRate?: number
  breakEvenAnnualRoomNights?: number
  breakEvenMonthlyRoomNights?: number
  formalConfirmationAllowed: boolean
  warnings: CalculationWarning[]
  scenarios: ScenarioResult[]
  systemAnalysis: string
}

export type InvestmentVersion = {
  id: string
  projectId: string
  versionNo: number
  lifecycleStatus: 'DRAFT' | 'FORMAL' | 'HISTORICAL'
  projectName: string
  input: PlanInput
  costParameters: CostParameterVersion
  calculation: CalculationResult
  analysisOrigin: 'RULE_FALLBACK' | 'AI_GATEWAY' | 'MANUAL_REVIEW'
  rowVersion: number
  createdBy: string
  confirmedBy?: string
  createdAt: string
  updatedAt: string
  confirmedAt?: string
  currentFormal: boolean
}

export type InvestmentProjectSummary = {
  id: string
  projectNo: string
  name: string
  lifecycleStatus: 'ACTIVE' | 'ARCHIVED'
  latestVersionNo?: number
  latestVersionStatus?: string
  currentFormalVersionId?: string
  defaultAnnualProfit?: number
  defaultPaybackYears?: number
  defaultRating?: string
  updatedAt: string
}

export type InvestmentProjectDetail = {
  id: string
  projectNo: string
  name: string
  lifecycleStatus: 'ACTIVE' | 'ARCHIVED'
  currentFormalVersionId?: string
  rowVersion: number
  createdAt: string
  updatedAt: string
  versions: InvestmentVersion[]
}

export type InvestmentAuditEntry = {
  id: string
  actorId?: string
  action: string
  resourceType: string
  resourceId?: string
  details: string
  createdAt: string
}
