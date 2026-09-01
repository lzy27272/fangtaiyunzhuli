import { useEffect, useState } from 'react'
import {
  loadBieyanghongWorkspaceAvailability,
  startBieyanghongWorkspace,
  type BieyanghongWorkspaceAvailability,
  type BieyanghongWorkspaceView,
} from '../api/bieyanghongWorkspace'
import type { HotelContext } from '../api/business'

interface Props {
  context: HotelContext
  canConfigure: boolean
  onStatusChanged: () => void
}

const workspaceWindowName = 'sifangguan-bieyanghong-001-workspace'

const preparePopup = (): Window | null => {
  const popup = window.open(
    'about:blank',
    workspaceWindowName,
    'popup,width=1280,height=900,resizable=yes,scrollbars=yes',
  )
  if (!popup) return null
  popup.document.title = '正在建立001云端登录工作台'
  popup.document.body.textContent = '正在安全连接美团官方登录页面，请稍候…'
  return popup
}

export function BieyanghongCloudWorkspacePanel({
  context,
  canConfigure,
  onStatusChanged,
}: Props) {
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [workspace, setWorkspace] =
    useState<BieyanghongWorkspaceView | null>(null)
  const [availability, setAvailability] =
    useState<BieyanghongWorkspaceAvailability | null>(null)

  useEffect(() => {
    let cancelled = false
    setAvailability(null)
    setWorkspace(null)
    setError('')
    setNotice('')
    loadBieyanghongWorkspaceAvailability(context)
      .then((result) => {
        if (!cancelled) setAvailability(result)
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : '读取001云端工作台状态失败',
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [context.hotelId, context.tenantId])

  if (!availability?.eligible) return null

  async function openWorkspace() {
    if (!canConfigure || !availability?.ready || starting) return
    const popup = preparePopup()
    if (!popup) {
      setError('浏览器阻止了云端工作台窗口，请允许本站打开弹窗后重试。')
      setNotice('')
      return
    }
    setStarting(true)
    setError('')
    setNotice('正在建立001云端登录工作台，请勿重复点击。')
    try {
      const started = await startBieyanghongWorkspace(context)
      setWorkspace(started)
      popup.location.replace(started.workspaceUrl)
      popup.focus()
      setNotice(
        '云端工作台已打开。请直接在美团官方页面完成登录；成功后系统会自动更新Cookie、采集并补发播报。',
      )
      onStatusChanged()
    } catch (cause) {
      popup.close()
      setWorkspace(null)
      setError(
        cause instanceof Error
          ? cause.message
          : '001云端登录工作台启动失败',
      )
      setNotice('')
    } finally {
      setStarting(false)
    }
  }

  return (
    <article className="report-source-card bieyanghong-workspace-card">
      <header>
        <div>
          <span>001 · 云端登录工作台</span>
          <strong>别样红云端登录工作台</strong>
        </div>
        <span className="mode-chip">固定入口</span>
      </header>
      <div className="bieyanghong-workspace-body">
        <div>
          <strong>无需企微中转链接，也不依赖本地电脑</strong>
          <p>
            点击后直接打开001专属云端Chrome。账号、密码、验证码及滑块均只在
            美团官方页面操作，系统不保存、不回显、不写入日志。
          </p>
        </div>
        <button
          disabled={!canConfigure || !availability.ready || starting}
          type="button"
          onClick={() => void openWorkspace()}
        >
          {starting
            ? '正在建立工作台…'
            : availability.ready
              ? '打开001云端登录工作台'
              : '云端工作台暂不可用'}
        </button>
      </div>
      <div className="bieyanghong-workspace-policy">
        <span>浏览器档案：长期保存</span>
        <span>单次人工操作：最长{availability.workspaceTtlMinutes}分钟</span>
        <span>再次打开：自动结束上一次未完成窗口</span>
      </div>
      {notice ? <div className="success-note" role="status">{notice}</div> : null}
      {error ? <div className="field-error" role="alert">{error}</div> : null}
      {workspace ? (
        <footer>
          <span>
            本次工作台有效至：
            {new Date(workspace.expiresAt).toLocaleString('zh-CN')}
          </span>
          <span>登录成功后自动采集并补发</span>
        </footer>
      ) : null}
    </article>
  )
}
