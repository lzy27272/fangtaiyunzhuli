# TECH-V0.2-PILOT.6 实施与验证状态

日期：2026-07-21  
产品基线：PRODUCT-V1.2  
技术通道：TECH-V0.2-PILOT.6  
当前结论：已部署至内部Pilot并通过真实PostgreSQL、八角色API及公网页面UAT；TECH-V0.2正式版本仍为Unreleased

## 1. 冻结范围

PILOT.6按已确认推荐方案实施，并增加CEO集团模板治理：

- 集团所有岗位的标准工作模板可由CEO创建、修订、发布和下发。
- 任务模板可由CEO创建、修订和发布。
- 门店驾驶舱模板可由CEO创建、修订和发布。
- 其他角色只消费其权限和组织范围内的已发布配置。
- 不改变组织模型、一人多岗、权限隔离、标准中心和任务状态机。
- 不进入Sprint 3。

## 2. 已实施能力

### 2.1 岗位工作

- 工作记录支持保存草稿和最终提交。
- 表单草稿允许暂缺必填字段，但已填写字段仍执行类型和范围校验。
- 最终提交重新执行完整发布Schema校验。
- 所有岗位统一支持完成情况、异常协同、下一步行动。
- 支持JPEG、PNG、PDF、DOCX和XLSX多附件，单文件上限20 MiB。
- 支持待复核期间追加不可变补充说明。
- 主管在团队工作中只查看、复核员工提交证据，不可代替员工上传或删除。

### 2.2 任务执行

- 主管及以上可在任务中心选择目标组织、精确执行任职和精确验收任职创建任务。
- 可选择CEO发布的任务模板并带入标题、要求、优先级、时限和证据策略。
- 执行负责人可确认、开始、上传/查看/删除提交前证据和提交结果。
- 验收负责人可评价、通过或返工；全程保留不可变时间线。
- 模板证据策略冻结到任务来源快照，后端在提交结果时确定性校验文字说明和附件要求。

### 2.3 CEO集团模板配置

- 导航入口：`集团模板配置`，仅`template.manage`可见。
- 岗位标准工作：复用工作包定义、版本、工作项、标准关联、发布和精确任职下发。
- 任务模板：独立定义和版本，发布版本不可原地修改。
- 门店驾驶舱模板：配置经营指标、风险、未完成任务和工作完成区。
- 修改已发布模板时创建新草稿版本，历史发布版本保留。
- 创建、修改、发布写入审计日志。

## 3. 数据库与权限

- 新增迁移：`V16__pilot6_operational_usability_and_enterprise_templates.sql`。
- 新增表：`enterprise_template_definition`、`enterprise_template_version`、`work_record_supplement`。
- 三张表均启用并强制PostgreSQL RLS。
- 新增权限：`template.read`、`template.manage`、`template.publish`。
- CEO拥有管理和发布；主管及以上仅拥有已发布模板读取权限。
- `work_package_item.submission_policy`决定岗位工作文字和附件证据要求。
- `work_record`增加三类统一文字陈述字段；`task_evidence`增加扫描状态。

## 4. API候选版本

- API主版本：API-V1，不破坏现有路径。
- OpenAPI候选：`0.2.3-pilot.6`。
- 新增企业模板：`/api/v1/templates`及版本/发布子资源。
- 新增工作补充：`POST /api/v1/work-data/records/{recordId}/supplements`。
- 新增任务证据二进制接口：上传、查看和删除。

## 5. 当前验证事实

| 验证项 | 结果 | 说明 |
|---|---|---|
| 后端完整回归 | PASS | 53项测试，失败0、错误0、跳过2 |
| 后端PILOT.6可执行JAR | PASS | `0.2.0-pilot.6`已部署；SHA-256：`EFE5241BAA9509E806DD4E23E4226518EADE903C145A81C5039BB438A036BAB3` |
| 前端TypeScript/Vite生产构建 | PASS | Vite 7.3.6，39个模块；已部署修复后的PILOT.6制品 |
| V16真实PostgreSQL迁移 | PASS | PostgreSQL 14.22；Flyway V16；52张表启用并强制RLS |
| 八角色本机API UAT | PASS | 8/8角色；低权限团队接口按预期403；业务写入与图片附件通过 |
| 真实全流程API UAT | PASS | 新建组织、岗位、员工、账号、任职、工作包、下发、草稿、图片和最终提交均成功 |
| CEO集团模板治理 | PASS | CEO可创建/修改/发布；店总只读；店总写入返回403 |
| 八角色公网页面UAT | PASS | 8/8角色；修复登录后身份解析竞态后，业务请求无非预期4xx/5xx |
| 自动化队列健康 | PASS | 两条历史管理事件死信已修复汇报链并重放；Outbox、管理事件和规则动作失败/死信均为0 |
| 运行服务 | PASS | Caddy、Core API、PostgreSQL和Cloudflare Tunnel均正常；健康检查`UP` |

## 6. 部署与回滚事实

- 正式Pilot入口：`https://www.sfgzt.cn/#/workbench`。
- 部署前一致性逻辑备份：`D:\SifangguanHotelAIOS\Backups\TECH-V0.2-PILOT.6-logical-predeploy-20260721-112032`。
- 备份包含51张表、序列状态、附件、旧/新后端制品、候选前端制品、manifest与SHA-256；总计62个文件、35,247,547字节。
- 数据库只追加Flyway V16，不修改V1—V15；组织、一人多岗、权限隔离和标准版本模型保持不变。
- Core API健康检查为`UP`，修复完成后规则自动化未再产生新的人工处理错误。
- 当前Windows电脑仍是内部Pilot单机：PostgreSQL、Caddy和Tunnel为自动服务，Core API由登录用户计划任务恢复。电脑必须保持开机、联网且该用户已登录。
- 本状态只证明PILOT.6具备受控内部测试条件，不等于TECH-V0.2正式Released，也不代表Sprint 3已启动。
