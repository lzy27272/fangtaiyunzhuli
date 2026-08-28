import { useEffect, useState } from 'react'
import {
  loadLuopanBrowserConfig,
  saveLuopanBrowserConfig,
  triggerLiveCollection,
  validateLuopanBrowserConfig,
  type HotelContext,
  type LuopanBrowserConfigView,
} from '../api/business'

interface Props {
  context: HotelContext
  canConfigure: boolean
  onStatusChanged?: () => void
}

const PROFILE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/

const guidanceFor = (code: string | null | undefined) => {
  switch (code) {
    case 'LUOPAN_REAUTH_REQUIRED':
      return '门店登录会话已失效。请重新打开隔离浏览器，用该门店账号登录后再次验证。'
    case 'LUOPAN_HOTEL_SCOPE_AMBIGUOUS':
      return '当前账号可选择多个门店，已停止采集。请改用只有一个门店权限的账号。'
    case 'LUOPAN_HOTEL_SCOPE_CHANGED':
      return '登录会话对应的门店已变化，已停止采集。请重新登录正确门店并验证。'
    case 'LUOPAN_BUSINESS_DATE_UNAVAILABLE':
      return '未能从罗盘云确认PMS营业日，已停止生成简报。请登录后台检查夜审状态。'
    case 'LUOPAN_BROWSER_PROFILE_NOT_FOUND':
      return '后台运行环境中不存在该浏览器会话引用。请先在同一运行环境完成门店账号授权。'
    case 'LUOPAN_BROWSER_NOT_FOUND':
      return '后台运行环境未配置受控浏览器，暂时不能执行罗盘云采集。'
    case 'LUOPAN_BROWSER_RUNTIME_UNAVAILABLE':
      return '后台运行环境缺少受控浏览器运行时，配置可保存，但暂时不能执行采集。'
    case 'LUOPAN_SESSION_VALIDATION_REQUIRED':
      return '启用前必须先完成单门店会话验证。'
    default:
      return code
        ? `罗盘云采集失败：${code}。请核对会话并重新验证。`
        : ''
  }
}

export function LuopanBrowserConfigPanel({
  context,
  canConfigure,
  onStatusChanged,
}: Props) {
  const [config, setConfig] = useState<LuopanBrowserConfigView | null>(null)
  const [profileRef, setProfileRef] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const applyConfig = (next: LuopanBrowserConfigView) => {
    setConfig(next)
    setProfileRef(next.profileRef)
    setEnabled(next.enabled)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setNotice('')
    loadLuopanBrowserConfig(context)
      .then((next) => {
        if (!cancelled) applyConfig(next)
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : '读取罗盘云配置失败',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [context])

  const validProfile = PROFILE_PATTERN.test(profileRef)
  const profileChanged = profileRef !== (config?.profileRef ?? '')

  async function save() {
    if (!canConfigure || !config) return
    setError('')
    setNotice('')
    if (!validProfile) {
      setError('浏览器会话引用只能使用小写字母、数字、短横线或下划线。')
      return
    }
    if (
      enabled
      && (
        profileChanged
        || config.scopeStatus !== 'SINGLE_HOTEL_CONFIRMED'
      )
    ) {
      setError('会话引用变化后必须先保存并验证，确认单一门店后才能启用。')
      return
    }
    setWorking(true)
    try {
      const next = await saveLuopanBrowserConfig(context, {
        enabled,
        profileRef,
        rowVersion: config.rowVersion,
      })
      applyConfig(next)
      if (!next.enabled) {
        setNotice('罗盘云后台采集配置已保存；当前未启用，因此未执行自动采集。')
        return
      }
      try {
        const run = await triggerLiveCollection(context)
        const refreshed = await loadLuopanBrowserConfig(context)
        applyConfig(refreshed)
        setNotice(
          `罗盘云配置已保存并自动采集一次：`
          + `${run.successfulSourceCount}/${run.sourceCount}个数据来源可用，`
          + `结果为${run.status === 'PARTIAL' ? '部分形成' : '完整'}。`,
        )
      } catch (collectionCause) {
        const refreshed = await loadLuopanBrowserConfig(context)
          .catch(() => null)
        if (refreshed) applyConfig(refreshed)
        const code =
          refreshed?.lastErrorCode
          ?? (
            collectionCause instanceof Error
              ? collectionCause.message
              : null
          )
        setNotice('罗盘云配置已保存，但保存后的自动采集未完成。')
        setError(guidanceFor(code))
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '保存罗盘云配置失败',
      )
    } finally {
      setWorking(false)
      onStatusChanged?.()
    }
  }

  async function validate() {
    if (!canConfigure || !config) return
    setError('')
    setNotice('')
    if (!validProfile) {
      setError('请先填写有效的浏览器会话引用。')
      return
    }
    setWorking(true)
    try {
      let current = config
      if (profileChanged || config.enabled) {
        current = await saveLuopanBrowserConfig(context, {
          enabled: false,
          profileRef,
          rowVersion: config.rowVersion,
        })
        applyConfig(current)
      }
      const validated = await validateLuopanBrowserConfig(context)
      applyConfig(validated)
      setNotice(
        `单门店会话验证通过，PMS营业日为${
          validated.lastBusinessDate ?? '已确认'
        }。`,
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? guidanceFor(cause.message)
          : '验证罗盘云会话失败',
      )
    } finally {
      setWorking(false)
      onStatusChanged?.()
    }
  }

  async function collect() {
    if (!config?.enabled) return
    setError('')
    setNotice('')
    setWorking(true)
    try {
      const run = await triggerLiveCollection(context)
      const refreshed = await loadLuopanBrowserConfig(context)
      applyConfig(refreshed)
      setNotice(
        `已采集并生成${run.status === 'PARTIAL' ? '部分' : '完整'}简报：`
          + `${run.successfulSourceCount}/${run.sourceCount}个数据来源可用。`,
      )
    } catch (cause) {
      const refreshed = await loadLuopanBrowserConfig(context)
        .catch(() => null)
      if (refreshed) applyConfig(refreshed)
      const code =
        refreshed?.lastErrorCode
        ?? (cause instanceof Error ? cause.message : null)
      setError(guidanceFor(code))
    } finally {
      setWorking(false)
      onStatusChanged?.()
    }
  }

  return (
    <article
      className="report-source-card luopan-browser-card"
      id="luopan-browser-config-panel"
    >
      <header>
        <div>
          <span>LUOPAN CLOUD</span>
          <strong>罗盘云单门店受控采集</strong>
          <small>按旺季/节假日与普通日期的动态时段采集；末班01:00</small>
        </div>
        <span className="mode-chip">
          {config?.scopeStatus === 'SINGLE_HOTEL_CONFIRMED'
            ? config.enabled ? '单店已启用' : '单店已验证'
            : '等待验证'}
        </span>
      </header>

      <p>
        后台复用人工登录后的隔离浏览器会话，读取PMS营业日、房态预测、
        可售、已售、出租率、ADR和预计房费。检测到集团多门店账号、
        门店指纹变化或登录失效时将停止采集，不会生成虚假简报。
      </p>

      {loading ? <div className="state-panel">正在读取罗盘云配置…</div> : null}
      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <div className="success" role="status">{notice}</div> : null}

      <div className="report-source-form">
        <label className="wide-field">
          罗盘云登录地址
          <input
            disabled
            value={config?.portalUrl ?? ''}
          />
        </label>
        <label>
          浏览器会话引用
          <input
            disabled={!canConfigure || working}
            placeholder="例如 store-account-test"
            value={profileRef}
            onChange={(event) => {
              setProfileRef(event.target.value.trim().toLowerCase())
              setEnabled(false)
              setNotice('')
            }}
          />
        </label>
        <label>
          轮询间隔
          <select disabled value={30}>
            <option value={30}>30分钟</option>
          </select>
        </label>
        <label className="inline-toggle">
          <input
            checked={enabled}
            disabled={
              !canConfigure
              || working
              || profileChanged
              || config?.scopeStatus !== 'SINGLE_HOTEL_CONFIRMED'
            }
            type="checkbox"
            onChange={(event) => setEnabled(event.target.checked)}
          />
          启用罗盘云作为当前门店主采集来源
        </label>
      </div>

      <div className="security-note report-source-note">
        会话范围：
        {config?.scopeStatus === 'SINGLE_HOTEL_CONFIRMED'
          ? '已确认仅一个门店'
          : '尚未验证'}
        ；最后营业日：{config?.lastBusinessDate ?? '—'}
        ；最后采集：{config?.lastCollectionStatus ?? 'NEVER'}
        {config?.lastErrorCode
          ? `（${config.lastErrorCode}）`
          : ''}
        。订单渠道明细尚未接入，简报会明确标记为不可用。
      </div>

      <div className="button-row">
        <button
          className="secondary"
          disabled={!canConfigure || working || !config}
          type="button"
          onClick={() => void save()}
        >
          保存并自动采集一次
        </button>
        <button
          className="secondary"
          disabled={!canConfigure || working || !config || !validProfile}
          type="button"
          onClick={() => void validate()}
        >
          验证单门店会话
        </button>
        <button
          disabled={
            !canConfigure
            || working
            || !config?.enabled
            || config.scopeStatus !== 'SINGLE_HOTEL_CONFIRMED'
          }
          type="button"
          onClick={() => void collect()}
        >
          立即采集并生成简报
        </button>
        {config?.portalUrl ? (
          <a
            className="button-link secondary"
            href={config.portalUrl}
            rel="noreferrer"
            target="_blank"
          >
            打开罗盘云后台
          </a>
        ) : null}
      </div>
    </article>
  )
}
