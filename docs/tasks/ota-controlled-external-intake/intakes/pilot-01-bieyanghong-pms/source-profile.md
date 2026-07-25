# 单一来源接入资料｜喷水池态六酒店｜美团别样红系统

> 只记录用户提供、公开官方资料、离线解析和受控只读观察产生的非秘密元数据。2026-07-25已完成一次隔离浏览器人工认证和试点门店选择；同日根据官方协议停止Cookie自动采集方案，所有未证实字段继续保持`PENDING`。

## 1. 范围

| 字段 | 值 | 状态/证据 |
|---|---|---|
| 资料包ID | `INTAKE-PILOT-01-BYH-PMS-001` | `READY` |
| 门店名称 | 喷水池态六酒店 | `READY / USER_PROVIDED_2026-07-23` |
| 后台门店编码 | `PENDING` | `PENDING` |
| 时区 | `Asia/Shanghai` | `FROZEN_PROJECT_DEFAULT / HOTEL_CONFIRMATION_PENDING` |
| 来源 | `PMS` | `SELECTED_IN_CONTROLLED_INTAKE` |
| 产品负责人确认系统名称 | 美团别样红系统 | `READY / OWNER_CONFIRMED_2026-07-24` |
| 正式厂商名称 | `PENDING` | 不从用户简称或域名猜测 |
| 正式产品名称 | 美团别样红系统 | `READY / OWNER_CONFIRMED_2026-07-24` |
| 准确版本/Build | `NO_VISIBLE_VERSION` | `OWNER_CONFIRMED_2026-07-24`；后续以capability/schema指纹和脱敏合同测试识别变化 |
| 部署位置 | `PENDING` | `CLOUD / ON_PREMISE / PRIVATE_CLOUD`待确认 |
| 用户提出的接入方式 | `AUTHENTICATED_WEB_INTERFACE / COOKIE_SESSION` | `OWNER_PROPOSED_2026-07-25 / VENDOR_WRITTEN_AUTHORIZATION_REQUIRED`；当前禁止实施 |
| 推荐正式接入方式 | `OFFICIAL_SIGNED_OPENAPI` | `PUBLIC_DOCUMENTATION_FOUND_2026-07-25 / HOTEL_AND_METHOD_PERMISSION_PENDING` |
| 外部门店ID或非秘密别名 | `PENDING` | `PENDING` |
| 测试账号别名 | `AVAILABLE_NOT_DISCLOSED` | `OWNER_CONFIRMED_2026-07-24`；只登记别名，不接收秘密 |
| 账号用途授权 | 仅限喷水池态六酒店的受控只读自动化测试；禁止全部写操作 | `OWNER_CONFIRMED_2026-07-24` |
| 资料责任人 | `PENDING` | `PENDING` |
| 门店复核人 | `PENDING` | `PENDING` |
| 当前状态 | `I0 PARTIAL / CONTROLLED LOGIN COMPLETE / OBSERVATION PARTIAL / COOKIE AUTOMATION BLOCKED` | I1书面许可或OpenAPI正式开通前，真实连接器继续阻断 |

## 2. 用户提供候选地址

| 字段 | 值 | 状态 |
|---|---|---|
| 地址ID | `ENDPOINT-BYH-ROOM-001` | `READY` |
| 原始地址 | `https://pms.meituan.com/hotelpms/api/v1/report/lion/manager/workbench/room` | `USER_PROVIDED_UNVALIDATED` |
| 地址分类 | `POST_LOGIN_PMS_WEB_ENDPOINT` | `OWNER_CLARIFIED_2026-07-24` |
| 正确登录入口 | `https://pms.meituan.com/` | `OWNER_CONFIRMED_2026-07-24 / AUTHENTICATED_2026-07-25` |
| Scheme | `https` | `OFFLINE_PARSED` |
| Host | `pms.meituan.com` | `OFFLINE_PARSED` |
| Port | `443` | `OFFLINE_PARSED_DEFAULT` |
| Path | `/hotelpms/api/v1/report/lion/manager/workbench/room` | `OFFLINE_PARSED` |
| URI user-info | 无 | `OFFLINE_PARSED` |
| Query | 无 | `OFFLINE_PARSED` |
| Fragment | 无 | `OFFLINE_PARSED` |
| 可见Secret | 未发现 | 仅针对用户提供的字符串，不代表响应或登录态安全 |
| 网络状态 | 授权人员已在独立Chrome Profile现场认证并选择喷水池态六酒店；有限观察完成后浏览器进程已关闭，Profile未删除 | `CONTROLLED LOGIN COMPLETE / SESSION PROCESS CLOSED_2026-07-25` |
| 登录后接口状态 | 原`lion`地址的一次受控GET仅返回通用JSON包络；正确业务方法和语义仍未知 | `CONTROLLED PROBE COMPLETE / BUSINESS SCHEMA UNVERIFIED` |
| egress允许清单候选 | `pms.meituan.com:443` | `IN_REVIEW / NOT_ALLOWED` |

该地址是受控内部运营元数据，不含可见Secret，但不应公开扩散。未来如地址出现Token、session、signature、key、URI账号信息或其他凭据化参数，整个地址必须按Secret处理，不得进入聊天、Git、日志或fixture。

### 2.1 受控观察到的主页候选接口

| 字段 | 值 | 状态 |
|---|---|---|
| 地址ID | `ENDPOINT-BYH-HOME-ROOM-001` | `OBSERVED_2026-07-25` |
| Path | `/hotelpms/api/v1/report/home/workbench/room` | `CONTROLLED PAGE OBSERVATION` |
| HTTP方法 | `POST` | PMS主页受控刷新产生的自然请求 |
| Query | 无 | `OBSERVED` |
| 请求体 | 无 | `OBSERVED` |
| HTTP状态 | `200` | 仅证明传输成功 |
| 响应格式 | JSON包络，`data[]`为对象数组；每行一个字符串字段、两个数字字段 | 匿名结构指纹；字段名和值均未留存 |
| 业务成功 | 未验证 | 不得由HTTP 200推断 |
| 连接器可用 | 否 | 字段语义、许可、认证复用和限流均未完成 |

同时观察到`GET /hotelpms/api/v1/night/audit/businessDate`、`GET /hotelpms/api/v1/night/audit/businessDate/detail`、`POST /hotelpms/api/v1/property/roomType/search`及主页经营概览候选接口。仅记录路径、方法和HTTP状态，不代表字段能力已通过。

## 3. 合法性与厂商合同

| 检查项 | 证据引用或结论 | 状态 |
|---|---|---|
| 厂商服务协议 | [酒店SaaS产品服务协议](https://pms.meituan.com/pms-min-web/productService.html)：第4.10条禁止未经授权获取接口数据；第6.2条要求第三方技术对接接受厂商评估；第11.3条要求未明示权利另行取得书面许可 | `OFFICIAL PUBLIC EVIDENCE / REVIEWED_2026-07-25` |
| 厂商正式接口文档 | [安全规范](https://docs.beyondh.com/apidoc/security.html)、[公共参数](https://docs.beyondh.com/apidoc/pubparam.html)、[Hotel API](https://docs.beyondh.com/apidoc/HotelApi.html)公开签名鉴权及营业日、房态/房型、可用房等能力 | `PUBLIC DOCUMENTATION FOUND / ACCESS NOT GRANTED` |
| 自动化或只读访问许可 | 未取得喷水池态六酒店、具体方法、字段、频率和环境的厂商书面许可或OpenAPI开通证明 | `BLOCKED` |
| 该地址的正式用途与支持范围 | 需要网络登录后使用的美团别样红PMS网页接口 | `OWNER_CONFIRMED_TYPE_2026-07-24`；具体数据能力仍`PENDING` |
| HTTP方法、Content-Type和非秘密参数 | 主页房态候选为无请求体`POST`；原`lion`地址仍`PENDING` | `PARTIAL / OBSERVED_2026-07-25` |
| 认证机制类型及最小权限范围 | OpenAPI公开文档要求联系对接支持取得`ChannelKey`、`AppKey`并签名；网页会话机制未记录，且不得提取Cookie | `PUBLIC DOC PARTIAL / CREDENTIALS NOT ISSUED` |
| 允许频率与限流 | `PENDING` | `PENDING` |
| 历史查询范围 | `PENDING` | `PENDING` |
| 分页完整性规则 | `PENDING` | `PENDING` |
| 增量水位或来源更新时间规则 | `PENDING` | `PENDING` |
| 错误码与重试限制 | `PENDING` | `PENDING` |
| Schema/页面变化通知机制 | `PENDING` | `PENDING` |

> 门禁缺口：2026-07-25的受控人工登录和有限只读结构观察发生时，厂商/合同允许自动化观察的证据尚未登记。官方协议复核后，Cookie自动采集被明确保持阻断。本次不升级为I1通过、UAT或连接器证据；在厂商书面许可或OpenAPI正式开通材料补齐前，不得继续捕获字段名、业务值、请求头、会话或扩大接口范围。

## 4. PMS业务语义

候选地址已做受控只读观察，但尚未形成字段合同；以下字段不得因路径、HTTP 200或匿名结构而置为`READY`。

| 检查项 | 来源语义或证据引用 | 状态 |
|---|---|---|
| PMS营业日字段和值格式 | 已观察到`businessDate`与`businessDate/detail`候选路径，未读取字段或值 | `PENDING / PATH OBSERVED` |
| 夜审后实际切换行为 | `PENDING` | `PENDING` |
| 稳定订单键/间夜键 | `PENDING` | `PENDING` |
| 创建/修改/取消/来源更新时间 | `PENDING` | `PENDING` |
| 订单状态及有效售出范围 | `PENDING` | `PENDING` |
| 房费与非房费区分 | `PENDING` | `PENDING` |
| 钟点房判定及房费收入 | `PENDING` | `PENDING` |
| 退款、冲销和负向修订 | `PENDING` | `PENDING` |
| 实体房型稳定ID与名称 | `PENDING` | `PENDING` |
| 有效总房量 | `PENDING` | `PENDING` |
| 当前实际可售房量与观察时间 | `PENDING` | `PENDING` |

## 5. 端点覆盖缺口

| 标准数据流 | 当前证据 | 状态 |
|---|---|---|
| PMS营业日与夜审切换 | 无字段或文档证据 | `PENDING` |
| 订单、改期、缩住、减房与取消间夜 | 无字段或文档证据 | `PENDING` |
| 房费收入、钟点房、退款与冲销 | 无字段或文档证据 | `PENDING` |
| PMS实体房型、有效总房量、实际可售 | 主页房态候选返回三字段对象数组；字段名、含义和库存口径未验证 | `PENDING / STRUCTURE OBSERVED` |
| 来源更新时间、分页与增量水位 | 无字段或文档证据 | `PENDING` |

若该地址只覆盖房态或房型，还必须提供营业日、订单间夜和房费收入对应的厂商正式地址、报表或只读数据源证据。

## 6. 网络与Secret边界

| 检查项 | 非秘密结论 | 状态 |
|---|---|---|
| UAT网络拓扑证据 | 独立Chrome Profile、回环调试端点、授权人员现场认证；未导出凭据或原始HAR | `PARTIAL / CONTROLLED LOGIN EVIDENCE` |
| 稳定出口IP | `PENDING` | `PENDING` |
| 目标域名/IP允许清单 | 候选`pms.meituan.com:443` | `IN_REVIEW / NOT_ALLOWED` |
| TLS/mTLS要求 | 用户提供地址使用HTTPS；未执行TLS握手 | `PENDING` |
| SecretStore产品与UAT命名空间 | `PENDING` | `PENDING` |
| Secret引用命名规范 | `PENDING` | `PENDING` |
| 录入/轮换/吊销责任人 | `PENDING` | `PENDING` |
| 首次人工认证责任人 | 门店授权人员可现场输入 | `OWNER_CONFIRMED_2026-07-24 / IDENTITY_PENDING` |
| Cookie/网页登录会话 | 不得导出、粘贴、保存或程序化重放；如OpenAPI确实不能覆盖，须先取得厂商对具体会话自动化方式的书面许可 | `BLOCKED` |

## 7. 脱敏样例

| 样例ID | 受控位置 | SHA-256 | 隐私复核人 | 状态 |
|---|---|---|---|---|
| `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` |

不得提供原始HAR。脱敏样例不得包含住客姓名、手机号、证件号、Cookie、Token、验证码、请求头秘密或可复用会话信息。

## 8. 当前门禁结论

- I0：`PARTIAL / IN_REVIEW`；
- I1：`BLOCKED / VENDOR WRITTEN AUTHORIZATION OR OPENAPI ACTIVATION REQUIRED`；
- I2至I3：`BLOCKED BY I1`；
- I4真实适配器离线代码：`HOLD`；
- I5可信候选：`EMPTY / BLOCKED`；
- I6真实Secret与网络：`BLOCKED`；
- I7影子联调与企业微信：`BLOCKED`；
- 生产：`NO-GO`。

登录准备、已执行动作和继续阻断项见[受控登录验证清单](./CONTROLLED-LOGIN-RUNBOOK.md)。Cookie方案评估、正式接口优先级及获批后的隔离架构见[Cookie/浏览器会话自动采集设计草案](./COOKIE-SESSION-AUTOMATION-DESIGN-DRAFT.md)。当前仅完成一次受控登录与只读结构观察，不构成周期采集、Secret复用、连接器或生产授权。
