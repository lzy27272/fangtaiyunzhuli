# TECH-V0.2 RC2后本地加固证据

运行标识：`20260718-0215-tech-v02-local-hardening`  
状态：`UNIT/REGRESSION PASS；LIVE验证失败，尚未关闭`  
用途：记录RC2审计发现的Live UAT测试宿主资源关闭顺序首轮加固及其验证边界。

## 修改内容

- Live UAT宿主按`Spring应用上下文/调度器/Hikari → Embedded PostgreSQL → 临时标记文件`顺序同步关闭。
- 任一资源关闭失败时仍继续释放后续资源；首个异常保留，其余异常作为suppressed信息附加。
- 静态初始化失败时立即关闭已经启动的Embedded PostgreSQL，避免测试基础设施泄漏。
- 新增两项定向生命周期测试，验证关闭顺序和异常释放行为。

## 验证结果

| 项目 | 结果 |
|---|---:|
| 测试套件 | 18 |
| 测试总数 | 43 |
| 失败 | 0 |
| 错误 | 0 |
| 跳过 | 2 |
| 生命周期定向测试 | 2/2 PASS |

18份Surefire XML和18份文本报告位于[regression](regression/)目录；机器可读汇总见[summary.json](summary.json)。完整回归在允许本机嵌入式PostgreSQL进程和回环端口的执行环境中完成，构建结果为`BUILD SUCCESS`。

## 边界

- 本次是RC2之后的测试基础设施加固，不替换`20260718-0154-tech-v02-rc2`业务/API/数据库证据。
- 后续专用Live UAT实跑确认Hikari已先于数据库关闭，但暴露Spring Test监听器在手工关闭上下文后的`IllegalStateException`；失败证据见`../20260718-0218-tech-v02-shutdown-order/README.md`。因此本条不能单独证明技术债已关闭。
- 本次不改变数据库迁移、API、生产代码、正式发布状态或REL-P0门禁结论。
