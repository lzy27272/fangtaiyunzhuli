# Pilot Windows 服务器运行手册

适用版本：`TECH-V0.2-PILOT.6`

目标网址：`https://www.sfgzt.cn`

## 1. 当前部署结构

```text
公网用户
  -> Cloudflare HTTPS
  -> Cloudflare Tunnel（本机主动出站）
  -> cloudflared
  -> 127.0.0.1:4180
  -> SifangguanPilot（Caddy Windows Service）
       -> apps/web/dist（SPA）
       -> /api/* -> 127.0.0.1:18080（Core API）
                         -> 127.0.0.1:55432（PostgreSQL）
```

这台电脑承载Pilot前端、Core API与持久化PostgreSQL。公网只允许经Cloudflare Tunnel到Caddy；PostgreSQL、Core API、远程桌面和开发端口均不得直接暴露。

## 2. 本机已完成

- Caddy：`v2.11.4`
- Windows服务：`SifangguanPilot`，自动启动，仅监听`127.0.0.1:4180`
- cloudflared：`2026.7.2`，Cloudflare有效数字签名
- Named Tunnel：`sifangguan-pilot`
- Windows隧道服务：`SifangguanPilotTunnel`，自动启动
- 公网入站防火墙规则：无
- 临时测试端口4174、4175：已停止
- 正式Pilot地址：`https://www.sfgzt.cn`
- AC供电睡眠：关闭，适合持续运行
- PostgreSQL：`14.22`，Windows服务`SifangguanPostgreSQL`，延迟自动启动并配置三级失败重启；仅监听`127.0.0.1:55432`，数据目录`D:\SifangguanHotelAIOS\Data\PostgreSQL`
- Core API：仅监听`127.0.0.1:18080`，日志目录`D:\SifangguanHotelAIOS\Logs`
- 附件目录：`D:\SifangguanHotelAIOS\Data\Attachments`
- Core API启动方式：当前用户计划任务`SifangguanPilotCoreApiUser`在登录时启动，并每5分钟检查和自动恢复；PostgreSQL不再依赖用户登录启动
- 访问控制：浏览器直接进入应用登录；除登录接口外的业务API要求有效JWT，并由服务端RBAC、组织范围和PostgreSQL RLS保护

## 3. 网络结论

- WAN IPv4为`100.64.185.139`，属于运营商CGNAT，光猫IPv4虚拟服务器规则不能形成公网入口。
- 光猫已获得IPv6前缀，但`useradmin`界面没有安全的单端口IPv6入站例外；不得关闭IPv6会话防火墙。
- Pilot改用Cloudflare Tunnel出站连接，不修改光猫NAT、不启用DMZ、不开放Windows入站端口。

## 4. 当前Pilot测试

固定Named Tunnel运行期间可访问：

`https://www.sfgzt.cn/#/workbench`

该地址当前只用于Pilot内部测试。不要再使用`?demo=1`旧链接。Caddy、Named Tunnel和PostgreSQL均为Windows自动服务；Core API在当前Windows用户登录后由计划任务恢复。

## 5. www.sfgzt.cn绑定结果

1. `sfgzt.cn`权威Nameserver已从DNSPod切换到Cloudflare。
2. 固定Named Tunnel `sifangguan-pilot`已创建并连接两个Cloudflare边缘节点。
3. `www.sfgzt.cn`和`sfgzt.cn`已建立Cloudflare Tunnel DNS路由；根域名以308永久跳转到`https://www.sfgzt.cn`。
4. Named Tunnel已安装为Windows自动启动服务，回源为`http://127.0.0.1:4180`。
5. 两个Cloudflare边缘IP直接HTTPS测试均返回200；独立外部抓取节点已读取到正确产品标题和完整页面内容。
6. 本机Meta代理曾短时缓存旧DNS，普通本地curl握手失败；这不影响外部访问，等待其缓存刷新后复验。

Cloudflare账户凭据、Tunnel Token和证书不得写入仓库、文档或聊天。

### ICP备案

当前服务器位于中国大陆。域名上线前必须确认ICP备案状态；获得备案号后在页面底部真实展示并链接备案系统，不得填入虚构备案号。

## 6. 启动与检查

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\pilot\Get-PilotServerStatus.ps1
```

预期：Caddy、Tunnel和PostgreSQL服务均为`Running/Automatic`；4180、18080和55432只在回环监听；Cloudflare Tunnel进程运行；公网80/443监听均为False；Core API健康状态为`UP`。

浏览器验收：

1. `https://www.sfgzt.cn`证书有效，直接返回中台应用登录页。
2. `http://sfgzt.cn`永久跳转至`https://www.sfgzt.cn`。
3. 浏览器标题显示“贵州四方馆酒店管理有限公司中台”。
4. 桌面和移动端无白屏、遮挡和框架错误层。
5. 使用真实应用账号登录后，页面顶部显示“服务端权限已解析”，且只能看到该账号授权的组织、任职和功能。
6. 企业规则中心显示“实时API”，能够读取数据库规则；有`rule.manage`权限的角色可以创建/修改，有`rule.publish`权限的角色可以发布。
7. Cloudflare Browser Insights脚本被CSP阻止产生的单条提示属于已知非业务错误；其他业务脚本或API错误必须处理。

## 7. 发布更新

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\pilot\Start-PilotUatRuntime.ps1
```

该命令会检查并启动PostgreSQL，随后确认或启动Core API。前端重新构建后，Caddy静态目录直接读取`apps/web/dist`；Caddy配置变更必须先校验再热加载。

每次更新必须同步`CHANGELOG.md`和Pilot发布记录，并保留前一版构建制品以便回滚。

## 8. 日常运行要求

- 保持电脑接通电源、网线和网络。
- 不修改电脑时间；TLS证书依赖准确系统时间。
- Windows网络配置必须保持`Private`，且不得新增Pilot入站端口。
- 每周检查服务状态、磁盘空间和证书续期日志。
- 办公电脑重启后确认`SifangguanPilot`、`SifangguanPilotTunnel`和`SifangguanPostgreSQL`均已恢复运行。
- PostgreSQL不再依赖Windows用户登录；Core API当前仍依赖部署Pilot的Windows用户会话，计划任务`SifangguanPilotCoreApiUser`在登录时及每5分钟检查恢复。该用户未登录时，公网前端可能可见但业务API不可用。
- Pilot阶段可接受单机中断；正式生产必须迁移到具备备份、监控和高可用能力的云服务器。

## 9. 数据与安全边界

- 数据库运行账户不是超级用户，不得授予`BYPASSRLS`；迁移账户只用于Flyway。
- V1—V13迁移已执行且不可修改；后续数据库演进只能追加V14+。
- 当前Pilot身份方案是本地应用账号和短期JWT，不是企业SSO。应用账号不得转发给无关人员；连续失败5次会临时锁定。
- 不在聊天、截图、仓库、Change Log或运行手册中记录明文密码、Tunnel Token或数据库密钥。
- 测试期间不录入真实身份证号、手机号、支付信息、客人照片等敏感个人信息。
- 正式生产前必须完成自动备份、异机恢复演练、磁盘容量告警、服务健康告警、证书与Tunnel监控。
