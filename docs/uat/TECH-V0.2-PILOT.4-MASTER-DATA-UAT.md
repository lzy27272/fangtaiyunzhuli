# TECH-V0.2-PILOT.4 主数据维护UAT报告

日期：2026-07-19  
目标：https://www.sfgzt.cn  
数据库：真实PostgreSQL 14.22 / Flyway V14  
结论：PASS

## 验收范围

- 组织：新建、编辑、停用、受控删除。
- 岗位：新建、编辑、停用、受控删除。
- 人员：新建、编辑、停用、受控删除。
- 权限：CEO具有维护入口；普通前台无维护权限且后端写接口返回403。
- 历史保护：已有任职、权限或业务历史的数据只能停用，不能物理删除。

## 自动化结果

| 检查 | 结果 |
|---|---|
| 主数据生命周期后端集成测试 | 3/3 PASS |
| 后端完整回归 | 51项；失败0；错误0；跳过2 |
| Pilot前端生产构建 | PASS |
| 公网真实页面业务步骤 | 8/8 PASS |
| 浏览器控制台错误 | 0 |
| 页面错误 | 0 |
| 非预期请求失败 | 0 |
| 服务端5xx | 0 |
| 临时UAT数据清理 | 完成 |

## 生命周期边界

- 停用组织会停用其下级组织、当前任职和直接组织范围授权。
- 停用岗位会结束该岗位当前有效任职。
- 停用人员会停用登录账号、结束任职并终止有效角色授权。
- 重新启用不会自动恢复旧任职或旧角色，必须由管理员重新授权。
- 硬删除仅用于已停用且无任何业务引用的临时/错误主数据。

## 证据

- [浏览器UAT摘要](./evidence/pilot4-master-data/pilot4-master-data-uat.md)
- [浏览器UAT结构化记录](./evidence/pilot4-master-data/pilot4-master-data-uat.json)
- [组织编辑截图](./evidence/pilot4-master-data/pilot4-organization-edit.png)
- [组织停用截图](./evidence/pilot4-master-data/pilot4-organization-inactive.png)
- [岗位编辑截图](./evidence/pilot4-master-data/pilot4-position-edit.png)
- [人员编辑截图](./evidence/pilot4-master-data/pilot4-employee-edit.png)
- [人员停用截图](./evidence/pilot4-master-data/pilot4-employee-inactive.png)

本报告只确认内部Pilot主数据维护能力，不改变TECH-V0.2正式版仍为Unreleased / Release NO-GO的治理结论。
