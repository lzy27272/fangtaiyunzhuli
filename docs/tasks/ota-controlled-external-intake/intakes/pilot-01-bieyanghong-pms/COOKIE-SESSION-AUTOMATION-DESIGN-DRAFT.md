# 别样红PMS Cookie/浏览器会话自动采集评估与授权后实施设计

形成日期：2026-07-25  
适用实例：喷水池态六酒店｜美团别样红系统｜PMS  
当前状态：`DESIGN ONLY / VENDOR WRITTEN AUTHORIZATION REQUIRED / COOKIE CAPTURE PROHIBITED / REAL CONNECTOR BLOCKED / PRODUCTION NO-GO`

## 一、当前决定

现阶段不提取、导出、保存或程序化重放网页登录Cookie，也不启动自动抓取。

原因不是技术不可行，而是当前缺少厂商对该访问方式的明确许可。官方[《酒店SaaS产品服务协议》](https://pms.meituan.com/pms-min-web/productService.html)第4.10条禁止未经授权爬取或以其他方式获取接口数据；第6.2条要求第三方技术对接先联系厂商并接受安全性、适配性评估；第11.3条要求未明示授权的权利另行取得书面许可。酒店内部账号授权不能替代厂商对自动化采集方式的授权。

官方[隐私政策](https://pms.meituan.com/pms-min-web/privacyPolicy.html)说明Cookie用于保障正常登录、简化操作和安全控制，但没有把该说明视为导出、共享或重放Cookie的授权依据。

## 二、首选接入路径

优先申请厂商签名式OpenAPI，不使用网页登录Cookie作为正式连接器凭据：

- [OpenAPI安全规范](https://docs.beyondh.com/apidoc/security.html)说明调用方需联系对接支持人员取得`ChannelKey`和`AppKey`；
- [公共参数](https://docs.beyondh.com/apidoc/pubparam.html)定义签名鉴权公共参数；
- [Hotel API](https://docs.beyondh.com/apidoc/HotelApi.html)公开列出营业日、房态、房间、可用房、房型及房量房价等只读能力。

公开文档只证明存在对接能力，不代表喷水池态六酒店已经获准调用，也不代表所需订单间夜、房费、钟点房、退款冲销和实体库存口径已经全部覆盖。必须取得账号/门店、方法和数据范围的正式开通证据。

只有当正式OpenAPI无法覆盖冻结业务字段时，才申请厂商书面确认是否允许使用网页登录会话进行受控自动化读取。

## 三、书面授权最小清单

许可证据必须由资料责任人存入受控证据区，并至少明确：

1. 被授权主体、喷水池态六酒店及对应外部门店标识；
2. 允许使用OpenAPI还是网页登录会话；若为网页会话，须明确允许自动化读取及会话复用；
3. 允许的域名、接口路径、HTTP方法、业务动作和字段范围；
4. 轮询频率、并发数、限流、历史回看范围和重试上限；
5. 数据用途：营业日、订单间夜、房费收入、钟点房、实体房型及实际可售；
6. 数据保存期限、删除方式、脱敏要求及第三方系统处理边界；
7. 是否允许将汇总分析结果发送至本门店企业微信群；
8. UAT/生产环境、出口IP、服务身份和技术联系人；
9. 会话失效、验证码/MFA、风控提示、账号吊销和应急停用流程；
10. 厂商确认人、确认时间、有效期和许可撤销方式。

不得把账号、密码、Cookie、Token、验证码、`ChannelKey`、`AppKey`或原始HAR作为许可证据提交到聊天、Git或普通文档。

## 四、厂商书面批准网页会话后的安全架构

即使获得许可，也不采用“复制Cookie字符串到后台配置”的做法。使用独立的浏览器会话代理：

```text
授权人员首次人工登录/MFA
        ↓
隔离持久化浏览器Profile
        ↓
Browser Session Agent（独立进程）
        ↓  仅受批准的同源只读请求
标准化事实/质量状态
        ↓
现有OTA Connector Worker与分析链路
```

强制边界：

- 新建独立`ota-browser-session-agent`，不把Playwright、浏览器驱动或网页登录能力放入现有Connector Worker；
- Cookie只由隔离浏览器Profile管理，API、后台页面、任务载荷、日志和聊天都不能读取或显示原始值；
- 后台只保存不透明的`BROWSER_SESSION` SecretStore引用和非秘密会话状态，不保存可复用Cookie；
- Agent只允许访问厂商书面批准的`scheme + host + port + path + method`白名单，禁止路径枚举、接口扫描、参数爆破和写操作；
- Agent与后台控制面仅通过回环或mTLS通信，并使用独立最小权限服务身份；
- 请求和响应设置硬超时、最大正文、最大分页、最大并发及服务端批准频率；
- 日志不得记录请求头、响应正文、Cookie、Token、住客个人信息或完整订单明细；
- 只向后续链路输出经字段合同验证的标准化事实、来源时间、水位、Schema指纹和质量状态。

## 五、会话状态机

```text
PENDING_INTERACTIVE_LOGIN
  → ACTIVE
  → EXPIRING
  → REAUTH_REQUIRED
  → ACTIVE

任意状态 → REVOKED
```

- 首次登录、验证码和MFA必须由授权人员在隔离浏览器现场完成；
- `401/403`、跳回登录页、验证码/风控页面、跨店页面或权限变化立即停止采集，状态改为`REAUTH_REQUIRED`或`REVOKED`；
- 不绕过验证码，不模拟破解风控，不无限重试，不自动切换到其他账号或酒店；
- 会话失效时按“来源不可用”进入现有质量/P1逻辑，禁止用旧缓存伪装实时数据；
- 重新认证成功后从持久化水位恢复，按冻结的迟到数据规则补算；是否补发消息仍由现有Outbox门禁决定。

## 六、获批后需要新增或调整的工程边界

只有I1许可证据通过后，才允许提出代码变更评审：

当前仓库已有可复用的`SecretStorePort`不透明引用、`BROWSER_SESSION_AUTH`能力、人工授权连接器模型、`AUTH_REQUIRED`采集结果、结果安全门和运行时合同漂移门禁。当前也存在两项有意设置的硬阻断：

- `PMS_INTAKE`只允许`OFFICIAL_API / READ_ONLY_DATABASE / AUTOMATED_REPORT / LOCAL_AGENT`，尚不允许`CONTROLLED_BROWSER`；
- `Sprint2OfflineRuntimeGate`对真实profile固定返回`SPRINT2A_EXTERNAL_SECRETSTORE_EGRESS_NOT_IMPLEMENTED`。

这些阻断不得通过改配置或复用诊断脚本绕过。

1. 在PMS接入模板中增加`CONTROLLED_BROWSER`接入方式，并只允许`BROWSER_SESSION`用途的不透明Secret引用；
2. 新建`apps/ota-browser-session-helper/`独立浏览器会话代理、外部SecretStore适配器、域名/路径/方法egress白名单和最小权限服务身份；不得把`tools/ota/`诊断脚本改造成生产采集器；
3. 建立厂商版本无关的capability/schema指纹、脱敏fixture、字段合同和人工金标准；
4. 将标准化事实接入现有Raw/Standard事务、水位、质量、漂移、P1和小时简报链路；
5. 建立会话过期、重新认证、撤销、字段漂移、限流、超时、迟到数据和跨店拒绝测试；
6. 完成受信任制品准入、隔离UAT、双店连续3个PMS营业日核对后，才可单独申请企业微信发送和生产放行。

浏览器代理不得启用HAR、trace、截图、下载、上传、远程CDP或原始响应落盘。现有Worker中的离线安全门禁不得为了网页接入而放宽；应在制品批准、SecretStore、egress白名单、UAT服务身份和`message_enabled=false`全部可验证后，新增窄范围真实运行模式。

## 七、放行顺序

```text
厂商书面许可或OpenAPI正式开通
→ I1合法接入通过
→ I2字段合同和脱敏样例通过
→ I3人工金标准通过
→ I4离线适配器
→ I5受信任制品
→ I6隔离真实运行
→ I7影子联调
→ 连续3个PMS营业日UAT
→ 另行批准企业微信和生产
```

在上述门禁通过前，本设计不授权重新打开保留的浏览器Profile，不授权提取Cookie、周期抓取、真实连接器候选登记、`test/activate/run`或企业微信发送。
