# TECH-V0.2 RC3 本地发布加固证据

运行标识：`20260718-1315-tech-v02-rc3-local-hardening`  
状态：`PASS（本地技术范围）`  
候选版本：`TECH-V0.2-rc.3-local`

## 已关闭问题

- 移除主数据源与Flyway密码的JAR内置回退值，改为必填外部变量。
- UAT Docker启动路径在启动数据库前校验所有必需数据库变量非空。
- 新增发布配置回归测试，防止密码回退值重新进入主配置。

## 验证结果

- 定向安全配置测试：1/1 PASS。
- 后端完整回归：48项测试，0失败，0错误，2项按设计跳过；13个迁移全部成功。
- 双构建可复现性：5/5制品一致，载荷指纹 `546fc5175d97af2e0bbe3736468b1366d8890e89a6c6a6d761db4d40eba089ee`。
- 深度敏感信息扫描：160个文件、120个归档、43,830个归档条目；0命中、0错误，`PASS / CLEAN`。
- 扫描输入集指纹：`e5b3f36e2ed5ddad69dce7adfe16a3bbbf3457c1fd5c8baa1da605b0fe5a95f3`。

## 证据目录

- `regression/`：20份Surefire XML和20份文本报告，共48项测试。
- `artifacts/`：两次独立构建的manifest；两者载荷指纹一致。
- `security/release-sensitive-information-scan.json`：机器可读深度扫描报告。
- `security/required-secret-fail-fast.json`：无密钥JAR启动失败关闭证据。
- `summary.json`：本地加固机器可读汇总。

## 边界

这是未绑定Git提交的本地RC3候选证据。它关闭发布包默认密码问题，但不构成TECH-V0.2正式Released，也不替代剩余外部门禁。
