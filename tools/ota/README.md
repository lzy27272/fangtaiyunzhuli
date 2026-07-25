# OTA受控浏览器诊断工具

本目录只包含一次性UAT诊断辅助脚本，不是PMS连接器、周期采集器或生产运行组件。

当前门禁：

- `CONTROLLED LOGIN COMPLETE / OBSERVATION PARTIAL`；
- 厂商/合同自动化许可证据仍为`PENDING`；官方协议复核后，Cookie自动采集明确保持`BLOCKED`；
- 许可证据、允许频率和责任人补齐前，不得重新登录、扩大页面观察或执行字段名/业务值捕获；
- 不得重新使用本次诊断保留的临时Chrome Profile，不得提取、导出、保存或重放其中的Cookie；
- 首选申请官方签名式OpenAPI；网页登录会话只允许在厂商对具体酒店、路径、字段和频率书面批准后另行实现；
- 真实Connector Worker、Secret解析、`test/activate/run`、企业微信发送和生产均保持阻断。

安全约束：

- 只允许连接`127.0.0.1`上的隔离Chrome调试端点；
- 不接收或输出账号、密码、Cookie、Token、验证码、请求头、请求体秘密或页面输入值；
- 诊断输出只能包含白名单接口路径、HTTP方法/状态和匿名结构类型；
- 原始HAR、响应正文和可复用会话不得写入仓库；
- `.runtime/`仅用于本机短期诊断输出，并已禁止Git跟踪；
- 浏览器辅助进程必须与OTA Connector Worker分离。

脚本说明：

| 脚本 | 用途 |
|---|---|
| `Inspect-ByhLoginPageMetadata.mjs` | 读取脱敏页面路径和同源资源状态 |
| `Watch-ByhLoginNetworkMetadata.mjs` | 限时监听脱敏路径、方法和状态码 |
| `Reload-ByhCurrentPage.mjs` | 对唯一PMS工作台执行一次普通刷新 |
| `Inspect-ByhEndpointSchema.mjs` | 对固定候选地址生成匿名JSON结构指纹 |
| `Capture-ByhControlledReloadRoomSchema.mjs` | 受控刷新后对固定主页房态POST生成匿名请求/响应结构指纹 |
| `Close-ByhIsolatedBrowser.mjs` | 关闭隔离浏览器控制会话 |

这些脚本不能证明业务成功、字段语义、连接器可用、UAT通过或生产就绪。所有真实接入状态以受控接入资料和准入门禁为准。

本目录不得改造成周期采集器。获批后的网页登录能力必须进入独立浏览器会话代理，Cookie不得进入现有Worker、API、数据库业务字段、日志或Git。
