# UAT fixture

此目录不属于Flyway迁移路径。文件只能由`tools/uat`或人工`psql -f`显式执行，禁止移动到`database/migrations`。

## 数据集

`001_sprint2_1_uat_fixture.sql`要求数据库已成功迁移到V12，随后补充：

- 六个真实`user_account`、员工、任职和数据库RBAC上下文检查。
- 华东、华南两个区域；杭州、上海、深圳三家门店。
- 一个额外隔离对照租户。
- OTA巡检和前台客诉两个结构化标准。
- OTA巡检和前台客诉两个发布工作包。
- 三个可执行工作期望。
- OTA评分风险建任务、工作记录提交提醒两条确定性规则。
- 一个待消费OTA风险事件及六角色未读通知。

账号表没有密码字段。本地UAT通过开发身份边界提交tenant/actor，服务端从数据库解析角色、权限、任职和组织范围。

## 可重复性

fixture使用固定UUID和冲突保护，不会重复创建同一批数据；但UAT会改变任务、评价、通知和工作期望状态。需要完全一致的初始状态时，应使用：

```powershell
.\tools\uat\Start-UatEnvironment.ps1 -ResetDatabase -Force
```

不要对共享开发库或生产库执行此fixture。

`002_verify_sprint2_1_uat_fixture.sql`只读校验区域、门店、账号、标准、工作包、规则、期望和隔离对照租户。

