import { useEffect, useRef, useState } from 'react'
import {
  approveTrustedDeviceScope,
  createTrustedDeviceEnrollment,
  downloadTrustedDeviceBootstrap,
  loadTrustedDeviceStatus,
  revokeTrustedDevice,
  type TrustedDeviceEnrollment,
  type TrustedDeviceStatus,
} from '../api/trustedDevice'
import type { HotelContext } from '../api/business'
import { businessErrorMessage } from '../ui/businessDisplay'

interface Props {
  context: HotelContext
  canRevokeDevice: boolean
  onStatusChanged: () => void
}

const formatTime = (value: string | null): string =>
  value ? new Date(value).toLocaleString('zh-CN') : '尚未上报'

export function TrustedDevicePanel({
  context,
  canRevokeDevice,
  onStatusChanged,
}: Props) {
  const [status, setStatus] = useState<TrustedDeviceStatus | null>(null)
  const [enrollment, setEnrollment] =
    useState<TrustedDeviceEnrollment | null>(null)
  const [loading, setLoading] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const repairPollRef = useRef<number | null>(null)
  const repairPollInFlightRef = useRef(false)

  const stopRepairPolling = () => {
    if (repairPollRef.current !== null) {
      window.clearInterval(repairPollRef.current)
      repairPollRef.current = null
    }
    repairPollInFlightRef.current = false
  }

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
    stopRepairPolling()
    setRepairing(false)
    loadTrustedDeviceStatus(context)
      .then((next) => {
        if (!cancelled) setStatus(next)
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(businessErrorMessage(cause, '读取可信设备状态失败'))
        }
      })
    return () => {
      cancelled = true
      stopRepairPolling()
    }
  }, [context.hotelId, context.tenantId])

  if (!status?.eligible) return null
  const hotelCode = status.hotelCode

  const generateEnrollment = async () => {
    if (loading) return
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const created = await createTrustedDeviceEnrollment(
        context,
        `${hotelCode}门店采集电脑`,
      )
      setEnrollment(created)
      await refresh()
      setNotice(`安装码已生成。请仅在${hotelCode}门店指定电脑上使用，15分钟后自动失效。`)
      onStatusChanged()
    } catch (cause) {
      setError(businessErrorMessage(cause, '生成安装码失败'))
    } finally {
      setLoading(false)
    }
  }

  const downloadAndInstall = async () => {
    if (loading) return
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const download = await downloadTrustedDeviceBootstrap(
        context,
        `${hotelCode}门店采集电脑`,
      )
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
      setError(businessErrorMessage(cause, '下载安装文件生成失败'))
    } finally {
      setLoading(false)
    }
  }

  const openInstalledLogin = () => {
    setError('')
    setNotice(`正在调用本机${hotelCode}采集器打开美团官方登录；浏览器询问时请选择“打开”。`)
    const protocolCode = hotelCode.toLowerCase().replaceAll('_', '-')
    window.location.href = `sfgtrusted${protocolCode}://login`
  }

  const openInstalledRepair = () => {
    if (repairing || !status.device) return
    stopRepairPolling()
    const baselineSnapshotAt = status.device.lastSnapshotAt
    const deadline = Date.now() + 5 * 60_000
    setRepairing(true)
    setError('')
    setNotice(
      `正在唤起${hotelCode}本机一键修复助手；若美团要求验证，请在官方Chrome完成，之后会自动采集。`,
    )
    const protocolCode = hotelCode.toLowerCase().replaceAll('_', '-')
    window.location.href = `sfgtrusted${protocolCode}://repair`
    repairPollRef.current = window.setInterval(() => {
      if (repairPollInFlightRef.current) return
      if (Date.now() >= deadline) {
        stopRepairPolling()
        setRepairing(false)
        setNotice('本机助手已唤起；如官网仍在等待验证，请完成后点击“刷新状态”。')
        return
      }
      repairPollInFlightRef.current = true
      loadTrustedDeviceStatus(context)
        .then((next) => {
          setStatus(next)
          const latest = next.device?.lastSnapshotAt ?? null
          if (!latest || latest === baselineSnapshotAt) return
          stopRepairPolling()
          setRepairing(false)
          if (
            next.device?.lastCompleteness === 'COMPLETE'
            && next.device.cutoverReady
          ) {
            setError('')
            setNotice(`${hotelCode}一键修复完成：登录、采集与云端上报均正常。`)
            onStatusChanged()
          } else {
            setNotice('')
            setError('本机已完成采集，但数据仍不完整，请查看完整性后再处理。')
          }
        })
        .catch((cause) => {
          setError(businessErrorMessage(cause, '读取修复状态失败'))
        })
        .finally(() => {
          repairPollInFlightRef.current = false
        })
    }, 3_000)
  }

  const revoke = async () => {
    if (!canRevokeDevice || loading || !status.device) return
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const result = await revokeTrustedDevice(context)
      setStatus(result.status)
      setEnrollment(null)
      setNotice(result.revoked ? `${hotelCode}可信设备已撤销。` : '当前没有可撤销的设备。')
      onStatusChanged()
    } catch (cause) {
      setError(businessErrorMessage(cause, '撤销设备失败'))
    } finally {
      setLoading(false)
    }
  }

  const approveScope = async () => {
    if (
      loading
      || status.device?.scopeApprovalStatus !== 'PENDING'
    ) return
    setLoading(true)
    setError('')
    setNotice('')
    try {
      await approveTrustedDeviceScope(context)
      await refresh()
      setNotice(
        `${hotelCode}门店范围已批准。请点击“一键检查并修复”完成首次完整采集与接管。`,
      )
      onStatusChanged()
    } catch (cause) {
      setError(businessErrorMessage(cause, '批准门店范围失败'))
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
          <span>{hotelCode} · 门店可信设备</span>
          <strong>{hotelCode}门店可信设备采集</strong>
        </div>
        <span className="mode-chip">
          {status.device
            ? status.device.reenrollRequired
              ? '需要重新绑定'
              : status.device.scopeApprovalStatus === 'PENDING'
                ? '等待门店批准'
                : status.device.cutoverReady
              ? '采集已接管'
              : '等待首次完整采集'
            : '等待安装'}
        </span>
      </header>
      <div className="trusted-device-body">
        <div>
          <strong>登录会话只留在门店电脑，云端只接收签名业务数据</strong>
          <p>
            管理员直接在门店电脑的美团官方页面登录。Cookie、账号、密码、验证码和
            设备私钥不上传；登录使用普通Chrome，不由自动测试软件启动。登录后请
            保留该窗口运行（可以最小化），采集器只连接这一本机会话。
          </p>
        </div>
        <div className="trusted-device-actions">
          {status.device ? (
            <button
              disabled={repairing}
              type="button"
              onClick={openInstalledRepair}
            >
              {repairing ? '正在检查并修复…' : '一键检查并修复'}
            </button>
          ) : (
            <button
              disabled={loading}
              type="button"
              onClick={() => void downloadAndInstall()}
            >{loading ? '正在生成安装文件…' : '下载安装并进入登录'}</button>
          )}
          {status.device ? (
            <button
              className="secondary"
              disabled={repairing}
              type="button"
              onClick={openInstalledLogin}
            >仅打开美团登录</button>
          ) : null}
          {status.device ? (
            <button
              className="secondary"
              disabled={loading}
              type="button"
              onClick={() => void downloadAndInstall()}
            >重新下载安装</button>
          ) : null}
          <button
            className="secondary"
            disabled={loading}
            type="button"
            onClick={() => void generateEnrollment()}
          >仅生成安装码</button>
          {status.device ? (
            <button
              className="danger-outline"
              disabled={!canRevokeDevice || loading}
              type="button"
              onClick={() => void revoke()}
            >撤销当前设备</button>
          ) : null}
        </div>
      </div>
      {status.device?.scopeApprovalStatus === 'PENDING' ? (
        <div className="trusted-device-enrollment trusted-device-scope-approval" role="status">
          <span>首次接管前门店核对</span>
          <strong>请在本机美团官方 Chrome 核对当前登录门店确为 {hotelCode} · {status.hotelName}</strong>
          <small>批准只保存加密的门店范围锚，不显示或保存原始 PMS 门店编号；未批准前旧采集不会被切断。</small>
          <button
            disabled={loading}
            type="button"
            onClick={() => void approveScope()}
          >{loading ? '正在批准…' : '已核对，批准本门店'}</button>
        </div>
      ) : null}
      {status.device?.scopeApprovalStatus === 'UNBOUND' ? (
        <div className="trusted-device-install-note" role="status">
          请先在本机完成美团官方登录并运行一次检查；系统取得加密门店范围锚后，才会显示批准按钮。
        </div>
      ) : null}
      {status.device?.reenrollRequired ? (
        <div className="field-error" role="alert">
          当前设备协议版本已过期，请重新下载安装并绑定；系统保持旧采集为权威，不会自动切换。
        </div>
      ) : null}
      {enrollment ? (
        <div className="trusted-device-enrollment" role="status">
          <span>一次性安装码</span>
          <strong>{enrollment.enrollmentCode}</strong>
          <small>有效至 {formatTime(enrollment.expiresAt)}，使用一次后立即失效。</small>
          <button type="button" onClick={() => void copyEnrollment()}>复制安装码</button>
        </div>
      ) : null}
      <p className="trusted-device-install-note">
        已绑定的{hotelCode}门店电脑可直接一键检查；会话有效时自动恢复采集，失效时只需在美团官网完成人工验证。其他电脑首次使用仍需下载安装并绑定，系统不会绕过平台风控。
      </p>
      <div className="trusted-device-policy">
        <span>门店范围：仅{hotelCode}</span>
        <span>认证：Ed25519设备签名</span>
        <span>门店校验：一次性范围挑战</span>
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
          <span>采集接管：{status.device.cutoverReady ? '已完成' : '等待完整数据'}</span>
          <span>门店范围：{
            status.device.scopeApprovalStatus === 'APPROVED'
              ? '已批准'
              : status.device.scopeApprovalStatus === 'PENDING'
                ? '待管理员批准'
                : '等待本机校验'
          }</span>
        </footer>
      ) : null}
      {notice ? <div className="success-note" role="status">{notice}</div> : null}
      {error ? <div className="field-error" role="alert">{error}</div> : null}
    </article>
  )
}
