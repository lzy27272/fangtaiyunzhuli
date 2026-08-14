import { type ChangeEvent, type FormEvent, type ReactNode, useMemo, useState } from 'react'
import type { AppNavigate } from '../../app/routeConfig'
import type { RoleContext } from '../../domain'
import { useStableCommand } from '../../shared/useStableCommand'
import { useScopedResource } from '../../shared/useScopedResource'
import { FeatureHeader, formatLocalDateTime } from '../shared/FeatureUI'
import {
  calculateProfessionalInvestment,
  createProfessionalInvestmentHistory,
  deleteProfessionalInvestmentHistory,
  downloadProfessionalInvestmentHistoryPdf,
  loadProfessionalInvestmentHistories,
  loadProfessionalInvestmentHistory,
  updateProfessionalInvestmentHistory,
} from './api'
import styles from './investment.module.css'
import type {
  ProfessionalAdrPlan,
  ProfessionalCalculationResult,
  ProfessionalMaintenanceUpgrade,
  ProfessionalPlanInput,
  ProfessionalReportNarrative,
  ProfessionalReportHistoryRecord,
  ProfessionalReportHistorySummary,
} from './types'

type ProfessionalForm = {
  projectName: string
  projectLocation: string
  brandName: string
  operatorName: string
  roomCount: string
  propertyAreaSqm: string
  rentPerSqmMonth: string
  propertyFeePerSqmMonth: string
  leaseTermYears: string
  occupancyRate: string
  managementFeeRate: string
  staffCount: string
  projectPositioning: 'THREE_DIAMOND' | 'FOUR_DIAMOND'
  initialInvestmentWan: string
  prepaidRentMonths: string
  depositMonths: string
  discountRate: string
  projectStatus: string
  marketContext: string
  sameScaleNewHotelInvestmentWan: string
  marketRentLow: string
  marketRentHigh: string
  localOperatingHotelCount: string
  operationEvidence: string
  productPositioning: string
  upgradeStrategy: string
  totalShares: string
  minimumSubscriptionShares: string
  distributionFrequency: string
  lockupYears: string
  exitStartYear: string
  annualExitDepreciationRate: string
}

const defaultAdrs = [180, 180, 180, 160, 180, 170, 160, 150, 180, 170, 160, 150]

const defaultForm: ProfessionalForm = {
  projectName: '贵阳观山湖酒店',
  projectLocation: '贵阳市观山湖区',
  brandName: '四方馆酒店',
  operatorName: '四方馆集团统一管理',
  roomCount: '71',
  propertyAreaSqm: '4420',
  rentPerSqmMonth: '20',
  propertyFeePerSqmMonth: '0',
  leaseTermYears: '12',
  occupancyRate: '86.5',
  managementFeeRate: '5',
  staffCount: '11',
  projectPositioning: 'FOUR_DIAMOND',
  initialInvestmentWan: '300',
  prepaidRentMonths: '3',
  depositMonths: '1',
  discountRate: '10',
  projectStatus: '在营酒店，具备接手及开业条件，产品定位与经营效率存在提升空间。',
  marketContext: '成熟商务商圈，周边企业办公、协议客户及城市商务出行需求稳定。',
  sameScaleNewHotelInvestmentWan: '750',
  marketRentLow: '25',
  marketRentHigh: '30',
  localOperatingHotelCount: '2',
  operationEvidence: '入住率依据同商圈两家在营酒店的实际经营表现，并按稳健口径折算；ADR按照区域经营水平和产品升级后的价格能力测算。',
  productPositioning: '品质商务酒店，面向商务办公客户、企业协议客户、城市商务出行客户及中长期住宿客户。',
  upgradeStrategy: '首期投入完成品牌导入与客房、公共区域、智能化及配套体验升级；隔音、门头等非收益优先项目可根据经营现金流分阶段投入。',
  totalShares: '100',
  minimumSubscriptionShares: '10',
  distributionFrequency: '每半年',
  lockupYears: '3',
  exitStartYear: '4',
  annualExitDepreciationRate: '20',
}

function defaultAdr(year: number) {
  return String(defaultAdrs[year - 1] ?? defaultAdrs.at(-1) ?? 180)
}

function initialAdrPlan(term = 12) {
  return Array.from({ length: term }, (_, index) => ({ year: index + 1, adr: Number(defaultAdr(index + 1)) }))
}

function formFromInput(input: ProfessionalPlanInput): ProfessionalForm {
  const narrative = input.reportNarrative
  return {
    ...defaultForm,
    projectName: input.projectName,
    projectLocation: input.projectLocation ?? '',
    brandName: input.brandName ?? '',
    operatorName: input.operatorName ?? '',
    roomCount: inputNumber(input.roomCount),
    propertyAreaSqm: inputNumber(input.propertyAreaSqm),
    rentPerSqmMonth: inputNumber(input.rentPerSqmMonth),
    propertyFeePerSqmMonth: inputNumber(input.propertyFeePerSqmMonth),
    leaseTermYears: inputNumber(input.leaseTermYears),
    occupancyRate: inputNumber(input.occupancyRate * 100),
    managementFeeRate: inputNumber(input.managementFeeRate * 100),
    staffCount: inputNumber(input.staffCount),
    projectPositioning: input.projectPositioning,
    initialInvestmentWan: inputNumber(input.initialInvestment / 10_000),
    prepaidRentMonths: inputNumber(input.prepaidRentMonths),
    depositMonths: inputNumber(input.depositMonths),
    discountRate: inputNumber(input.discountRate * 100),
    projectStatus: narrative?.projectStatus ?? '',
    marketContext: narrative?.marketContext ?? '',
    sameScaleNewHotelInvestmentWan: inputNumber((narrative?.sameScaleNewHotelInvestment ?? 0) / 10_000),
    marketRentLow: inputNumber(narrative?.marketRentLow),
    marketRentHigh: inputNumber(narrative?.marketRentHigh),
    localOperatingHotelCount: inputNumber(narrative?.localOperatingHotelCount),
    operationEvidence: narrative?.operationEvidence ?? '',
    productPositioning: narrative?.productPositioning ?? '',
    upgradeStrategy: narrative?.upgradeStrategy ?? '',
    totalShares: inputNumber(narrative?.totalShares),
    minimumSubscriptionShares: inputNumber(narrative?.minimumSubscriptionShares),
    distributionFrequency: narrative?.distributionFrequency ?? '',
    lockupYears: inputNumber(narrative?.lockupYears),
    exitStartYear: inputNumber(narrative?.exitStartYear),
    annualExitDepreciationRate: inputNumber((narrative?.annualExitDepreciationRate ?? 0) * 100),
  }
}

function inputNumber(value?: number) {
  return value == null ? '' : String(value)
}

export function ProfessionalInvestmentPage({ identity, go }: { identity: RoleContext; go: AppNavigate }) {
  const command = useStableCommand('investment-professional-report')
  const histories = useScopedResource(
    `${identity.key}:investment-professional-report-history`,
    (signal) => loadProfessionalInvestmentHistories(identity, signal),
    [],
  )
  const [form, setForm] = useState<ProfessionalForm>(defaultForm)
  const [adrPlan, setAdrPlan] = useState<ProfessionalAdrPlan[]>(() => initialAdrPlan())
  const [maintenanceUpgrades, setMaintenanceUpgrades] = useState<ProfessionalMaintenanceUpgrade[]>([
    { year: 4, amount: 40, purpose: '产品维护升级' },
    { year: 8, amount: 40, purpose: '产品维护升级' },
  ])
  const [result, setResult] = useState<ProfessionalCalculationResult>()
  const [selectedHistory, setSelectedHistory] = useState<ProfessionalReportHistoryRecord>()
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()

  const term = useMemo(() => clampInteger(Number(form.leaseTermYears), 1, 12), [form.leaseTermYears])
  const update = (field: keyof ProfessionalForm, value: string) => setForm((current) => ({ ...current, [field]: value }))

  const applyHistory = (report: ProfessionalReportHistoryRecord) => {
    setForm(formFromInput(report.input))
    setAdrPlan(report.input.adrPlan.map((item) => ({ ...item })))
    setMaintenanceUpgrades(report.input.maintenanceUpgrades.map((item) => ({ ...item })))
    setResult(report.calculation)
    setSelectedHistory(report)
  }

  const startNewReport = () => {
    setForm({ ...defaultForm })
    setAdrPlan(initialAdrPlan())
    setMaintenanceUpgrades([
      { year: 4, amount: 40, purpose: '产品维护升级' },
      { year: 8, amount: 40, purpose: '产品维护升级' },
    ])
    setResult(undefined)
    setSelectedHistory(undefined)
    setError(undefined)
    setMessage('已切换为新项目。首次生成 PDF 后会自动存入历史记录。')
  }

  const updateTerm = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    update('leaseTermYears', value)
    const nextTerm = clampInteger(Number(value), 1, 12)
    setAdrPlan((current) => Array.from({ length: nextTerm }, (_, index) => {
      const currentPlan = current.find((item) => item.year === index + 1)
      return currentPlan || { year: index + 1, adr: Number(defaultAdr(index + 1)) }
    }))
    setMaintenanceUpgrades((current) => current.filter((item) => item.year <= nextTerm))
  }

  const makeNarrative = (): ProfessionalReportNarrative => ({
    projectStatus: optional(form.projectStatus),
    marketContext: optional(form.marketContext),
    sameScaleNewHotelInvestment: numeric(form.sameScaleNewHotelInvestmentWan, '同规模新店参考投入') * 10_000,
    marketRentLow: numeric(form.marketRentLow, '周边租金下限'),
    marketRentHigh: numeric(form.marketRentHigh, '周边租金上限'),
    localOperatingHotelCount: integer(form.localOperatingHotelCount, '同商圈在营门店数量'),
    operationEvidence: optional(form.operationEvidence),
    productPositioning: optional(form.productPositioning),
    upgradeStrategy: optional(form.upgradeStrategy),
    totalShares: integer(form.totalShares, '项目总份额'),
    minimumSubscriptionShares: integer(form.minimumSubscriptionShares, '最低认购份额'),
    distributionFrequency: optional(form.distributionFrequency),
    lockupYears: integer(form.lockupYears, '锁定期'),
    exitStartYear: integer(form.exitStartYear, '可申请退出起始年度'),
    annualExitDepreciationRate: numeric(form.annualExitDepreciationRate, '退出本金年度折旧比例') / 100,
  })

  const makeInput = (): ProfessionalPlanInput => ({
    projectName: form.projectName.trim(),
    projectLocation: optional(form.projectLocation),
    brandName: optional(form.brandName),
    operatorName: optional(form.operatorName),
    roomCount: integer(form.roomCount, '客房数量'),
    propertyAreaSqm: numeric(form.propertyAreaSqm, '物业面积'),
    rentPerSqmMonth: numeric(form.rentPerSqmMonth, '月租金'),
    propertyFeePerSqmMonth: numeric(form.propertyFeePerSqmMonth, '月物业费'),
    leaseTermYears: term,
    occupancyRate: numeric(form.occupancyRate, '入住率') / 100,
    managementFeeRate: numeric(form.managementFeeRate, '管理费率') / 100,
    staffCount: integer(form.staffCount, '人工数量'),
    projectPositioning: form.projectPositioning,
    initialInvestment: numeric(form.initialInvestmentWan, '首期综合投入') * 10_000,
    prepaidRentMonths: numeric(form.prepaidRentMonths, '预付租金月数'),
    depositMonths: numeric(form.depositMonths, '押金月数'),
    discountRate: numeric(form.discountRate, '折现率') / 100,
    adrPlan: adrPlan.map((item) => ({ year: item.year, adr: numeric(String(item.adr), `第 ${item.year} 年 ADR`) })),
    maintenanceUpgrades: maintenanceUpgrades.map((item) => ({
      year: item.year,
      amount: numeric(String(item.amount), `第 ${item.year} 年维护升级金额`) * 10_000,
      purpose: optional(item.purpose),
    })),
    reportNarrative: makeNarrative(),
  })

  const preview = async (event?: FormEvent) => {
    event?.preventDefault()
    setError(undefined); setMessage(undefined)
    try {
      const input = makeInput()
      if (!input.projectName) throw new Error('请填写项目名称')
      const value = await command.run(() => calculateProfessionalInvestment(identity, input))
      if (value) {
        setResult(value)
        setMessage('测算预览已更新；确认后可直接生成投资分析书 PDF。')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '投资测算失败，请检查输入数据。')
    }
  }

  const generatePdf = async () => {
    setError(undefined); setMessage(undefined)
    try {
      const input = makeInput()
      if (!input.projectName) throw new Error('请填写项目名称')
      const saved = await command.run(async () => {
        const report = selectedHistory
          ? await updateProfessionalInvestmentHistory(identity, selectedHistory, input)
          : await createProfessionalInvestmentHistory(identity, input)
        await downloadProfessionalInvestmentHistoryPdf(identity, report)
        return report
      })
      if (saved) {
        applyHistory(saved)
        await histories.reload()
        setMessage(selectedHistory ? '历史项目已更新，新的投资分析书 PDF 已生成并开始下载。' : '投资分析书已自动存入历史记录，并开始下载 PDF。')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '生成报告失败，请检查输入数据。')
    }
  }

  const openHistory = async (summary: ProfessionalReportHistorySummary) => {
    setError(undefined); setMessage(undefined)
    try {
      const report = await command.run(() => loadProfessionalInvestmentHistory(identity, summary.id))
      if (report) {
        applyHistory(report)
        setMessage(`已打开“${report.projectName}”的历史测算，可修改后再次生成。`)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法打开历史项目。')
    }
  }

  const downloadHistoryPdf = async (summary: ProfessionalReportHistorySummary) => {
    setError(undefined); setMessage(undefined)
    try {
      await command.run(() => downloadProfessionalInvestmentHistoryPdf(identity, summary))
      setMessage(`“${summary.projectName}”的历史投资分析书 PDF 已开始下载。`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法下载历史投资分析书。')
    }
  }

  const removeHistory = async (summary: ProfessionalReportHistorySummary) => {
    if (!window.confirm(`确定删除“${summary.projectName}”的历史投资项目记录吗？删除后将不再出现在列表中。`)) return
    setError(undefined); setMessage(undefined)
    try {
      await command.run(() => deleteProfessionalInvestmentHistory(identity, summary))
      if (selectedHistory?.id === summary.id) startNewReport()
      await histories.reload()
      setMessage(`“${summary.projectName}”已从历史记录中删除。`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法删除历史项目。')
    }
  }

  const updateAdr = (year: number, value: string) => setAdrPlan((current) => current.map((item) => item.year === year ? { ...item, adr: value === '' ? 0 : Number(value) } : item))
  const updateUpgrade = (index: number, field: keyof ProfessionalMaintenanceUpgrade, value: string) => setMaintenanceUpgrades((current) => current.map((item, itemIndex) => {
    if (itemIndex !== index) return item
    if (field === 'purpose') return { ...item, purpose: value }
    return { ...item, [field]: value === '' ? 0 : Number(value) }
  }))

  return <section className={styles.page}>
    <FeatureHeader
      eyebrow="INVESTMENT ANALYSIS PROFESSIONAL"
      title="投资测算专业版"
      description="填写项目数据，自动形成逐年 ADR、经营现金流、IRR、NPV 与投资人版 PDF 报告；生成后会自动存入历史投资项目记录。"
      actions={<>
        <button className="secondary" onClick={() => go('investments')}>返回投资测算</button>
        <button className="secondary" disabled={command.busy} onClick={startNewReport}>新建投资项目</button>
        <button className="primary" disabled={command.busy} onClick={() => void generatePdf()}>{command.busy ? '正在生成…' : selectedHistory ? '更新并生成 PDF' : '生成投资分析书 PDF'}</button>
      </>}
    />
    {(message || error) && <div className={error ? styles.error : styles.success}>{error || message}</div>}
    <section className={styles.professionalPanel}>
      <header><div><span>REPORT HISTORY</span><h2>历史生成的投资项目</h2></div><div className={styles.professionalHistoryHeader}><small>每次生成投资分析书都会自动归档。打开后可查看、修改、再次生成或删除。</small><button type="button" className="secondary" disabled={histories.loading || command.busy} onClick={() => void histories.reload()}>刷新记录</button></div></header>
      {Boolean(histories.error) && <div className={styles.error}>历史记录加载失败，请刷新重试。</div>}
      {!histories.loading && !histories.error && histories.data.length === 0 && <p className={styles.professionalHint}>暂无历史记录。完成一次“生成投资分析书 PDF”后，项目将自动显示在这里。</p>}
      <div className={styles.professionalHistoryList}>{histories.data.map((item) => <article key={item.id} className={`${styles.professionalHistoryItem} ${selectedHistory?.id === item.id ? styles.professionalHistoryItemActive : ''}`}>
        <div><strong>{item.projectName}</strong><span>{item.roomCount} 间 · 首期投入 {wan(item.initialInvestment)} 万元 · COST-V{String(item.costParameterVersionNo).padStart(3, '0')}</span><small>第 {item.generationCount} 次生成 · 最后生成 {formatLocalDateTime(item.lastGeneratedAt)}</small></div>
        <div className={styles.professionalHistoryMetrics}><span>IRR {percent(item.irr)}</span><span>NPV {wan(item.npv)} 万元</span></div>
        <div className={styles.actions}><button type="button" className="secondary" disabled={command.busy} onClick={() => void openHistory(item)}>查看 / 修改</button><button type="button" className="secondary" disabled={command.busy} onClick={() => void downloadHistoryPdf(item)}>再次下载</button><button type="button" className="secondary" disabled={command.busy} onClick={() => void removeHistory(item)}>删除</button></div>
      </article>)}</div>
    </section>
    <form className={styles.professionalForm} onSubmit={(event) => void preview(event)}>
      <section className={styles.professionalPanel}>
        <header><div><span>01 / PROJECT</span><h2>项目与租赁条件</h2></div><small>金额默认以“万元”输入；租金与 ADR 以“元”输入。</small></header>
        <div className={styles.professionalFields}>
          <Field label="项目名称"><input required maxLength={100} value={form.projectName} onChange={(event) => update('projectName', event.target.value)}/></Field>
          <Field label="项目地点"><input maxLength={120} value={form.projectLocation} onChange={(event) => update('projectLocation', event.target.value)}/></Field>
          <Field label="品牌/产品"><input maxLength={80} value={form.brandName} onChange={(event) => update('brandName', event.target.value)}/></Field>
          <Field label="运营管理"><input maxLength={80} value={form.operatorName} onChange={(event) => update('operatorName', event.target.value)}/></Field>
          <Field label="客房数量（间）"><input required min="1" step="1" type="number" value={form.roomCount} onChange={(event) => update('roomCount', event.target.value)}/></Field>
          <Field label="物业面积（㎡）"><input required min="0.01" step="0.01" type="number" value={form.propertyAreaSqm} onChange={(event) => update('propertyAreaSqm', event.target.value)}/></Field>
          <Field label="月租金（元/㎡）"><input required min="0" step="0.01" type="number" value={form.rentPerSqmMonth} onChange={(event) => update('rentPerSqmMonth', event.target.value)}/></Field>
          <Field label="月物业费（元/㎡）"><input required min="0" step="0.01" type="number" value={form.propertyFeePerSqmMonth} onChange={(event) => update('propertyFeePerSqmMonth', event.target.value)}/></Field>
          <Field label="租赁年限（年）"><input required min="1" max="12" step="1" type="number" value={form.leaseTermYears} onChange={updateTerm}/></Field>
          <Field label="首期综合投入（万元）"><input required min="0.01" step="0.01" type="number" value={form.initialInvestmentWan} onChange={(event) => update('initialInvestmentWan', event.target.value)}/></Field>
          <Field label="预付租金（月）"><input required min="0" max="24" step="0.1" type="number" value={form.prepaidRentMonths} onChange={(event) => update('prepaidRentMonths', event.target.value)}/></Field>
          <Field label="履约押金（月）"><input required min="0" max="24" step="0.1" type="number" value={form.depositMonths} onChange={(event) => update('depositMonths', event.target.value)}/></Field>
        </div>
        <p className={styles.professionalHint}>首期综合投入可涵盖收购、交易居间、房屋租赁（预付租金）及押金、升级改造等。系统会把预付租金和押金按现金流时点单独核对。</p>
      </section>

      <section className={styles.professionalPanel}>
        <header><div><span>02 / OPERATIONS</span><h2>经营口径</h2></div><small>年度经营及固定成本由系统按当前生效成本参数自动计算，无需手填。</small></header>
        <div className={styles.professionalFields}>
          <Field label="全年入住率（%）"><input required min="1" max="100" step="0.1" type="number" value={form.occupancyRate} onChange={(event) => update('occupancyRate', event.target.value)}/></Field>
          <Field label="管理费率（营业额 %）"><input required min="0" max="20" step="0.1" type="number" value={form.managementFeeRate} onChange={(event) => update('managementFeeRate', event.target.value)}/></Field>
          <Field label="人工数量（人）"><input required min="1" step="1" type="number" value={form.staffCount} onChange={(event) => update('staffCount', event.target.value)}/></Field>
          <Field label="项目定位"><select value={form.projectPositioning} onChange={(event) => update('projectPositioning', event.target.value as ProfessionalForm['projectPositioning'])}><option value="THREE_DIAMOND">三钻（运营成本 15 元/已售间夜）</option><option value="FOUR_DIAMOND">四钻（运营成本 30 元/已售间夜）</option></select></Field>
          <Field label="NPV 折现率（%）"><input required min="0" max="50" step="0.1" type="number" value={form.discountRate} onChange={(event) => update('discountRate', event.target.value)}/></Field>
        </div>
        <p className={styles.professionalHint}>系统自动计入全年租金及物业费、人工、易耗品、布草洗涤、水电和定位运营成本；点击“更新测算预览”后可查看分项成本与逐年现金流。</p>
      </section>

      <section className={styles.professionalPanel}>
        <header><div><span>03 / ADR PLAN</span><h2>{term} 年 ADR 计划</h2></div><small>价格输入为全年平均房价（元/间夜）。</small></header>
        <div className={styles.adrGrid}>
          {adrPlan.map((item) => <label key={item.year} className={styles.adrCard}><span>第 {item.year} 年</span><input required min="0.01" step="0.01" type="number" value={item.adr || ''} onChange={(event) => updateAdr(item.year, event.target.value)}/><small>元 / 间夜</small></label>)}
        </div>
      </section>

      <section className={styles.professionalPanel}>
        <header><div><span>04 / REINVESTMENT</span><h2>维护升级计划</h2></div><button type="button" className="secondary" disabled={maintenanceUpgrades.length >= term} onClick={() => setMaintenanceUpgrades((current) => [...current, { year: Math.min(term, current.length ? current.at(-1)!.year + 1 : 1), amount: 0, purpose: '产品维护升级' }])}>增加年度投入</button></header>
        <div className={styles.upgradeList}>
          {maintenanceUpgrades.length === 0 && <p className={styles.professionalHint}>未设置维护升级投入。若计划后续复投，可在这里增加对应年度与金额。</p>}
          {maintenanceUpgrades.map((item, index) => <div className={styles.upgradeRow} key={`${item.year}-${index}`}>
            <label>年度<select value={item.year} onChange={(event) => updateUpgrade(index, 'year', event.target.value)}>{Array.from({ length: term }, (_, year) => <option key={year + 1} value={year + 1}>第 {year + 1} 年</option>)}</select></label>
            <label>投入（万元）<input min="0.01" step="0.01" type="number" value={item.amount || ''} onChange={(event) => updateUpgrade(index, 'amount', event.target.value)}/></label>
            <label>主要用途<input maxLength={160} value={item.purpose || ''} onChange={(event) => updateUpgrade(index, 'purpose', event.target.value)} placeholder="例如：产品维护升级"/></label>
            <button type="button" className="secondary" onClick={() => setMaintenanceUpgrades((current) => current.filter((_, itemIndex) => itemIndex !== index))}>移除</button>
          </div>)}
        </div>
      </section>
      <section className={styles.professionalPanel}>
        <header><div><span>05 / INVESTOR STORY</span><h2>投资沟通与经营验证</h2></div><small>以下内容用于生成投资人报告文案，不会改变收益、IRR、NPV 等测算结果。</small></header>
        <div className={styles.professionalFields}>
          <Field label="项目当前状态"><textarea maxLength={400} rows={3} value={form.projectStatus} onChange={(event) => update('projectStatus', event.target.value)}/></Field>
          <Field label="商圈与客源基础"><textarea maxLength={500} rows={3} value={form.marketContext} onChange={(event) => update('marketContext', event.target.value)}/></Field>
          <Field label="同规模新店参考投入（万元）"><input required min="0.01" step="0.01" type="number" value={form.sameScaleNewHotelInvestmentWan} onChange={(event) => update('sameScaleNewHotelInvestmentWan', event.target.value)}/></Field>
          <Field label="同商圈在营门店数量"><input required min="1" step="1" type="number" value={form.localOperatingHotelCount} onChange={(event) => update('localOperatingHotelCount', event.target.value)}/></Field>
          <Field label="周边租金下限（元/㎡·月）"><input required min="0" step="0.01" type="number" value={form.marketRentLow} onChange={(event) => update('marketRentLow', event.target.value)}/></Field>
          <Field label="周边租金上限（元/㎡·月）"><input required min="0" step="0.01" type="number" value={form.marketRentHigh} onChange={(event) => update('marketRentHigh', event.target.value)}/></Field>
          <Field label="经营数据验证"><textarea maxLength={800} rows={4} value={form.operationEvidence} onChange={(event) => update('operationEvidence', event.target.value)}/></Field>
          <Field label="改造后产品定位"><textarea maxLength={400} rows={4} value={form.productPositioning} onChange={(event) => update('productPositioning', event.target.value)}/></Field>
          <Field label="升级改造策略"><textarea maxLength={800} rows={4} value={form.upgradeStrategy} onChange={(event) => update('upgradeStrategy', event.target.value)}/></Field>
        </div>
      </section>
      <section className={styles.professionalPanel}>
        <header><div><span>06 / COOPERATION</span><h2>合作与退出口径</h2></div><small>该部分用于投资沟通；投资协议、份额登记与退出条件仍以正式文件为准。</small></header>
        <div className={styles.professionalFields}>
          <Field label="项目总份额（股）"><input required min="1" step="1" type="number" value={form.totalShares} onChange={(event) => update('totalShares', event.target.value)}/></Field>
          <Field label="最低认购份额（股）"><input required min="1" step="1" type="number" value={form.minimumSubscriptionShares} onChange={(event) => update('minimumSubscriptionShares', event.target.value)}/></Field>
          <Field label="收益分配频率"><input required maxLength={40} value={form.distributionFrequency} onChange={(event) => update('distributionFrequency', event.target.value)}/></Field>
          <Field label="投资锁定期（年）"><input required min="1" step="1" type="number" value={form.lockupYears} onChange={(event) => update('lockupYears', event.target.value)}/></Field>
          <Field label="可申请退出起始年度"><input required min="1" step="1" type="number" value={form.exitStartYear} onChange={(event) => update('exitStartYear', event.target.value)}/></Field>
          <Field label="退出本金年度折旧比例（%）"><input required min="0" max="100" step="0.01" type="number" value={form.annualExitDepreciationRate} onChange={(event) => update('annualExitDepreciationRate', event.target.value)}/></Field>
        </div>
      </section>
      <div className={styles.professionalActionRow}><p>IRR 会考虑每年的现金流时点；NPV 会以设定折现率折算未来现金流到今天的价值。</p><button className="primary" disabled={command.busy}>{command.busy ? '正在测算…' : '更新测算预览'}</button></div>
    </form>

    {result && <ProfessionalResult result={result}/>}
  </section>
}

function ProfessionalResult({ result }: { result: ProfessionalCalculationResult }) {
  return <>
    <section className={styles.professionalResultGrid}>
      <ResultMetric label="自动年度经营成本" value={wanWithUnit(result.annualOperatingAndFixedCost)} note={`租赁 ${wanWithUnit(result.annualRentAndPropertyCost)} · 人工 ${wanWithUnit(result.annualLaborCost)}`}/>
      <ResultMetric label="投资回收期" value={result.paybackYears == null ? '租期内未回收' : `${number(result.paybackYears)} 年`} note="按逐年现金流"/>
      <ResultMetric label="IRR（内部收益率）" value={percent(result.irr)} note="全周期年化收益"/>
      <ResultMetric label="NPV（净现值）" value={`${wan(result.npv)} 万元`} note={`按 ${percent(result.discountRate)} 折现`}/>
      <ResultMetric label="累计净现金收益" value={`${wan(result.netCashGain)} 万元`} note={`ROI ${percent(result.roi)}`}/>
    </section>
    <section className={styles.professionalPanel}>
      <header><div><span>PREVIEW / CASH FLOW</span><h2>逐年经营利润与现金流预览</h2></div><small>金额单位：万元</small></header>
      <div className={styles.tableWrap}><table className={styles.professionalTable}><thead><tr><th>年度</th><th>ADR</th><th>客房收入</th><th>管理费</th><th>经营成本</th><th>升级投入</th><th>年度利润</th><th>现金流</th><th>累计现金流</th></tr></thead><tbody>{result.yearlyResults.map((item) => <tr key={item.year}><td>第 {item.year} 年</td><td>{yuanWithUnit(item.adr)}</td><td>{wanWithUnit(item.annualRevenue)}</td><td>{wanWithUnit(item.annualManagementFee)}</td><td>{wanWithUnit(item.annualOperatingAndFixedCost)}</td><td>{wanWithUnit(item.maintenanceUpgrade)}</td><td className={item.annualProfit < 0 ? styles.negative : styles.positive}>{wanWithUnit(item.annualProfit)}</td><td>{wanWithUnit(item.cashFlow)}</td><td className={item.cumulativeCashFlow < 0 ? styles.negative : styles.positive}>{wanWithUnit(item.cumulativeCashFlow)}</td></tr>)}</tbody></table></div>
      {!!result.warnings.length && <div className={styles.professionalWarnings}>{result.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
    </section>
  </>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className={styles.professionalField}><span>{label}</span>{children}</label>
}

function ResultMetric({ label, value, note }: { label: string; value: string; note: string }) {
  return <article><span>{label}</span><strong>{value}</strong><small>{note}</small></article>
}

function optional(value?: string) { return value?.trim() || undefined }

function numeric(value: string, label: string) {
  const result = Number(value)
  if (!Number.isFinite(result) || result < 0) throw new Error(`请正确填写${label}`)
  return result
}

function integer(value: string, label: string) {
  const result = numeric(value, label)
  if (!Number.isInteger(result) || result <= 0) throw new Error(`请正确填写${label}`)
  return result
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}

function number(value?: number) {
  if (value == null || !Number.isFinite(value)) return '-'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
}

function wan(value?: number) { return value == null ? '-' : number(value / 10_000) }
function wanWithUnit(value?: number) { return value == null ? '-' : `${wan(value)} 万元` }
function yuanWithUnit(value?: number) { return value == null ? '-' : `${number(value)} 元` }
function percent(value?: number) { return value == null ? '-' : `${number(value * 100)}%` }
