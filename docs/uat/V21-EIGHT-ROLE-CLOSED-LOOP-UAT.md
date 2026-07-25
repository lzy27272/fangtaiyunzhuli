# V21 八角色隔离闭环 UAT

该工具只允许写入一次性 UAT 数据库，不能把本机 Pilot、公网域名或共享测试库当作目标。

旧的 `tools/pilot/Invoke-Pilot7LiveSmoke.ps1` 已同步取消默认 API：即使传入 `-ConfirmMutation`，没有匹配的 `ISOLATED_UAT` 状态文件也会拒绝运行，`-AllowPublicApi` 不再能够开启公网写入。新工具沿用它已经验证过的任务状态链，但增加八角色矩阵、日报模板前置条件、`403`、`409`、幂等、通知和审计断言。

## 安全前提

- `RunId` 必须以 `CL-UAT-` 开头。
- 必须显式提供 `ApiBase`、`StateFile`、`TokenFile` 和 `-ConfirmMutation`。
- `StateFile` 只能是仓库固定的 `docs/uat/evidence/runtime/uat-processes.json`。
- API 必须是回环地址上的 HTTP 服务，且与状态文件中的 `apiUrl` 完全一致；18080 和 4180 被显式拒绝，只接受动态端口。
- 状态文件必须声明 `purpose=ISOLATED_UAT`、Bearer JWT、关闭开发身份头，并且尚未过期。
- 状态必须声明 `environmentType=embedded-postgresql`、记录正数且仍存活的 API PID；任何字段或值包含 Pilot 标识都会被拒绝。
- 数据库标识必须是 Embedded PostgreSQL；包含 Pilot 标识的目标会被拒绝。
- TokenFile 必须位于被忽略的 `.uat-runtime/identity` 目录；口令、JWT 和 Authorization 头不会写入验收报告。

先运行静态自检：

```powershell
.\tools\uat\Invoke-IsolatedV21RoleClosedLoopUat.ps1 -SelfTest
```

启动全新的隔离环境，`RunId` 要和后续验收保持一致：

```powershell
$runId = 'CL-UAT-20260722-01'
.\tools\uat\Start-EmbeddedUatEnvironment.ps1 -RunId $runId -SkipWeb
```

从启动输出取得 API 地址，然后显式确认写入：

```powershell
.\tools\uat\Invoke-IsolatedV21RoleClosedLoopUat.ps1 `
  -ApiBase 'http://127.0.0.1:<动态端口>/api/v1' `
  -StateFile '.\docs\uat\evidence\runtime\uat-processes.json' `
  -TokenFile '.\.uat-runtime\identity\tokens.json' `
  -RunId $runId `
  -ConfirmMutation
```

报告输出到 `docs/uat/evidence/<runId>/closed-loop/`。完成审核后停止并销毁该隔离环境；不要把产生的 UAT 数据迁移到 Pilot。

## 八角色责任矩阵

| 角色 | 日报 | 任务闭环 |
|---|---|---|
| 前台员工 | 酒店岗位日报 | 接单、提交、返工、重提 |
| 前厅主管 | 酒店岗位日报 | 执行任务；复核前台任务 |
| 客房主管 | 酒店岗位日报 | 执行任务；由店总复核 |
| 店助 | 酒店岗位日报 | 执行任务；由店总复核 |
| 店总 | 酒店岗位日报 | 复核酒店岗位任务；因没有更高酒店任职，不伪造本人任务复核人 |
| OTA 助理 | 不伪造酒店日报 | 区域任务执行；由 OTA 经理复核 |
| OTA 经理 | 不伪造酒店日报 | 复核 OTA 助理任务；不伪造更高区域任职 |
| CEO | 不伪造员工任职或日报 | 总部治理身份创建任务，不作为员工执行或验收人 |

任务链验证创建幂等、接单、结构化证据、版本冲突 `409`、提交、返工、再次处理、再次提交、主管验收、通知及审计时间线；低权限角色创建任务和总部模板必须返回 `403`。

该结果只称为“能力矩阵”，不能称为日运营主闭环通过。以下链路不在本工具中：日报汇总并引用巡查/质检/任务、AI 建议、主管确认后生成任务、逾期升级通知、日终快照和导出。任务 timeline 可证明状态迁移和幂等，不等于直接读取 `audit_log` 表；当前没有授权的只读审计 API。

## 当前已知阻断

日报模板采用独立编制/复核机制。冻结的八角色集合中通常只有 CEO 同时具备总部模板复核与发布权限，因此无法由两个不同账号安全完成新模板发布。工具不会临时给店总或店助授予 CEO 权限，也不会留下无法发布的模板草稿；若数据库尚无已发布模板，日报项会明确记为 `BLOCKED`，任务闭环仍会执行并独立报告。

当前 Embedded UAT 缺少以下五个酒店岗位的前置模板：前台员工、前厅主管、客房主管、店助、店总。每个模板必须由 UAT-only fixture 以可审计的双人发布事实预置，并同时具备：`ACTIVE` 模板定义、`PUBLISHED` 版本、对应已发布岗位工作包版本、至少一个有效栏目/字段，以及覆盖当日岗位任职的有效模板分配。未满足这些条件前，工具不会绕过 API 或伪造复核人。

这意味着报告只有在目标隔离库已经通过合规的双人流程准备好各酒店岗位模板，并且角色集中存在第二名合格模板复核人时，才可能得到完整 `PASS`。`BLOCKED` 是产品初始化缺口的真实结果，不应改写为通过。
