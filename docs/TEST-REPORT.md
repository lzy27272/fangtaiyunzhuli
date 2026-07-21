# Sprint 1 测试报告

测试日期：2026-07-17  
测试对象：Hotel AI OS V1.2 Sprint 1  
结论：Java编译、JUnit、真实PostgreSQL迁移与租户隔离、Spring API集成、React生产构建、静态契约和浏览器渲染全部通过；Sprint 1达到技术验收条件。

## 1. 后端构建与自动化测试

运行环境：

- Eclipse Temurin OpenJDK 21.0.11 LTS。
- Apache Maven 3.9.9。
- Spring Boot 3.5.3。

执行命令：

```powershell
mvn test
```

结果：

- 27个主Java源文件编译通过。
- 5个测试源文件编译通过。
- `11/11`个测试通过，失败0、错误0、跳过0。

测试分层：

| 测试类 | 用例数 | 验证内容 |
|---|---:|---|
| `TenantContextFilterTest` | 3 | 请求租户上下文、缺失请求头、开发认证默认关闭 |
| `AccessPolicyTest` | 3 | CEO配置权限、一线岗位拒绝、店总跨门店拒绝 |
| `TenantIsolationMigrationTest` | 1 | RLS迁移覆盖关键租户表 |
| `PostgresMigrationIntegrationTest` | 1 | 真实PostgreSQL迁移、种子数据、运行角色RLS隔离 |
| `ApiRuntimeIntegrationTest` | 3 | Spring上下文、CEO/店总驾驶舱、403、默认拒绝、跨租户空结果 |

## 2. PostgreSQL迁移与安全验证

使用测试期内启动的PostgreSQL 14.22原生进程执行Flyway，不使用H2模拟PostgreSQL语法。

结果：

- `V1`至`V4`共4个迁移全部成功，数据库版本达到`v4`。
- 25张Sprint 1业务表创建成功，Flyway历史表创建成功。
- 演示租户、集团/区域/门店/部门树、4个试点岗位、5个系统角色、标准、表单、工作记录和经营指标成功初始化。
- 所有租户领域表启用并强制执行RLS。
- 测试运行账号为`NOSUPERUSER`、`NOBYPASSRLS`且不是表所有者。
- 同一数据库连接切换租户上下文后，只能读取当前租户数据；两个租户互不可见。

## 3. API运行验证

Spring Boot完整应用上下文在真实PostgreSQL上启动成功，Flyway随应用启动执行成功，并通过MockMvc调用真实Controller、Service和JDBC链路。

已验证：

- CEO驾驶舱返回2家门店、4名员工、1项已发布标准、3条当日工作记录和5项经营指标。
- 店总可读取授权门店驾驶舱。
- 店总访问未授权门店返回HTTP 403。
- 缺少租户身份上下文返回HTTP 400。
- 第二租户使用CEO视角仍无法读取演示租户数据。

## 4. React生产构建

运行环境：Node.js 24.14.0、TypeScript 5.9.3、Vite 7.3.6。

结果：

- TypeScript工程构建通过。
- Vite转换30个模块并生成生产目录`apps/web/dist`。
- 输出：HTML 0.45 kB、CSS 11.98 kB、JavaScript 204.18 kB。
- 主JavaScript gzip后64.28 kB，未出现构建警告或错误。
- pnpm仅允许`esbuild`执行依赖安装脚本，未全局放开依赖脚本权限。

## 5. 静态契约与浏览器验证

结构化验收脚本：

```powershell
python tools/validate_sprint1.py
```

结果：`25/25 checks passed`。

覆盖数据库表、`tenant_id`约束、RLS、四个试点角色、一人多岗、六项指标、Java包结构、关键业务约束、审计与Outbox、OpenAPI、页面入口、响应式视口及截图尺寸。

浏览器验证使用Microsoft Edge实际加载页面：

- CEO驾驶舱通过。
- 店总驾驶舱通过，数据限制在本门店。
- 企业标准中心通过。
- 角色切换、中心切换和响应式布局通过。
- 三张交付截图均为1440×1050。

## 6. 安全边界

本地联调身份头`X-Tenant-Id`、`X-Actor-Id`、`X-Role-Code`和`X-Org-Scope`默认关闭，只有显式设置`DEV_HEADER_AUTH_ENABLED=true`才可启用。生产部署必须接入受信JWT或企业SSO，并由服务端解析角色与组织范围，不能信任浏览器自报身份。

租户隔离采用两道防线：应用查询显式包含`tenant_id`，事务写入`app.tenant_id`并由PostgreSQL强制RLS检查。后续生产部署仍需复核数据库运行账号与迁移账号分离。

## 7. 最终质量判定

| 项目 | 状态 |
|---|---|
| 架构、目录、SQL和API契约 | 通过 |
| Java编译与11项自动化测试 | 通过 |
| Flyway真实PostgreSQL迁移 | 通过 |
| PostgreSQL跨租户RLS | 通过 |
| Spring API运行链路 | 通过 |
| React TypeScript生产构建 | 通过 |
| 页面原型与浏览器截图 | 通过 |
| Sprint 1技术验收 | 通过 |

## 8. Sprint 2开发候选验证补充

验证日期：2026-07-17  
验证对象：TECH-V0.2工作树候选  
状态：自动化技术验证通过，业务验收与正式发布未完成。

本节为追加记录，不改变前述Sprint 1已验收结论，也不把TECH-V0.2提前标记为已验收或已发布。

后续状态：本节是Sprint 2首轮技术候选历史检查点；Sprint 2.1复验结果见第9节。

### 8.1 后端自动化验证

执行命令：

```powershell
cd apps/core-api
mvn test
```

结果：

- `27/27`项测试通过，失败0、错误0、跳过0。
- 应用在真实临时PostgreSQL 14.22上完成启动、12个迁移与集成测试。
- Sprint 1既有IAM、API、迁移和租户隔离测试继续通过。
- 新增工作包/工作记录、确定性规则条件、规则消费、任务流转和标准评价测试通过。
- 客户端伪造角色或组织范围不会成为服务端授权依据。

### 8.2 数据库验证

- Flyway从V1连续迁移至V12，V1—V4保持不变。
- 工作树共50张业务表；Sprint 2通过V5—V11新增25张租户业务表，并由V12加固事件与不可变性。
- 25张新增业务表全部启用并强制执行PostgreSQL RLS。
- 同租户组合外键、数据库运行角色与服务端授权链继续作为隔离防线。
- 已发布标准和表单版本的数据库不可变保护已加入V11。

### 8.3 管理闭环候选验证

- 工作包可定义版本、适用范围、岗位分配和工作期望。
- 岗位工作记录可提交并进入评价、事件和规则链路。
- Outbox可自动投影为管理事件，并进入确定性规则消费。
- 规则条件不依赖大模型；当前动作仅允许`CREATE_TASK`和`CREATE_NOTIFICATION`。
- 管理任务支持负责人、验收人、SLA、证据、返工与合法状态流转。
- 重复规则动作使用幂等键防止重复创建。
- 真实岗位工作提交可自动投影并触发唯一规则动作；失败动作可恢复重试。
- 前台不能读取同部门但非本人参与的任务，团队工作接口由服务端权限保护。
- 任务标准评价拒绝使用非绑定标准，跨组织任职指派被拒绝。

### 8.4 前端构建验证

- OTA运营助理、OTA运营经理、前台员工、前厅主管、店助、店总六角色入口已接入。
- 8个Sprint 2页面使用真实API资源层。
- TypeScript与Vite生产构建通过，生成`apps/web/dist`。
- 页面截图和六角色业务UAT尚未执行，因此本项只判定“构建通过”，不判定“页面验收通过”。

### 8.5 尚未通过的发布门槛

| 项目 | 当前状态 |
|---|---|
| 对象存储、上传内容安全与病毒扫描 | 未落地 |
| 完整JSON Schema校验 | 未实现 |
| Outbox/规则定时恢复调度 | 未完成 |
| 工作记录与人工复核的完整命令幂等 | 未完成 |
| 任务升级路径生产Worker | 未完成 |
| 真实企业SSO生产部署 | 未完成 |
| Sprint 2页面截图 | 未完成 |
| 六角色业务UAT | 未完成 |
| TECH-V0.2正式验收与发布 | 未进行 |

### 8.6 当前判定

TECH-V0.2已从“规划中”进入“开发中/技术验收候选”。自动化技术验证可以支持下一步技术审查，但不能替代页面截图、六角色业务验收、生产身份联调与正式发布审批。

## 9. Sprint 2.1修复与业务UAT复验

验证日期：2026-07-17  
验证对象：TECH-V0.2 / Sprint 2.1发布候选  
UAT运行编号：`20260717-2317-s21-final`  
状态：技术闭环UAT通过；正式Final UAT选择B，继续修复。

### 9.1 后端回归

- 标准测试套件共33项，失败0、错误0、跳过1。
- 跳过项为默认关闭的`Sprint21LiveUatServerTest`，防止普通测试等待外部UAT编排。
- Live UAT测试已另行显式启用并实跑1/1通过。
- `Sprint2RuleTaskIntegrationTest`定向回归5/5通过。
- 真实PostgreSQL 14.22、Flyway V1—V13、非超级运行账号和强制RLS链路通过。

### 9.2 真实API与业务闭环

- API请求83次，其中77次正向2xx、6次预期400/403、非预期失败0；83个Correlation ID均存在且唯一。
- 六角色资源探测34次。
- 客房主管账号实际创建客房卫生`FAIL`标准评价，HTTP 201；后续由店总创建任务结果`PASS`评价并验收。
- 权限负向用例6/6通过，覆盖团队数据、跨门店、跨区域、范围外指派、自我验收和附件越权。
- 前厅主管手工创建整改任务并取消，API与数据库证据完整。
- 场景A客房卫生问题：真实图片上传/下载SHA-256一致，规则建任务，客房主管执行，店总验收，最终`COMPLETED`。
- 场景B客诉问题：客诉记录、失败评价、规则任务、前台执行、前厅主管复核验收，最终`COMPLETED`。
- 场景B产生专用业务事件`COMPLAINTREPORTED`；整改规则实际监听`STANDARDEVALUATIONCOMPLETED`。
- 场景C工作未完成：工作期望转`MISSED`，发送提醒，规则建任务，任务转`OVERDUE`并执行`ESCALATE`；本次由UAT脚本调用SLA接口，不是真实后台Worker自动执行。

### 9.3 页面与前端构建

- 前端生产构建通过，Vite转换36个模块。
- 主JavaScript为264.79 kB，gzip后79.82 kB。
- 六角色共25张真实API页面截图，25张加载检查通过，0张失败。
- 覆盖客房主管图片整改、前厅主管团队复核、店总门店驾驶舱、店助任务跟进和区域多门店范围隔离。
- 页面未出现“演示回退”或API错误状态。

### 9.4 数据库证据

- 导出12份数据库证据，新增PostgreSQL版本、Flyway迁移、非超级运行账号和强制RLS环境事实。
- 六角色账号6个、前厅主管有效任职2个、客房卫生附件1个、完成评价4个、UAT任务5个、完成任务2个、取消任务1个、升级迁移2个、漏交提醒1个。
- 任务时间线证明执行人与验收人分离；规则事件、规则动作、任务、标准评价和工作记录可追溯。

### 9.5 契约验证

- OpenAPI版本：`0.2.1-sprint2.1`。
- 68个路径、85个操作、58个模型。
- 228个本地引用全部可解析，缺失引用0，重复`operationId`为0。

### 9.6 当前判定

Sprint 2.1技术闭环、六角色自动化业务走查和权限负向验收为`PASS`；真实后台Worker、正式登录、业务签字、真实照片、制品追溯和目标环境运行保障为`BLOCKED`。正式A/B发布判断选择`B——继续修复`，TECH-V0.2保持Unreleased，Sprint 3继续冻结。

证据：

- `docs/SPRINT-2.1-UAT-ACCEPTANCE-REPORT.md`
- `docs/HOTEL-AI-OS-TECH-V0.2-SPRINT-2.1-FINAL-UAT-REPORT.md`
- `docs/uat/evidence/20260717-2317-s21-final/README.md`

## 10. TECH-V0.2 RC Final技术验证

验证日期：2026-07-18  
验证对象：TECH-V0.2 Release Candidate（本地技术收口，非正式发布）  
UAT运行编号：`20260718-0112-tech-v02-rc-final`  
状态：技术验证`PASS`；正式发布门禁`NO-GO`。

### 10.1 后端与数据库

- Maven完整回归：37项，失败0、错误0、跳过2，`BUILD SUCCESS`；完成时间2026-07-18 01:24:12+08:00。
- 两个跳过项为需显式编排的Live UAT和数据库恢复演练；两者已独立执行并分别留存API/数据库证据与恢复演练JSON。
- PostgreSQL 14.22、Flyway V1—V13、13个迁移、49张强制RLS表均通过。
- 本地冷备恢复演练PASS：备份1253个文件、47,904,787字节，内容指纹`3899505ebcc5b8573b31d3c3ce9903a87575e99d9a938126d6d86079c5362755`。

### 10.2 六角色、认证与三业务闭环

- 六角色：前台员工、前厅主管、客房主管、店助、店总、区域/运营，正式角色路径6/6通过。
- 采用RS256 Bearer JWT；10项匿名、过期、错误签名、错误受众/签发方等认证负向用例均按预期拒绝；测试Token未写入证据目录。
- 业务权限负向用例6/6按预期拒绝，覆盖跨部门、跨门店、跨区域、越权指派、自我验收和附件越权。
- 场景A客房卫生整改最终`COMPLETED`；场景B客诉处理最终`COMPLETED`；场景C工作未提交到达`OVERDUE`并完成`ESCALATE`。
- 后台Worker自动执行；`manualSlaProcessRequestCount=0`、`manualOutboxRecoveryRequestCount=0`。
- 共89次API请求，非预期失败0；34次角色资源探测完成。

### 10.3 页面、附件与制品

- 25/25页面截图检查通过；控制台错误0、警告0，未发现5xx或失败网络请求。因本轮环境没有Browser插件，按前端测试技能的回退规则使用本地Playwright与Edge执行。
- 正式模式附件链使用ClamAV 1.5.3签名CVD库；干净图片扫描通过，标准EICAR测试样本被识别；扫描器不可用时失败关闭。
- 双构建可复现验证PASS，5项载荷指纹一致：`1652df5d4e3e1beb0418765584468cc849b80c1913286ad910fad64164a8d98c`。

### 10.4 治理判定

Sprint 2.1业务P0/P1技术问题已关闭，开放P1为0；但发布级REL-P0未全部关闭：目标企业SSO与账号生命周期、10方签署、真实现场照片及目标对象存储/备份、有效Git HEAD和正式标签、目标持久化PostgreSQL的备份保留/加密/监控/运维签署均缺证据。

因此TECH-V0.2保持`Unreleased`，当前正式发行仍为TECH-V0.1，Sprint 3不启动。权威判断与证据索引见：

- `docs/TECH-V0.2-RELEASE-CANDIDATE-FINAL-REPORT.md`
- `docs/uat/evidence/20260718-0112-tech-v02-rc-final/README.md`
- `.uat-runtime/release-artifacts/reproducibility/build-1/manifest.json`
- `.uat-runtime/release-db-drill/tech-v0.2-rc-final-20260718/evidence/database-recovery-drill.json`

## 11. TECH-V0.2 RC2身份生命周期修复复验

验证日期：2026-07-18  
候选标识：`TECH-V0.2-rc.2-local`  
API/数据库UAT：`20260718-0154-tech-v02-rc2`  
状态：本地技术`PASS`；正式发布仍`BLOCKED`。

### 11.1 修复内容

- 员工账号使用仍在有效期内的签名JWT时，如果账号变为INACTIVE，下一请求立即返回401。
- 员工最后一个当前有效任职失效后，旧JWT下一请求立即返回401，不再保留脱离任职的数据范围或角色授权。
- 一人多岗只失效一个任职且仍有其他当前任职时继续正常认证，并只返回剩余任职。
- 未绑定employee的租户级账号继续正常认证，不把员工任职约束错误套用到非员工主体。

### 11.2 自动化与UAT

- 完整后端回归：41项，失败0、错误0、跳过2，`BUILD SUCCESS`。
- 新增`SignedJwtIdentityLifecycleIntegrationTest`：4/4通过。
- 六角色与三闭环API复验：89次请求，非预期失败0；10次认证拒绝、6次业务权限拒绝均符合预期。
- 后台Worker模式继续为`scheduled-worker`；手工SLA与Outbox恢复调用均为0。
- 场景A/B最终`COMPLETED`，场景C到达`OVERDUE`并完成升级证据。
- 本轮服务端身份修复不影响Web，页面证据沿用`20260718-0112-tech-v02-rc-final`的25/25 PASS。

### 11.3 RC2制品

- 双构建可复现验证PASS，载荷指纹：`daf7a779fca869ee0208c7ae4588aff3d3f111ee1732f6ff5477612d42a1f1bb`。
- 5项制品大小和SHA-256校验全部PASS。
- 本地Git仓库尚无首个提交与RC标签，manifest仍为`source.commit=null`，因此不能关闭来源追溯门禁。

证据：

- `docs/uat/evidence/20260718-0144-tech-v02-identity-lifecycle/README.md`
- `docs/uat/evidence/20260718-0154-tech-v02-rc2/README.md`
- `.uat-runtime/release-artifacts/reproducibility/build-1/manifest.json`

结论：本地账号和任职生命周期缺口已关闭；目标企业SSO、退出/撤销、真实账号与安全签署仍须在目标环境验收，REL-P0-02继续为`BLOCKED`。
