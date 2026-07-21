import type {
  HotelDashboard,
  ManagementRule,
  ManagementTask,
  NotificationItem,
  OperationsDashboard,
  StandardEvaluation,
  WorkExpectation,
  WorkPackage,
} from '../domain'

export const demoWorkPackages: WorkPackage[] = [
  { id: 'wp-ota-daily', code: 'WP-OTA-DAILY', name: 'OTA每日运营巡查', positionName: 'OTA运营助理', versionNo: 1, lifecycleStatus: 'PUBLISHED', scopeName: '华东区域 · 2家门店', completionRate: 83, itemCount: 5 },
  { id: 'wp-front-shift', code: 'WP-FD-SHIFT', name: '前台班次工作包', positionName: '前台员工', versionNo: 2, lifecycleStatus: 'PUBLISHED', scopeName: '杭州中心店 · 前厅部', completionRate: 92, itemCount: 6 },
  { id: 'wp-fo-team', code: 'WP-FO-SUP', name: '前厅主管每日管理', positionName: '前厅主管', versionNo: 1, lifecycleStatus: 'PUBLISHED', scopeName: '杭州中心店', completionRate: 88, itemCount: 4 },
  { id: 'wp-gm', code: 'WP-GM-DAILY', name: '店总每日管理', positionName: '店总', versionNo: 1, lifecycleStatus: 'DRAFT', scopeName: '集团全部门店', itemCount: 4 },
]

export const demoExpectations: WorkExpectation[] = [
  { id: 'we-1', title: '杭州中心店OTA巡查', packageName: 'OTA每日运营巡查', itemName: '评分与差评检查', status: 'PENDING', businessDate: '2026-07-17', dueAt: '2026-07-17T18:00:00+08:00', targetOrgName: '杭州中心店', assigneeName: '唐悦' },
  { id: 'we-2', title: '上海滨江店OTA巡查', packageName: 'OTA每日运营巡查', itemName: '价格与房态检查', status: 'SUBMITTED', businessDate: '2026-07-17', dueAt: '2026-07-17T18:00:00+08:00', targetOrgName: '上海滨江店', assigneeName: '唐悦', recordId: 'record-demo-ota', evaluationOutcome: 'WARNING', standards: [{ standardVersionId: 'standard-version-ota', usageType: 'EXECUTION', standardCode: 'STD-OTA-REVIEW', title: 'OTA评价巡查标准', versionNo: 1 }] },
  { id: 'we-3', title: '前台早班交接', packageName: '前台班次工作包', itemName: 'VIP与客诉交接', status: 'OVERDUE', businessDate: '2026-07-17', dueAt: '2026-07-17T10:00:00+08:00', targetOrgName: '杭州中心店', assigneeName: '林悦' },
  { id: 'we-4', title: '前厅班组检查', packageName: '前厅主管每日管理', itemName: '人员状态与服务检查', status: 'COMPLETED', businessDate: '2026-07-17', targetOrgName: '杭州中心店 · 前厅部', assigneeName: '陈航', recordId: 'record-demo-front', evaluationOutcome: 'PASS', standards: [{ standardVersionId: 'standard-version-front', usageType: 'EXECUTION', standardCode: 'STD-FO-DAILY', title: '前厅主管每日检查标准', versionNo: 1 }] },
  { id: 'we-5', title: '12层客房卫生巡检', packageName: '客房主管每日巡检', itemName: '客房清洁与设施检查', status: 'SUBMITTED', businessDate: '2026-07-17', dueAt: '2026-07-17T16:00:00+08:00', targetOrgName: '杭州中心店 · 客房部', assigneeName: '周敏', recordId: 'record-demo-housekeeping', evaluationOutcome: 'WARNING', standards: [{ standardVersionId: 'standard-version-housekeeping', usageType: 'ACCEPTANCE', standardCode: 'STD-HK-INSPECTION', title: '客房卫生检查标准', versionNo: 1 }] },
]

export const demoRules: ManagementRule[] = [
  { id: 'rule-1', code: 'RULE-OTA-DOWN', name: 'OTA评分连续下降触发整改', status: 'PUBLISHED', versionNo: 1, eventType: 'METRIC_TREND_DETECTED', scopeName: '集团全部门店', hitCount: 3 },
  { id: 'rule-2', code: 'RULE-WORK-MISSED', name: '岗位工作漏交升级', status: 'PUBLISHED', versionNo: 2, eventType: 'WORK_EXPECTATION_MISSED', scopeName: '集团全部岗位', hitCount: 8 },
  { id: 'rule-3', code: 'RULE-COMPLAINT', name: '重大客诉整改任务', status: 'DRAFT', versionNo: 1, eventType: 'WORK_RECORD_SUBMITTED', scopeName: '前厅岗位' },
]

export const demoTasks: ManagementTask[] = [
  { id: 'task-1', code: 'TASK-20260717-001', title: '处理杭州中心店OTA评分下降', status: 'IN_PROGRESS', slaStatus: 'DUE_SOON', priority: 'HIGH', assigneeName: '唐悦', reviewerName: '许晨', targetOrgName: '杭州中心店', sourceType: 'RULE', sourceTitle: 'OTA评分连续下降触发整改', description: '复核近7日差评并形成回复与整改结果。', dueAt: '2026-07-18T10:00:00+08:00', version: 2 },
  { id: 'task-2', code: 'TASK-20260717-002', title: '补充重大客诉升级信息', status: 'REWORK', slaStatus: 'OVERDUE', priority: 'URGENT', assigneeName: '陈航', reviewerName: '沈乔', targetOrgName: '杭州中心店', sourceType: 'STANDARD_EVALUATION', sourceTitle: '客诉处理SOP V1', description: '原结果缺少客诉升级时间和沟通证据。', dueAt: '2026-07-17T12:00:00+08:00', version: 4 },
  { id: 'task-3', code: 'TASK-20260717-003', title: '验收前台早班漏交整改', status: 'AWAITING_REVIEW', slaStatus: 'ON_TIME', priority: 'MEDIUM', assigneeName: '林悦', reviewerName: '陈航', targetOrgName: '杭州中心店', sourceType: 'RULE', sourceTitle: '岗位工作漏交升级', dueAt: '2026-07-17T20:00:00+08:00', version: 3 },
]

export const demoEvaluations: StandardEvaluation[] = [
  { id: 'eval-1', subjectType: 'WORK_RECORD', subjectTitle: '杭州中心店OTA巡查', standardCode: 'STD-OTA-REVIEW', standardTitle: 'OTA评价巡查标准', standardVersion: 1, outcome: 'WARNING', score: 78, severity: 'MEDIUM', executionStatus: 'COMPLETED', evaluatedAt: '2026-07-17T10:05:00+08:00', targetOrgName: '杭州中心店' },
  { id: 'eval-2', subjectType: 'TASK_RESULT', subjectTitle: '重大客诉处理结果', standardCode: 'STD-FD-COMPLAINT', standardTitle: '前台客诉处理SOP', standardVersion: 2, outcome: 'FAIL', score: 55, severity: 'HIGH', executionStatus: 'COMPLETED', evaluatedAt: '2026-07-17T11:20:00+08:00', targetOrgName: '杭州中心店' },
  { id: 'eval-3', subjectType: 'WORK_RECORD', subjectTitle: '前厅班组检查', standardCode: 'STD-FO-DAILY', standardTitle: '前厅主管每日检查标准', standardVersion: 1, outcome: 'PASS', score: 96, severity: 'LOW', executionStatus: 'COMPLETED', evaluatedAt: '2026-07-17T09:18:00+08:00', targetOrgName: '杭州中心店' },
]

export const demoNotifications: NotificationItem[] = [
  { id: 'notice-1', type: 'TASK_DUE_SOON', title: '任务将在24小时内到期', content: '处理杭州中心店OTA评分下降，请及时提交执行结果。', sourceType: 'TASK', sourceId: 'task-1', createdAt: '2026-07-17T10:30:00+08:00', version: 0 },
  { id: 'notice-2', type: 'TASK_REWORK', title: '整改任务被打回', content: '请补充客诉升级时间和沟通证据。', sourceType: 'TASK', sourceId: 'task-2', createdAt: '2026-07-17T11:22:00+08:00', version: 0 },
  { id: 'notice-3', type: 'WORK_SUBMITTED', title: '团队工作已提交', content: '陈航提交了前厅班组检查，标准评价为通过。', sourceType: 'WORK_RECORD', sourceId: 'we-4', createdAt: '2026-07-17T09:20:00+08:00', readAt: '2026-07-17T09:30:00+08:00', version: 1 },
]

export const demoHotelDashboard: HotelDashboard = {
  hotel: { id: '12000000-0000-0000-0000-000000000003', name: '杭州中心店', city: '杭州', roomCount: 128 },
  activeEmployeeCount: 68,
  todayWorkSubmissionCount: 42,
  latestMetrics: [
    { code: 'REVENUE', name: '营业收入', unit: 'CNY', value: 86240, businessDate: '2026-07-17' },
    { code: 'OCCUPANCY', name: '入住率', unit: 'PERCENT', value: 87.6, businessDate: '2026-07-17' },
    { code: 'ADR', name: '平均房价', unit: 'CNY', value: 628, businessDate: '2026-07-17' },
    { code: 'OTA_SCORE', name: 'OTA评分', unit: 'SCORE', value: 4.91, businessDate: '2026-07-17' },
  ],
  risks: [
    { id: 'risk-1', title: '重大客诉整改已逾期', type: 'COMPLAINT', severity: 'HIGH', status: 'OPEN', ownerName: '陈航', occurredAt: '2026-07-17T11:20:00+08:00' },
    { id: 'risk-2', title: '12层客房巡检存在2项问题', type: 'INSPECTION', severity: 'MEDIUM', status: 'OPEN', ownerName: '周敏', occurredAt: '2026-07-17T14:05:00+08:00' },
  ],
  incompleteTasks: demoTasks,
}

export const demoOperationsDashboard: OperationsDashboard = {
  hotels: [
    { id: '12000000-0000-0000-0000-000000000003', name: '杭州中心店', city: '杭州', roomCount: 128, openTaskCount: 8, overdueTaskCount: 2, failedEvaluationCount: 3, missedWorkCount: 1, todaySubmissionCount: 42 },
    { id: '12000000-0000-0000-0000-000000000004', name: '上海滨江店', city: '上海', roomCount: 156, openTaskCount: 5, overdueTaskCount: 0, failedEvaluationCount: 1, missedWorkCount: 2, todaySubmissionCount: 51 },
  ],
}
