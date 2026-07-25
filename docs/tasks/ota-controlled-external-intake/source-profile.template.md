# 单一来源接入资料

> 只填写非秘密元数据。不得填写密码、Cookie、Token、Webhook、验证码、私钥、数据库密码或住客个人信息。

## 1. 范围

| 字段 | 值 |
|---|---|
| 资料包ID | `PENDING` |
| 门店名称 | `PENDING` |
| 后台门店编码 | `PENDING` |
| 时区 | `Asia/Shanghai` |
| 来源 | `PMS / CTRIP / MEITUAN` |
| 厂商 | `PENDING` |
| 产品 | `PENDING` |
| 准确版本/Build | `PENDING` |
| 部署位置 | `CLOUD / ON_PREMISE / PRIVATE_CLOUD / NOT_APPLICABLE` |
| 正式接入方式 | `OFFICIAL_API / READ_ONLY_DATABASE / AUTOMATED_REPORT / LOCAL_AGENT / PENDING_REVIEW` |
| 外部门店ID或非秘密别名 | `PENDING` |
| 测试账号别名 | `PENDING` |
| 资料责任人 | `PENDING` |
| 门店复核人 | `PENDING` |
| 当前状态 | `PENDING` |

## 2. 合法性与厂商合同

| 检查项 | 证据引用或结论 | 状态 |
|---|---|---|
| 厂商正式接口/报表/数据库文档 | `PENDING` | `PENDING` |
| 自动化或只读访问许可 | `PENDING` | `PENDING` |
| 允许频率与限流 | `PENDING` | `PENDING` |
| 历史查询范围 | `PENDING` | `PENDING` |
| 分页完整性规则 | `PENDING` | `PENDING` |
| 增量水位或来源更新时间规则 | `PENDING` | `PENDING` |
| 错误码与重试限制 | `PENDING` | `PENDING` |
| Schema/页面变化通知机制 | `PENDING` | `PENDING` |

## 3. PMS业务语义

不适用于OTA来源的项目标记为`NOT_APPLICABLE`，不得删除。

| 检查项 | 来源语义或证据引用 | 状态 |
|---|---|---|
| PMS营业日字段和值格式 | `PENDING` | `PENDING` |
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

## 4. OTA业务语义

不适用于PMS来源的项目标记为`NOT_APPLICABLE`，不得删除。

| 检查项 | 来源语义或证据引用 | 状态 |
|---|---|---|
| 稳定产品ID与售卖名称 | `PENDING` | `PENDING` |
| 产品级可售与开关房 | `PENDING` | `PENDING` |
| 稳定订单/间夜标识 | `PENDING` | `PENDING` |
| 改期、缩住、减房、取消语义 | `PENDING` | `PENDING` |
| 多间多晚拆分规则 | `PENDING` | `PENDING` |
| 来源更新时间 | `PENDING` | `PENDING` |
| 首次人工认证协作流程 | `PENDING` | `PENDING` |

## 5. 网络与Secret边界

| 检查项 | 非秘密结论 | 状态 |
|---|---|---|
| UAT网络拓扑证据 | `PENDING` | `PENDING` |
| 稳定出口IP | `PENDING` | `PENDING` |
| 目标域名/IP允许清单 | `PENDING` | `PENDING` |
| TLS/mTLS要求 | `PENDING` | `PENDING` |
| SecretStore产品与UAT命名空间 | `PENDING` | `PENDING` |
| Secret引用命名规范 | `PENDING` | `PENDING` |
| 录入/轮换/吊销责任人 | `PENDING` | `PENDING` |
| 首次人工认证责任人 | `PENDING` | `PENDING` |

## 6. 脱敏样例

| 样例ID | 受控位置 | SHA-256 | 隐私复核人 | 状态 |
|---|---|---|---|---|
| `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` |

确认：

- [ ] 样例不含住客个人信息；
- [ ] 样例不含任何凭据或可复用登录态；
- [ ] SHA-256从实际审查文件计算；
- [ ] 原始未脱敏数据未进入Git仓库。
