# OTA受控外部接入资料模板

本目录服务于`OTA-AUTOMATION-V0.1`首个真实适配器的非秘密资料收集。每家门店、每个来源分别复制一套，不要直接在模板原件上混填多个来源。

## 当前接入实例

- [喷水池态六酒店｜美团别样红系统｜PMS](./intakes/pilot-01-bieyanghong-pms/README.md)：`FIRST ADAPTER SELECTED / I0 PARTIAL / ENDPOINT METADATA RECORDED / NOT CONTACTED`。

## 使用顺序

1. 先复制并填写`source-profile.template.md`，锁定一个“门店＋来源＋厂商产品版本＋接入方式”。
2. 填写`field-capability-matrix.template.csv`，为每个冻结业务字段找到来源字段、稳定键、水位和时间语义。
3. 涉及携程或美团时，填写`physical-room-product-mapping.template.csv`；每个售卖产品占一行。
4. 使用`golden-sample-manifest.template.md`登记脱敏样例、SHA-256、人工期望值和边界场景。
5. 适配器离线实现完成后，使用`artifact-admission-checklist.template.md`审查制品；通过前不得登记可信候选。

## 数据红线

以下内容不得写入这些模板、聊天、工单、Git提交、日志或测试fixture：

- 密码、Cookie、Token、Webhook、验证码、私钥、数据库连接密码；
- 住客姓名、手机号、证件号、银行卡、地址或其他可识别个人信息；
- 未脱敏的PMS/OTA原始导出；
- 带有URI user-info或查询参数秘密的连接地址。

模板只记录账号别名、SecretStore不透明引用规范、资料位置、文件SHA-256和非秘密网络边界。真实秘密由授权人员直接录入外部SecretStore。

## 状态值

统一使用：

- `PENDING`：尚未提供；
- `IN_REVIEW`：已提供，正在复核；
- `READY`：证据完整且已复核；
- `NOT_APPLICABLE`：对该来源不适用，并写明理由；
- `BLOCKED`：存在明确阻断项。

资料齐备只允许申请单一适配器离线开发，不会自动解锁联网、Secret解析、`test/activate/run`、企业微信发送、UAT或生产发布。
