import { useMemo, useState } from 'react';
import { hasPermission, permissions } from '../../app/permissions';
import type { AppNavigate, DailyFeatureRouteId } from '../../app/routeConfig';
import type { RoleContext, RouteParams } from '../../domain';
import { AsyncState } from '../../shared/AsyncState';
import { useScopedResource } from '../../shared/useScopedResource';
import { useStableCommand } from '../../shared/useStableCommand';
import { FeatureHeader, StatusBadge, featureStyles as styles, formatLocalDateTime } from '../shared/FeatureUI';
import { calculateKpiSourcePreview, downloadKpiExport, disputeKpiScorecard, generateKpiPeriod, generateKpiTemplateDrafts, loadInspectionSchedules, loadInspections, loadKpiPeriods, loadKpiRelations, loadKpiSourcePreviewCatalog, loadKpiScorecard, loadKpiScorecards, loadKpiSettlements, loadKpiTemplate, loadKpiTemplateVersion, loadKpiTemplates, loadKpiPositions, recordInspectionEvent, reviewKpiScorecard, submitInspection, submitManualKpiScore, uploadKpiTemplate, updateKpiTemplateVersion, verifyInspection, } from './api';
import type { KpiImportUpload, KpiSourcePreviewResult } from './api';
import type { InspectionSchedule, InspectionSubmission, KpiScorecard, KpiScorecardDetail } from './types';
export function KpiRoutes({ view, params, identity, grantedPermissions, go, }: {
    view: DailyFeatureRouteId;
    params: RouteParams;
    identity: RoleContext;
    grantedPermissions: string[];
    go: AppNavigate;
}) {
    if (view === 'kpi-center')
        return <KpiOverview identity={identity} grantedPermissions={grantedPermissions} go={go}/>;
    if (view === 'kpi-scorecards')
        return <ScorecardList identity={identity} grantedPermissions={grantedPermissions} params={params} go={go}/>;
    if (view === 'kpi-scorecard-detail')
        return params.scorecardId
            ? <ScorecardDetail identity={identity} grantedPermissions={grantedPermissions} scorecardId={params.scorecardId} go={go}/>
            : <AsyncState loading={false} error={new Error('路由缺少考核单编号')}/>;
    if (view === 'kpi-templates')
        return <TemplateList identity={identity} grantedPermissions={grantedPermissions} go={go}/>;
    if (view === 'kpi-template-detail')
        return params.templateId
            ? <TemplateDetail identity={identity} grantedPermissions={grantedPermissions} templateId={params.templateId} go={go}/>
            : <AsyncState loading={false} error={new Error('路由缺少模板编号')}/>;
    if (view === 'kpi-relations')
        return <RelationList identity={identity}/>;
    if (view === 'kpi-settlements')
        return <SettlementList identity={identity} grantedPermissions={grantedPermissions} params={params}/>;
    return <InspectionCenter identity={identity} grantedPermissions={grantedPermissions}/>;
}
function KpiOverview({ identity, grantedPermissions, go }: {
    identity: RoleContext;
    grantedPermissions: string[];
    go: AppNavigate;
}) {
    const periods = useScopedResource(`${identity.key}:kpi-periods`, (signal) => loadKpiPeriods(identity, signal), []);
    const scorecards = useScopedResource(`${identity.key}:kpi-scorecards-overview`, (signal) => loadKpiScorecards(identity, signal), []);
    const command = useStableCommand('kpi-period-generate');
    const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
    const [message, setMessage] = useState<string>();
    const pending = scorecards.data.filter((item) => ['PENDING_MANUAL', 'PENDING_VERIFICATION', 'DISPUTE'].includes(item.status)).length;
    const warning = scorecards.data.filter((item) => item.warningLevel && item.warningLevel !== 'NONE').length;
    const generate = async () => {
        setMessage(undefined);
        try {
            await command.run((key) => generateKpiPeriod(identity, { monthStart: `${month}-01`, generationType: 'ALL', reason: '行政人事后台手动重算', idempotencyKey: key }));
            await Promise.all([periods.reload(), scorecards.reload()]);
            setMessage('四周及月度考核单已重算，历史修订仍保留。');
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : '生成失败');
        }
    };
    return <section className={styles.page}>
    <FeatureHeader eyebrow="HR · KPI PERFORMANCE CENTER" title="KPI考核与绩效复盘中心" description="统一配置岗位KPI、生成固定四周与月度考核单、处理复核异议并锁定奖金结果。缺失数据标记待核验，不按0分处理。"/>
    <section className={styles.metricGrid}>
      <button className={`${styles.metric} metric-action`} onClick={() => go('kpi-scorecards')}><span>考核单总数</span><strong>{scorecards.data.length}</strong><small>本人、门店或授权团队范围</small></button>
      <div className={styles.metric}><span>待评分/待核验</span><strong>{pending}</strong><small>锁定前必须处理完成</small></div>
      <div className={styles.metric}><span>过程预警</span><strong>{warning}</strong><small>同一指标连续周次升级</small></div>
      <div className={styles.metric}><span>考核周期</span><strong>{periods.data.length}</strong><small>固定四周，不自动变成五周</small></div>
    </section>
    <section className={styles.toolbar}>
      {hasPermission(grantedPermissions, permissions.kpi.scorecardGenerate) && <><label>考核月份<input type="month" value={month} onChange={(event) => setMonth(event.target.value)}/></label><button className="primary" disabled={command.busy} onClick={() => void generate()}>{command.busy ? '生成中…' : '生成/重算考核单'}</button></>}
      <button className="secondary" onClick={() => go('kpi-scorecards')}>考核单</button>
      {hasPermission(grantedPermissions, permissions.kpi.templateRead) && <button className="secondary" onClick={() => go('kpi-templates')}>岗位模板</button>}
      {hasPermission(grantedPermissions, permissions.kpi.relationManage) && <button className="secondary" onClick={() => go('kpi-relations')}>考核关系</button>}
      {hasPermission(grantedPermissions, permissions.kpi.settlementRead) && <button className="secondary" onClick={() => go('kpi-settlements')}>奖金结算</button>}
      {(hasPermission(grantedPermissions, permissions.kpi.inspectionSubmit) || hasPermission(grantedPermissions, permissions.kpi.inspectionReadTeam)) && <button className="secondary" onClick={() => go('kpi-inspections')}>OTA巡检留痕</button>}
    </section>
    {message && <div className={styles.locked}>{message}</div>}
    <AsyncState loading={periods.loading || scorecards.loading} error={periods.error || scorecards.error} onRetry={async () => { await Promise.all([periods.reload(), scorecards.reload()]); }}/>
    <section className={styles.section}><header><h2>最近考核周期</h2></header><div className={styles.actionList}>{periods.data.slice(0, 6).map((period) => <article key={period.id}><div><strong>{period.monthStart.slice(0, 7)} KPI</strong> <StatusBadge value={period.status}/></div><button className="secondary" onClick={() => go('kpi-scorecards', { periodId: period.id })}>查看考核单</button><p>{period.scorecardCount}张考核单 · {period.pendingCount}张待核验 · 锁定截止 {formatLocalDateTime(period.lockDueAt)}</p></article>)}</div></section>
  </section>;
}
function ScorecardList({ identity, grantedPermissions, params, go }: {
    identity: RoleContext;
    grantedPermissions: string[];
    params: RouteParams;
    go: AppNavigate;
}) {
    const cardType = params.cardType || '';
    const status = params.status || '';
    const resource = useScopedResource(`${identity.key}:kpi-scorecards:${params.periodId || ''}:${cardType}:${status}`, (signal) => loadKpiScorecards(identity, signal, { periodId: params.periodId, cardType, status }), []);
    const update = (nextType: string, nextStatus: string) => go('kpi-scorecards', { ...params, cardType: nextType || undefined, status: nextStatus || undefined });
    return <section className={styles.page}>
    <FeatureHeader eyebrow="WEEKLY & MONTHLY SCORECARDS" title="KPI考核单" description="固定四周成绩用于过程管理；月度比例指标按全月累计分子与分母重新计算，不平均四周比例。" actions={<>{hasPermission(grantedPermissions, permissions.kpi.export) && <button className="secondary" onClick={() => void downloadKpiExport(identity, 'scorecards', params.periodId)}>一键导出明细</button>}<button className="secondary" onClick={() => go('kpi-center')}>返回KPI中心</button></>}/>
    <div className={styles.toolbar}><label>考核单类型<select value={cardType} onChange={(event) => update(event.target.value, status)}><option value="">全部</option><option value="WEEK">周考核单</option><option value="MONTH">月考核单</option></select></label><label>状态<select value={status} onChange={(event) => update(cardType, event.target.value)}><option value="">全部</option><option value="PENDING_MANUAL">待人工评分</option><option value="PENDING_VERIFICATION">待核验</option><option value="DEPARTMENT_REVIEW">部门复核</option><option value="HR_REVIEW">人事复核</option><option value="LOCKED">已锁定</option></select></label></div>
    <AsyncState loading={resource.loading} error={resource.error} empty={!resource.data.length} onRetry={resource.reload} emptyTitle="当前范围暂无考核单"/>
    <div className={styles.cardGrid}>{resource.data.map((card) => <ScorecardCard key={card.id} card={card} go={go}/>)}</div>
  </section>;
}
function ScorecardCard({ card, go }: {
    card: KpiScorecard;
    go: AppNavigate;
}) {
    return <article className={styles.card}><header><strong>{card.employeeName} · {card.positionName}</strong><StatusBadge value={card.status}/></header><h2>{card.cardType === 'WEEK' ? `第${card.weekNo}周考核单` : '月度考核单'}</h2><p>{card.orgName} · {card.periodStart} 至 {card.periodEnd}</p><section className={styles.metricGrid}><div className={styles.metric}><span>最终得分</span><strong>{card.finalScore ?? '待核验'}</strong></div><div className={styles.metric}><span>预警</span><strong>{card.warningLevel}</strong></div></section><footer><button className="primary" onClick={() => go('kpi-scorecard-detail', { scorecardId: card.id })}>查看明细与证据</button></footer></article>;
}
function ScorecardDetail({ identity, grantedPermissions, scorecardId, go }: {
    identity: RoleContext;
    grantedPermissions: string[];
    scorecardId: string;
    go: AppNavigate;
}) {
    const resource = useScopedResource(`${identity.key}:kpi-scorecard:${scorecardId}`, (signal) => loadKpiScorecard(identity, scorecardId, signal), undefined as never);
    return <section className={styles.page}><FeatureHeader eyebrow="AUDITABLE KPI SCORECARD" title={resource.data ? `${resource.data.employeeName} · ${resource.data.cardType === 'WEEK' ? `第${resource.data.weekNo}周` : '月度'}考核单` : '考核单详情'} description="每次计算生成新修订，事实、人工评分和更正只追加不覆盖。" actions={<button className="secondary" onClick={() => go('kpi-scorecards')}>返回列表</button>}/><AsyncState loading={resource.loading} error={resource.error} onRetry={resource.reload}/>{resource.data && <ScorecardBody identity={identity} grantedPermissions={grantedPermissions} card={resource.data} reload={resource.reload}/>}</section>;
}
function ScorecardBody({ identity, grantedPermissions, card, reload }: {
    identity: RoleContext;
    grantedPermissions: string[];
    card: KpiScorecardDetail;
    reload: () => Promise<void>;
}) {
    const command = useStableCommand(`kpi-scorecard-${card.id}`);
    const [message, setMessage] = useState<string>();
    const [manual, setManual] = useState({ indicatorRuleId: '', score: '', explanation: '', evidenceReference: '' });
    const [dispute, setDispute] = useState('');
    const actReview = async (stage: string) => {
        try {
            await command.run(() => reviewKpiScorecard(identity, card, { stage, decision: 'APPROVED', comment: `${stage}确认` }));
            await reload();
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : '复核失败');
        }
    };
    const submitManual = async () => {
        try {
            await command.run(() => submitManualKpiScore(identity, card.id, { ...manual, score: Number(manual.score), evaluatorAssignmentId: identity.assignmentId }));
            await reload();
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : '人工评分失败');
        }
    };
    const createDispute = async () => {
        try {
            await command.run(() => disputeKpiScorecard(identity, card.id, { reason: dispute }));
            await reload();
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : '异议提交失败');
        }
    };
    const manualRules = card.indicators.filter((item) => item.dataState === 'PENDING_VERIFICATION');
    return <><section className={styles.metricGrid}><div className={styles.metric}><span>基础得分</span><strong>{card.baseScore ?? '—'}</strong></div><div className={styles.metric}><span>额外加分</span><strong>{card.extraScore ?? '—'}</strong></div><div className={styles.metric}><span>最终得分</span><strong>{card.finalScore ?? '待核验'}</strong></div><div className={styles.metric}><span>当前修订</span><strong>V{card.currentRevisionNo}</strong></div></section>
    <section className={styles.section}><header><h2>指标明细</h2><StatusBadge value={card.status}/></header><div className={styles.actionList}>{card.indicators.map((item) => <article key={item.id}><div><strong>{item.name}</strong> <StatusBadge value={item.dataState}/></div><span>{item.score ?? '待核验'} / {item.maxScore}</span><p>目标 {item.targetValue ?? '—'} · 实际 {item.actualValue ?? '—'} · {item.outcome}</p></article>)}</div></section>
    {hasPermission(grantedPermissions, permissions.kpi.scorecardManual) && !!manualRules.length && <section className={styles.section}><h2>评价人直接输入分数</h2><div className={styles.formGrid}><label>指标<select value={manual.indicatorRuleId} onChange={(event) => setManual({ ...manual, indicatorRuleId: event.target.value })}><option value="">选择指标</option>{manualRules.map((item) => <option key={item.indicatorRuleId} value={item.indicatorRuleId}>{item.name}</option>)}</select></label><label>分数<input type="number" value={manual.score} onChange={(event) => setManual({ ...manual, score: event.target.value })}/></label><label className={styles.full}>评分说明<textarea value={manual.explanation} onChange={(event) => setManual({ ...manual, explanation: event.target.value })}/></label><label className={styles.full}>证据引用<input value={manual.evidenceReference} onChange={(event) => setManual({ ...manual, evidenceReference: event.target.value })}/></label></div><button className="primary" disabled={command.busy || !identity.assignmentId || !manual.indicatorRuleId || !manual.score || !manual.explanation.trim()} onClick={() => void submitManual()}>提交人工评分</button></section>}
    {hasPermission(grantedPermissions, permissions.kpi.scorecardReview) && <section className={styles.toolbar}><button className="secondary" disabled={command.busy} onClick={() => void actReview('DEPARTMENT')}>部门确认</button><button className="secondary" disabled={command.busy} onClick={() => void actReview('HR')}>人事确认</button>{hasPermission(grantedPermissions, permissions.kpi.scorecardLock) && <button className="primary" disabled={command.busy} onClick={() => void actReview('CEO')}>CEO确认</button>}</section>}
    {hasPermission(grantedPermissions, permissions.kpi.scorecardDispute) && <section className={styles.toolbar}><label>异议原因<input value={dispute} onChange={(event) => setDispute(event.target.value)}/></label><button className="secondary" disabled={command.busy || !dispute.trim()} onClick={() => void createDispute()}>提交异议</button></section>}
    {message && <div className="inline-error">{message}</div>}
    <section className={styles.split}><section className={styles.section}><h2>复核记录</h2><div className={styles.timeline}>{card.reviews.map((item, index) => <article key={index}><strong>{String(item.reviewStage)} · {String(item.decision)}</strong><small>{String(item.comment || '')} · {formatLocalDateTime(String(item.reviewedAt || ''))}</small></article>)}</div></section><section className={styles.section}><h2>修订与更正</h2><p>{card.revisions.length}个计算修订 · {card.disputes.length}个异议 · {card.corrections.length}个更正申请</p></section></section></>;
}
function TemplateList({ identity, grantedPermissions, go }: {
    identity: RoleContext;
    grantedPermissions: string[];
    go: AppNavigate;
}) {
    const resource = useScopedResource(`${identity.key}:kpi-templates`, (signal) => loadKpiTemplates(identity, signal), []);
    return <section className={styles.page}><FeatureHeader eyebrow="VERSIONED ROLE KPI" title="岗位KPI模板" description="各店、各岗位和各周期可独立配置。发布版本不可修改，只能复制形成未来周期的新版本。" actions={<button className="secondary" onClick={() => go('kpi-center')}>返回KPI中心</button>}/>{hasPermission(grantedPermissions, permissions.kpi.templateImport) && <TemplateImportPanel identity={identity} reload={resource.reload}/>}<AsyncState loading={resource.loading} error={resource.error} empty={!resource.data.length} onRetry={resource.reload}/><div className={styles.cardGrid}>{resource.data.map((template) => <article className={styles.card} key={template.id}><header><strong>{template.positionName || template.templateOrigin}</strong><StatusBadge value={template.lifecycleStatus || template.status}/></header><h2>{template.name}</h2><p>{template.code} · V{template.currentVersionNo || '草稿'} · {template.effectiveMonth || '未生效'}</p><footer><button className="secondary" onClick={() => go('kpi-template-detail', { templateId: template.id })}>查看/修改草稿</button></footer></article>)}</div></section>;
}
function TemplateImportPanel({ identity, reload }: {
    identity: RoleContext;
    reload: () => Promise<void>;
}) {
    const command = useStableCommand('kpi-template-import');
    const positions = useScopedResource(`${identity.key}:kpi-import-positions`, (signal) => loadKpiPositions(identity, signal), []);
    const [file, setFile] = useState<File>();
    const [uploaded, setUploaded] = useState<KpiImportUpload>();
    const [drafts, setDrafts] = useState<Array<{
        selected: boolean;
        sheetName: string;
        positionId: string;
        templateCode: string;
        templateName: string;
    }>>([]);
    const [message, setMessage] = useState<string>();
    const upload = async () => {
        if (!file)
            return;
        try {
            const result = await command.run(() => uploadKpiTemplate(identity, file));
            if (!result)
                return;
            setUploaded(result);
            setDrafts(result.templates.map((template) => ({ selected: true, sheetName: template.sheetName, positionId: template.suggestedPositionId || '', templateCode: template.templateCode, templateName: template.templateName })));
            setMessage(result.templates.length
                ? `已检查${result.sheetCount}张工作表，识别${result.templates.length}套岗位KPI；其余${result.ignoredSheets.length}张业务表已自动忽略。`
                : '没有识别到岗位KPI表。请确认表内含“指标类别、考核项目、衡量标准、目标值、权重、实际值”表头。');
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : '上传失败');
        }
    };
    const generate = async () => {
        if (!uploaded)
            return;
        const selected = drafts.filter((item) => item.selected);
        try {
            const result = await command.run(() => generateKpiTemplateDrafts(identity, uploaded.id, { templates: selected.map(({ selected: _selected, ...item }) => item) }));
            if (!result)
                return;
            setMessage(`已生成${String(result.draftCount || selected.length)}套可编辑草稿。现在可在下方模板列表进入修改；未审核、未发布，不会影响正式考核。`);
            await reload();
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : '生成草稿失败');
        }
    };
    const updateDraft = (index: number, changes: Partial<(typeof drafts)[number]>) => setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item));
    const ready = drafts.filter((item) => item.selected).length > 0 && drafts.filter((item) => item.selected).every((item) => item.positionId && item.templateCode.trim() && item.templateName.trim());
    return <section className={styles.section}><header><div><h2>一键导入门店岗位KPI</h2><p>直接上传组合工作簿，系统自动识别岗位表、合并重复员工并预选岗位。</p></div><span className={styles.badge}>仅生成草稿</span></header><div className={styles.toolbar}><input type="file" accept=".xlsx" onChange={(event) => { setFile(event.target.files?.[0]); setUploaded(undefined); setDrafts([]); setMessage(undefined); }}/><button className="secondary" disabled={!file || command.busy} onClick={() => void upload()}>{command.busy ? '解析中…' : '上传并自动识别'}</button></div><AsyncState loading={positions.loading} error={positions.error} onRetry={positions.reload}/>{uploaded && uploaded.templates.length > 0 && <><div className={styles.actionList}>{uploaded.templates.map((template, index) => { const draft = drafts[index]; return <article key={template.sheetName}><div><strong><input type="checkbox" checked={draft?.selected ?? true} onChange={(event) => updateDraft(index, { selected: event.target.checked })}/> {template.sheetName} → {template.suggestedPositionName}</strong><span>{template.indicators.length}项 · 基础满分{template.baseFullScore} · 绩效基数{template.bonusBase ?? '待配置'}</span></div>{draft?.selected && <div className={styles.formGrid}><label>适用岗位<select value={draft.positionId} onChange={(event) => updateDraft(index, { positionId: event.target.value })}><option value="">请选择岗位</option>{positions.data.filter((item) => item.status === 'ACTIVE').map((item) => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select></label><label>模板名称<input value={draft.templateName} onChange={(event) => updateDraft(index, { templateName: event.target.value })}/></label><label className={styles.full}>模板编码<input value={draft.templateCode} onChange={(event) => updateDraft(index, { templateCode: event.target.value.toUpperCase() })}/></label></div>}<p>{template.indicators.map((item) => `${item.section}/${item.name} ${item.maxScore}分`).join('；')}</p>{template.warnings.map((warning) => <small key={warning}>⚠ {warning}</small>)}</article>; })}</div><div className={styles.toolbar}><button className="primary" disabled={command.busy || !ready} onClick={() => void generate()}>{command.busy ? '生成中…' : `生成${drafts.filter((item) => item.selected).length}套可编辑草稿`}</button><span>不会自动审核或发布</span></div></>}{uploaded && uploaded.ignoredSheets.length > 0 && <details><summary>已忽略的{uploaded.ignoredSheets.length}张非模板工作表</summary><p>{uploaded.ignoredSheets.map((item) => `${item.sheetName}（${item.reason}）`).join('；')}</p></details>}{message && <div className={styles.locked}>{message}</div>}</section>;
}
function TemplateDetail({ identity, grantedPermissions, templateId, go }: {
    identity: RoleContext;
    grantedPermissions: string[];
    templateId: string;
    go: AppNavigate;
}) {
    const resource = useScopedResource(`${identity.key}:kpi-template:${templateId}`, (signal) => loadKpiTemplate(identity, templateId, signal), undefined as never);
    const versions = (resource.data?.versions as Array<Record<string, unknown>> | undefined) || [];
    return <section className={styles.page}><FeatureHeader eyebrow="KPI TEMPLATE DETAIL" title={String(resource.data?.name || 'KPI模板详情')} description="草稿可直接修改；发布版本保持不可变，需要调整时新建未来周期版本。" actions={<button className="secondary" onClick={() => go('kpi-templates')}>返回模板列表</button>}/><AsyncState loading={resource.loading} error={resource.error} onRetry={resource.reload}/>{resource.data && <><section className={styles.metricGrid}><div className={styles.metric}><span>模板编码</span><strong>{String(resource.data.code)}</strong></div><div className={styles.metric}><span>岗位</span><strong>{String(resource.data.positionName || resource.data.positionCode || '岗位模板')}</strong></div><div className={styles.metric}><span>版本数</span><strong>{versions.length}</strong></div></section><div className={styles.actionList}>{versions.map((version) => <TemplateVersionEditor key={String(version.id)} identity={identity} grantedPermissions={grantedPermissions} version={version}/>)}</div></>}</section>;
}
function TemplateVersionEditor({ identity, grantedPermissions, version }: {
    identity: RoleContext;
    grantedPermissions: string[];
    version: Record<string, unknown>;
}) {
    const versionId = String(version.id);
    const detail = useScopedResource(`${identity.key}:kpi-template-version:${versionId}`, (signal) => loadKpiTemplateVersion(identity, versionId, signal), undefined as never);
    const command = useStableCommand(`kpi-template-version-edit:${versionId}`);
    const [editing, setEditing] = useState(false);
    const [message, setMessage] = useState<string>();
    const [form, setForm] = useState<{
        title: string;
        baseFullScore: string;
        allowExtraScore: boolean;
        sections: Array<{
            name: string;
            sectionCode: string;
            indicators: Array<Record<string, unknown>>;
        }>;
    }>({ title: '', baseFullScore: '', allowExtraScore: true, sections: [] });
    const startEdit = () => {
        const sections = ((detail.data?.sections as Array<Record<string, unknown>> | undefined) || []).map((section) => ({ name: String(section.name || ''), sectionCode: String(section.sectionCode || ''), indicators: ((section.indicators as Array<Record<string, unknown>> | undefined) || []).map((indicator) => ({ ...indicator })) }));
        setForm({ title: String(detail.data?.title || 'KPI模板草稿'), baseFullScore: String(detail.data?.baseFullScore ?? ''), allowExtraScore: Boolean(detail.data?.allowExtraScore ?? true), sections });
        setEditing(true);
        setMessage(undefined);
    };
    const updateIndicator = (sectionIndex: number, indicatorIndex: number, changes: Record<string, unknown>) => setForm((current) => ({ ...current, sections: current.sections.map((section, currentSection) => currentSection !== sectionIndex ? section : { ...section, indicators: section.indicators.map((indicator, currentIndicator) => currentIndicator === indicatorIndex ? { ...indicator, ...changes } : indicator) }) }));
    const removeIndicator = (sectionIndex: number, indicatorIndex: number) => setForm((current) => ({ ...current, sections: current.sections.map((section, currentSection) => currentSection !== sectionIndex ? section : { ...section, indicators: section.indicators.filter((_indicator, currentIndicator) => currentIndicator !== indicatorIndex) }) }));
    const save = async () => {
        const sections = form.sections.map((section, sectionIndex) => { const indicators = section.indicators.map((indicator, indicatorIndex) => ({ ...indicator, id: null, indicatorCode: String(indicator.indicatorCode || `INDICATOR_${sectionIndex + 1}_${indicatorIndex + 1}`), name: String(indicator.name || ''), indicatorType: String(indicator.indicatorType || 'MANUAL'), weeklySplitType: String(indicator.weeklySplitType || 'SAME_TARGET'), metricVersionId: indicator.metricVersionId || null, maxScore: Number(indicator.maxScore || 0), minScore: indicator.minScore === null || indicator.minScore === undefined || indicator.minScore === '' ? null : Number(indicator.minScore), targetValue: indicator.targetValue === null || indicator.targetValue === undefined || indicator.targetValue === '' ? null : Number(indicator.targetValue), allowAboveMax: Boolean(indicator.allowAboveMax), precisionScale: Number(indicator.precisionScale ?? 2), evidenceRequired: Boolean(indicator.evidenceRequired ?? true), evaluatorType: String(indicator.evaluatorType || 'MANUAL_EVALUATOR'), notApplicablePolicy: String(indicator.notApplicablePolicy || 'PENDING_VERIFICATION'), sortOrder: indicatorIndex, formulaConfig: indicator.formulaConfig || {}, warningConfig: indicator.warningConfig || {} })); return { id: null, sectionCode: section.sectionCode || `SECTION_${sectionIndex + 1}`, name: section.name, maxScore: indicators.reduce((sum, indicator) => sum + Number(indicator.maxScore || 0), 0), minScore: null, sortOrder: sectionIndex, configuration: {}, indicators }; });
        try {
            await command.run(() => updateKpiTemplateVersion(identity, versionId, { title: form.title, description: '后台快速配置草稿', baseTemplateVersionId: detail.data?.baseTemplateVersionId || null, compensationPolicyVersionId: detail.data?.compensationPolicyVersionId || null, baseFullScore: sections.reduce((sum, section) => sum + section.maxScore, 0), allowExtraScore: form.allowExtraScore, effectiveMonth: detail.data?.effectiveMonth || null, expiresMonth: detail.data?.expiresMonth || null, configuration: detail.data?.configuration || {}, sections, expectedVersion: Number(detail.data?.rowVersion || 0) }));
            setEditing(false);
            setMessage('草稿已保存，系统保留修改审计；尚未审核或发布。');
            await detail.reload();
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : '草稿保存失败');
        }
    };
    const lifecycle = String(detail.data?.lifecycleStatus || version.lifecycleStatus || '');
    const canEdit = lifecycle === 'DRAFT' && String(detail.data?.reviewStatus || version.reviewStatus || 'DRAFT') === 'DRAFT' && hasPermission(grantedPermissions, permissions.kpi.templateManage);
    return <article><div><strong>V{String(version.versionNo || '')} · {String(version.title || '')}</strong> <StatusBadge value={lifecycle}/></div><span>基础满分 {String(version.baseFullScore || '—')} · {String(version.effectiveMonth || '未生效')}</span><AsyncState loading={detail.loading} error={detail.error} onRetry={detail.reload}/>{detail.data && !editing && <>{((detail.data.sections as Array<Record<string, unknown>> | undefined) || []).map((section) => <p key={String(section.id)}><strong>{String(section.name)}</strong>：{((section.indicators as Array<Record<string, unknown>> | undefined) || []).map((indicator) => `${String(indicator.name)} ${String(indicator.maxScore)}分`).join('；')}</p>)}<KpiSourcePreviewPanel identity={identity} versionId={versionId}/>{canEdit && <button className="secondary" onClick={startEdit}>快速修改草稿</button>}</>}{detail.data && editing && <section className={styles.section}><div className={styles.formGrid}><label>版本名称<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })}/></label><label className="checkbox-label"><input type="checkbox" checked={form.allowExtraScore} onChange={(event) => setForm({ ...form, allowExtraScore: event.target.checked })}/>允许额外加分</label></div>{form.sections.map((section, sectionIndex) => <section key={`${section.sectionCode}:${sectionIndex}`}><h3>{section.name}</h3><div className={styles.actionList}>{section.indicators.map((indicator, indicatorIndex) => <article key={`${String(indicator.indicatorCode)}:${indicatorIndex}`}><div className={styles.formGrid}><label>指标名称<input value={String(indicator.name || '')} onChange={(event) => updateIndicator(sectionIndex, indicatorIndex, { name: event.target.value })}/></label><label>满分<input type="number" step="0.01" value={String(indicator.maxScore ?? '')} onChange={(event) => updateIndicator(sectionIndex, indicatorIndex, { maxScore: event.target.value })}/></label><label>最低分<input type="number" step="0.01" value={indicator.minScore === null || indicator.minScore === undefined ? '' : String(indicator.minScore)} onChange={(event) => updateIndicator(sectionIndex, indicatorIndex, { minScore: event.target.value })}/></label><label>数值目标（可选）<input type="number" step="0.0001" value={indicator.targetValue === null || indicator.targetValue === undefined ? '' : String(indicator.targetValue)} onChange={(event) => updateIndicator(sectionIndex, indicatorIndex, { targetValue: event.target.value })}/></label><label>周目标<select value={String(indicator.weeklySplitType || 'SAME_TARGET')} onChange={(event) => updateIndicator(sectionIndex, indicatorIndex, { weeklySplitType: event.target.value })}><option value="SAME_TARGET">每周保持同一目标</option><option value="EQUAL_FOUR_WEEKS">月度总量按4周分解</option><option value="MONTH_END_ONLY">仅月末确认</option></select></label><label className={styles.full}>考核与评分标准<textarea value={String((indicator.formulaConfig as Record<string, unknown> | undefined)?.sourceCriteria || '')} onChange={(event) => updateIndicator(sectionIndex, indicatorIndex, { formulaConfig: { ...((indicator.formulaConfig as Record<string, unknown> | undefined) || {}), sourceCriteria: event.target.value } })}/></label></div><button className="link-button" onClick={() => removeIndicator(sectionIndex, indicatorIndex)}>移除此指标</button></article>)}</div></section>)}<div className={styles.toolbar}><button className="primary" disabled={command.busy || !form.title.trim()} onClick={() => void save()}>{command.busy ? '保存中…' : '保存草稿'}</button><button className="secondary" disabled={command.busy} onClick={() => setEditing(false)}>取消</button></div></section>}{message && <div className={styles.locked}>{message}</div>}</article>;
}

function KpiSourcePreviewPanel({ identity, versionId }: { identity: RoleContext; versionId: string }) {
    const catalog = useScopedResource(`${identity.key}:kpi-source-preview:${versionId}`, (signal) => loadKpiSourcePreviewCatalog(identity, versionId, signal), undefined as never);
    const command = useStableCommand(`kpi-source-preview-calculate:${versionId}`);
    const [hotelId, setHotelId] = useState('');
    const [assessmentMonth, setAssessmentMonth] = useState(new Date().toISOString().slice(0, 7));
    const [result, setResult] = useState<KpiSourcePreviewResult>();
    const [message, setMessage] = useState<string>();
    const defaultHotelId = catalog.data?.hotels.find((hotel) => hotel.snapshotAvailable)?.hotelId || '';
    const selectedHotel = hotelId || defaultHotelId;
    const calculate = async () => {
        if (!selectedHotel) return;
        setMessage(undefined);
        try {
            setResult(await command.run(() => calculateKpiSourcePreview(identity, versionId, selectedHotel, assessmentMonth)));
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'OTA 数据试算失败');
        }
    };
    return <section className={styles.section}><header><div><h3>OTA / PMS 上月数据一键试算</h3><p>选择考核月份，系统固定读取上一个自然月的完整PMS月报；不写入正式周考核单或月考核单。</p></div><span className={styles.badge}>只读预览</span></header><AsyncState loading={catalog.loading} error={catalog.error} onRetry={catalog.reload}/>{catalog.data && <><div className={styles.toolbar}><label>考核月份<input type="month" value={assessmentMonth} onChange={(event) => { setAssessmentMonth(event.target.value); setResult(undefined); }}/></label><select value={selectedHotel} onChange={(event) => { setHotelId(event.target.value); setResult(undefined); }}><option value="">选择 OTA 数据门店</option>{catalog.data.hotels.map((hotel) => <option key={hotel.hotelId} value={hotel.hotelId}>{hotel.hotelCode} · {hotel.hotelName}</option>)}</select><button className="primary" disabled={!selectedHotel || !assessmentMonth || command.busy} onClick={() => void calculate()}>{command.busy ? '读取并测算中…' : '读取上月并试算'}</button><span>本模板{catalog.data.totalIndicators}项，当前最多可自动试算{catalog.data.currentlyScoreableIndicators}项</span></div>{!catalog.data.hotels.length && <div className={styles.locked}>尚未配置当前租户可读取的 OTA 门店数据源。</div>}</>}{result && <><section className={styles.metricGrid}><div className={styles.metric}><span>{result.officialScoreEligible ? '正式可计分' : '候选得分（口径待验收）'}</span><strong>{result.officialScoreEligible ? result.automaticScore : result.candidateScore}/{result.officialScoreEligible ? result.automaticMaxScore : result.candidateMaxScore}</strong></div><div className={styles.metric}><span>考核月份</span><strong>{result.assessmentMonth.slice(0, 7)}</strong></div><div className={styles.metric}><span>实际取数月份</span><strong>{result.sourceDataMonth}</strong></div><div className={styles.metric}><span>数据周期</span><strong>{result.window.from} 至 {result.window.to}</strong></div></section><div className={styles.locked}>数据状态：{result.scoreState}；完整性：{result.completenessState}。31天、缺日、重复、数值和月合计校验未通过时不计分。</div><div className={styles.metricGrid}>{result.sourceMetrics.map((metric) => <div className={styles.metric} key={metric.code}><span>{metric.name}</span><strong>{metric.displayValue}</strong><small>{metric.state}</small></div>)}</div><div className={styles.actionList}>{result.indicators.map((indicator) => <article key={indicator.indicatorCode}><div><strong>{indicator.section} / {indicator.name}</strong> <StatusBadge value={indicator.state}/></div><span>{indicator.sourceLabel}{indicator.displayValue ? ` · 实际${indicator.displayValue}` : ''}{indicator.score !== undefined ? ` · 正式${indicator.score}/${indicator.maxScore}分` : indicator.candidateScore !== undefined ? ` · 候选${indicator.candidateScore}/${indicator.maxScore}分` : ''}</span><p>{indicator.evidence || indicator.reason}</p>{indicator.definitionWarning && <small>口径待验收：{indicator.definitionWarning}</small>}</article>)}</div>{result.warnings.map((warning) => <small key={warning}>⚠ {warning}</small>)}</>}{message && <div className={styles.locked}>{message}</div>}</section>;
}
function RelationList({ identity }: {
    identity: RoleContext;
}) {
    const resource = useScopedResource(`${identity.key}:kpi-relations`, (signal) => loadKpiRelations(identity, signal), []);
    return <section className={styles.page}><FeatureHeader eyebrow="ASSESSMENT RESPONSIBILITY" title="员工考核关系" description="第一期每名员工每月只解析一套KPI模板，不设置兼岗和代理岗位。"/><AsyncState loading={resource.loading} error={resource.error} empty={!resource.data.length} onRetry={resource.reload}/><div className={styles.actionList}>{resource.data.map((relation) => <article key={relation.id}><div><strong>{relation.employeeName} · {relation.positionName}</strong> <StatusBadge value={relation.status}/></div><span>{relation.orgName}</span><p>{relation.templateName} · {relation.validFrom} 至 {relation.validTo || '长期'}</p></article>)}</div></section>;
}
function SettlementList({ identity, grantedPermissions, params }: {
    identity: RoleContext;
    grantedPermissions: string[];
    params: RouteParams;
}) {
    const resource = useScopedResource(`${identity.key}:kpi-settlements:${params.periodId || ''}`, (signal) => loadKpiSettlements(identity, signal, params.periodId), []);
    return <section className={styles.page}><FeatureHeader eyebrow="PERFORMANCE BONUS SETTLEMENT" title="绩效奖金结算" description="奖金基数、岗位专属加减、绩效系数与正常出勤系数分步计算；应发金额最低为0元。" actions={hasPermission(grantedPermissions, permissions.kpi.export) ? <button className="secondary" onClick={() => void downloadKpiExport(identity, 'settlements', params.periodId)}>一键导出结算</button> : undefined}/><AsyncState loading={resource.loading} error={resource.error} empty={!resource.data.length} onRetry={resource.reload}/><div className={styles.cardGrid}>{resource.data.map((item) => <article className={styles.card} key={item.id}><header><strong>{item.employeeName}</strong><StatusBadge value={item.status}/></header><h2>应发 ¥{item.payableBonus}</h2><p>得分 {item.finalScore} · 原基数 ¥{item.originalBonusBase} · 岗位调整 {item.bonusAdjustment >= 0 ? '+' : ''}{item.bonusAdjustment}</p><div className={styles.meta}><span>绩效系数 {item.performanceCoefficient}</span><span>出勤系数 {item.attendanceCoefficient}</span></div></article>)}</div></section>;
}
function InspectionCenter({ identity, grantedPermissions }: {
    identity: RoleContext;
    grantedPermissions: string[];
}) {
    const today = new Date().toISOString().slice(0, 10);
    const schedules = useScopedResource(`${identity.key}:kpi-inspection-schedules`, (signal) => loadInspectionSchedules(identity, signal), []);
    const inspections = useScopedResource(`${identity.key}:kpi-inspections:${today}`, (signal) => loadInspections(identity, signal, today), []);
    return <section className={styles.page}><FeatureHeader eyebrow="SERVER-SIGNED OTA INSPECTION" title="每日OTA运营自查与异常闭环" description="巡检由服务器自动签署账号、姓名和时间；原记录不可修改，只能追加更正。发现异常不扣分，漏检、虚假正常和超时处置才形成客观扣分。"/><AsyncState loading={schedules.loading || inspections.loading} error={schedules.error || inspections.error} onRetry={async () => { await Promise.all([schedules.reload(), inspections.reload()]); }}/>{hasPermission(grantedPermissions, permissions.kpi.inspectionSubmit) && <InspectionForm identity={identity} schedules={schedules.data} reload={inspections.reload}/>}
    <section className={styles.section}><header><h2>今日巡检留痕</h2><span className={styles.badge}>{inspections.data.length}条</span></header><div className={styles.actionList}>{inspections.data.map((item) => <InspectionRow key={item.id} item={item} identity={identity} grantedPermissions={grantedPermissions} reload={inspections.reload}/>)}</div></section></section>;
}
function InspectionForm({ identity, schedules, reload }: {
    identity: RoleContext;
    schedules: InspectionSchedule[];
    reload: () => Promise<void>;
}) {
    const command = useStableCommand('kpi-inspection-submit');
    const [slot, setSlot] = useState(schedules[0]?.timeSlot || 'MORNING');
    const [channel, setChannel] = useState('PRIMARY');
    const [result, setResult] = useState('NORMAL');
    const [level, setLevel] = useState('ORDINARY');
    const [description, setDescription] = useState('');
    const [firstAction, setFirstAction] = useState('');
    const [message, setMessage] = useState<string>();
    const required = useMemo(() => schedules.find((item) => item.timeSlot === slot)?.requiredChecks || [], [schedules, slot]);
    const submit = async () => {
        setMessage(undefined);
        try {
            await command.run((key) => submitInspection(identity, {
                assignmentId: identity.assignmentId,
                orgUnitId: identity.assignmentOrgUnitId || identity.orgScopes[0],
                businessDate: new Date().toISOString().slice(0, 10),
                timeSlot: slot,
                channelCode: channel,
                result,
                checkItems: required.map((code) => ({ code, status: result === 'NORMAL' ? 'NORMAL' : 'CHECKED', note: '' })),
                abnormalityLevel: result === 'ABNORMAL' ? level : undefined,
                abnormalityDescription: result === 'ABNORMAL' ? description : undefined,
                firstAction: result === 'ABNORMAL' ? firstAction : undefined,
                idempotencyKey: key,
            }));
            setMessage('巡检已由服务器签署并保存，不可覆盖。');
            await reload();
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : '巡检提交失败');
        }
    };
    return <section className={styles.section}><header><h2>提交本时段巡检</h2><span className={styles.badge}>自动签名+时间戳</span></header><div className={styles.formGrid}><label>巡检时段<select value={slot} onChange={(event) => setSlot(event.target.value)}>{schedules.filter((item) => item.active).map((item) => <option key={item.id} value={item.timeSlot}>{item.timeSlot} · {item.opensAt}-{item.cutoffAt}</option>)}</select></label><label>渠道<input value={channel} onChange={(event) => setChannel(event.target.value)}/></label><label>结论<select value={result} onChange={(event) => setResult(event.target.value)}><option value="NORMAL">正常</option><option value="ABNORMAL">异常</option><option value="PENDING_VERIFICATION">待核验</option></select></label>{result === 'ABNORMAL' && <><label>异常级别<select value={level} onChange={(event) => setLevel(event.target.value)}><option value="ORDINARY">普通异常</option><option value="MAJOR">重大异常</option></select></label><label className={styles.full}>异常说明<textarea value={description} onChange={(event) => setDescription(event.target.value)}/></label><label className={styles.full}>首个处理动作<textarea value={firstAction} onChange={(event) => setFirstAction(event.target.value)}/></label></>}</div><div className={styles.meta}>{required.map((item) => <span key={item}>✓ {item}</span>)}</div><button className="primary" disabled={command.busy || !identity.assignmentId || !channel.trim() || (result === 'ABNORMAL' && (!description.trim() || !firstAction.trim()))} onClick={() => void submit()}>{command.busy ? '签署中…' : '提交并自动签署'}</button>{message && <div className={styles.locked}>{message}</div>}</section>;
}
function InspectionRow({ item, identity, grantedPermissions, reload }: {
    item: InspectionSubmission;
    identity: RoleContext;
    grantedPermissions: string[];
    reload: () => Promise<void>;
}) {
    const command = useStableCommand(`inspection-${item.id}`);
    const [note, setNote] = useState('');
    const [message, setMessage] = useState<string>();
    const event = async (eventType: string) => {
        try {
            await command.run(() => recordInspectionEvent(identity, item.id, { eventType, note, evidenceReference: '' }));
            await reload();
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : '异常处理留痕失败');
        }
    };
    const verify = async (decision: string) => {
        try {
            await command.run(() => verifyInspection(identity, item.id, { decision, finding: note || '随机抽查', evidenceReference: '' }));
            await reload();
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : '核验失败');
        }
    };
    return <article><div><strong>{item.orgName} · {item.channelCode} · {item.timeSlot}</strong> <StatusBadge value={item.result}/></div><span>{item.signedName} · {formatLocalDateTime(item.signedAt)}</span><p>{item.abnormalityDescription || '申报无异常'} · SLA扣分事件 {item.breachCount || 0} · 核验 {item.verificationDecision || '未抽查'}</p>{item.result === 'ABNORMAL' && <div className={styles.full}><input placeholder="处理说明/证据摘要" value={note} onChange={(event) => setNote(event.target.value)}/> <button className="secondary" disabled={!note.trim() || command.busy} onClick={() => void event('CONFIRMED')}>确认异常</button> <button className="secondary" disabled={!note.trim() || command.busy} onClick={() => void event('ACTION_SUBMITTED')}>提交处理动作</button> <button className="secondary" disabled={!note.trim() || command.busy} onClick={() => void event('CLOSED')}>关闭</button> <button className="secondary" disabled={!note.trim() || command.busy} onClick={() => void event('ESCALATED')}>升级交接</button></div>}{hasPermission(grantedPermissions, permissions.kpi.inspectionVerify) && <div><input placeholder="抽查发现" value={note} onChange={(event) => setNote(event.target.value)}/> <button className="link-button" disabled={!note.trim() || command.busy} onClick={() => void verify('MATCHED')}>抽查一致</button> <button className="link-button" disabled={!note.trim() || command.busy} onClick={() => void verify('MISMATCH')}>发现不一致</button></div>}{message && <div className="inline-error">{message}</div>}</article>;
}
