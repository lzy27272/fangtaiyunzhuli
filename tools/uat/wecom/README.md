# OTA JSON → 企业微信群机器人 UAT 桥

这是一次性、人工触发、默认不联网的 UAT 工具，用于验证：

```text
本地 PMS JSON → 严格结构校验 → 脱敏汇总 → 企业微信群机器人
```

它不是周期采集器、生产投递 Worker 或 PMS 登录器，不读取 Cookie，也不解除
OTA Connector Worker 的真实连接器和生产发送门禁。

## 保护措施与信任边界

本工具信任当前 Windows 账户以及该账户可写的项目目录。同一账户下能够修改源码、
设置环境变量或直接执行 Node 的人员，也能够绕过这些本机门禁；因此它们用于防止误操作，
不是针对恶意本机管理员的安全沙箱。真实 UAT 的受支持入口是 PowerShell 包装器；生产环境
必须改用受限服务账户、SecretStore 和不可由普通运营人员改写的部署制品。

- 默认是 `DRY_RUN`，不会发起任何网络请求。
- JSON 只能从仓库忽略 Git 的 `.uat-runtime/wecom/inbox/` 读取；UNC、设备路径、
  目录穿越、符号链接和指向目录外的重解析路径均被拒绝。
- 真实发送必须同时提供 `--send` 和
  `OTA_WECOM_UAT_SEND_ENABLED=true`。
- 真实发送的受支持入口是 PowerShell 包装器；包装器为子 Node 进程生成并清除一次性
  handoff nonce，用于阻止无意中直接执行 Node CLI。nonce 不是本机用户身份凭据，
  不能抵御同权限人员主动构造参数或修改源码。
- Webhook 每次都通过本机不回显输入框重新输入，不会静默复用已有环境变量。
- 发送前必须匹配管理员预先确认的 endpoint SHA-256 和门店名称，防止投错群或串店。
- PowerShell 包装器只会启动当前 Codex 运行时中具有有效 OpenJS Foundation
  签名的固定本地 Node 可执行文件，不从 `PATH` 或参数接收任意程序；启动前会
  清理 Node loader、TLS、CA 和代理相关环境变量，拒绝远程盘及重解析路径。
- 只允许官方
  `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...`，禁止重定向和额外参数。
- 每次最多发送一次，不自动重试。网络结果不明确时返回 `AMBIGUOUS`，避免重复推送。
- `(endpoint SHA-256, message SHA-256)` 会在
  `.uat-runtime/wecom/delivery-claims/` 原子占位；相同消息并发或重复执行会被拒绝。
- `mentioned_list` 固定为空，不触发群内 `@所有人`。
- 群消息不显示 `【UAT测试｜非经营指令】` 和“隐私处理”装饰文案。
- 不发送姓名、订单号、电话、备注、操作员、内部 URL、机构 ID 或原始 JSON。
- `roomPrice` 不作为营业额；`roomCount` 未经接口口径确认前不标记为间夜。
- 输入限制为 1 MiB、5000 行，并拒绝符号链接、未知字段和嵌套值。

用户提供的 `jd01` 示例在根对象结束前以逗号截断。工具只允许这一种精确恢复：
在内存中删除末尾逗号并补一个根对象 `}`，同时在消息中标明恢复状态；不会改写原文件。
所有真实发送都要求 `OTA_WECOM_UAT_APPROVED_INPUT_SHA256` 精确匹配 dry-run
输出的原始输入哈希，防止预览后文件被替换。恢复后的数据还必须显式提供恢复开关。

## 1. 本地预览

先把待验证文件放入固定收件箱：

```text
.uat-runtime/wecom/inbox/
```

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\tools\uat\wecom\Invoke-OtaJsonWeComUat.ps1 `
  -InputPath '.\.uat-runtime\wecom\inbox\pms-response.json' `
  -HotelName '喷水池态六酒店'
```

输出只包含脱敏消息预览、原始输入 SHA-256、正文 SHA-256、记录数、房量字段合计
及是否执行截断恢复。

## 2. 单次真实 UAT 推送

不要把 Webhook 粘贴到聊天、脚本、截图或 Git。先在本机通过不回显输入框计算
endpoint 指纹；此步骤不联网：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\tools\uat\wecom\Invoke-OtaJsonWeComUat.ps1 `
  -FingerprintWebhook
```

管理员核对并批准该指纹和目标门店后，在当前 PowerShell 进程设置非秘密绑定值。
`input-sha256` 对完整或截断文件都必须填写；截断文件还必须经过人工复核：

```powershell
$env:OTA_WECOM_UAT_SEND_ENABLED = 'true'
$env:WECOM_GROUP_ROBOT_ENDPOINT_SHA256 = '已批准的64位endpoint-sha256'
$env:WECOM_UAT_EXPECTED_HOTEL_NAME = '喷水池态六酒店'
$env:OTA_WECOM_UAT_APPROVED_INPUT_SHA256 = 'dry-run输出的64位input-sha256'

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\tools\uat\wecom\Invoke-OtaJsonWeComUat.ps1 `
  -InputPath '.\.uat-runtime\wecom\inbox\pms-response.json' `
  -HotelName '喷水池态六酒店' `
  -Send `
  -AllowTruncatedRootRecovery

Remove-Item Env:OTA_WECOM_UAT_SEND_ENABLED -ErrorAction SilentlyContinue
Remove-Item Env:WECOM_GROUP_ROBOT_ENDPOINT_SHA256 -ErrorAction SilentlyContinue
Remove-Item Env:WECOM_UAT_EXPECTED_HOTEL_NAME -ErrorAction SilentlyContinue
Remove-Item Env:OTA_WECOM_UAT_APPROVED_INPUT_SHA256 -ErrorAction SilentlyContinue
```

只有 HTTP 成功且响应 JSON 的 `errcode=0` 才返回 `DELIVERED`。输出不会包含
Webhook 或企业微信的原始错误正文。408、429、5xx、超时、断网和响应无法读取
均返回 `AMBIGUOUS`，不会自动重发。

## 3. 测试

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" `
  --test .\tools\uat\wecom\tests\*.test.mjs
```

测试全部使用注入的假 HTTP 客户端，不访问企业微信。

## 后续生产化

正式每小时自动投递应新增独立 `ota-delivery-worker`，消费 PostgreSQL Outbox，
通过 `SecretStorePort` 按租户和门店解析 Webhook 引用，并实现已确认的重试、
补发、幂等、`AMBIGUOUS` 审计和 P1 升级规则。生产流程不应使用 JSON 文件作为输入。
