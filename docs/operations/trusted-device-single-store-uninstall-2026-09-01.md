# 可信设备单店本机卸载完成报告（2026-09-01）

## 结论

已实现多门店通用、显式门店绑定的 Windows PowerShell 本机卸载流程。
入口保留现行兼容命名 `Uninstall-001TrustedDevice.ps1`，但没有默认门店，
任何预览或卸载都必须显式传入 `--hotel <门店号>`。

本次仅完成代码、安装包接线、文档和本地静态/聚焦验证；未在任何
门店电脑执行真实卸载，未读取设备私钥、Cookie、浏览器 profile、快照或
状态文件内容，也未发布或修改云端设备登记。

## 实现范围

- 新增 `tools/trusted-device/Uninstall-001TrustedDevice.ps1`。
- 卸载目标只由通过严格校验的 `--hotel` 门店号派生：
  - 根任务路径 `\` 下精确的
    `Sifangguan-<code>-Trusted-Collector`；
  - 精确的 `HKCU:\Software\Classes\sfgtrusted<protocol-code>`；
  - `001` 的 `%LOCALAPPDATA%\Sifangguan\TrustedDevice001`，或其他门店的
    `%LOCALAPPDATA%\Sifangguan\TrustedDevice-<code>`。
- 安装器会将卸载脚本复制到该店本机 `app` 目录；bootstrap 会将其
  作为带 UTF-8 BOM 的 PowerShell 文件打包；服务端发布清单也已包含该文件。
- `tools/trusted-device/README.md` 已增加 `001`、非 `001`、`--dry-run`、
  不可恢复的本机数据清理以及自定义安装目录的人工边界说明。
- 同时修复安装器的 `InstallRoot` 目录边界：只接受等于
  `LOCALAPPDATA` 或以 `LOCALAPPDATA + 目录分隔符` 开头的规范化路径，
  `LOCALAPPDATA-Evil` 类同前缀兄弟目录已在任何目录创建前被拒绝。

## 安全不变量

1. 不接受隐式、缺失、重复或格式非法的门店号。
2. 不按前缀或通配符枚举任务、注册表协议或门店目录。
3. 删除协议前，先校验协议标题和 `-HotelCode` 命令参数属于目标门店。
   归属不明时在任何修改前失败，同时覆盖 `A_B` / `A-B` 协议归一化冲突。
4. 任务按“停用→停止→精确注销”顺序处理；停止失败则不继续删除。
5. 目录删除前再次做完整路径边界检查，遇到 reparse point 只删链接本身，
   不跟随到目标目录。
6. 先删除该店 Chrome profile，最后删除 `app`。profile 仍被占用时会保留
   卸载脚本供关闭窗口后重试。
7. 不扫描或杀死 Node.js/Chrome 进程，不删除 Node.js，不读取状态文件内容，
   不调用云端 API。
8. 对不存在的精确任务、协议或目录按幂等方式返回；不会转而处理相似名称。

## 验证记录

聚焦测试命令：

```powershell
node --test tests/trusted-device-bootstrap.test.mjs tests/trusted-device-uninstall.test.mjs tests/trusted-device-ui.test.mjs
```

结果：`12/12 PASS`。覆盖项包括：

- bootstrap 内卸载脚本存在且有 Windows PowerShell 5.1 所需 BOM；
- `001` 和 `003` 的 dry-run 精确目标映射，dry-run 明确报告不修改运行时；
- 缺失、非法、重复和未使用 `--hotel` 的门店参数全部失败；
- 协议归属预检、精确根任务路径、状态根边界、reparse point 防跟随；
- 安装文件清单、服务端发布清单和 README 可发现性。
- 安装器 `InstallRoot` 的分隔符边界，以及 Windows PowerShell 下对
  `LOCALAPPDATA-<suffix>` 同前缀兄弟路径的真实拒绝。
- 独立临时目录中的真实删除验证：目标 `003` 目录被删除，重复删除幂等，
  兄弟 `001` 目录保留，junction 只删链接而不删外部 sentinel。

`git diff --check` 通过，仅有现有 Windows 行尾转换提示。

## 尚未跨过的门禁

- 未在真实门店执行非 dry-run 命令；计划任务、注册表和本机状态未被更改。
- 未发布、未上传、未切换生产。
- 卸载仅处理本机信任材料；云端登记仍保留为历史记录。因本机私钥被删除，
  该本机无法继续以旧设备身份签名；如需云端撤销，必须由独立、明确授权的流程处理。
- 非默认 `-InstallRoot` 无法在不读取可信归属数据的前提下自动判定，
  因此本脚本不自动删除标准门店目录之外的应用目录。
