import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { hasPermission, permissions } from '../../app/permissions'
import type { AppNavigate, InvestmentFeatureRouteId } from '../../app/routeConfig'
import type { RoleContext, RouteParams } from '../../domain'
import { AsyncState } from '../../shared/AsyncState'
import { useScopedResource } from '../../shared/useScopedResource'
import { useStableCommand } from '../../shared/useStableCommand'
import { FeatureHeader, StatusBadge, formatLocalDateTime } from '../shared/FeatureUI'
import { ProfessionalInvestmentPage } from './ProfessionalInvestmentPage'
import {
  activateInvestmentCostParameters,
  confirmInvestmentVersion,
  copyInvestmentVersion,
  createInvestmentCostParameters,
  createInvestmentProject,
  downloadInvestmentExcel,
  downloadInvestmentPdf,
  loadInvestmentAudit,
  loadInvestmentCostParameters,
  loadInvestmentProject,
  loadInvestmentProjects,
  setInvestmentProjectArchived,
  updateInvestmentCostParameters,
  updateInvestmentDraft,
} from './api'
import styles from './investment.module.css'
import type {
  CostParameterInput,
  CostParameterVersion,
  InvestmentProjectDetail,
  InvestmentVersion,
  PlanInput,
  ScenarioResult,
} from './types'

export function InvestmentRoutes({ view, params, identity, grantedPermissions, go }: {
  view: InvestmentFeatureRouteId
  params: RouteParams
  identity: RoleContext
  grantedPermissions: string[]
  go: AppNavigate
}) {
  if (view === 'investment-project') {
    return params.projectId
      ? <ProjectDetailPage identity={identity} grantedPermissions={grantedPermissions} projectId={params.projectId} go={go}/>
      : <AsyncState loading={false} error={new Error('路由缺少投资项目编号')}/>
  }
  if (view === 'investment-parameters') {
    return <CostParameterPage identity={identity} grantedPermissions={grantedPermissions} go={go}/>
  }
  if (view === 'investment-professional') {
    return <ProfessionalInvestmentPage identity={identity} go={go}/>
  }
  return <InvestmentOverview identity={identity} grantedPermissions={grantedPermissions} go={go}/>
}

function InvestmentOverview({ identity, grantedPermissions, go }: {
  identity: RoleContext
  grantedPermissions: string[]
  go: AppNavigate
}) {
  const [includeArchived, setIncludeArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const [message, setMessage] = useState<string>()
  const projects = useScopedResource(
    `${identity.key}:investment-projects:${includeArchived}`,
    (signal) => loadInvestmentProjects(identity, signal, includeArchived),
    [],
  )
  const canManage = hasPermission(grantedPermissions, permissions.investment.manage)
  const canConfigure = hasPermission(grantedPermissions, permissions.investment.configure)
    || hasPermission(grantedPermissions, permissions.investment.parameterConfirm)
  const defaultProfit = projects.data.reduce((sum, item) => sum + (item.defaultAnnualProfit || 0), 0)

  return <section className={styles.page}>
    <FeatureHeader
      eyebrow="INVESTMENT ANALYSIS CENTER"
      title="投资测算"
      description="以版本化成本参数和后端确定性公式，测算80%、85%、90%、95%出租率下的经营利润与静态投资回收期。"
      actions={<>
        {canManage && <button className="primary" onClick={() => go('investment-professional')}>投资测算专业版</button>}
        {canConfigure && <button className="secondary" onClick={() => go('investment-parameters')}>成本参数配置</button>}
        {canManage && <button className="primary" onClick={() => setCreating((value) => !value)}>{creating ? '收起新建' : '新建投资测算'}</button>}
      </>}
    />
    <section className={styles.metrics}>
      <Metric label="测算项目" value={String(projects.data.length)} note="当前可见全部范围"/>
      <Metric label="正式预测" value={String(projects.data.filter((item) => item.currentFormalVersionId).length)} note="已生成不可覆盖版本"/>
      <Metric label="85%情景利润合计" value={money(defaultProfit)} note="仅作为项目组合快速参考"/>
      <Metric label="权限范围" value="全集团" note="仅集团CEO与平台管理员"/>
    </section>
    {creating && <CreateProjectPanel identity={identity} onCreated={async (project) => {
      setMessage(`项目 ${project.projectNo} 已创建`)
      setCreating(false)
      await projects.reload()
      go('investment-project', { projectId: project.id })
    }}/>}
    <div className={styles.toolbar}>
      <label><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)}/> 显示已归档项目</label>
      <button className="secondary" onClick={() => void projects.reload()}>刷新</button>
      {message && <span className={styles.success}>{message}</span>}
    </div>
    <AsyncState loading={projects.loading} error={projects.error} empty={!projects.data.length} onRetry={projects.reload} emptyTitle="暂无投资测算项目"/>
    <div className={styles.projectGrid}>
      {projects.data.map((project) => <button key={project.id} className={styles.projectCard} onClick={() => go('investment-project', { projectId: project.id })}>
        <header><span>{project.projectNo}</span><StatusBadge value={project.lifecycleStatus}/></header>
        <h2>{project.name}</h2>
        <div className={styles.projectNumbers}>
          <div><small>85%年利润</small><strong className={(project.defaultAnnualProfit || 0) < 0 ? styles.negative : ''}>{money(project.defaultAnnualProfit)}</strong></div>
          <div><small>回收时长</small><strong>{project.defaultPaybackYears == null ? '无法回收' : `${number(project.defaultPaybackYears)}年`}</strong></div>
        </div>
        <footer><span>最新 V{String(project.latestVersionNo || 0).padStart(3, '0')}</span><span>{ratingLabel(project.defaultRating)}</span></footer>
      </button>)}
    </div>
  </section>
}

function CreateProjectPanel({ identity, onCreated }: {
  identity: RoleContext
  onCreated: (project: InvestmentProjectDetail) => Promise<void>
}) {
  const command = useStableCommand('investment-create')
  const [error, setError] = useState<string>()
  return <section className={styles.panel}>
    <header><div><span>NEW INVESTMENT MODEL</span><h2>新建投资测算</h2></div></header>
    <PlanEditor submitLabel="保存草稿并生成四档测算" busy={command.busy} onSubmit={async (projectName, input) => {
      setError(undefined)
      try {
        const result = await command.run(() => createInvestmentProject(identity, projectName, input))
        if (result) await onCreated(result)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '项目创建失败')
      }
    }}/>
    {error && <div className={styles.error}>{error}</div>}
  </section>
}

function ProjectDetailPage({ identity, grantedPermissions, projectId, go }: {
  identity: RoleContext
  grantedPermissions: string[]
  projectId: string
  go: AppNavigate
}) {
  const project = useScopedResource(`${identity.key}:investment-project:${projectId}`, (signal) => loadInvestmentProject(identity, projectId, signal), undefined as InvestmentProjectDetail | undefined)
  const audit = useScopedResource(`${identity.key}:investment-audit:${projectId}`, (signal) => loadInvestmentAudit(identity, projectId, signal), [])
  const command = useStableCommand(`investment-project-${projectId}`)
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [selectedOccupancies, setSelectedOccupancies] = useState<number[]>([80, 85, 90, 95])
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (!selectedVersionId && project.data?.versions[0]) setSelectedVersionId(project.data.versions[0].id)
    if (selectedVersionId && project.data && !project.data.versions.some((item) => item.id === selectedVersionId)) {
      setSelectedVersionId(project.data.versions[0]?.id || '')
    }
  }, [project.data, selectedVersionId])
  const version = project.data?.versions.find((item) => item.id === selectedVersionId) || project.data?.versions[0]
  const canManage = hasPermission(grantedPermissions, permissions.investment.manage)
  const canConfirm = hasPermission(grantedPermissions, permissions.investment.confirm)
  const canExport = hasPermission(grantedPermissions, permissions.investment.export)

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setError(undefined); setMessage(undefined)
    try {
      await command.run(operation)
      setMessage(success)
      await Promise.all([project.reload(), audit.reload()])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败')
    }
  }

  if (project.loading || project.error || !project.data || !version) {
    return <section className={styles.page}><FeatureHeader eyebrow="INVESTMENT PROJECT" title="投资测算项目" description="正在读取项目与版本快照。" actions={<button className="secondary" onClick={() => go('investments')}>返回列表</button>}/><AsyncState loading={project.loading} error={project.error} empty={!project.loading && !project.error && !project.data} onRetry={project.reload}/></section>
  }

  const toggleCompare = (id: string) => setCompareIds((current) => current.includes(id)
    ? current.filter((item) => item !== id)
    : current.length >= 3 ? current : [...current, id])
  const toggleOccupancy = (value: number) => setSelectedOccupancies((current) => current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value].sort())

  return <section className={styles.page}>
    <FeatureHeader eyebrow={`${project.data.projectNo} · INVESTMENT FORECAST`} title={project.data.name} description="正式版本不可覆盖；修改时复制为新草稿。管理费始终按年营业收入乘以所选费率计算。" actions={<>
      <button className="secondary" onClick={() => go('investments')}>返回列表</button>
      {canManage && <button className="secondary" disabled={command.busy} onClick={() => void run(() => copyInvestmentVersion(identity, version.id), '已复制为采用最新成本参数的新草稿')}>复制为新草稿</button>}
      {canManage && <button className="secondary" disabled={command.busy} onClick={() => void run(() => setInvestmentProjectArchived(identity, project.data!, project.data!.lifecycleStatus !== 'ARCHIVED'), project.data!.lifecycleStatus === 'ARCHIVED' ? '项目已恢复' : '项目已归档')}>{project.data.lifecycleStatus === 'ARCHIVED' ? '恢复项目' : '归档项目'}</button>}
    </>}/>
    {(message || error) && <div className={error ? styles.error : styles.success}>{error || message}</div>}
    <section className={styles.versionBar}>
      <div><strong>方案版本</strong>{project.data.versions.map((item) => <button key={item.id} className={item.id === version.id ? styles.activeVersion : ''} onClick={() => setSelectedVersionId(item.id)}>V{String(item.versionNo).padStart(3, '0')} · {statusLabel(item.lifecycleStatus)}</button>)}</div>
      <span>成本参数 COST-V{String(version.costParameters.versionNo).padStart(3, '0')}</span>
    </section>
    {version.lifecycleStatus === 'DRAFT' && canManage && project.data.lifecycleStatus === 'ACTIVE'
      ? <section className={styles.panel}><header><div><span>DRAFT INPUTS</span><h2>测算参数</h2></div>{canConfirm && <button className="primary" disabled={command.busy || !version.calculation.formalConfirmationAllowed} onClick={() => {
        if (window.confirm('确认后将生成不可修改的正式预测，是否继续？')) void run(() => confirmInvestmentVersion(identity, version), '正式预测已确认并锁定')
      }}>确认正式预测</button>}</header><PlanEditor key={version.id} initialName={version.projectName} initial={version.input} submitLabel="保存并重新测算" busy={command.busy} onSubmit={async (name, input) => { await run(() => updateInvestmentDraft(identity, version, name, input), '草稿已保存，四档情景已重新计算') }}/></section>
      : <InputSnapshot version={version}/>}
    <ScenarioAnalysis version={version}/>
    <section className={styles.twoColumns}>
      <article className={styles.panel}><header><div><span>DETERMINISTIC ANALYSIS</span><h2>综合预测分析</h2></div><StatusBadge value={version.analysisOrigin}/></header><p className={styles.analysis}>{version.input.reviewedAnalysis || version.calculation.systemAnalysis}</p><small>公式负责金额与等级；该文字不改变测算结果。未接通AI Gateway时采用确定性基础分析。</small></article>
      <article className={styles.panel}><header><div><span>MODEL CHECKS</span><h2>风险与校验</h2></div><span className={version.calculation.formalConfirmationAllowed ? styles.pass : styles.block}>{version.calculation.formalConfirmationAllowed ? '可确认' : '禁止确认'}</span></header>{version.calculation.warnings.length ? <ul className={styles.warningList}>{version.calculation.warnings.map((item) => <li key={item.code} className={item.blocksFormalConfirmation ? styles.blocking : ''}><strong>{item.blocksFormalConfirmation ? '阻断' : '提示'}</strong>{item.message}</li>)}</ul> : <p>当前参数未发现校验异常。</p>}</article>
    </section>
    <section className={styles.panel}><header><div><span>VERSION COMPARISON</span><h2>历史版本对比</h2></div><span>选择2～3个版本</span></header><div className={styles.compareSelector}>{project.data.versions.map((item) => <label key={item.id}><input type="checkbox" checked={compareIds.includes(item.id)} onChange={() => toggleCompare(item.id)}/>V{String(item.versionNo).padStart(3, '0')} · {statusLabel(item.lifecycleStatus)}</label>)}</div>{compareIds.length >= 2 && <VersionComparison versions={project.data.versions.filter((item) => compareIds.includes(item.id))}/>}</section>
    {canExport && <section className={styles.panel}><header><div><span>REPORT EXPORT</span><h2>报告导出</h2></div></header><div className={styles.exportRow}><div>{[80, 85, 90, 95].map((value) => <label key={value}><input type="checkbox" checked={selectedOccupancies.includes(value)} onChange={() => toggleOccupancy(value)}/>{value}%</label>)}</div><button className="secondary" disabled={command.busy} onClick={() => void downloadInvestmentExcel(identity, version)}>导出完整Excel</button><button className="primary" disabled={command.busy || !selectedOccupancies.length} onClick={() => void downloadInvestmentPdf(identity, version, selectedOccupancies)}>导出所选PDF</button></div><p className={styles.note}>PDF可选择一个、多个或全部出租率；选择仅影响报告内容，不生成新版本。导出文件名统一为“项目名称+投资测算”。</p></section>}
    <section className={styles.panel}><header><div><span>AUDIT TRAIL</span><h2>操作审计</h2></div><button className="secondary" onClick={() => void audit.reload()}>刷新</button></header><AsyncState loading={audit.loading} error={audit.error} empty={!audit.data.length} onRetry={audit.reload} emptyTitle="暂无审计记录"/><div className={styles.auditList}>{audit.data.slice(0, 30).map((item) => <article key={item.id}><strong>{auditLabel(item.action)}</strong><span>{formatLocalDateTime(item.createdAt)} · {item.actorId || 'SYSTEM'}</span></article>)}</div></section>
  </section>
}

function PlanEditor({ initialName = '', initial, submitLabel, busy, onSubmit }: {
  initialName?: string
  initial?: PlanInput
  submitLabel: string
  busy: boolean
  onSubmit: (projectName: string, input: PlanInput) => Promise<void>
}) {
  const [projectName, setProjectName] = useState(initialName)
  const [form, setForm] = useState(() => planForm(initial))
  const set = (key: keyof PlanForm, value: string) => setForm((current) => ({ ...current, [key]: value }))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void onSubmit(projectName.trim(), {
      rentPerSqmMonth: Number(form.rentPerSqmMonth), propertyAreaSqm: Number(form.propertyAreaSqm),
      propertyFeePerSqmMonth: Number(form.propertyFeePerSqmMonth), roomCount: Number(form.roomCount),
      staffCount: Number(form.staffCount), positioning: form.positioning as PlanInput['positioning'],
      managementFeeRate: Number(form.managementFeeRate), sellingRoomRate: Number(form.sellingRoomRate),
      investmentTotal: Number(form.investmentTotal), notes: form.notes.trim() || undefined,
      reviewedAnalysis: form.reviewedAnalysis.trim() || undefined,
    })
  }
  return <form className={styles.form} onSubmit={submit}>
    <label>项目名称<input required maxLength={100} value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="例如：贵阳观山湖精品酒店"/></label>
    <label>租金（元/㎡/月）<input required min="0" step="0.01" type="number" value={form.rentPerSqmMonth} onChange={(event) => set('rentPerSqmMonth', event.target.value)}/></label>
    <label>物业面积（㎡）<input required min="0.01" step="0.01" type="number" value={form.propertyAreaSqm} onChange={(event) => set('propertyAreaSqm', event.target.value)}/></label>
    <label>物业费（元/㎡/月）<input required min="0" step="0.01" type="number" value={form.propertyFeePerSqmMonth} onChange={(event) => set('propertyFeePerSqmMonth', event.target.value)}/></label>
    <label>房间数量<input required min="1" step="1" type="number" value={form.roomCount} onChange={(event) => set('roomCount', event.target.value)}/></label>
    <label>人员数量<input required min="1" step="1" type="number" value={form.staffCount} onChange={(event) => set('staffCount', event.target.value)}/></label>
    <label>项目定位<select value={form.positioning} onChange={(event) => set('positioning', event.target.value)}><option value="THREE_DIAMOND">三钻（运营费15元/间夜）</option><option value="FOUR_DIAMOND">四钻（运营费30元/间夜）</option></select></label>
    <label>管理费率<select value={form.managementFeeRate} onChange={(event) => set('managementFeeRate', event.target.value)}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value / 100}>{value}%</option>)}</select></label>
    <label>售卖房价（元/间夜）<input required min="0.01" step="0.01" type="number" value={form.sellingRoomRate} onChange={(event) => set('sellingRoomRate', event.target.value)}/></label>
    <label>投资总额（元）<input required min="0.01" step="0.01" type="number" value={form.investmentTotal} onChange={(event) => set('investmentTotal', event.target.value)}/></label>
    <label className={styles.full}>备注<textarea maxLength={1000} value={form.notes} onChange={(event) => set('notes', event.target.value)} placeholder="可填写物业条件、免租安排或测算说明"/></label>
    <label className={styles.full}>确认分析（选填）<textarea maxLength={8000} value={form.reviewedAnalysis} onChange={(event) => set('reviewedAnalysis', event.target.value)} placeholder="留空则使用系统确定性分析；填写后作为人工确认分析进入正式报告"/></label>
    <div className={styles.full}><button className="primary" disabled={busy}>{busy ? '处理中…' : submitLabel}</button></div>
  </form>
}

function InputSnapshot({ version }: { version: InvestmentVersion }) {
  const input = version.input
  return <section className={styles.panel}><header><div><span>LOCKED INPUT SNAPSHOT</span><h2>正式参数快照</h2></div><StatusBadge value={version.lifecycleStatus}/></header><dl className={styles.snapshotGrid}>
    <Snapshot label="租金" value={`${money(input.rentPerSqmMonth)}/㎡/月`}/><Snapshot label="物业面积" value={`${number(input.propertyAreaSqm)}㎡`}/><Snapshot label="物业费" value={`${money(input.propertyFeePerSqmMonth)}/㎡/月`}/><Snapshot label="房间数量" value={`${input.roomCount}间`}/><Snapshot label="人员数量" value={`${input.staffCount}人`}/><Snapshot label="项目定位" value={input.positioning === 'FOUR_DIAMOND' ? '四钻' : '三钻'}/><Snapshot label="管理费率" value={percent(input.managementFeeRate)}/><Snapshot label="售卖房价" value={money(input.sellingRoomRate)}/><Snapshot label="投资总额" value={money(input.investmentTotal)}/>
  </dl></section>
}

function ScenarioAnalysis({ version }: { version: InvestmentVersion }) {
  const defaultScenario = version.calculation.scenarios.find((item) => item.occupancyRate === 0.85) || version.calculation.scenarios[0]
  const maxValue = Math.max(...version.calculation.scenarios.map((item) => item.annualRevenue), 1)
  return <>
    <section className={styles.metrics}>
      <Metric label="85%年收入" value={money(defaultScenario.annualRevenue)} note="默认主预测"/>
      <Metric label="85%年成本" value={money(defaultScenario.annualCost)} note="不含管理费"/>
      <Metric label="85%年管理费" value={money(defaultScenario.annualManagementFee)} note={`年收入 × ${percent(version.input.managementFeeRate)}`}/>
      <Metric label="85%年利润" value={money(defaultScenario.annualProfit)} note={ratingLabel(defaultScenario.rating)} negative={defaultScenario.annualProfit < 0}/>
      <Metric label="回收时长" value={defaultScenario.paybackYears == null ? '无法回收' : `${number(defaultScenario.paybackYears)}年`} note={`ROI ${percent(defaultScenario.investmentReturnRate)}`}/>
      <Metric label="盈亏平衡出租率" value={version.calculation.breakEvenOccupancyRate == null ? '无法形成' : percent(version.calculation.breakEvenOccupancyRate)} note="固定成本÷单房贡献"/>
    </section>
    <section className={styles.panel}><header><div><span>OCCUPANCY SCENARIOS</span><h2>四档出租率综合预测</h2></div></header><div className={styles.tableWrap}><table><thead><tr><th>出租率</th><th>年开房量</th><th>全年均价</th><th>年收入</th><th>年成本</th><th>年管理费</th><th>年利润</th><th>总投资金额</th><th>回报率</th><th>回收时长</th><th>判定</th></tr></thead><tbody>{version.calculation.scenarios.map((item) => <tr key={item.occupancyRate}><td>{percent(item.occupancyRate)}</td><td>{number(item.soldRoomNights)}</td><td>{money(version.input.sellingRoomRate)}</td><td>{money(item.annualRevenue)}</td><td>{money(item.annualCost)}</td><td>{money(item.annualManagementFee)}</td><td className={item.annualProfit < 0 ? styles.negative : styles.positive}>{money(item.annualProfit)}</td><td>{money(version.input.investmentTotal)}</td><td>{percent(item.investmentReturnRate)}</td><td>{item.paybackYears == null ? '无法回收' : `${number(item.paybackYears)}年`}</td><td><span className={`${styles.rating} ${styles[item.rating.toLowerCase()]}`}>{ratingLabel(item.rating)}</span></td></tr>)}</tbody></table></div></section>
    <section className={styles.twoColumns}><article className={styles.panel}><header><div><span>REVENUE · COST · PROFIT</span><h2>情景收益对比</h2></div></header><div className={styles.barChart}>{version.calculation.scenarios.map((item) => <div key={item.occupancyRate} className={styles.barGroup}><strong>{percent(item.occupancyRate)}</strong><Bar label="收入" value={item.annualRevenue} max={maxValue} kind="revenue"/><Bar label="成本" value={item.annualCost} max={maxValue} kind="cost"/><Bar label="利润" value={Math.max(0, item.annualProfit)} max={maxValue} kind="profit"/></div>)}</div></article><CostStructure version={version} scenario={defaultScenario}/></section>
  </>
}

function CostStructure({ version, scenario }: { version: InvestmentVersion; scenario: ScenarioResult }) {
  const items = [
    ['租金及物业', scenario.annualPropertyCost], ['人工', scenario.annualLaborCost],
    ['单房变动成本', scenario.annualVariableCost], ['管理费', scenario.annualManagementFee],
  ] as const
  const total = items.reduce((sum, item) => sum + item[1], 0) || 1
  return <article className={styles.panel}><header><div><span>COST STRUCTURE · 85%</span><h2>成本结构</h2></div></header><div className={styles.costList}>{items.map(([label, value]) => <div key={label}><span>{label}<strong>{money(value)}</strong></span><div><i style={{ width: `${Math.max(2, value / total * 100)}%` }}/></div></div>)}</div><p className={styles.note}>单房变动成本：{money(version.calculation.unitVariableCost)}/已售间夜；年固定成本：{money(version.calculation.annualFixedCost)}。</p></article>
}

function VersionComparison({ versions }: { versions: InvestmentVersion[] }) {
  return <div className={styles.tableWrap}><table><thead><tr><th>指标</th>{versions.map((item) => <th key={item.id}>V{String(item.versionNo).padStart(3, '0')}<small>{statusLabel(item.lifecycleStatus)}</small></th>)}</tr></thead><tbody>{[
    ['售卖房价', (item: InvestmentVersion) => money(item.input.sellingRoomRate)],
    ['投资总额', (item: InvestmentVersion) => money(item.input.investmentTotal)],
    ['管理费率', (item: InvestmentVersion) => percent(item.input.managementFeeRate)],
    ['成本参数', (item: InvestmentVersion) => `COST-V${String(item.costParameters.versionNo).padStart(3, '0')}`],
    ['85%年收入', (item: InvestmentVersion) => money(scenario85(item).annualRevenue)],
    ['85%年利润', (item: InvestmentVersion) => money(scenario85(item).annualProfit)],
    ['85%回收期', (item: InvestmentVersion) => scenario85(item).paybackYears == null ? '无法回收' : `${number(scenario85(item).paybackYears)}年`],
    ['85%判定', (item: InvestmentVersion) => ratingLabel(scenario85(item).rating)],
  ].map(([label, value]) => <tr key={String(label)}><td>{String(label)}</td>{versions.map((item) => <td key={item.id}>{(value as (item: InvestmentVersion) => string)(item)}</td>)}</tr>)}</tbody></table></div>
}

function CostParameterPage({ identity, grantedPermissions, go }: {
  identity: RoleContext
  grantedPermissions: string[]
  go: AppNavigate
}) {
  const parameters = useScopedResource(`${identity.key}:investment-cost-parameters`, (signal) => loadInvestmentCostParameters(identity, signal), [])
  const command = useStableCommand('investment-cost-parameters')
  const [editing, setEditing] = useState<CostParameterVersion | undefined>()
  const [creating, setCreating] = useState(false)
  const [creatingFrom, setCreatingFrom] = useState<CostParameterVersion | undefined>()
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()
  const canConfigure = identity.roleCode === 'PLATFORM_ADMIN' && hasPermission(grantedPermissions, permissions.investment.configure)
  const canActivate = identity.roleCode === 'CEO' && hasPermission(grantedPermissions, permissions.investment.parameterConfirm)
  const active = parameters.data.find((item) => item.lifecycleStatus === 'ACTIVE')
  const run = async (operation: () => Promise<unknown>, success: string) => {
    setError(undefined); setMessage(undefined)
    try { await command.run(operation); setMessage(success); setCreating(false); setCreatingFrom(undefined); setEditing(undefined); await parameters.reload() }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败') }
  }
  return <section className={styles.page}>
    <FeatureHeader eyebrow="VERSIONED COST PARAMETERS" title="投资测算成本参数" description="可新增固定成本配置，或基于现有配置修改并保存为新版本草稿；历史正式预测继续引用原版本，不随参数变化。" actions={<><button className="secondary" onClick={() => go('investments')}>返回投资测算</button>{canConfigure && <button className="primary" onClick={() => { setEditing(undefined); setCreatingFrom(undefined); setCreating(true) }}>新增固定成本配置</button>}</>}/>
    {(message || error) && <div className={error ? styles.error : styles.success}>{error || message}</div>}
    {creating && <section className={styles.panel}><header><div><span>{creatingFrom ? `MODIFY COST-V${String(creatingFrom.versionNo).padStart(3, '0')}` : 'NEW COST CONFIGURATION'}</span><h2>{creatingFrom ? '修改固定成本参数（新版本草稿）' : '新增固定成本配置'}</h2><p>{creatingFrom ? '已生效版本不会被覆盖；保存后将创建新的可编辑草稿，待 CEO 确认启用。' : '请填写新的成本口径；保存后将创建新的可编辑草稿，待 CEO 确认启用。'}</p></div><button className="secondary" type="button" onClick={() => { setCreating(false); setCreatingFrom(undefined) }}>取消</button></header><CostParameterEditor initial={creatingFrom} busy={command.busy} submitLabel={creatingFrom ? '保存为新版本草稿' : '新增参数草稿'} onSubmit={(input) => run(() => createInvestmentCostParameters(identity, input), creatingFrom ? '修改已保存为新版本草稿' : '成本参数草稿已创建')}/></section>}
    <AsyncState loading={parameters.loading} error={parameters.error} empty={!parameters.data.length} onRetry={parameters.reload}/>
    <div className={styles.parameterList}>{parameters.data.map((item) => <article key={item.id} className={styles.panel}><header><div><span>COST-V{String(item.versionNo).padStart(3, '0')}</span><h2>固定成本参数</h2></div><StatusBadge value={item.lifecycleStatus}/></header>{editing?.id === item.id ? <CostParameterEditor initial={item} busy={command.busy} onSubmit={(input) => run(() => updateInvestmentCostParameters(identity, item, input), '成本参数草稿已更新')}/> : <dl className={styles.snapshotGrid}><Snapshot label="人员工资" value={`${money(item.salaryPerPersonMonth)}/人/月`}/><Snapshot label="易耗品" value={`${money(item.consumablesPerRoomNight)}/间夜`}/><Snapshot label="布草洗涤" value={`${money(item.linenPerRoomNight)}/间夜`}/><Snapshot label="水电" value={`${money(item.utilitiesPerRoomNight)}/间夜`}/><Snapshot label="三钻运营费" value={`${money(item.threeDiamondOperationsPerRoomNight)}/间夜`}/><Snapshot label="四钻运营费" value={`${money(item.fourDiamondOperationsPerRoomNight)}/间夜`}/></dl>}<footer className={styles.actions}>{canConfigure && item.lifecycleStatus === 'ACTIVE' && <button className="secondary" disabled={command.busy} onClick={() => { setEditing(undefined); setCreatingFrom(item); setCreating(true) }}>修改此配置</button>}{canConfigure && item.lifecycleStatus === 'DRAFT' && <button className="secondary" onClick={() => { setCreating(false); setCreatingFrom(undefined); setEditing(item) }}>编辑草稿</button>}{canActivate && item.lifecycleStatus === 'DRAFT' && <button className="primary" disabled={command.busy} onClick={() => { if (window.confirm('启用后旧参数将停用，是否继续？')) void run(() => activateInvestmentCostParameters(identity, item), '新成本参数已生效') }}>CEO确认启用</button>}<span>创建 {formatLocalDateTime(item.createdAt)}</span></footer></article>)}</div>
  </section>
}

function CostParameterEditor({ initial, busy, submitLabel, onSubmit }: {
  initial?: CostParameterVersion
  busy: boolean
  submitLabel?: string
  onSubmit: (input: CostParameterInput) => Promise<void>
}) {
  const [form, setForm] = useState(() => ({
    salaryPerPersonMonth: String(initial?.salaryPerPersonMonth ?? 5500),
    consumablesPerRoomNight: String(initial?.consumablesPerRoomNight ?? 6),
    linenPerRoomNight: String(initial?.linenPerRoomNight ?? 8),
    utilitiesPerRoomNight: String(initial?.utilitiesPerRoomNight ?? 12),
    threeDiamondOperationsPerRoomNight: String(initial?.threeDiamondOperationsPerRoomNight ?? 15),
    fourDiamondOperationsPerRoomNight: String(initial?.fourDiamondOperationsPerRoomNight ?? 30),
  }))
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }))
  return <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void onSubmit(Object.fromEntries(Object.entries(form).map(([key, value]) => [key, Number(value)])) as CostParameterInput) }}>
    {(Object.keys(form) as Array<keyof typeof form>).map((key) => <label key={key}>{costLabel(key)}<input required min="0" step="0.01" type="number" value={form[key]} onChange={(event) => set(key, event.target.value)}/></label>)}
    <div className={styles.full}><button className="primary" disabled={busy}>{busy ? '保存中…' : submitLabel || '保存参数草稿'}</button></div>
  </form>
}

function Metric({ label, value, note, negative = false }: { label: string; value: string; note: string; negative?: boolean }) { return <article className={styles.metric}><span>{label}</span><strong className={negative ? styles.negative : ''}>{value}</strong><small>{note}</small></article> }
function Snapshot({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div> }
function Bar({ label, value, max, kind }: { label: string; value: number; max: number; kind: string }) { return <div className={styles.barRow}><span>{label}</span><div><i className={styles[kind]} style={{ width: `${Math.max(value > 0 ? 2 : 0, value / max * 100)}%` }}/></div><small>{money(value)}</small></div> }

type PlanForm = Record<'rentPerSqmMonth' | 'propertyAreaSqm' | 'propertyFeePerSqmMonth' | 'roomCount' | 'staffCount' | 'positioning' | 'managementFeeRate' | 'sellingRoomRate' | 'investmentTotal' | 'notes' | 'reviewedAnalysis', string>
function planForm(input?: PlanInput): PlanForm { return { rentPerSqmMonth: String(input?.rentPerSqmMonth ?? ''), propertyAreaSqm: String(input?.propertyAreaSqm ?? ''), propertyFeePerSqmMonth: String(input?.propertyFeePerSqmMonth ?? ''), roomCount: String(input?.roomCount ?? ''), staffCount: String(input?.staffCount ?? ''), positioning: input?.positioning ?? 'THREE_DIAMOND', managementFeeRate: String(input?.managementFeeRate ?? 0.05), sellingRoomRate: String(input?.sellingRoomRate ?? ''), investmentTotal: String(input?.investmentTotal ?? ''), notes: input?.notes ?? '', reviewedAnalysis: input?.reviewedAnalysis ?? '' } }
function scenario85(version: InvestmentVersion) { return version.calculation.scenarios.find((item) => item.occupancyRate === 0.85) || version.calculation.scenarios[0] }
function money(value?: number) { return value == null ? '—' : `${number(value)}元` }
function number(value?: number) { return value == null ? '—' : new Intl.NumberFormat('zh-CN', { useGrouping: false, maximumFractionDigits: 2 }).format(value) }
function percent(value?: number) { return value == null ? '—' : new Intl.NumberFormat('zh-CN', { style: 'percent', useGrouping: false, maximumFractionDigits: 2 }).format(value) }
function ratingLabel(value?: string) { return ({ LOSS: '亏损', HIGH_RISK: '高风险', CAUTIOUS: '谨慎', FEASIBLE: '可行', QUALITY: '优质' } as Record<string, string>)[value || ''] || '待测算' }
function statusLabel(value: string) { return ({ DRAFT: '草稿', FORMAL: '正式预测', HISTORICAL: '历史版本', ACTIVE: '生效', ARCHIVED: '已归档' } as Record<string, string>)[value] || value }
function auditLabel(value: string) { return ({ INVESTMENT_PROJECT_CREATED: '新建项目', INVESTMENT_DRAFT_UPDATED: '修改并重算', INVESTMENT_VERSION_CONFIRMED: '确认正式预测', INVESTMENT_VERSION_COPIED: '复制为新草稿', INVESTMENT_PROJECT_ARCHIVED: '归档项目', INVESTMENT_PROJECT_RESTORED: '恢复项目', INVESTMENT_EXCEL_EXPORTED: '导出Excel', INVESTMENT_PDF_EXPORTED: '导出PDF' } as Record<string, string>)[value] || value }
function costLabel(value: string) { return ({ salaryPerPersonMonth: '人员工资（元/人/月）', consumablesPerRoomNight: '易耗品（元/间夜）', linenPerRoomNight: '布草洗涤（元/间夜）', utilitiesPerRoomNight: '水电（元/间夜）', threeDiamondOperationsPerRoomNight: '三钻运营费（元/间夜）', fourDiamondOperationsPerRoomNight: '四钻运营费（元/间夜）' } as Record<string, string>)[value] || value }
