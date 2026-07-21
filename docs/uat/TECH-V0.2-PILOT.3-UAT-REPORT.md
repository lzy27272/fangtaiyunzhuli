# TECH-V0.2-PILOT.3 内部测试版UAT报告

日期：2026-07-19  
系统名称：贵州四方馆酒店管理有限公司中台  
公网地址：https://www.sfgzt.cn  
数据库：PostgreSQL 14.22 / `hotel_ai_os_uat` / Flyway V14  
结论：Pilot内部业务测试 PASS，可下发受控门店账号开展边测边优化；不等于TECH-V0.2正式Released。

## 一、真实环境

- 公网入口：Cloudflare Tunnel → 本机Caddy → React静态页面/Core API。
- 前端：Pilot生产构建，演示数据回退关闭。
- 后端：Core API仅监听`127.0.0.1:18080`。
- 数据库：PostgreSQL仅监听`127.0.0.1:55432`，运行账号无超级用户和`BYPASSRLS`权限。
- 认证：全站外层Basic Auth；应用层真实账号密码登录和短期JWT。
- 凭据：只保存在本机受限ACL文件，验收报告与截图不含密码或令牌。

## 二、验收结果

| 验收项 | 结果 |
|---|---|
| CEO真实登录及租户组织范围 | PASS |
| 新增门店、岗位、员工账号 | PASS |
| 同一员工分配自定义兼岗与前台主岗 | PASS |
| FRONT_DESK角色绑定指定门店范围 | PASS |
| 创建工作包草稿 | PASS |
| 校验并发布工作包 | PASS |
| 下发到员工任职并生成今日工作 | PASS |
| 新员工真实登录 | PASS |
| 员工只读取1个授权门店 | PASS |
| 员工查看本人工作 | PASS |
| 提交结构化工作记录 | PASS，最终状态`SUBMITTED` |
| 上传图片附件 | PASS |
| 低权限账号隐藏组织/工作包修改入口 | PASS |
| 浏览器控制台、页面、请求、服务端5xx | PASS，均为0 |
| 工作包详情PostgreSQL数组序列化 | PASS，HTTP 500已修复 |
| 后端完整JUnit回归 | PASS，48项、失败0、错误0、跳过2 |

## 三、自动化证据

- 公网角色与权限验收：[pilot3-browser-uat.md](evidence/pilot3/pilot3-browser-uat.md)
- 公网页面真实写入闭环：[pilot3-ui-full-flow.md](evidence/pilot3/pilot3-ui-full-flow.md)
- 机器可读页面闭环结果：[pilot3-ui-full-flow.json](evidence/pilot3/pilot3-ui-full-flow.json)
- CEO组织配置截图：[pilot3-ceo-organization.png](evidence/pilot3/pilot3-ceo-organization.png)
- 一人多岗员工任职截图：[pilot3-ui-created-employee-assignment.png](evidence/pilot3/pilot3-ui-created-employee-assignment.png)
- 工作包发布下发截图：[pilot3-ui-published-allocation.png](evidence/pilot3/pilot3-ui-published-allocation.png)
- 员工门店范围和本人工作截图：[pilot3-ui-employee-scoped-work.png](evidence/pilot3/pilot3-ui-employee-scoped-work.png)
- 结构化填报与附件截图：[pilot3-ui-work-record-with-attachment.png](evidence/pilot3/pilot3-ui-work-record-with-attachment.png)
- 已提交结果截图：[pilot3-ui-work-record-submitted.png](evidence/pilot3/pilot3-ui-work-record-submitted.png)

自动化使用本机Chrome的Playwright回退方案执行，因为当前环境未提供Browser插件。自动化凭据仅在运行内存中使用，未持久化到证据文件。

## 四、缺陷及处理

1. 双层认证冲突：外层Basic Auth和应用Bearer最初争用`Authorization`头，导致页面能打开但API全部401。现已使用独立应用认证头并由Caddy在受保护入口内转换，外层保护未削弱。
2. CEO无任职上下文：最初错误回退为前台工作台。现按账号`primaryRoleCode`解析CEO界面，不再伪造任职。
3. 低权限组织页403：页面曾无条件读取角色字典。现仅有授权权限时读取角色管理接口。
4. 工作包详情500：PostgreSQL数组对象无法直接JSON序列化。现转换为脱离连接的Java列表并增加回归测试。
5. 图片扫描提供方不可用：当前电脑由第三方杀毒软件接管，AMSI与Defender命令行提供方均不可用。Pilot仅对服务端成功解码并规范化重编码的受限PNG/JPEG启用显式回退；生产默认失败关闭。

## 五、已知限制

- 尚未提供组织、岗位和员工历史主数据的完整编辑/停用/批量导入页面。
- 尚未提供员工自助密码重置和正式企业SSO。
- 当前电脑是服务器，关机、断网、睡眠或未恢复运行进程会影响门店访问。
- 自动验收产生的`UAT`、`UI-`和“Pilot网页验收”前缀数据保留作证据，未做破坏性删除。

## 六、发布建议

建议以`TECH-V0.2-PILOT.3`名义向少量受控门店发放独立账号，先验证真实人员、真实班次和真实现场照片；问题按角色、门店、当前任职和发生时间记录。Sprint 3可在独立开发通道推进，但不得破坏组织模型、一人多岗、权限隔离、标准中心或当前管理闭环。
