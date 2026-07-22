# Pilot 数据维护

`cleanup_pilot_uat_artifacts.sql` 只用于清理由旧 UAT/UI 自动化脚本写入共享 Pilot PostgreSQL 的测试数据，不属于 Flyway 迁移。维护入口优先使用`psql.exe`；精简服务端未安装客户端时，自动使用仓库内受限JDBC执行器，事务和保护条件保持一致。

先执行默认 dry-run（只建立候选集、校验保护对象并回滚）：

```powershell
.\tools\pilot\Invoke-PilotUatDataCleanup.ps1
```

执行前必须先用 `PostgresLogicalBackup.java` 生成完整逻辑备份。确认 dry-run 清单后，才允许执行：

```powershell
.\tools\pilot\Invoke-PilotUatDataCleanup.ps1 `
  -Mode Execute `
  -BackupDirectory 'D:\SifangguanHotelAIOS\Backups\<timestamp>' `
  -Confirmation DELETE-PILOT-UAT-ONLY
```

执行模式采用 `SERIALIZABLE` 单事务、事务级 advisory lock、15 秒锁等待上限和执行后零残留校验；任一删除或保护条件失败都会回滚。脚本明确保护：8 个正式角色、7 个核心岗位、V3 演示组织、`四方馆归来`、`ceo.demo`、`sfgrff`、`sfglzy` 和工作包 `123`。

附件数据库行会清理，但物理附件文件不会由本工具直接删除，以免发生不可恢复的文件误删；如需清理存储，应先根据备份与对象键单独隔离到回收目录。
