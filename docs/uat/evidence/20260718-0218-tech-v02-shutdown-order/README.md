# Live UAT停机顺序首次实跑证据

运行标识：`20260718-0218-tech-v02-shutdown-order`  
状态：`FAIL`  
用途：验证RC2后测试宿主关闭顺序修复，保留失败事实，不作为发布通过证据。

## 已验证事实

- Hikari连接池在Embedded PostgreSQL之前关闭。
- RC2中数据库停止后Worker继续访问数据库的11条错误未再次出现。
- 数据库证据成功导出，API、OIDC和临时Token均完成受控清理。

## 新发现问题

测试宿主在JUnit `@AfterAll`中手工关闭Spring ApplicationContext。虽然资源依赖顺序正确，但Spring Test自己的`afterTestClass`监听器随后访问已关闭上下文，产生`IllegalStateException`：

```text
Tests run: 2, Failures: 0, Errors: 1, Skipped: 0
BUILD FAILURE
```

因此本次实跑结论必须为`FAIL`。修复方向是让`@DirtiesContext`先按Spring Test生命周期关闭上下文，再由低于其order的自定义测试监听器释放Embedded PostgreSQL，而不是在JUnit回调中手工关闭上下文。

## 证据

- [机器可读汇总](summary.json)
- [运行日志](runtime/)
- [Surefire结果](regression/)
- [数据库导出](database/)

## 边界

- 本次未运行六角色和三条业务闭环，不替换RC2权威业务证据。
- 本次不关闭任何REL-P0，不改变TECH-V0.2的Unreleased状态。
- 后续修复必须重新实跑Live UAT宿主；单元级关闭顺序测试不能单独作为通过依据。
