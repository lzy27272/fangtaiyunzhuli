import type { RoleContext } from '../domain'

const tenantId = '10000000-0000-0000-0000-000000000001'
const region = '12000000-0000-0000-0000-000000000002'
const hotel = '12000000-0000-0000-0000-000000000003'
const frontOffice = '12000000-0000-0000-0000-000000000005'
const housekeeping = '12000000-0000-0000-0000-000000000006'

// These are local acceptance accounts only. Roles, permissions and scopes are always re-resolved by /iam/me.
export const roleContexts: RoleContext[] = [
  { key: 'platform-admin', label: '平台管理员', userName: '系统管理员', orgName: '四方馆AI中台', focus: '全租户配置、权限、KPI与系统调试', tenantId, actorId: 'a3e1746e-3356-434f-a843-29ae8175c616', roleCode: 'PLATFORM_ADMIN', orgScopes: [] },
  { key: 'ceo', label: '集团CEO', userName: '集团CEO', orgName: '贵州四方馆酒店管理有限公司', focus: '集团规则、重大风险、跨区域任务与经营决策事项', tenantId, actorId: '19000000-0000-0000-0000-000000000001', roleCode: 'CEO', orgScopes: [] },
  { key: 'front-desk', label: '前台员工', userName: '林悦', orgName: '杭州中心店 · 前厅部', focus: '当前班次工作、VIP、客诉与待整改事项', tenantId, actorId: '19000000-0000-0000-0000-000000000003', assignmentId: '19200000-0000-0000-0000-000000000002', roleCode: 'FRONT_DESK', orgScopes: [frontOffice] },
  { key: 'front-supervisor', label: '前厅主管', userName: '陈航', orgName: '杭州中心店 · 前厅部', focus: '班组完成率、漏交、客诉与待验收事项', tenantId, actorId: '19000000-0000-0000-0000-000000000005', assignmentId: '19200000-0000-0000-0000-000000000004', roleCode: 'FRONT_OFFICE_SUPERVISOR', orgScopes: [frontOffice] },
  { key: 'housekeeping-supervisor', label: '客房主管', userName: '周敏', orgName: '杭州中心店 · 客房部', focus: '客房巡检、现场图片、卫生问题与整改评价', tenantId, actorId: '19000000-0000-0000-0000-000000000004', assignmentId: '19200000-0000-0000-0000-000000000003', roleCode: 'HOUSEKEEPING_SUPERVISOR', orgScopes: [housekeeping] },
  { key: 'assistant-gm', label: '店助', userName: '沈乔', orgName: '杭州中心店', focus: '跨部门待办、即将逾期、返工与待验收', tenantId, actorId: '19000000-0000-0000-0000-000000000008', assignmentId: '19200000-0000-0000-0000-000000000008', roleCode: 'ASSISTANT_GENERAL_MANAGER', orgScopes: [hotel] },
  { key: 'general-manager', label: '店总', userName: '赵晨', orgName: '杭州中心店', focus: '全店完成率、标准达标率、风险与最终验收', tenantId, actorId: '19000000-0000-0000-0000-000000000002', assignmentId: '19200000-0000-0000-0000-000000000001', roleCode: 'GENERAL_MANAGER', orgScopes: [hotel, frontOffice] },
  { key: 'regional-operations', label: '区域/运营', userName: '许晨', orgName: '华东区域', focus: '多门店任务、逾期、评价失败与岗位漏交总览', tenantId, actorId: '19000000-0000-0000-0000-000000000007', assignmentId: '19200000-0000-0000-0000-000000000007', roleCode: 'OTA_OPERATION_MANAGER', orgScopes: [region] },
]
