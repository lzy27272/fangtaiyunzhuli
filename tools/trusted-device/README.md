# 别样红门店可信设备采集器

此采集器适用于后台中登记为 `MEITUAN_BIEYANGHONG` 的门店。每家门店使用
独立安装码、设备密钥、Chrome 用户目录、计划任务和本机协议；不同门店不会
共用或覆盖登录会话。美团账号、密码、短信验证码、Cookie、Chrome 用户目录
和设备私钥只保存在对应门店 Windows 用户目录中；云端只接收经过 Ed25519
签名、锁定到该门店且通过字段校验的业务快照。

## 安装

1. 在项目后台进入目标门店的“可信设备采集”卡片，点击“下载安装并进入登录”。
2. 打开浏览器下载的 `Sifangguan-门店编号-Setup.cmd`。Windows 不允许网页静默
   执行安装程序，因此首次需要人工打开这一个文件；脚本会自动安装采集器、
   注册本机登录入口并打开美团官方页面。
3. 只在打开的美团官方页面完成人工登录。以后 Cookie 失效时，在后台点击
   “直接进入美团登录”即可，不会重复下载安装。登录使用普通 Chrome 专用
   配置，不带自动测试启动标记；登录后保留窗口运行（可以最小化），采集任务
   只通过本机回环端口连接这一已登录会话。

如需离线安装，也可在后台仅生成 15 分钟安装码，然后运行：

```powershell
.\Install-001TrustedDevice.ps1 -HotelCode '003' -EnrollmentCode '003-XXXX-XXXX-XXXX'
```

安装脚本在缺少 Node.js 时会调用 Windows 软件源安装 Node.js LTS；没有
`winget` 的旧版 Windows 需先人工安装 Node.js LTS。

安装脚本每 5 分钟检查一次动态采集时间表，但只在应采集的时段执行一次。
门店电脑须在计划采集时间保持开机联网；Cookie 失效时重新打开登录入口即可，
不需要重新注册设备。

## 单店本机停用和卸载

回滚某一家门店时，必须显式传入该门店号；卸载脚本没有默认门店。
先用不修改本机的预览模式核对精确目标：

```powershell
& "$env:LOCALAPPDATA\Sifangguan\TrustedDevice-003\app\tools\trusted-device\Uninstall-001TrustedDevice.ps1" --hotel 003 --dry-run
```

确认任务名、协议名和目录均是 `003` 后，关闭该门店的美团专用 Chrome
窗口，再执行：

```powershell
& "$env:LOCALAPPDATA\Sifangguan\TrustedDevice-003\app\tools\trusted-device\Uninstall-001TrustedDevice.ps1" --hotel 003
```

`001` 保留历史目录名，命令为：

```powershell
& "$env:LOCALAPPDATA\Sifangguan\TrustedDevice001\app\tools\trusted-device\Uninstall-001TrustedDevice.ps1" --hotel 001
```

脚本只停用并注销根路径下精确名为
`Sifangguan-门店号-Trusted-Collector` 的任务，删除精确的
`sfgtrusted门店号` 协议，以及该门店自己的 `app`、`chrome-profile`
和状态目录。删除协议前会校验其注册命令确实属于目标门店；归属不明时
直接拒绝，不继续删除。脚本不按前缀扫描，不终止其他 Node.js/Chrome
进程，不删除 Node.js，不修改其他门店或云端设备登记。

卸载会删除该店本机设备私钥、本地快照和专用 Chrome 会话，不可本机
恢复。如专用 Chrome 仍在使用对应 profile，目录删除将失败；关闭该窗口后
重试同一条命令。任务和协议已不存在时会按幂等方式继续清理目录。
若安装时人工指定了非默认 `-InstallRoot`，为避免误删无法自动归属的目录，
本脚本只清理上述标准门店目录；自定义应用目录需在人工核对后单独处理。

## 安全边界

- 安装码 15 分钟、单次使用；重新注册只会撤销同一家门店的旧设备。
- 云端按门店分别保存设备公钥，不保存私钥、账号、密码或 Cookie。
- 每次请求包含门店号、时间戳、随机数和签名；跨店、过期、伪造和重放请求会被拒绝。
- 原始 PMS 行只在门店电脑内存中解析；订单号仅形成本机密钥的不可逆摘要。
- 001 保留原目录 `%LOCALAPPDATA%\Sifangguan\TrustedDevice001`；其他门店使用
  `%LOCALAPPDATA%\Sifangguan\TrustedDevice-门店编号`，安装时均收紧为当前用户可访问。
