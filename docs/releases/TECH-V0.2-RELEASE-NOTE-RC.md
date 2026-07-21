# Hotel AI OS TECH-V0.2 Release Note — RC

文档版本：RC-NOTE-V1.4  
候选日期：2026-07-18  
候选标识：`TECH-V0.2-rc.3-local`  
产品基线：PRODUCT-V1.2  
发布状态：`NO-GO / Unreleased`  
正式技术版本：TECH-V0.1  
Sprint 3：`未启动`

> 这是Release Candidate说明，不是正式Release Note。不得据此宣告TECH-V0.2已发布，不得把候选标识当作正式Git标签。

## 候选版本目标

TECH-V0.2候选版本用于打通酒店集团“标准 → 工作 → 任务 → 执行 → 验收”管理闭环，并验证组织隔离、一人多岗、角色权限和多门店数据范围不会被破坏。

## 候选能力

- 工作包定义、版本、范围、分配和岗位工作期望。
- 岗位工作记录、附件、表单关联和团队复核。
- 企业规则的事件、条件、动作和幂等消费。
- 整改任务创建、确认、执行、证据、复评、验收、返工、逾期和升级。
- 标准评价与评价快照。
- 前台员工、前厅主管、客房主管、店助、店总、区域/运营六角色页面和数据权限。
- 店总门店驾驶舱和区域多门店运营视图。
- RS256 Bearer JWT资源服务器路径及认证负向控制。
- 后台定时Worker处理Outbox、规则、漏交和任务SLA。
- 附件安全扫描失败关闭和下载状态控制。
- 数据库密码仅允许外部注入且缺失即失败，不再把回退值打入发布JAR。
- 外部发布证据在正式门禁前执行路径、哈希、签署凭据和身份唯一性校验。
- 新增唯一正式、失败关闭的发布收口总控，强制执行本地一致性、外部证据生成、独立重算和最终6项门禁；证据材料只进入Git忽略目录，生成器经暂存文件复算后以备份式原子替换规范输入，清理失败即恢复原目标；最终门禁锁定并返回实际消费SHA，总控严格核对大小写状态、副作用字段类型及输入漂移；三个子工具只能用于内部诊断，总控不创建签字、提交、标签、发布状态或Sprint 3代码。
- 外部证据协议新增主体绑定：目标SSO和目标运维各自强制10个专项角色审批；现场照片从原始文件的锁定字节快照核对名称、大小、SHA及上传/下载/恢复链；Git追溯要求唯一且一致的受控fetch/push远程、HEAD身份、远程跟踪提交和绑定远程/分支/HEAD/RC标签/manifest/发布时间的仓库责任人审批；最终门禁再次读取全部证据URI并核对SHA。

## 版本清单

| 项目 | RC版本 |
|---|---|
| TECH候选 | TECH-V0.2 |
| RC构建标识 | `TECH-V0.2-rc.3-local` |
| 数据库 | DB-V13 / Flyway V1—V13 |
| API | API-V1，`/api/v1` |
| OpenAPI | `0.2.1-sprint2.1` |
| 后端 | `0.1.0-SNAPSHOT` |
| 前端 | `0.2.0` |

## 验证结果

最终API/数据库证据批次：`20260718-0154-tech-v02-rc2`；页面证据继续引用未受服务端身份修复影响的`20260718-0112-tech-v02-rc-final`。

- 后端测试：48项，失败0，错误0，跳过2；身份生命周期、发布配置、密钥入口预检和Live宿主生命周期测试均通过，两个跳过能力已通过独立Live UAT和数据库演练执行。
- API：89次请求，非预期失败0。
- 认证：6个角色Bearer JWT通过；10个认证负向用例按预期拒绝。
- 权限：6个业务越权/非法状态用例按预期拒绝。
- 自动化：后台Worker模式执行；手工SLA和手工Outbox请求均为0。
- 页面：25/25通过，控制台错误0、警告0、页面异常0、失败请求0、5xx为0。
- 数据库：PostgreSQL 14.22、Flyway V13、非超级应用账号、49张强制RLS表。
- 三场景：客房卫生整改`COMPLETED`；客诉处理`COMPLETED`；工作漏交完成提醒、逾期和升级验证。
- Live宿主停机：1/1、错误0、BUILD SUCCESS；Hikari先于嵌入式PostgreSQL关闭，托管进程与临时令牌已清理。
- 制品安全：160个文件、120个归档、43,830个归档条目深度扫描，0命中、0错误，`PASS / CLEAN`；无密钥启动在创建Spring上下文或尝试连接数据库前失败。

证据索引：

- [RC Final Report](../TECH-V0.2-RELEASE-CANDIDATE-FINAL-REPORT.md)
- [RC2证据索引](../uat/evidence/20260718-0154-tech-v02-rc2/README.md)
- [API汇总](../uat/evidence/20260718-0154-tech-v02-rc2/api/summary.json)
- [截图清单](../uat/evidence/20260718-0112-tech-v02-rc-final/screenshots/manifest.md)
- [数据库环境](../uat/evidence/20260718-0154-tech-v02-rc2/database/00-environment.json)
- [数据库汇总](../uat/evidence/20260718-0154-tech-v02-rc2/database/11-database-summary.json)
- [Live宿主停机复验](../uat/evidence/20260718-1306-tech-v02-shutdown-order-fixed/README.md)
- [RC3本地安全加固](../uat/evidence/20260718-1315-tech-v02-rc3-local-hardening/README.md)

## 三个业务闭环

### 客房卫生整改

客房主管上传附件并创建卫生FAIL评价，Worker投影规则事件并生成整改任务，客房主管执行和提交证据，店总复评PASS并验收，最终任务`COMPLETED`。

技术结果：`PASS`。现场发布结果：`BLOCKED`，因为当前附件是68字节1×1测试PNG，不是真实现场照片。

### 客诉处理

前台员工提交客诉，主管按标准判断FAIL，规则创建任务，前台整改，主管复评和验收，最终任务`COMPLETED`。

结果：`PASS`。

### 工作未提交提醒升级

后台Worker自动把漏交期望标记为MISSED，发送提醒、创建整改任务、标记OVERDUE并升级店助。手工SLA和Outbox处理请求为0。

结果：`PASS`。

## 可复现RC制品

两次本地构建的负载指纹完全一致：

`546fc5175d97af2e0bbe3736468b1366d8890e89a6c6a6d761db4d40eba089ee`

| 制品 | SHA-256 |
|---|---|
| API说明 | `0196e2c8b9731effd6fb34f0efe3686d0bc0d4eabdcc0103d4486d383c160a4e` |
| 后端JAR | `7cc2d6ecf194c1b78f258c0e84d58eb5661801e10645f75e2635539740df4fec` |
| DB-V13迁移包 | `d300af375a37d9c68bb60b1f4ea6cbae4a3eec58d64ca8d56a6e64c35f39b9de` |
| OpenAPI | `cdfb24bcdd9ad498f7e2938d108bbc70d1f34a921270df9f6cb54ebc7c4791e6` |
| 前端ZIP | `934a6e8b0da47363b8429b5a6f6f48c9dd0684de7fcea979edb6253a3228fc18` |

- [构建1清单](../uat/evidence/20260718-1315-tech-v02-rc3-local-hardening/artifacts/build-1-manifest.json)
- [构建2清单](../uat/evidence/20260718-1315-tech-v02-rc3-local-hardening/artifacts/build-2-manifest.json)
- [敏感信息扫描报告](../uat/evidence/20260718-1315-tech-v02-rc3-local-hardening/security/release-sensitive-information-scan.json)

限制：两个清单的`source.commit`均为`null`，所以可复现构建不能替代Git提交、受控标签和来源追溯。

## 数据库恢复演练

[本地恢复演练](../../.uat-runtime/release-db-drill/tech-v0.2-rc-final-20260718/evidence/database-recovery-drill.json)结果为`PASS`：13次迁移、1,253个备份文件、47,904,787字节，恢复后数据、Flyway版本和RLS验证通过。

该结果仅覆盖本地冷备恢复，不覆盖目标环境定时备份、保留、加密、监控告警和运维审批。

## 发布门禁治理复验

稳定快照已通过外部证据主体绑定与负向测试`34/34`、最终门禁证据绑定测试`24/24`、收口契约测试`19/19`、总控负向测试`6/6`和本地证据一致性`15/15`。复验覆盖严格schema/版本/RC标签、ISO 8601显式时区、严格整数、精确角色集合、五类正式制品唯一性、原图字节绑定、Worker/manifest/SHA256SUMS末端重验、manifest瞬时替换拒绝及UTF-8 BOM兼容；未创建签署、审批、提交、标签或网络写入。

本地门禁缺陷已关闭不等于真实外部证据已具备。正式外部证据包、规范门禁输入、受控Git提交/远程/标签和正式RC3制品当前均不存在，因此总控仍在外部证据生成阶段失败关闭。

## 已知限制与发布阻断

1. 目标企业SSO尚未完成六角色登录、账号生命周期和退出失效验收。
2. [正式发布签署单](TECH-V0.2-RELEASE-SIGNOFF.md)仍为0/10。
3. [现场照片与附件验收](TECH-V0.2-FIELD-PHOTO-AND-ATTACHMENT-UAT.md)仍为BLOCKED。
4. 无真实客房现场照片、目标对象存储及附件备份恢复证据。
5. 无有效Git提交、RC标签和正式标签；RC制品无法关联来源提交。
6. 目标持久化PostgreSQL部署、定时备份、监控告警和运维回滚未验收。
7. 后端仍为SNAPSHOT制品，尚未冻结正式非SNAPSHOT版本。
8. 页面自动化使用Playwright fallback；真实业务人员仍需现场操作并签署。
9. 环境责任人尚需确认旧数据库密码回退值未在任何环境实际使用；如曾使用，必须完成凭据轮换并留存受控记录。

## 发布决定

本RC的业务功能P0/P1技术闭环已通过，但正式发布REL-P0未全部关闭。

最终决定：`NO-GO`。

- TECH-V0.2继续保持Unreleased。
- 当前正式技术发行继续为TECH-V0.1。
- 不创建正式`TECH-V0.2`标签。
- Sprint 3不启动。

完成目标SSO、10方签署、真实现场照片与生产附件链、Git/制品追溯、目标部署及恢复回滚后，必须基于同一提交和同一制品重新作GO审批。

外部责任人、证据格式和校验顺序见[TECH-V0.2发布阻塞交接单](TECH-V0.2-RELEASE-BLOCKER-HANDOFF.md)。
