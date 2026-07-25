# OTA Standalone Web

独立OTA后台。它不依赖现有AI中台Web模块，提供接入配置、实时经营监控、房型/目标/节奏配置、简报与告警历史四个最小页面；Sprint 2B在接入配置页增加真实接入资料准备面板，但不包含PMS、OTA或企业微信真实连接与运行。

## 安全边界

- Access Token仅保存在页面内存，不写入`localStorage`或`sessionStorage`。
- Refresh Token只允许由API通过`HttpOnly + Secure + SameSite` Cookie签发。
- 页面不接受角色、租户或门店范围自报；最终权限由API可信会话计算。
- 没有默认账号或密码；首个管理员必须通过受控离线引导创建。
- 门店上下文只保存在页面内存，不写入浏览器存储。
- 模拟运行固定提交`deliveryMode=BLOCKED`；页面不接收Webhook、Cookie、Token、任意URL或脚本。
- 所有业务写请求使用Bearer Access Token、`Idempotency-Key`和关联ID；401时只允许一次受控Refresh后重试。

## Sprint 1页面

1. PMS与OTA接入配置：只列服务端登记的模拟适配器和非密钥参数。
2. 实时经营监控：来源新鲜度、确定性指标和实体库存池逐产品对账。
3. 房型、目标与节奏：试点只支持`FULL_SYNC`，共享库存产品不相加。
4. 简报与告警历史：查看不可变简报、P1/任务和企业微信Outbox禁发预览。

Sprint 2B的真实接入准备面板只能登记厂商、版本、接入方式、外部门店编码、账号别名、路由编码、轮询间隔和不透明SecretStore引用。Secret输入使用密码框，保存后清空且不回显引用或指纹；页面固定显示`RUNTIME BLOCKED`，没有测试、激活或运行入口。

## 本地命令

```powershell
pnpm install --offline --store-dir ..\..\.pnpm-store
pnpm test
pnpm build
```

默认开发端口为`5180`，API代理目标为`http://localhost:8091`。可通过环境配置覆盖，密钥不得写入`.env`文件。
