# 脱敏金标准样例清单

> 本文件只登记脱敏样例和人工期望结果。不得包含原始住客信息、账号秘密或可复用登录态。

## 1. 数据集身份

| 字段 | 值 |
|---|---|
| 数据集ID | `PENDING` |
| 门店 | `PENDING` |
| 来源 | `PMS / CTRIP / MEITUAN` |
| 厂商/产品/版本 | `PENDING` |
| PMS营业日范围 | `PENDING` |
| 采集观察起止时间 | `PENDING` |
| 时区 | `Asia/Shanghai` |
| 脱敏执行人 | `PENDING` |
| 隐私复核人 | `PENDING` |
| 门店业务复核人 | `PENDING` |
| 当前状态 | `PENDING` |

## 2. 样例文件

| 样例文件ID | 受控位置 | SHA-256 | Schema/格式 | 是否脱敏 | 状态 |
|---|---|---|---|---|---|
| `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` |

受控位置只写证据系统引用或相对路径，不写带秘密参数的下载地址。

## 3. 必须覆盖的业务场景

| 场景 | 样例/记录引用 | 人工期望 | 状态 |
|---|---|---|---|
| PMS夜审后营业日实际切换 | `PENDING` | `PENDING` | `PENDING` |
| 跨夜审但营业日尚未切换 | `PENDING` | `PENDING` | `PENDING` |
| 新增当日到店间夜 | `PENDING` | `PENDING` | `PENDING` |
| 新增远期到店间夜 | `PENDING` | `PENDING` | `PENDING` |
| 改期 | `PENDING` | `PENDING` | `PENDING` |
| 缩住 | `PENDING` | `PENDING` | `PENDING` |
| 减房 | `PENDING` | `PENDING` | `PENDING` |
| 取消及负向间夜 | `PENDING` | `PENDING` | `PENDING` |
| 房费退款/冲销 | `PENDING` | `PENDING` | `PENDING` |
| 钟点房房费 | `PENDING` | 进入总营业额，不进入过夜房指标 | `PENDING` |
| 非房费收入 | `PENDING` | 不进入总营业额 | `PENDING` |
| 多间多晚订单 | `PENDING` | 按实际间夜拆分 | `PENDING` |
| 多个OTA售卖产品共享实体房型 | `PENDING` | 逐产品比较，产品库存不相加 | `PENDING` |
| OTA可售高于PMS | `PENDING` | P1超卖风险 | `PENDING` |
| OTA可售低于PMS | `PENDING` | P1房态不匹配风险 | `PENDING` |
| 来源不可用或陈旧 | `PENDING` | 显示无法判断，不以0或旧值代替 | `PENDING` |

## 4. 人工期望结果

### 4.1 营业日经营

| 指标 | 人工期望值 | 精度/单位 | 证据引用 | 状态 |
|---|---|---|---|---|
| PMS营业日 | `PENDING` | 日期 | `PENDING` | `PENDING` |
| 房费总营业额 | `PENDING` | CNY，精确到分 | `PENDING` | `PENDING` |
| 钟点房房费 | `PENDING` | CNY，精确到分 | `PENDING` | `PENDING` |
| 今日已售 | `PENDING` | 间夜 | `PENDING` | `PENDING` |
| 有效可售总房量 | `PENDING` | 间 | `PENDING` | `PENDING` |
| 当前可售 | `PENDING` | 间 | `PENDING` | `PENDING` |

### 4.2 整点窗口

| 截止窗口 | 新增当日间夜 | 新增远期间夜 | 取消/减少当日间夜 | 取消/减少远期间夜 | 净间夜 | 房费变化 | 状态 |
|---|---:|---:|---:|---:|---:|---:|---|
| `HH:00→HH:00` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` |

### 4.3 逐产品库存

| PMS实体房型 | PMS可售 | OTA来源 | OTA产品 | OTA产品可售 | 期望判断 | 状态 |
|---|---:|---|---|---:|---|---|
| `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` |

## 5. 签字

- 数据脱敏复核：`PENDING`
- 门店业务复核：`PENDING`
- 适配器工程复核：`PENDING`
- 差异说明及处置：`PENDING`
- 最终状态：`PENDING`
