# 贵州四方馆酒店管理有限公司中台 Pilot Test Version 发布记录

| 项目 | 当前值 |
|---|---|
| 产品名称 | 贵州四方馆酒店管理有限公司中台 |
| 发布通道 | Pilot Test Version（内部测试版） |
| Pilot版本 | TECH-V0.2-PILOT.6 |
| 产品基线 | PRODUCT-V1.2 |
| API边界 | API-V1（`/api/v1`，真实Core API） |
| 数据库边界 | PostgreSQL 14.22；Flyway V1—V16；不修改既有迁移 |
| 目标网址 | https://www.sfgzt.cn |
| 制品状态 | REAL POSTGRESQL UAT ACTIVE / LOCAL E2E PASS / PUBLIC DOMAIN E2E PASS |
| 正式Pilot网址 | https://www.sfgzt.cn |
| 域名上线状态 | ACTIVE：Cloudflare Named Tunnel已服务化；ICP备案仍待确认 |
| 运行主机 | 当前Windows办公电脑（内部Pilot单机） |
| 正式TECH状态 | TECH-V0.2仍为Unreleased；本Pilot不等于正式发布 |

> PILOT.6状态（2026-07-21）：已部署至正式Pilot网址；生产构建、部署前一致性逻辑备份、Flyway V16、八角色API UAT、公网页面UAT和自动化队列复核均PASS。TECH-V0.2正式版本仍为Unreleased。

## 1. 已完成

- 前端品牌、浏览器标题和版本标识统一更名。
- Pilot构建已关闭演示回退，旧`?demo=1`参数不能再切回静态演示数据。
- 已连接真实PostgreSQL 14.22数据库`hotel_ai_os_uat`，完成Flyway V1—V16与Sprint 2.1 UAT数据导入。
- 已启动真实Core API并接入数据库RBAC、强制RLS、自动化Worker、工作期望SLA调度及附件持久化/AMSI扫描。
- 已提供CEO、前台员工、前厅主管、客房主管、店助、店总、OTA运营助理、OTA运营经理8个真实验收账号；权限与数据范围由数据库解析，不提供前端模拟角色切换。
- 七类运营岗位均已配置角色专属结构化表单、已发布工作包、当前任职下发和真实工作实例；后续新增任职需由管理员在工作包中心选择该员工任职完成下发。
- 企业规则中心支持创建规则、修改草稿/创建新版本和发布；操作写入真实PostgreSQL，不再是页面模拟。
- 组织、岗位和人员支持编辑、启用/停用；只有已停用且未被业务引用的数据允许受控硬删除，历史数据只停用不级联删除。
- 准备Caddy HTTPS、SPA路由、安全响应头和根域名跳转配置。
- 当前办公室Windows电脑已配置为Pilot服务器；Caddy开机自启服务运行中且仅监听`127.0.0.1:4180`，Core API仅监听`127.0.0.1:18080`，PostgreSQL仅监听`127.0.0.1:55432`。
- WAN IPv4为运营商CGNAT地址，已放弃无效的光猫端口映射；Pilot公网入口改用Cloudflare出站隧道。
- Windows不开放Pilot入站端口；临时4174、4175入口均已关闭。
- 历史Quick Tunnel已完成1440×1000桌面与390×844移动端渲染、任务中心导航及控制台验收，错误0、警告0，现已停止。
- 固定Named Tunnel、`www.sfgzt.cn`和根域名DNS路由已建立；根域名308跳转到`https://www.sfgzt.cn`；两个Cloudflare边缘IP及独立外部抓取节点均验证正式域名返回200和正确页面内容。
- 公网页面直接进入中台应用登录；除登录接口外，`/api/*`继续要求有效JWT，账号组织范围和权限由服务端解析。本机测试账号与数据库密钥保存在受限ACL文件中，不进入仓库或聊天。
- 本机Playwright完成真实规则创建→修改→发布；公网Playwright完成8个真实角色登录、七岗位填报表单、团队隔离和对应驾驶舱走查，页面显示“实时API”。
- CEO可在“集团模板配置”创建、修订和发布集团岗位标准工作、任务与门店驾驶舱模板；其他管理角色只能在授权组织范围内读取已发布模板。
- 岗位工作支持草稿、统一文字陈述、多附件和最终提交；任务支持精确执行/验收任职、证据上传、结果提交、返工和验收。
- PILOT.6完整后端回归53项，失败0、错误0、跳过2；公网八角色严格走查8/8 PASS，所有业务HTTP请求无非预期4xx/5xx。
- 已修复店助登录后身份解析竞态，门店驾驶舱只在服务端身份与主岗解析完成后加载，不再用部门ID请求酒店驾驶舱。
- 两条历史管理事件死信已通过受控汇报链修复、审计和重放关闭；修复后Outbox、管理事件、规则动作失败/死信均为0，未再产生新的人工处理错误。

## 2. 上线所需外部条件

1. 确认`sfgzt.cn`已完成ICP备案并提供备案号用于页面底部展示。
2. Pilot目前使用本地应用账号、短期JWT、连续失败5次临时锁定和服务端RBAC/RLS；正式发布前仍需接入目标企业SSO并完成正式账号生命周期验收。
3. PostgreSQL已作为Windows自动服务运行；Core API由当前Windows用户计划任务在登录时及每5分钟检查恢复。正式生产前必须改为SYSTEM受管服务或云端托管，并补齐监控、告警、备份和恢复演练。
4. 附件当前保存于本机D盘；正式生产前必须切换对象存储并落实容量、病毒扫描、保留期和灾备策略。
5. Cloudflare Browser Insights注入脚本会被本站严格CSP拦截并产生一条无业务影响的控制台提示；可在Cloudflare关闭该注入，或在安全评审后单独决定是否放行。

## 3. 内部测试入口与使用约束

- 测试入口：`https://www.sfgzt.cn/#/workbench`。
- 不再使用包含`?demo=1`的旧链接。
- 浏览器直接显示中台登录页；应用测试账号只保存在本机`D:\SifangguanHotelAIOS\Pilot-Account-Access.txt`并通过安全渠道单独发放。
- 测试数据会真实写入PostgreSQL。创建规则、提交记录、创建任务或发布标准前，应使用UAT命名并避免录入真实客人隐私数据。
- 该电脑必须保持开机和联网；重启后需登录部署该任务的Windows用户，`SifangguanPilotCoreApiUser`会立即检查并每5分钟恢复Core API。

## 4. 测试与Sprint 3并行规则

产品负责人允许Pilot测试与后续Sprint 3开发并行，但必须保持以下隔离：

- Pilot稳定通道以 `TECH-V0.2-PILOT.x` 维护，紧急修复只进入该通道。
- Sprint 3使用独立开发分支和功能开关；未经回归不得覆盖Pilot稳定制品。
- V1—V13迁移不可修改；Sprint 3数据库只能追加V14+。
- 组织模型、一人多岗、权限隔离、标准中心、规则中心和任务状态机不得被破坏。
- TECH-V0.2正式Released与Pilot可测试是两个不同结论，不相互替代。
