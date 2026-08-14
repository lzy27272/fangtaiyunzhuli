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

export type ProfessionalAdrPlan = {
  year: number
  adr: number
}

export type ProfessionalMaintenanceUpgrade = {
  year: number
  amount: number
  purpose?: string
}

export type ProfessionalReportNarrative = {
  projectStatus?: string
  marketContext?: string
  sameScaleNewHotelInvestment?: number
  marketRentLow?: number
  marketRentHigh?: number
  localOperatingHotelCount?: number
  operationEvidence?: string
  productPositioning?: string
  upgradeStrategy?: string
  totalShares?: number
  minimumSubscriptionShares?: number
  distributionFrequency?: string
  lockupYears?: number
  exitStartYear?: number
  annualExitDepreciationRate?: number
}

export type ProfessionalPlanInput = {
  projectName: string
  projectLocation?: string
  brandName?: string
  operatorName?: string
  roomCount: number
  propertyAreaSqm: number
  rentPerSqmMonth: number
  propertyFeePerSqmMonth: number
  leaseTermYears: number
  occupancyRate: number
  managementFeeRate: number
  staffCount: number
  projectPositioning: 'THREE_DIAMOND' | 'FOUR_DIAMOND'
  initialInvestment: number
  prepaidRentMonths: number
  depositMonths: number
  discountRate: number
  adrPlan: ProfessionalAdrPlan[]
  maintenanceUpgrades: ProfessionalMaintenanceUpgrade[]
  reportNarrative?: ProfessionalReportNarrative
}

export type ProfessionalYearlyResult = {
  year: number
  adr: number
  annualRevenue: number
  annualManagementFee: number
  annualOperatingAndFixedCost: number
  maintenanceUpgrade: number
  annualProfit: number
  cashFlow: number
  cumulativeCashFlow: number
}

export type ProfessionalCalculationResult = {
  annualRentAndPropertyCost: number
  quarterlyRentAndPropertyCost: number
  leaseDeposit: number
  annualLaborCost: number
  annualVariableCost: number
  unitVariableCost: number
  annualOperatingAndFixedCost: number
  availableRoomNights: number
  soldRoomNights: number
  totalRevenue: number
  totalManagementFee: number
  totalMaintenanceUpgrade: number
  totalAnnualProfit: number
  netCashGain: number
  roi: number
  paybackYears?: number
  irr?: number
  npv: number
  discountRate: number
  yearlyResults: ProfessionalYearlyResult[]
  warnings: string[]
}

export type ProfessionalReportHistorySummary = {
  id: string
  projectName: string
  roomCount: number
  initialInvestment: number
  irr?: number
  npv: number
  costParameterVersionNo: number
  generationCount: number
  rowVersion: number
  createdAt: string
  updatedAt: string
  lastGeneratedAt: string
}

export type ProfessionalReportHistoryRecord = ProfessionalReportHistorySummary & {
  input: ProfessionalPlanInput
  calculation: ProfessionalCalculationResult
}
