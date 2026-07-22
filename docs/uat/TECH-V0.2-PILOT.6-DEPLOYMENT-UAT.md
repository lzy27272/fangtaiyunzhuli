# TECH-V0.2-PILOT.6 部署与UAT报告

日期：2026-07-21  
产品基线：PRODUCT-V1.2  
测试地址：`https://www.sfgzt.cn`  
结论：`PASS — 内部Pilot运行中`  
正式发布边界：TECH-V0.2仍为`Unreleased / NO-GO`，Sprint 3未启动

## 1. 部署结论

TECH-V0.2-PILOT.6已部署到当前Windows Pilot服务器，网站、Core API、PostgreSQL与Cloudflare Tunnel均可用。系统运行真实PostgreSQL和真实服务端RBAC/RLS，不使用静态角色切换或演示数据回退。

本次部署没有改变以下冻结模型：

- 集团→区域→门店→部门组织树。
- 一人多岗与精确任职绑定。
- 租户、组织范围与岗位权限隔离。
- 标准中心结构化版本模型。
- 规则中心确定性执行边界与任务状态机。

## 2. 制品、数据库与备份

| 项目 | 结果 |
|---|---|
| 后端制品 | `hotel-ai-os-core-api-0.2.0-pilot.6.jar` |
| 后端SHA-256 | `EFE5241BAA9509E806DD4E23E4226518EADE903C145A81C5039BB438A036BAB3` |
| 前端构建 | Vite 7.3.6；39个模块；PASS |
| 当前前端入口SHA-256 | `AFEFF7658854ED28E99D024AD937C93961001BD0413D8F3B9D2FADB9F3093089` |
| 数据库 | PostgreSQL 14.22 / Flyway V16 |
| RLS | 52张表启用并强制执行 |
| 后端健康检查 | `UP` |
| 部署前备份 | `D:\SifangguanHotelAIOS\Backups\TECH-V0.2-PILOT.6-logical-predeploy-20260721-112032` |

备份在单个只读、可重复读事务中导出51张用户表，并包含序列状态、附件、旧/新后端制品、候选前端制品、manifest和SHA-256。备份共62个文件、35,247,547字节，可作为本次V16升级前的逻辑恢复边界。

## 3. 自动化测试

| 测试 | 结果 |
|---|---|
| 后端完整回归 | 53项；失败0；错误0；跳过2；PASS |
| 前端TypeScript与生产构建 | PASS |
| Flyway V16真实迁移 | PASS |
| API健康检查 | PASS |

## 4. 八角色API UAT

以下真实账号均由服务端解析身份、权限、组织范围和任职，证据中未保存密码或Token：

| 角色 | 核心验证 | 结果 |
|---|---|---|
| 前台员工 | 本人工作、草稿、提交；团队接口按预期403 | PASS |
| 前厅主管 | 本人工作、团队工作、任务、评价 | PASS |
| 客房主管 | 本人工作、团队工作、图片附件、任务、评价 | PASS |
| 店助 | 门店驾驶舱、团队工作、任务 | PASS |
| 店总 | 门店驾驶舱、团队工作、任务 | PASS |
| OTA运营助理 | 本人工作；团队接口按预期403 | PASS |
| OTA运营经理 | 区域多门店驾驶舱、团队工作、任务 | PASS |
| CEO | 租户全量配置、标准工作/任务/驾驶舱模板 | PASS |

另以页面新建的店总账号验证自动下发工作，结果PASS。

## 5. 真实业务写入闭环

`Invoke-PilotUsableFlowSmoke.ps1`在真实数据库完成以下链路：

    区域与门店
      → 岗位与员工
      → 登录账号与组织范围角色
      → 精确任职
      → 工作包创建、发布与下发
      → 当日工作生成
      → 工作记录草稿
      → 图片附件上传
      → 最终提交

最终工作记录状态为`SUBMITTED`；新员工只能看到1个授权组织；越权访问未放宽。

## 6. CEO集团模板治理

- CEO创建、修改并发布任务模板：PASS。
- 店总读取已发布模板：PASS。
- 店总尝试创建模板返回HTTP 403：PASS。
- 岗位标准工作、任务模板和门店驾驶舱模板均在CEO权限内配置；其他角色只消费授权范围内的已发布版本。

## 7. 公网页面UAT

Playwright从`https://www.sfgzt.cn`使用八个真实角色逐一登录和访问目标页面，结果8/8 PASS。验收器已经收紧为：页面错误、请求失败或任一业务HTTP 4xx/5xx均判定失败。

本轮发现并关闭一个真实缺陷：登录后静态回退身份、服务端身份和主岗选择之间存在短暂竞态，店助驾驶舱曾以部门ID请求酒店资源并返回404。修复后系统在身份与主岗解析完成后才加载业务页；复测店助驾驶舱显示真实经营指标、风险和未完成任务，全部业务请求无非预期4xx/5xx。

Cloudflare Browser Insights脚本因本站严格CSP被浏览器阻止，属于已知非业务遥测请求，不影响系统功能；验收器只对该特定CSP阻断例外，其他请求失败仍会导致UAT失败。

## 8. 自动化队列修复与复核

部署后发现两条2026-07-19遗留的`WORK_EXPECTATION_MISSED`管理事件死信。根因是对应任职缺少唯一直接汇报任职，导致规则动作`CREATE_TASK`不能确定负责人。

已执行受控修复：

- 为前厅主管的兼岗前台任职补充其主岗主管作为直接汇报任职。
- 为店总任职补充区域OTA运营经理作为直接汇报任职。
- 写入审计记录，并只重放精确匹配的两条历史死信。

复核结果：Outbox失败/死信0、管理事件失败/死信0、规则动作失败0；修复完成后没有新的“Automation worker requires operator attention”日志。

## 9. 运行限制

- 当前Windows电脑必须保持开机、联网且部署用户已经登录；Core API目前由用户计划任务在登录时及每5分钟检查恢复。
- Pilot当前采用本地应用账号、短期JWT、连续失败锁定和服务端RBAC/RLS；尚未接入正式企业SSO。
- 附件保存在本机D盘，正式生产前应迁移到对象存储并完成容量、病毒扫描、保留期和灾备设计。
- ICP备案号仍待业务负责人确认并展示。
- 本报告只批准受控内部Pilot测试，不批准TECH-V0.2正式Released。

## 10. 证据索引

- 八角色API审计：`docs/uat/evidence/pilot6-role-capability/pilot6-role-capability-audit.md`
- 八角色API结构化记录：`docs/uat/evidence/pilot6-role-capability/pilot6-role-capability-audit.json`
- 公网页面结构化记录：`docs/uat/evidence/pilot6-public/pilot6-public-browser-uat.json`
- 八角色及CEO三类模板截图：`docs/uat/evidence/pilot6-public/`
- 实施状态：`docs/TECH-V0.2-PILOT.6-IMPLEMENTATION-STATUS.md`
