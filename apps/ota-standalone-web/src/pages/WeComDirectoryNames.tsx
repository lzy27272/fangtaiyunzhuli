import { useState } from 'react'
import type { WeComRepairAdminCommand, WeComRepairAdminsView } from '../api/business'
import { businessErrorMessage } from '../ui/businessDisplay'

export function WeComDirectoryNames({ data, busy, onSave }: {
  data: WeComRepairAdminsView; busy: boolean
  onSave: (command: WeComRepairAdminCommand, version: number) => Promise<boolean | undefined>
}) {
  const [appSecret, setAppSecret] = useState('')
  const [version, setVersion] = useState<number | null>(null)
  const read = data.directoryRead
  const syncing = busy || read.syncing
  return <div className="repair-directory-names">
    <div className="page-heading">
      <p>{read.lastSyncedAt ? `名称同步：${new Date(read.lastSyncedAt).toLocaleString('zh-CN')} · 已匹配 ${read.matchedCount} 人 / 待匹配 ${read.unmatchedCount} 人` : '连接企业微信通讯录后，自动补充已绑定人员的名称。'}</p>
      <button className="secondary" type="button" disabled={syncing || !read.enabled} onClick={() => void onSave({ action: 'SYNC_DIRECTORY_NAMES' }, data.rowVersion)}>{syncing ? '同步处理中…' : '同步企微名称'}</button>
    </div>
    {read.lastErrorCode ? <p className="error" role="alert">最近同步未成功：{businessErrorMessage(new Error(read.lastErrorCode), '请检查通讯录读取配置')}。上次成功的数据保留，权限不受影响。</p> : null}
    <details className="repair-admin-directory">
      <summary>通讯录名称同步 · {read.enabled ? '已启用' : '未接通'} <span className="repair-section-hint">只读取账号与名称</span></summary>
      <p>每6小时自动更新，也可手动同步。名称来自企业微信通讯录，不是个人微信昵称；姓名备注单独保留。只按已核对的通讯录账号或完全相同的机器人账号匹配，不按姓名猜测，也不会自动授予权限或关联离职解绑。</p>
      <p>使用本企业自建应用 Secret（例如“AI管理后台”），不是机器人密钥或离职回调 Token。应用可见范围需覆盖员工所在部门，企业可信 IP 需包含本系统服务器。</p>
      <form className="wecom-config-grid" onSubmit={async (event) => {
        event.preventDefault()
        const secret = appSecret.trim()
        setAppSecret('')
        const result = await onSave({ action: 'DIRECTORY_READ', directoryReadUpdate: {
          action: 'REPLACE', corpId: data.directory.corpId, appSecret: secret,
        } }, version ?? data.rowVersion)
        if (result !== undefined) setVersion(null)
      }}>
        <label>企业 ID<input readOnly value={data.directory.corpId} /><small>沿用已配置的本企业身份，防止读取其他企业。</small></label>
        <label>自建应用 Secret<input type="password" autoComplete="new-password" maxLength={256} required disabled={syncing} value={appSecret} placeholder={read.configured ? '已加密保存；更换时填写新 Secret' : '粘贴企业微信团队发来的应用 Secret'} onChange={(event) => { setAppSecret(event.target.value); setVersion((current) => current ?? data.rowVersion) }} /><small>仅加密保存，不回显、不写入浏览器存储。</small></label>
        <div className="heading-actions wide-field">
          <button type="submit" disabled={syncing || !appSecret.trim() || !data.directory.corpId || !data.credentialConfigured}>{syncing ? '正在核对并同步…' : '保存并同步名称'}</button>
          {read.enabled ? <button className="secondary" type="button" disabled={syncing} onClick={() => void onSave({ action: 'DIRECTORY_READ', directoryReadUpdate: { action: 'DISABLE' } }, data.rowVersion)}>停用名称同步</button> : null}
        </div>
        {!data.directory.corpId ? <p className="wide-field error">请先在“离职自动解绑”配置本企业身份。</p> : null}
      </form>
    </details>
  </div>
}
