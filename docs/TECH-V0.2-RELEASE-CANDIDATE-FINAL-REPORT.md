# Hotel AI OS TECH-V0.2 Release Candidate Final Report

报告版本：RC-FINAL-V1.6  
报告日期：2026-07-18  
产品基线：PRODUCT-V1.2  
发布候选：TECH-V0.2 / `TECH-V0.2-rc.3-local`（安全加固候选；RC2业务证据仍为权威）  
最终API/数据库证据运行：`20260718-0154-tech-v02-rc2`  
页面证据运行：`20260718-0112-tech-v02-rc-final`  
发布结论：`NO-GO`  
技术版本状态：`TECH-V0.2 Unreleased`  
Sprint 3状态：`未启动`

> 本报告是Release Candidate收口审计，不是正式发布批准。当前正式技术发行仍为TECH-V0.1；不得把本报告、RC制品、`final`证据目录名或Sprint 3计划审核通过解释为TECH-V0.2已经Released。

## 一、执行结论

Sprint 2.1要求的业务功能P0/P1已在本地Release Candidate环境完成技术闭环：六角色业务走查通过，客房卫生整改、客诉处理、工作未提交提醒升级三条流程通过，正式Bearer JWT路径、数据权限负向用例和后台定时Worker均有新证据。

但“业务功能P0/P1已闭环”不等于“正式发布REL-P0全部关闭”。截至本报告形成时，目标企业SSO、10方签署、真实现场照片与目标附件链、Git提交/正式标签、目标持久化环境及运维保障仍未完成。因此：

- TECH-V0.2不得从Unreleased迁入Released。
- 不得创建正式`TECH-V0.2`标签或对外宣告发布。
- 当前正式版本继续为TECH-V0.1。
- Sprint 3计划虽已审核通过，但开发未启动；只有TECH-V0.2正式Released后才能执行启动指令。

## 二、Release Note摘要

本候选版本打通以下管理链：

```text
企业标准
→ 岗位工作包与工作期望
→ 工作记录与附件
→ 标准评价
→ 企业规则
→ 整改任务
→ 执行与证据
→ 复核验收或逾期升级
```

RC新增或完成的关键能力：

- 六角色组织权限、数据范围和一人多岗业务验证。
- 工作包、岗位工作记录、附件、标准评价、规则、任务、通知和驾驶舱闭环。
- RS256 Bearer JWT认证路径；开发身份头在正式UAT模式下被拒绝。
- 后台定时Worker自动执行事件投影、规则消费、漏交检测、任务逾期和升级。
- 附件扫描正式模式失败关闭；本地RC运行由安全扫描器返回`CLEAN`。
- 后端、前端、数据库迁移、OpenAPI和API说明的本地可复现RC制品。
- 本地PostgreSQL冷备、恢复和回滚演练。

候选Release Note详见[TECH-V0.2 Release Note RC](releases/TECH-V0.2-RELEASE-NOTE-RC.md)。

## 三、版本清单

| 版本维度 | 正式已发布 | 本次RC候选 | 状态 |
|---|---|---|---|
| PRODUCT | PRODUCT-V1.2 | PRODUCT-V1.2 | 架构基线未改变 |
| TECH | TECH-V0.1 | TECH-V0.2 | `Unreleased / NO-GO` |
| 数据库 | DB-V4 | DB-V13 / Flyway V1—V13 | 本地RC验证通过，未正式发布 |
| API主版本 | API-V1 | API-V1，基础路径`/api/v1` | 保持向后兼容 |
| OpenAPI | `0.1.0-sprint1` | `0.2.1-sprint2.1` | RC候选契约 |
| 后端制品 | TECH-V0.1制品 | `0.1.0-SNAPSHOT` | 本地RC构建；正式版本号未冻结 |
| 前端制品 | TECH-V0.1制品 | `0.2.0` | 本地RC构建 |
| RC构建标识 | 无 | `TECH-V0.2-rc.3-local` | 仅本地安全加固候选，不是正式标签 |

机器可读契约：[OpenAPI 0.2.1](openapi.yaml)。  
版本治理依据：[Change Log](../CHANGELOG.md)、[技术版本记录](TECHNICAL-VERSION-HISTORY.md)。

## 四、自动化测试结果

### 4.1 后端回归

本次完整回归结果：

| 项目 | 结果 |
|---|---:|
| 测试总数 | 48 |
| 失败 | 0 |
| 错误 | 0 |
| 跳过 | 2 |
| 实际执行 | 46 |

两个默认跳过项分别是Live UAT宿主测试和数据库恢复演练，二者均通过独立受控流程执行：修订后的Live宿主停机复验证据见[停机顺序证据](uat/evidence/20260718-1306-tech-v02-shutdown-order-fixed/README.md)；数据库恢复演练见第九节。48项回归的20份Surefire XML和20份文本报告已封存于[RC3本地加固证据](uat/evidence/20260718-1315-tech-v02-rc3-local-hardening/regression/)。RC2原始业务回归仍保留在[RC2 regression目录](uat/evidence/20260718-0154-tech-v02-rc2/regression/)，证据封存不能替代正式制品仓库或Git追溯。

### 4.2 API与认证

身份生命周期修复后的[API汇总](uat/evidence/20260718-0154-tech-v02-rc2/api/summary.json)记录：

- 请求总数：89。
- 非预期失败：0。
- 预期拒绝：16，其中认证拒绝10、业务权限拒绝6。
- 六角色正式认证探测：6个角色，RS256 Bearer JWT。
- 认证负向用例：10/10按预期拒绝。
- 证据目录未持久化Bearer Token。
- 后台自动化模式：`scheduled-worker`。
- 手工SLA处理请求：0。
- 手工Outbox恢复请求：0。

认证证据：[authentication目录](uat/evidence/20260718-0154-tech-v02-rc2/api/authentication/)。  
权限负向证据：[security目录](uat/evidence/20260718-0154-tech-v02-rc2/api/security/)。  
账号/任职停用旧JWT立即失效、一人多岗保留及租户级账号边界见[身份生命周期证据](uat/evidence/20260718-0144-tech-v02-identity-lifecycle/README.md)。

### 4.3 页面验证

[截图清单](uat/evidence/20260718-0112-tech-v02-rc-final/screenshots/manifest.md)及[机器可读清单](uat/evidence/20260718-0112-tech-v02-rc-final/screenshots/manifest.json)记录：

- 页面截图：25张。
- 加载与交互检查：25/25 PASS。
- 控制台错误：0。
- 控制台警告：0。
- 页面异常、失败请求和5xx：0。
- 页面标题、实际URL、非空内容、遮罩状态和激活导航交互均被记录。
- 浏览器验证使用本机Microsoft Edge和Playwright；由于Browser插件不可用，证据清单明确标记为Playwright fallback。

## 五、六角色UAT

六个ACTIVE账号及任职关系见[六角色数据库记录](uat/evidence/20260718-0154-tech-v02-rc2/database/01-six-role-accounts.json)。前厅主管拥有2个有效任职，用于验证一人多岗模型。

| 角色 | 走查内容 | 结果 | 主要证据 |
|---|---|---|---|
| 前台员工 | 登录、查看本人工作、提交客诉、查看任务/评价/通知 | PASS | [front-desk](uat/evidence/20260718-0154-tech-v02-rc2/api/roles/front-desk/) |
| 前厅主管 | 查看团队、复核评价、创建整改任务、验收 | PASS | [front-supervisor](uat/evidence/20260718-0154-tech-v02-rc2/api/roles/front-supervisor/) |
| 客房主管 | 图片上传、卫生评价、整改执行与证据 | PASS | [housekeeping-supervisor](uat/evidence/20260718-0154-tech-v02-rc2/api/roles/housekeeping-supervisor/) |
| 店助 | 部门执行、任务跟进、漏交升级通知 | PASS | [assistant-gm](uat/evidence/20260718-0154-tech-v02-rc2/api/roles/assistant-gm/) |
| 店总 | 门店驾驶舱、风险、未完成任务、复核验收 | PASS | [general-manager](uat/evidence/20260718-0154-tech-v02-rc2/api/roles/general-manager/) |
| 区域/运营 | 区域多门店总览、规则、任务、跨区域拒绝 | PASS | [regional-operations](uat/evidence/20260718-0154-tech-v02-rc2/api/roles/regional-operations/) |

结论边界：以上证明本地RC环境中的业务身份、组织权限和数据范围正确；认证颁发方是本地受控OIDC模拟服务，不等同于目标企业SSO上线验收，也不替代六位业务代表签署。

## 六、三个业务闭环验收

### 场景A：客房卫生整改

链路：图片上传 → 关联卫生标准 → FAIL评价 → Worker投影事件 → 规则创建整改任务 → 客房主管执行并提交证据 → 店总PASS复评和验收。

- 任务：`487c7d1d-0fbb-499e-962e-6fe91e926f6b`。
- 最终状态：`COMPLETED`。
- 上传与下载SHA-256一致。
- 安全扫描状态：`CLEAN`。
- API证据：[场景A目录](uat/evidence/20260718-0154-tech-v02-rc2/api/flows/A-housekeeping-photo-standard-remediation/)。

结果：业务技术闭环`PASS`。发布边界：附件仍是68字节1×1 PNG测试样本，不是真实试点门店现场照片；目标对象存储、附件备份恢复和现场业务签署仍未完成。

### 场景B：客诉处理闭环

链路：前台提交客诉 → 标准判断FAIL → Worker投影事件 → 规则触发任务 → 前台执行 → 前厅主管复评和验收。

- 工作记录：`123e2965-1e88-4c5c-a196-f7cad1b3d941`。
- 任务：`f3e14bc5-7d17-4386-a436-f0f5067c6468`。
- 最终状态：`COMPLETED`。
- API证据：[场景B目录](uat/evidence/20260718-0154-tech-v02-rc2/api/flows/B-front-complaint-rule-task-closure/)。

结果：`PASS`。

### 场景C：工作未提交提醒升级

链路：工作期望未提交 → 后台Worker标记MISSED → 发送提醒 → 规则创建整改任务 → Worker标记OVERDUE → 升级店助。

- 工作期望：`2a500000-0000-0000-0000-000000000005`。
- 任务：`ae93939f-2be8-421d-b372-ef7c5c1ed37e`。
- 最终业务验证状态：`PENDING_ACK / OVERDUE`，时间线包含逾期和升级。
- 手工SLA/Outbox调用次数均为0。
- API证据：[场景C目录](uat/evidence/20260718-0154-tech-v02-rc2/api/flows/C-missed-scan-reminder-task-escalation/)。

结果：`PASS`。该任务有意保留在逾期待确认状态，用于证明提醒和升级已发生，不表示流程失败。

## 七、数据库结果

[数据库环境证据](uat/evidence/20260718-0154-tech-v02-rc2/database/00-environment.json)记录：

- PostgreSQL 14.22。
- Flyway当前版本13，V1—V13共13次迁移成功。
- 应用运行账号`hotel_ai_os_app`不是超级用户，`BYPASSRLS=false`。
- 49张租户业务表启用并强制RLS。

[数据库汇总](uat/evidence/20260718-0154-tech-v02-rc2/database/11-database-summary.json)记录：

- 六角色账号6个。
- 客房卫生附件1个。
- 已完成评价4个。
- UAT任务5个，其中完成2个、取消1个。
- 升级状态迁移2次。
- 漏交提醒1个。

工作记录、附件、评价、任务、时间线、证据、通知、升级及规则动作的逐项原始数据位于[数据库证据目录](uat/evidence/20260718-0154-tech-v02-rc2/database/)。

## 八、RC制品与可复现构建

### 8.1 RC2业务证据对应制品

两次独立本地构建产生相同的5个制品及相同负载指纹：

`daf7a779fca869ee0208c7ae4588aff3d3f111ee1732f6ff5477612d42a1f1bb`

构建清单：

- [build-1 manifest](../.uat-runtime/release-artifacts/reproducibility/build-1/manifest.json)
- [build-2 manifest](../.uat-runtime/release-artifacts/reproducibility/build-2/manifest.json)
- [SHA256SUMS](../.uat-runtime/release-artifacts/reproducibility/build-1/SHA256SUMS.txt)

| 制品 | SHA-256 |
|---|---|
| API说明 | `0196e2c8b9731effd6fb34f0efe3686d0bc0d4eabdcc0103d4486d383c160a4e` |
| 后端JAR | `e3b422216fe4109ac868ceba017912a1cbca1ec9e2d40b6b6a6eaa05fa2cc51d` |
| DB-V13迁移包 | `30856c7bbfcc6c042ecfefe3169f6d4682b9ea8b4ed604a77a59fb469f7f28c9` |
| OpenAPI | `cdfb24bcdd9ad498f7e2938d108bbc70d1f34a921270df9f6cb54ebc7c4791e6` |
| 前端ZIP | `3baaf43304f779ec30ad57c7616f2d5c1d820ce4262a7ee7ed3276003fa40225` |

边界：清单中的`source.commit`为`null`，当前目录没有有效Git提交和正式标签；上述制品位于本地`.uat-runtime`，只证明构建可复现，不能关闭发布追溯门禁。

### 8.2 RC3安全加固候选

发布包敏感信息扫描首次在两套RC2后端JAR的`application.yml`中发现4次`PASSWORD_ASSIGNMENT`命中。源到使用分析确认主数据源与Flyway密码存在打包回退值，缺少外部变量时可进入数据库认证路径。当前工作树已：

- 将两项密码配置改为无回退值的必填外部变量；
- 在UAT Docker启动路径中增加必需数据库变量非空校验；
- 新增发布配置回归测试；
- 增加应用入口密钥预检，缺失时在Spring上下文、迁移、数据库连接和端口监听之前失败；重新执行48项后端回归、真实Live宿主停机复验和两次独立制品构建。

两套`TECH-V0.2-rc.3-local`制品一致，载荷指纹为：

`546fc5175d97af2e0bbe3736468b1366d8890e89a6c6a6d761db4d40eba089ee`

| 制品 | SHA-256 |
|---|---|
| API说明 | `0196e2c8b9731effd6fb34f0efe3686d0bc0d4eabdcc0103d4486d383c160a4e` |
| 后端JAR | `7cc2d6ecf194c1b78f258c0e84d58eb5661801e10645f75e2635539740df4fec` |
| DB-V13迁移包 | `d300af375a37d9c68bb60b1f4ea6cbae4a3eec58d64ca8d56a6e64c35f39b9de` |
| OpenAPI | `cdfb24bcdd9ad498f7e2938d108bbc70d1f34a921270df9f6cb54ebc7c4791e6` |
| 前端ZIP | `934a6e8b0da47363b8429b5a6f6f48c9dd0684de7fcea979edb6253a3228fc18` |

[RC3本地加固证据](uat/evidence/20260718-1315-tech-v02-rc3-local-hardening/README.md)中的机器可读扫描报告记录：160个文件、120个归档、43,830个归档条目，0命中、0错误，结论`PASS / CLEAN`；扫描输入集指纹为`e5b3f36e2ed5ddad69dce7adfe16a3bbbf3457c1fd5c8baa1da605b0fe5a95f3`。无密钥启动负向验证在0.2秒内退出，未渲染Spring Banner、未连接数据库、未监听端口，且日志只列变量名、不包含密钥值。

RC3同样没有Git来源提交，`source.commit=null`；它关闭默认密码打包问题，但不关闭REL-P0-05。若旧回退值曾在任何环境实际使用，环境责任人必须在发布前完成凭据轮换并提交受控记录。

## 九、数据库恢复演练

[数据库恢复演练证据](../.uat-runtime/release-db-drill/tech-v0.2-rc-final-20260718/evidence/database-recovery-drill.json)结果为`PASS`：

- 演练类型：本地嵌入式PostgreSQL冷物理备份、恢复和时间点回滚验证。
- 新集群执行13次迁移。
- 备份文件1,253个，共47,904,787字节。
- 备份内容清单SHA-256：`3899505ebcc5b8573b31d3c3ce9903a87575e99d9a938126d6d86079c5362755`。
- 恢复后Flyway V13、49张强制RLS表和回滚数据均验证通过。

边界：这是本地演练，不证明目标环境定时备份、保留策略、加密、监控告警或运维负责人批准的回滚。

## 十、业务P0/P1与发布REL-P0的区分

### 10.1 Sprint 2.1业务问题

本地RC证据已覆盖并关闭Sprint 2.1业务功能P0/P1：

- 六角色工作页面和操作链路可执行。
- 前厅主管详情、复核、整改和验收可执行。
- 客房主管附件、标准评价和整改可执行。
- 店总门店驾驶舱、风险和未完成任务可见。
- 区域角色多门店正向访问及跨区域拒绝有效。
- 三个指定管理闭环均有API、页面和数据库记录。

这只表示“功能修复已通过本地RC验证”，不代表正式发布门禁为零。

### 10.2 正式发布REL-P0

| 门禁 | RC状态 | 证据与缺口 | 发布判断 |
|---|---|---|---|
| REL-P0-01 后台Worker | 本地关闭 | 定时Worker自动完成事件、漏交、逾期和升级；手工触发计数为0 | LOCAL PASS |
| REL-P0-02 正式登录 | 部分完成 | 本地RS256 JWT、10个认证负向及账号/任职即时失效通过；[目标企业SSO验收单](releases/TECH-V0.2-TARGET-SSO-ACCEPTANCE.md)尚未执行 | BLOCKED |
| REL-P0-03 正式签署 | 未完成 | [签署单](releases/TECH-V0.2-RELEASE-SIGNOFF.md)为0/10 | BLOCKED |
| REL-P0-04 现场照片与生产附件链 | 部分完成 | 本地扫描、权限和SHA通过；真实现场照片、目标对象存储、附件备份恢复与签署未完成 | BLOCKED |
| REL-P0-05 可追溯制品 | 部分完成 | 本地`main`已初始化、两次构建指纹一致；无首个Git提交、受控RC/正式标签，`source.commit=null` | BLOCKED |
| REL-P0-06 目标环境运行保障 | 部分完成 | 本地数据库恢复演练PASS；[目标环境运行保障验收单](releases/TECH-V0.2-TARGET-OPERATIONS-ACCEPTANCE.md)尚未执行 | BLOCKED |

发布REL-P0关闭结果：仅REL-P0-01达到本地关闭标准，其余5项未关闭。正式发布结论必须为`NO-GO`。

正式收口入口：`tools/release/Invoke-TechV02ReleaseClosure.ps1`。它在隔离子进程中固定执行“本地证据一致性→外部证据生成→独立重算→6项发布门禁”，同时校验退出码、JSON状态、只读保障字段和门禁输入SHA-256在重算及最终门禁前后均未漂移。当前实跑在本地一致性`15/15 PASS`后，因正式外部证据包不存在而停止，后续重算及最终门禁均未执行，门禁输入写入数为0。

收口工具稳定快照复验PASS：契约测试`19/19`、总控负向测试`6/6`、外部证据主体绑定与负向测试`34/34`、最终门禁证据绑定测试`24/24`、本地证据一致性`15/15`。测试覆盖严格schema/版本/RC标签、显式时区ISO 8601、角色大小写和额外项拒绝、严格整数计数、五类正式制品各唯一一次、原始照片字节绑定、Worker/manifest/SHA256SUMS末端重验、manifest瞬时A→B→A替换拒绝，以及可选单个UTF-8 BOM的合法兼容。原子替换后的清理失败能够恢复原目标，强制回滚失败会保留唯一备份并失败关闭；测试结束`.tmp/.bak`残留、签署、审批、提交、标签、发布状态修改和网络写入均为0。该结果仅证明本地门禁工具不会伪造READY、绕过总控或静默改变规范输入，不关闭任何外部REL-P0。

本轮治理审计进一步关闭了四个本地证据协议缺口及其复核中发现的假通过边界：目标SSO和目标运维不再接受单一责任人代替各自10方专项审批；现场照片必须绑定并重读原始文件字节；Git追溯必须绑定唯一且一致的受控fetch/push远程、远程分支、HEAD身份和仓库责任人审批；仓库审批必须精确绑定远程、分支、HEAD、RC标签、manifest SHA-256和远程发布时间。所有保留意见和Worker/XML计数使用严格整数类型，附件存储类型必须精确为`OBJECT_STORAGE`，schema、版本、角色和RC标签均按类型与大小写精确校验，签署与发布时间必须带`Z`或显式偏移。最终门禁直接从首次锁定的同一字节快照解析输入、Worker JSON/XML、manifest和SHA256SUMS，并在作出结论前再次核对所有登记证据，防止重算后替换或A→B→A时间窗口。受控Git平台导出仍须由仓库和发布责任人确认其确实包含这些作用域字段，本地远程跟踪引用本身不等于外部发布证明。

正式流程必须在已被Git排除的`.uat-runtime/release/`内填写`TECH-V0.2-EXTERNAL-EVIDENCE-BUNDLE.json`，并仅由总控内部调用生成器产生`TECH-V0.2-RELEASE-GATE-INPUTS.json`；真实签署和目标环境导出同样不得放入`docs/releases`。不得直接复制或填写门禁输入示例，不得单独运行生成器、外部校验器或旧门禁作为发布授权。生成器预检失败时不会创建或刷新门禁输入，且拒绝向`.uat-runtime/release`之外写入；预检通过后先写唯一暂存文件，针对暂存文件独立复算PASS后才以备份式原子替换规范输入；若替换后的备份清理失败则恢复原目标。最终门禁以共享读锁持有实际输入字节并返回消费SHA，总控要求该SHA与生成、重算及门禁前后哈希完全一致。模板、执行顺序和真实性边界见[外部证据包说明](releases/TECH-V0.2-EXTERNAL-EVIDENCE-BUNDLE.md)。本地工具不生成签字，也不把普通JSON声明解释为真人签署；即使总控全部通过，也仅允许进入发布责任人的人工审批，不会自动标记Released或启动Sprint 3。

剩余5项外部责任人、输入和关闭证据见[TECH-V0.2发布阻塞交接单](releases/TECH-V0.2-RELEASE-BLOCKER-HANDOFF.md)。

证据一致性校验器：`tools/release/Test-TechV02EvidenceConsistency.ps1`。该校验器只读对账RC报告、RC2业务摘要、三条闭环动态标识、数据库版本及RLS、RC2/RC3两组制品、RC3回归、敏感信息扫描、密钥缺失失败关闭、Live停机、恢复演练和截图清单；当前结果为`15/15 PASS`，用于防止不同UAT批次的动态UUID、哈希、候选制品或可变运行指针被串用。

## 十一、已知限制

1. JWT签发方为本地OIDC模拟服务，不是集团目标企业SSO。
2. 六角色走查为自动化技术UAT，不能代替真实业务代表签字；当前签署为0/10。
3. 场景A图片为68字节1×1测试PNG，不是现场客房照片，不能证明人工视觉判断或AI图片判断质量。
4. 附件当前使用本地文件存储；目标对象存储、生命周期、备份恢复和生产访问审计未验收。
5. 本地安全扫描器返回CLEAN，但目标部署的扫描引擎、更新策略和故障告警未验收。
6. 当前目录已非破坏性初始化为本地`main`仓库，但尚无首个提交、远程仓库、经确认的提交身份或RC标签；现有RC制品仍没有来源提交号，不能形成完整SBOM式追溯链。
7. 后端制品仍使用`0.1.0-SNAPSHOT`，正式发布前需要冻结非SNAPSHOT版本。
8. 数据库恢复仅完成本地演练，未覆盖目标环境备份保留、加密、调度、监控和运维审批。
9. 页面证据使用Playwright fallback，已完成浏览器健康检查，但仍需业务人员现场操作确认。
10. RC2技术UAT停止阶段曾由嵌入式PostgreSQL测试宿主先关闭数据库、随后Spring上下文结束，短窗口内产生11条Worker数据库连接错误日志。该测试宿主问题已修复：真实Live复验中Hikari于`13:11:27.817 +08:00`完成关闭，PostgreSQL于`13:11:27.968 +08:00`停止；Live测试1/1、0错误、`BUILD SUCCESS`，托管进程与临时令牌均已清理。RC2原日志继续作为历史失败事实保留，不再把其描述为当前未验证问题。
11. 首次机器可读制品扫描发现两套RC2 JAR中的数据库密码回退值并据此阻断；RC3已移除回退、增加UAT启动校验和回归测试。重建后的两套制品深度扫描为0命中、0错误，机器可读报告已固定归档。仍需环境责任人确认旧回退值未被实际使用；若使用过，必须轮换后才可发布。

## 十二、最终发布判断

最终判断：`NO-GO`。

```text
TECH-V0.2 = Unreleased
当前正式技术版本 = TECH-V0.1
正式TECH-V0.2标签 = 不得创建
Sprint 3 = 未启动
```

只有以下条件全部满足后，才能重新提交GO审批：

1. 目标企业SSO完成六角色登录、停用和退出失效验收。
2. 10方签署全部完成，无未关闭保留意见。
3. 使用真实试点门店现场照片完成生产附件链和业务复验。
4. 建立受控Git提交、RC标签、正式标签流程及制品来源追溯。
5. 目标持久化环境完成部署、监控、备份恢复和运维回滚演练。
6. 重新核对同一提交、同一制品、同一数据库迁移和同一OpenAPI后作正式发布决策。

在正式发布决策完成前，本报告不得被改写为Released，Sprint 3不得启动。
