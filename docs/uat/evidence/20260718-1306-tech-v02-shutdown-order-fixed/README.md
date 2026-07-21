# Live UAT 停机顺序修复复验证据

运行标识：`20260718-1306-tech-v02-shutdown-order-fixed`  
状态：`PASS`  
范围：修订后的 Spring Test 生命周期监听器与嵌入式 PostgreSQL 停机顺序。

## 验证结果

- Live UAT API 在 `127.0.0.1:51630` 启动，并通过签名 JWT 健康验证。
- Spring ApplicationContext 触发 Hikari 关闭；Hikari 于 `13:11:27.817 +08:00` 完成关闭。
- 嵌入式 PostgreSQL 于 `13:11:27.968 +08:00` 停止，晚于连接池关闭约 151 ms。
- `Sprint21LiveUatServerTest`：1项测试、0失败、0错误、0跳过，`BUILD SUCCESS`。
- 日志中不存在 `IllegalStateException`、`ApplicationContext is not active` 或停库后的 Worker 数据库访问错误。
- Maven/API 与临时 OIDC 进程均已退出；临时 Bearer Token、ready/stop 标记均已清理。
- 停机前导出了12份数据库状态证据。

## 证据目录

- `runtime/`：API/OIDC日志与受控进程状态。
- `regression/`：Live宿主Surefire XML和文本结果。
- `database/`：停机前数据库状态导出。
- `summary.json`：机器可读结论。

## 边界

本证据关闭的是“Live UAT宿主停机顺序”本地技术问题，不替代六角色RC2业务证据，也不关闭目标SSO、真人签署、现场照片/目标存储、Git标签或目标生产运维门禁。
