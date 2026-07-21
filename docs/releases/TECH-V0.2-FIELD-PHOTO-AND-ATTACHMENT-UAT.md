# TECH-V0.2 现场照片与生产附件链验收单

文档版本：RC-ATTACHMENT-UAT-V1.1  
技术候选：TECH-V0.2  
状态：`BLOCKED / 技术扫描链已通过，现场与目标环境证据未完成`  
适用门槛：REL-P0-04

## 一、当前结论

TECH-V0.2 RC 已完成附件恶意文件扫描链的机器验收：正式 Bearer JWT 模式下关闭开发请求头认证，使用 ClamAV 1.5.3 和签名 CVD 病毒库执行实际扫描，测试附件上传返回 `scanStatus=CLEAN`，数据库记录为 `scan_status=CLEAN`。该项结论为 `PASS`。

REL-P0-04 仍不得关闭。当前上传文件仍是自动化测试使用的 68 字节 1×1 PNG，不是真实试点门店现场照片；附件仍写入隔离的本地文件目录，不是目标环境对象存储；目标附件备份恢复尚未演练；业务、QA及安全/运维签署尚未完成。因此本验收单总体状态保持 `BLOCKED`。

## 二、扫描安全契约

- 正式模式采用 fail-closed。扫描命令未配置、路径不可用、执行超时、返回非零或文件未通过扫描时，上传整体失败，不创建附件元数据，正式模式也不允许下载未通过扫描的文件。
- `CLEAN` 仅表示已配置的实际恶意文件扫描器成功返回，不再以图片结构校验代替病毒扫描。
- `BYPASSED_DEV` 仅在显式设置 `DEV_HEADER_AUTH_ENABLED=true` 的开发模式中允许产生和下载；正式 JWT 模式既不会产生该状态，也不会放行该状态的附件。
- 图片格式、大小、实际内容校验及 SHA-256 校验仍与恶意文件扫描共同执行，任何一项失败均不得形成可用附件。

## 三、已完成技术证据

验收运行：`20260718-0112-tech-v02-rc-final`

| 检查项 | 证据 | 结果 |
|---|---|---|
| 正式鉴权模式 | `docs/uat/evidence/20260718-0112-tech-v02-rc-final/runtime/uat-processes.json`：`authenticationMode=bearer-jwt`、`devHeaderAuthEnabled=false` | PASS |
| 实际恶意文件扫描器 | 同一运行状态记录：ClamAV 1.5.3、签名 CVD 病毒库、fail-closed | PASS |
| 上传扫描结果 | `docs/uat/evidence/20260718-0112-tech-v02-rc-final/api/flows/A-housekeeping-photo-standard-remediation/01-photo-upload.json`：`scanStatus=CLEAN` | PASS |
| 数据库扫描结果 | `docs/uat/evidence/20260718-0112-tech-v02-rc-final/database/02-work-records-and-attachments.json`：对应附件 `scan_status=CLEAN` | PASS |
| 列表与下载 | 同一流程的附件列表、下载文件及 SHA-256 比对证据 | PASS（测试附件） |
| 越权下载拒绝 | `api/security/06-cross-department-attachment-download-denied.json` | PASS（测试附件） |
| 标准评价与整改闭环 | 场景 A 的评价、规则任务、执行、店总验收及任务时间线 | PASS（测试数据） |

以上 PASS 只证明技术链路，不代表真实现场或目标生产存储已经验收。

## 四、仍需现场输入

- 由试点门店客房主管现场拍摄一张可用于验收的客房卫生问题照片。
- 原图不得是页面截图、网络素材、AI 生成图或 1×1 测试图。
- 照片不得包含住客身份信息、证件、电话号码或其他不必要的个人信息。
- 记录门店、脱敏房间编号、拍摄时间、拍摄人和业务问题描述。

收到合规照片后，从仓库根目录使用以下入口复验；缺少任一来源字段、格式不是PNG/JPEG或文件小于1 KiB时脚本会直接拒绝：

```powershell
.\tools\uat\Invoke-UatApiSmoke.ps1 `
  -RunId 'tech-v0.2-field-photo' `
  -PhotoPath 'D:\uat-input\room-hygiene.jpg' `
  -PhotoHotel '试点门店编码' `
  -PhotoMaskedRoom '8**' `
  -PhotoCapturedAt '2026-07-18T10:30:00+08:00' `
  -PhotoCapturedBy '客房主管姓名或受控人员编号' `
  -PhotoIssueDescription '卫生问题说明'
```

证据会新增`00-photo-source.json`，包含来源类型、文件名、MIME、大小、SHA-256和业务元数据，但不会保存本机绝对路径。

## 五、门槛状态

| 检查项 | 验收要求 | 当前结果 | 状态 |
|---|---|---|---|
| 真实现场来源 | 业务代表确认照片来自试点门店现场 | 尚无真实现场照片 | BLOCKED |
| 上传与元数据 | 原名、MIME、大小、SHA-256可核对 | 测试附件已通过；真实照片待验 | BLOCKED |
| 恶意文件扫描 | 正式模式由真实安全引擎扫描并返回 `CLEAN` | ClamAV 1.5.3 + 签名 CVD 实际通过 | PASS |
| 授权访问 | 合法角色可访问，越权角色被拒绝 | 测试附件已通过；真实照片待复核 | BLOCKED |
| 目标对象存储 | 目标环境对象键、持久化、加密及生命周期策略有效 | 当前为隔离本地文件目录 | BLOCKED |
| 下载一致性 | 上传与下载 SHA-256 一致 | 测试附件已通过；真实照片待验 | BLOCKED |
| 目标附件备份恢复 | 从目标存储备份恢复后可读取且 SHA-256 一致 | 尚未执行目标环境恢复演练 | BLOCKED |
| 标准评价 | 关联已发布卫生标准并形成评价 | 测试数据已通过；真实照片待验 | BLOCKED |
| 整改闭环 | 生成任务、执行、复拍、店总验收 | 测试数据已通过；真实业务待验 | BLOCKED |
| 隐私复核 | 不含不必要个人信息，访问有审计 | 真实照片尚未提供 | BLOCKED |
| 正式签署 | 客房主管、店总、QA、安全/运维完成签署 | 尚未签署 | BLOCKED |

## 六、关闭 REL-P0-04 的必要条件

只有同时完成以下事项，才能将 REL-P0-04 从 `BLOCKED` 改为 `PASS`：

1. 使用真实试点门店照片重跑完整上传、扫描、标准评价、整改、复拍和店总验收流程。
2. 在目标对象存储中验证持久化、访问控制、加密和生命周期策略。
3. 对目标附件存储执行一次备份恢复，并核对恢复前后的 SHA-256。
4. 完成隐私与访问审计复核。
5. 完成业务、QA及安全/运维正式签署。

## 七、签署

| 责任 | 姓名/岗位 | 结论 | 时间 | 凭据 |
|---|---|---|---|---|
| 客房主管业务代表 | 待填写 | 待填写 | 待填写 | 待填写 |
| 店总业务代表 | 待填写 | 待填写 | 待填写 | 待填写 |
| QA负责人 | 待填写 | 待填写 | 待填写 | 待填写 |
| 安全/运维负责人 | 待填写 | 待填写 | 待填写 | 待填写 |
