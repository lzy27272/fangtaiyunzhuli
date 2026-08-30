import { useEffect, useState } from 'react'
import {
  createTrustedDeviceEnrollment,
  downloadTrustedDeviceBootstrap,
  loadTrustedDeviceStatus,
  revokeTrustedDevice,
  type TrustedDeviceEnrollment,
  type TrustedDeviceStatus,
} from '../api/trustedDevice'
import type { HotelContext } from '../api/business'

interface Props {
  context: HotelContext
  canConfigure: boolean
  onStatusChanged: () => void
}

const formatTime = (value: string | null): string =>
  value ? new Date(value).toLocaleString('zh-CN') : '尚未上报'

export function TrustedDevicePanel({
  context,
  canConfigure,
  onStatusChanged,
}: Props) {
  const [status, setStatus] = useState<TrustedDeviceStatus | null>(null)
  const [enrollment, setEnrollment] =
    useState<TrustedDeviceEnrollment | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = async () => {
    const next = await loadTrustedDeviceStatus(context)
    setStatus(next)
    return next
  }

  useEffect(() => {
    let cancelled = false
    setStatus(null)
    setEnrollment(null)
    setError('')
    loadTrustedDeviceStatus(context)
      .then((next) => {
        if (!cancelled) setStatus(next)
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : '读取可信设备状态失败')
        }
      })
    return () => { cancelled = true }
  }, [context.hotelId, context.tenantId])

  if (!status?.eligible) return null

  const generateEnrollment = async () => {
    if (!canConfigure || loading) return
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const created = await createTrustedDeviceEnrollment(context)
      setEnrollment(created)
      await refresh()
      setNotice('安装码已生成。请仅在001门店指定电脑上使用，15分钟后自动失效。')
      onStatusChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '生成安装码失败')
    } finally {
      setLoading(false)
    }
  }

  const downloadAndInstall = async () => {
    if (!canConfigure || loading) return
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const download = await downloadTrustedDeviceBootstrap(context)
      const href = URL.createObjectURL(download.blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = download.fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(href), 30_000)
      await refresh()
      setEnrollment(null)
      setNotice(
        `安装文件已下载${download.expiresAt ? `，请在${formatTime(download.expiresAt)}前` : ''}`
        + '打开一次。安装完成后会自动进入美团官方登录页面。',
      )
      onStatusChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '下载安装文件生成失败')
    } finally {
      setLoading(false)
    }
  }

  const openInstalledLogin = () => {
    setError('')
    setNotice('正在调用本机001采集器打开美团官方登录；浏览器询问时请选择“打开”。')
    window.location.href = 'sfgtrusted001://login'
  }

  const revoke = async () => {
    if (!canConfigure || loading || !status.device) return
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const result = await revokeTrustedDevice(context)
      setStatus(result.status)
      setEnrollment(null)
      setNotice(result.revoked ? '001可信设备已撤销。' : '当前没有可撤销的设备。')
      onStatusChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '撤销设备失败')
    } finally {
      setLoading(false)
    }
  }

  const copyEnrollment = async () => {
    if (!enrollment) return
    await navigator.clipboard.writeText(enrollment.enrollmentCode)
    setNotice('安装码已复制。')
  }

  return (
    <article className="report-source-card trusted-device-card">
      <header>
        <div>
          <span>001 · STORE TRUSTED DEVICE</span>
          <strong>001门店可信设备采集</strong>
        </div>
        <span className="mode-chip">
          {status.device ? '设备已绑定' : '等待安装'}
        </span>
      </header>
      <div className="trusted-device-body">
        <div>
          <strong>登录会话只留在门店电脑，云端只接收签名业务数据</strong>
          <p>
            管理员直接在门店电脑的美团官方页面登录。Cookie、账号、密码、验证码和
            设备私钥不上传；首次打开下载文件安装一次，以后直接从这里进入登录。
          </p>
        </div>
        <div className="trusted-device-actions">
          {status.device ? (
            <button type="button" onClick={openInstalledLogin}>
              直接进入美团登录
            </button>
          ) : (
            <button
              disabled={!canConfigure || loading}
              type="button"
              onClick={() => void downloadAndInstall()}
            >{loading ? '正在生成安装文件…' : '下载安装并进入登录'}</button>
          )}
          {status.device ? (
            <button
              className="secondary"
              disabled={!canConfigure || loading}
              type="button"
              onClick={() => void downloadAndInstall()}
            >重新下载安装</button>
          ) : null}
          <button
            className="secondary"
            disabled={!canConfigure || loading}
            type="button"
            onClick={() => void generateEnrollment()}
          >仅生成安装码</button>
          {status.device ? (
            <button
              className="danger-outline"
              disabled={!canConfigure || loading}
              type="button"
              onClick={() => void revoke()}
            >撤销当前设备</button>
          ) : null}
        </div>
      </div>
      {enrollment ? (
        <div className="trusted-device-enrollment" role="status">
          <span>一次性安装码</span>
          <strong>{enrollment.enrollmentCode}</strong>
          <small>有效至 {formatTime(enrollment.expiresAt)}，使用一次后立即失效。</small>
          <button type="button" onClick={() => void copyEnrollment()}>复制安装码</button>
        </div>
      ) : null}
      <p className="trusted-device-install-note">
        Windows不允许网页静默执行安装文件：首次下载后请打开一次；安装器会自动安装采集器并跳转到美团官网。已安装电脑不再下载。
      </p>
      <div className="trusted-device-policy">
        <span>门店范围：仅001</span>
        <span>认证：Ed25519设备签名</span>
        <span>防护：5分钟时效 + 随机数防重放</span>
        <span>本机检查：每5分钟，仅到点采集一次</span>
      </div>
      {status.device ? (
        <footer className="trusted-device-status">
          <span>设备：{status.device.label}</span>
          <span>最近联机：{formatTime(status.device.lastSeenAt)}</span>
          <span>最近数据：{formatTime(status.device.lastSnapshotAt)}</span>
          <span>营业日：{status.device.lastBusinessDate ?? '尚未上报'}</span>
          <span>完整性：{status.device.lastCompleteness ?? '尚未上报'}</span>
        </footer>
      ) : null}
      {notice ? <div className="success-note" role="status">{notice}</div> : null}
      {error ? <div className="field-error" role="alert">{error}</div> : null}
    </article>
  )
}
