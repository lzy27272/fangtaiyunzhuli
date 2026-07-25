# OTA-AUTOMATION-V0.1 受控外部接入前置工作包

任务编号：`OTA-AUTOMATION-V0.1`
工作包：`Sprint 2真实连接器——受控外部接入前置（单一适配器）`
形成日期：2026-07-23
当前状态：`CONTROLLED EXTERNAL INTAKE OPEN / CONTROLLED LOGIN COMPLETE / OBSERVATION PARTIAL / COOKIE AUTOMATION BLOCKED / I1 VENDOR AUTHORIZATION REQUIRED / REAL CONNECTORS BLOCKED / PRODUCTION NO-GO`
适用门店：喷水池态六酒店、解放路MOOODSHIFT酒店

---

## 一、本轮结论

产品负责人已要求进入下一个步骤。本轮正式打开“受控外部接入前置”，用于选择首个门店与来源、收集非秘密资料、形成字段/房型映射和人工金标准，并为后续单一适配器的受信任构建准备证据。

本工作包不新设其他Sprint子编号，也不自动解除Sprint 2C后的安全门禁。2026-07-25仅完成一次授权范围内的隔离浏览器人工登录、门店选择和只读结构观察；当前仍然：

- 不执行周期登录、接口扫描、路径枚举、批量回放或真实连接器采集；
- 不接收或解析密码、Cookie、Token、Webhook、验证码、数据库密码等秘密；
- 不开放外部egress，不启动真实profile，不登记或批准真实候选；
- 不运行`test/activate/run`，不把任何门店的`message_enabled`改为`true`；
- 不向测试群或正式运营群发送消息；
- 不把离线资料齐备误写成真实连接器、UAT或生产闭环已通过。

2026-07-25产品负责人提出使用Cookie登录并自动抓取。官方服务协议复核后，该方式在厂商书面许可前保持阻断；官方已有签名式OpenAPI文档，正式接口开通成为首选路径。未读取或导出现有浏览器会话。

## 二、首个适配器选择

真实适配器代码必须以一个明确的“门店＋来源＋厂商产品版本”为边界，不能同时猜测两店六个连接器。

| 决策项 | 当前值 | 允许值或要求 |
|---|---|---|
| 首个门店 | 喷水池态六酒店 | `SELECTED / USER_PROVIDED_2026-07-23` |
| 首个来源 | PMS | 这是PMS接入实例，不登记为美团OTA来源 |
| 产品负责人确认系统名称 | 美团别样红系统 | `READY / OWNER_CONFIRMED_2026-07-24`；正式厂商法律名称仍待证据 |
| 准确版本/Build | `NO_VISIBLE_VERSION` | 产品负责人确认无可见版本；后续强制使用capability/schema指纹及脱敏合同测试识别变化 |
| 正确登录入口 | `https://pms.meituan.com/` | `OWNER_CONFIRMED / AUTHENTICATED / HOTEL_SELECTED_2026-07-25` |
| 用户提供登录后业务接口 | `https://pms.meituan.com/hotelpms/api/v1/report/lion/manager/workbench/room` | 受控GET仅得到通用JSON包络；正确方法和业务语义仍未验证 |
| PMS主页房态候选 | `POST /hotelpms/api/v1/report/home/workbench/room` | 无请求体、HTTP 200、`data[]`三字段匿名结构；业务语义未验证 |
| 用户提出的接入方式 | `AUTHENTICATED_WEB_INTERFACE / COOKIE_SESSION` | 厂商书面许可前禁止实施 |
| 推荐正式接入方式 | `OFFICIAL_SIGNED_OPENAPI` | 官方公开签名鉴权及Hotel API文档；门店和方法权限尚未开通 |
| 资料责任人 | `PENDING` | 能确认文档、字段和许可，不是凭据转交人 |
| 门店复核人 | `PENDING` | 能核对营业日、房费、间夜、库存和房型映射 |

建议优先选择“资料最先齐备的一家门店的PMS”。PMS是营业日、实体房型、房费和实际可售库存的事实基准；在PMS口径未验证前先做OTA，无法完成最终房态对账。

门店、来源、系统名称、接口性质、“无可见版本”、专用账号及只读授权已锁定，受控人工登录和门店选择已完成。下一步是：

> 先取得官方OpenAPI正式开通证明；如其能力不足，再取得厂商对指定网页登录会话自动化方式的书面许可。I1通过后，才继续确认主页房态字段名、字段含义、营业日语义和库存口径。

不得在回复中附带账号密码、Cookie、Token、Webhook或验证码。

2026-07-25已完成一次有限受控观察，但厂商/合同许可证据仍缺失；该事实登记为I1门禁缺口。在许可、频率和责任人材料补齐前停止扩大真实页面观察，不捕获字段名、业务值、请求头或会话，不使用保留的临时Chrome Profile。

## 三、准入门禁

| 门禁 | 交付物 | 通过条件 | 当前状态 |
|---|---|---|---|
| I0 范围锁定 | 首个门店、来源、厂商产品版本、接入方式 | 六项均明确且无秘密 | `PARTIAL / IN_REVIEW` |
| I1 合法接入 | OpenAPI正式开通证明，或网页会话自动化书面许可；限流/分页/历史范围、网络边界 | 酒店、方法、字段、用途、频率和环境均获得明确许可 | `BLOCKED / VENDOR AUTHORIZATION REQUIRED` |
| I2 字段能力 | 字段字典、脱敏样例、错误码、增量水位、Schema变化策略 | 必填字段可定位，样例通过隐私检查并有SHA-256 | `BLOCKED BY I0` |
| I3 业务金标准 | 人工核对营业日、字段矩阵、产品到实体房型映射 | 覆盖夜审、改期、缩住、减房、取消、冲销、钟点房；房量不重复相加 | `BLOCKED BY I2` |
| I4 离线适配器 | 单一版本化适配器、fixture、合同测试、金标准比较 | 全程无网、无Secret；输出稳定能力/Schema指纹 | `CODE HOLD` |
| I5 受信任制品 | 代码评审、测试、SBOM、SAST/依赖扫描、签名/摘要 | 同一制品生成版本、源码修订、能力/Schema指纹和制品摘要 | `BLOCKED BY I4` |
| I6 隔离运行 | 外部SecretStore、最小权限身份、TLS、默认拒绝egress和允许清单 | 授权人员直接录入秘密；连接器独立进程/容器且代码加载前完成准入 | `EXTERNAL BLOCKED` |
| I7 影子联调 | 首次人工认证、蓝绿身份实操、单适配器影子采集 | `message_enabled=false`，不向正式群发送；真实并发切换和15分钟墙钟长测通过 | `EXTERNAL BLOCKED` |

I0至I3是开始单一适配器业务代码的最小输入门槛。资料不完整时，只能补资料和校验模板，不得以模拟字段猜测厂商实现。

## 四、需要收集的非秘密资料

### 4.1 门店与PMS

- 后台门店编码、时区及门店资料复核人；
- PMS厂商、产品、版本/Build、云端/本地/私有部署位置；
- 正式接入方式、厂商许可、网络拓扑、限流、分页、历史范围和增量规则；
- 稳定订单/间夜键，创建、修改、取消、来源更新时间；
- PMS营业日字段和值格式，以及夜审后实际切换行为；
- 订单状态、房费/非房费、钟点房、退款和冲销语义；
- 实体房型ID/名称、有效总房量、实际可售量和观察时间；
- 脱敏字段字典、脱敏样例文件的受控引用和SHA-256；
- 至少一个经人工核对的营业日金标准。

凌晨2点至7点仅是常见夜审区间，不能写成固定营业日切点。营业日切换以PMS返回的营业日实际变化为准。

### 4.2 携程与美团

- 准确外部门店ID、接入方式、厂商许可和专用测试账号别名；
- 权限范围、首次人工认证流程及协作责任人；
- 产品ID、售卖名称、套餐/含早/无早、产品级可售、开关房和来源更新时间；
- 稳定订单/间夜标识，修改、取消、改期、缩住、减房及多间多晚语义；
- 分页、历史范围、限频、错误码和Schema变化处理方式；
- 每个OTA售卖产品到一个PMS实体房型的全量映射。

账号别名可以记录；账号秘密、浏览器Cookie和验证码不能记录。多个套餐、含早/无早等售卖名称映射到同一实体房型时，共享同一实际房量，每个产品分别与PMS房量比较，绝不把产品库存相加。

### 4.3 Secret、网络与企业微信

- SecretStore/KMS产品、UAT命名空间、授权责任人、引用命名规范、轮换/吊销/恢复流程；
- 独立UAT域名/TLS、PostgreSQL、Worker、对象存储、稳定出口IP；
- 默认拒绝egress、目标域名/IP允许清单、代理或门店Agent/mTLS方案；
- 企业微信门店运营群、机器人类型、Webhook的Secret引用、`@所有人`权限和测试窗口；
- 限流、消息长度、成功码、失败码、结果不明、重试及过时简报补发验收方法。

同一门店的小时简报、P1首次告警、升级和恢复通知继续发送到同一个运营群并`@所有人`。Webhook本体只能由授权人员直接写入外部SecretStore。

## 五、资料包模板

模板目录：[`ota-controlled-external-intake`](./ota-controlled-external-intake/README.md)

首个实例：[`喷水池态六酒店｜美团别样红系统｜PMS`](./ota-controlled-external-intake/intakes/pilot-01-bieyanghong-pms/README.md)

受控登录方案：[`美团别样红PMS受控登录验证清单`](./ota-controlled-external-intake/intakes/pilot-01-bieyanghong-pms/CONTROLLED-LOGIN-RUNBOOK.md)

Cookie方案评估：[`Cookie/浏览器会话自动采集设计草案`](./ota-controlled-external-intake/intakes/pilot-01-bieyanghong-pms/COOKIE-SESSION-AUTOMATION-DESIGN-DRAFT.md)

| 模板 | 用途 |
|---|---|
| `source-profile.template.md` | 锁定单一门店、来源、厂商、版本、接入与网络边界 |
| `field-capability-matrix.template.csv` | 把冻结业务字段逐项映射到来源字段和水位语义 |
| `physical-room-product-mapping.template.csv` | 记录OTA产品到PMS实体房型的一对一映射及共享库存规则 |
| `golden-sample-manifest.template.md` | 登记脱敏样例、SHA-256、边界场景和人工期望结果 |
| `artifact-admission-checklist.template.md` | 后续单一适配器受信任构建、制品和隔离运行准入 |

模板可以复制到受控证据区填写。真实凭据、住客个人信息和未经审查的原始导出不得提交到Git仓库。

## 六、已登记P2的强制处理

进入真实适配器设计后必须同时处理Sprint 2C登记的限制：

1. 连接器在独立进程/容器运行，且在类加载、静态初始化和实例构造前完成制品准入；`collect`前preflight不能视为Java沙箱。
2. 运行时必须证明实际加载制品与已批准`artifact_digest`一致，不能只把摘要作为存档值。
3. stage/promote/retire和批准命令须有完整command receipt、服务端规范化请求哈希和幂等协议。
4. 默认拒绝网络，仅为已批准连接器和目标地址开放最小egress。
5. 蓝绿切换须真实撤销旧凭据、关闭旧连接池、终止旧backend并确认`pg_stat_activity=0`。
6. 完成真实并发写切换及15分钟墙钟长测；离线受控时间测试不能替代。

## 七、本工作包完成条件

只有同时满足以下条件，才能把状态改为`FIRST ADAPTER INPUT READY`并申请开始单一适配器代码：

1. I0范围已锁定；
2. 厂商正式文档和接入许可有受控证据；
3. 字段能力矩阵全部必填项为`READY`，未知项有明确阻断理由；
4. 脱敏样例隐私检查通过并登记SHA-256；
5. 房型与OTA产品映射由门店复核，确认共享库存不相加；
6. 人工金标准覆盖全部关键边界；
7. 适配器负责人、安全复核人和门店业务复核人明确。

完成本工作包仍不等于允许周期性或程序化登录、Secret提取/复用、真实连接器联网、候选登记、企业微信发送、连续3个PMS营业日UAT或生产发布；这些动作必须分别通过I5至I7并获得新的明确放行。
