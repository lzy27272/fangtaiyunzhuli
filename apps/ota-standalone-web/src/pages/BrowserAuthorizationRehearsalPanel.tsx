import { useEffect, useState } from 'react'
import {
  cancelBrowserAuthorizationRehearsal,
  confirmBrowserAuthorizationRehearsal,
  loadBrowserAuthorizationRehearsal,
  loadLatestBrowserAuthorizationRehearsal,
  reauthenticateBrowserAuthorizationRehearsal,
  startBrowserAuthorizationRehearsal,
  type BrowserAuthorizationRehearsalStatus,
  type BrowserAuthorizationRehearsalView,
  type HotelContext,
} from '../api/business'
import { selectCurrentConfigAttempt } from './browserAuthorizationRehearsalState'

interface Props {
  context: HotelContext
  connectorId: string
  configVersion: number
  canConfigure: boolean
}

const STATUS_LABELS: Record<BrowserAuthorizationRehearsalStatus, string> = {
  WAITING_FOR_OPERATOR: '等待操作人员确认演练步骤',
  OFFLINE_REHEARSAL_COMPLETE: '离线演练已完成',
  CANCELLED: '离线演练已取消',
  EXPIRED: '离线演练已过期',
  FAILED: '离线演练失败',
}

const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/

function displayTime(value?: string | null): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString('zh-CN', { hour12: false })
}

export function BrowserAuthorizationRehearsalPanel({
  context,
  connectorId,
  configVersion,
  canConfigure,
}: Props) {
  const [view, setView] =
    useState<BrowserAuthorizationRehearsalView | null>(null)
  const [reasonCode, setReasonCode] =
    useState('OFFLINE_BROWSER_REHEARSAL')
  const [workingAction, setWorkingAction] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    setView(null)
    setWorkingAction('restore')
    setError('')
    setNotice('')
    loadLatestBrowserAuthorizationRehearsal(context, connectorId)
      .then((latest) => {
        if (!cancelled) {
          setView(selectCurrentConfigAttempt(latest, configVersion))
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error
            ? cause.message
            : '恢复离线演练状态失败')
        }
      })
      .finally(() => {
        if (!cancelled) setWorkingAction('')
      })
    return () => {
      cancelled = true
    }
  }, [
    context.tenantId,
    context.hotelId,
    connectorId,
    configVersion,
  ])

  function validateReasonCode(): string | null {
    const normalized = reasonCode.trim().toUpperCase()
    if (!REASON_CODE_PATTERN.test(normalized)) {
      setError('原因码必须为3至64位，首位为大写字母，其余仅可使用大写字母、数字或下划线。')
      return null
    }
    return normalized
  }

  async function start() {
    const normalized = validateReasonCode()
    if (!normalized) return
    setWorkingAction('start')
    setError('')
    setNotice('')
    try {
      const result = await startBrowserAuthorizationRehearsal(
        context,
        connectorId,
        configVersion,
        normalized,
      )
      setView(result)
      setNotice('离线授权演练尝试已创建；所有运行能力继续保持阻断。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建离线授权演练失败')
    } finally {
      setWorkingAction('')
    }
  }

  async function refresh() {
    if (!view) return
    setWorkingAction('refresh')
    setError('')
    setNotice('')
    try {
      setView(await loadBrowserAuthorizationRehearsal(
        context,
        connectorId,
        view.authorizationAttemptId,
      ))
      setNotice('已从本地控制面刷新离线演练状态。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '刷新离线演练状态失败')
    } finally {
      setWorkingAction('')
    }
  }

  async function transition(
    action: 'confirm' | 'cancel' | 'reauthenticate',
  ) {
    if (!view) return
    const normalized = validateReasonCode()
    if (!normalized) return
    setWorkingAction(action)
    setError('')
    setNotice('')
    try {
      const operation = action === 'confirm'
        ? confirmBrowserAuthorizationRehearsal
        : action === 'cancel'
          ? cancelBrowserAuthorizationRehearsal
          : reauthenticateBrowserAuthorizationRehearsal
      const result = await operation(
        context,
        connectorId,
        view.authorizationAttemptId,
        view.rowVersion,
        normalized,
      )
      setView(result)
      setNotice(
        action === 'confirm'
          ? '离线演练步骤已记录完成；PMS仍未连接，运行门禁仍为锁定状态。'
          : action === 'cancel'
            ? '离线授权演练已取消；没有启动任何外部能力。'
            : '新的离线重新认证演练尝试已创建；没有发起外部访问。',
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '更新离线演练状态失败')
    } finally {
      setWorkingAction('')
    }
  }

  const waiting = view?.state === 'WAITING_FOR_OPERATOR'
  const terminal = view !== null && !waiting

  return (
    <section
      className="browser-authorization-rehearsal"
      aria-labelledby={`browser-authorization-rehearsal-${connectorId}`}
    >
      <div className="rehearsal-heading">
        <div>
          <p className="eyebrow">OFFLINE REHEARSAL</p>
          <h4 id={`browser-authorization-rehearsal-${connectorId}`}>
            PMS浏览器授权控制流程演练
          </h4>
        </div>
        <span className="mode-chip">RUNTIME BLOCKED</span>
      </div>

      <div className="safety-lock">
        <strong>离线安全边界</strong>
        <span>
          当前仅演练本地控制面状态流转：未连接PMS、未启动浏览器、未读取凭据，
          不会发起外部访问或数据采集。
        </span>
      </div>

      <dl className="rehearsal-boundary-grid">
        <div>
          <dt>授权状态</dt>
          <dd>{view?.authorizationState ?? 'AUTH_REQUIRED'}</dd>
        </div>
        <div>
          <dt>运行门禁</dt>
          <dd>{view?.runtimeBlocked ?? true ? 'RUNTIME BLOCKED' : '边界异常'}</dd>
        </div>
        <div>
          <dt>PMS连接</dt>
          <dd>{view?.pmsConnected ?? false ? '边界异常' : '未连接PMS'}</dd>
        </div>
        <div>
          <dt>浏览器进程</dt>
          <dd>{view?.browserStarted ?? false ? '边界异常' : '未启动浏览器'}</dd>
        </div>
        <div>
          <dt>凭据读取</dt>
          <dd>{view?.credentialsRead ?? false ? '边界异常' : '未读取凭据'}</dd>
        </div>
      </dl>

      {view ? (
        <div className="rehearsal-status" aria-live="polite">
          <strong>{STATUS_LABELS[view.state]}</strong>
          <small>状态码：{view.state}</small>
          <small>尝试ID：{view.authorizationAttemptId}</small>
          <small>
            配置版本：{view.configVersion} · 状态版本：{view.rowVersion}
          </small>
          <small>
            创建：{displayTime(view.requestedAt)} ·
            更新：{displayTime(view.changedAt)} ·
            到期：{displayTime(view.expiresAt)}
          </small>
          {view.terminalAt
            ? <small>终止：{displayTime(view.terminalAt)}</small>
            : null}
          {view.replayed
            ? <small>本次响应为同一幂等请求的安全重放。</small>
            : null}
        </div>
      ) : (
        <div className="state-panel">
          尚未创建离线授权演练尝试。开始操作只会登记本地状态。
        </div>
      )}

      <label className="rehearsal-reason">
        演练原因码
        <input
          disabled={!canConfigure || workingAction !== ''}
          pattern="[A-Z][A-Z0-9_]{2,63}"
          value={reasonCode}
          onChange={(event) =>
            setReasonCode(event.target.value.toUpperCase())}
        />
      </label>

      <div className="rehearsal-actions">
        {!view ? (
          <button
            disabled={!canConfigure || workingAction !== '' || configVersion < 0}
            type="button"
            onClick={start}
          >
            {workingAction === 'start'
              ? '正在创建离线演练…'
              : '创建离线授权演练'}
          </button>
        ) : null}
        {view ? (
          <button
            className="secondary"
            disabled={workingAction !== ''}
            type="button"
            onClick={refresh}
          >
            {workingAction === 'refresh' ? '正在刷新…' : '刷新本地状态'}
          </button>
        ) : null}
        {waiting ? (
          <>
            <button
              disabled={!canConfigure || workingAction !== ''}
              type="button"
              onClick={() => transition('confirm')}
            >
              {workingAction === 'confirm'
                ? '正在确认演练…'
                : '确认离线演练步骤完成'}
            </button>
            <button
              className="secondary"
              disabled={!canConfigure || workingAction !== ''}
              type="button"
              onClick={() => transition('cancel')}
            >
              {workingAction === 'cancel'
                ? '正在取消…'
                : '取消离线演练'}
            </button>
          </>
        ) : null}
        {terminal ? (
          <button
            disabled={!canConfigure || workingAction !== ''}
            type="button"
            onClick={() => transition('reauthenticate')}
          >
            {workingAction === 'reauthenticate'
              ? '正在创建新演练…'
              : '创建重新认证演练'}
          </button>
        ) : null}
      </div>

      {!canConfigure
        ? <p className="muted">当前角色只能查看离线安全边界，不能改变演练状态。</p>
        : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {notice ? <p className="success-note">{notice}</p> : null}
    </section>
  )
}
