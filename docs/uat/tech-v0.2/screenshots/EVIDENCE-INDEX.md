# TECH-V0.2 UAT截图证据索引

当前业务UAT状态：BLOCKED / NO-GO。

本目录暂不包含正式UAT截图。原因如下：

- 当前没有可运行的真实PostgreSQL UAT环境和业务Fixture。
- 真实企业SSO未联调。
- 本轮指定的客房主管未出现在前端验收账号入口。
- 图片上传、客诉规则事实和未提交检测链路存在P1阻断。

正式UAT截图必须同时满足：

1. 使用真实React页面、真实API和真实PostgreSQL。
2. 禁用`VITE_ENABLE_DEMO_FALLBACK`且不得使用`?demo=1`。
3. 截图可识别当前角色、精确任职、组织、业务状态和操作结果。
4. 记录对应实体ID及Correlation ID。
5. 不出现Token、Cookie、密码等敏感信息。

禁止以旧原型、离线演示数据或API失败后的演示回退替代正式验收截图。

