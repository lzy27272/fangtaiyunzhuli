import { useEffect, useRef, useState } from 'react'
import {
  loadPmsCookieBindingStatus,
  triggerLiveCollection,
  validateAndUpdatePmsCookie,
  type HotelContext,
  type PmsCookieValidationView,
  type PmsCookieBindingStatusView,
} from '../api/business'
import { businessErrorMessage } from '../ui/businessDisplay'

interface Props {
  context: HotelContext
  hotelCode: string
  canSubmit?: boolean
  onStatusChanged: () => void | Promise<void>
}

const MAX_COOKIE_LENGTH = 16 * 1024

export function BieyanghongCookieRepairPanel({
  context,
  hotelCode,
  canSubmit = true,
  onStatusChanged,
}: Props) {
  const [cookieDraft, setCookieDraft] = useState('')
  const [validation, setValidation] =
    useState<PmsCookieValidationView | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [binding, setBinding] = useState<PmsCookieBindingStatusView | null>(null)
  const [bindingLoading, setBindingLoading] = useState(true)
  const [expectedPmsHotelId, setExpectedPmsHotelId] = useState('')
  const [identityConfirmed, setIdentityConfirmed] = useState(false)
  const [progress, setProgress] = useState('')
  const scopeSequence = useRef(0)

  useEffect(() => {
    const sequence = ++scopeSequence.current
    setCookieDraft('')
    setValidation(null)
    setError('')
    setNotice('')
    setBinding(null)
    setBindingLoading(true)
    setExpectedPmsHotelId('')
    setIdentityConfirmed(false)
    setSubmitting(false)
    setProgress('')
    loadPmsCookieBindingStatus(context).then((status) => {
      if (scopeSequence.current === sequence) setBinding(status)
    }).catch((cause) => {
      if (scopeSequence.current === sequence) setError(businessErrorMessage(cause, '读取本店授权状态失败，请刷新授权状态后重试。'))
    }).finally(() => {
      if (scopeSequence.current === sequence) setBindingLoading(false)
    })
    return () => { scopeSequence.current += 1 }
  }, [context])

  const initialSetup = binding?.status === 'NOT_BOUND' && binding.firstTimeSetupRequired
  const hourlyCollectionEnabled = Boolean(binding?.collectionEnabled && binding.automaticHourlyCollectionEnabled)
  const identityValid = /^[1-9][0-9]{0,63}$/u.test(expectedPmsHotelId.trim())
  const blocked = binding?.status === 'CONFLICT' || (initialSetup && !binding.canInitialize)
  const ready = canSubmit && Boolean(binding) && !bindingLoading && !submitting && !blocked
    && Boolean(cookieDraft.trim()) && (!initialSetup || (identityValid && identityConfirmed))

  async function refreshBinding() {
    if (submitting || bindingLoading) return
    const sequence = scopeSequence.current
    setBindingLoading(true)
    setError('')
    try {
      const status = await loadPmsCookieBindingStatus(context)
      if (scopeSequence.current === sequence) {
        setBinding(status)
        setIdentityConfirmed(false)
      }
    } catch (cause) {
      if (scopeSequence.current === sequence) setError(businessErrorMessage(cause, '读取本店授权状态失败，请刷新授权状态后重试。'))
    } finally {
      if (scopeSequence.current === sequence) setBindingLoading(false)
    }
  }

  async function repairWithCookie() {
    if (!ready || !binding) return
    const sequence = scopeSequence.current
    let cookieHeader = cookieDraft.trim()
    setError('')
    setNotice('')
    setValidation(null)
    if (
      !cookieHeader
      || cookieHeader.length > MAX_COOKIE_LENGTH
      || /[\r\n\u0000]/u.test(cookieHeader)
      || /^cookie\s*:/iu.test(cookieHeader)
    ) {
      setError('请只粘贴 Cookie 原文，不要包含“Cookie:”前缀、换行或空字符。')
      return
    }

    setSubmitting(true)
    setCookieDraft('')
    setProgress(initialSetup ? '正在核对本店身份并验证只读接口…' : '正在验证本店只读接口…')
    let authorizationSaved = false
    let statusRefreshed = false
    try {
      const nextValidation = await validateAndUpdatePmsCookie(
        context,
        cookieHeader,
        initialSetup ? {
          independentExpectedPmsHotelId: expectedPmsHotelId.trim(),
          confirmStoreIdentity: true,
          expectedRowVersion: binding.hotelRowVersion,
        } : undefined,
      )
      if (scopeSequence.current !== sequence) return
      authorizationSaved = true
      setValidation(nextValidation)
      setProgress('授权已加密保存，正在执行本店采集…')
      const collection = await triggerLiveCollection(context)
      if (scopeSequence.current !== sequence) return
      if (collection.status !== 'SUCCEEDED' || collection.sourceCount < 1
        || collection.successfulSourceCount !== collection.sourceCount) {
        throw new Error('PMS_INITIAL_COLLECTION_INCOMPLETE')
      }
      const current = await loadPmsCookieBindingStatus(context)
      if (scopeSequence.current !== sequence) return
      setBinding(current)
      statusRefreshed = true
      setNotice(`本店采集已通过：${collection.successfulSourceCount}/${collection.sourceCount} 个来源可用。`
        + (current.collectionEnabled && current.automaticHourlyCollectionEnabled ? '每小时自动采集已开启。'
          : current.collectionEnabled ? '本店允许采集，但系统定时任务未启用，请联系平台管理员核对。'
            : '当前采集仍暂停，请核对门店采集状态。'))
    } catch (cause) {
      if (scopeSequence.current !== sequence) return
      if (authorizationSaved) setNotice('本店授权已验证并加密保存。')
      setError(businessErrorMessage(cause, authorizationSaved
        ? '授权已保存，但本次采集或状态确认未完成；尚不能确认自动采集已开启，请检查后重试。'
        : '本次授权结果未确认，请刷新授权状态核对；不要反复提交或更换门店。'))
    } finally {
      cookieHeader = ''
      if (authorizationSaved && scopeSequence.current === sequence) {
        if (!statusRefreshed) try {
          const current = await loadPmsCookieBindingStatus(context)
          if (scopeSequence.current === sequence) setBinding(current)
        } catch { /* The result above remains visible if status refresh fails. */ }
        if (scopeSequence.current === sequence) {
          try { await onStatusChanged() } catch {
            if (scopeSequence.current === sequence) setError('授权已保存，但页面状态未能刷新；请点击“刷新授权状态”核对。')
          }
        }
      }
      if (scopeSequence.current === sequence) {
        setSubmitting(false)
        setProgress('')
      }
    }
  }

  return (
    <article className="report-source-card pms-login-card pms-cookie-validation-card">
      <header>
        <div>
          <span>{hotelCode} · 云端 Cookie 修复</span>
          <strong>{initialSetup ? '首次授权并开启自动采集' : '验证 Cookie 并恢复采集'}</strong>
        </div>
        <span className="mode-chip">无需安装软件</span>
      </header>
      <p>
        粘贴当前 {hotelCode} 门店的 Cookie 后，服务器只读取营业日和本店已配置报表。
        全部验证通过才会加密替换并立即采集；失败保留旧 Cookie，不影响其他门店。
      </p>
      <div className="report-source-form">
        {bindingLoading ? <p className="wide-field" role="status">正在读取本店授权状态…</p> : null}
        {binding?.status === 'BOUND' ? <p className="wide-field">已确认美团门店编号：{binding.expectedPmsHotelId}；{hourlyCollectionEnabled ? '每小时自动采集已启用'
          : binding.collectionEnabled ? '本店允许采集，但系统定时任务未启用'
            : '采集仍暂停，需完成本店试采'}。</p> : null}
        {blocked ? <p className="wide-field field-error" role="alert">{binding?.status === 'CONFLICT'
          ? '本店已有授权记录存在身份冲突，不能覆盖绑定。请联系平台管理员核对。'
          : '当前门店暂不能首次授权，可能有验证任务正在处理。请稍后刷新授权状态，或联系平台管理员核对。'}</p> : null}
        {initialSetup && binding.canInitialize ? <>
          <p className="wide-field">首次接入：先在 <a href="https://pms.meituan.com/" target="_blank" rel="noreferrer">美团 PMS 官网</a> 登录并切到 {hotelCode} · {binding.hotelName}，核对官网门店名称和编号。请勿从 Cookie 猜测编号或使用其他门店授权。</p>
          <label className="wide-field">
            美团 PMS 官网门店编号（不是后台门店编号 {hotelCode}）
            <input inputMode="numeric" autoComplete="off" maxLength={64} disabled={!canSubmit || submitting}
              value={expectedPmsHotelId} placeholder="填写从官网独立核对的门店编号"
              onChange={(event) => { setExpectedPmsHotelId(event.target.value); setIdentityConfirmed(false); setError('') }} />
          </label>
          <label className="wide-field initial-pms-identity-confirm">
            <input type="checkbox" disabled={!canSubmit || submitting} checked={identityConfirmed}
              onChange={(event) => setIdentityConfirmed(event.target.checked)} />
            我已独立核对官网门店名称和编号，确认对应 {hotelCode} · {binding.hotelName}，并授权接入本店数据
          </label>
        </> : null}
        <label className="wide-field cookie-field">
          PMS Cookie 原文
          <input
            autoComplete="off"
            disabled={!canSubmit || submitting || bindingLoading || !binding || Boolean(blocked)}
            maxLength={MAX_COOKIE_LENGTH}
            placeholder="粘贴 Cookie 原文；不要包含 Cookie: 前缀"
            type="password"
            value={cookieDraft}
            onChange={(event) => {
              setCookieDraft(event.target.value)
              setError('')
              setNotice('')
              setValidation(null)
            }}
          />
          <small>内容只用于本次本店验证，提交后立即清空，后台不会回显原文。</small>
        </label>
        <details className="wide-field">
          <summary>如何获取本店授权 Cookie？</summary>
          <p>在美团 PMS 官网确认当前门店后，打开开发者工具的“网络 / Network”，刷新页面，选择本店 PMS 报表请求，在“请求标头 / Request Headers”复制 Cookie 的值，仅粘贴到上方输入框。不要复制“Cookie:”前缀，不要发送到聊天或群里。</p>
          <p>自动采集使用加密保存的会话；Cookie 过期后仍需在本页更新，不代表永久免登录。</p>
        </details>
        {binding && !binding.roomForecastConfigured ? <p className="wide-field inline-message info">本次先接通订单、实体库存和经营概览。远期分房型预测尚未配置，远期播报与依赖它的热销预警暂未就绪，不会发送缺失数据的远期播报。</p> : null}
      </div>
      <footer>
        <span>{progress || (!canSubmit ? '需要平台管理员配置本店授权。'
          : bindingLoading ? '正在读取本店授权状态，请稍候。'
            : !binding ? '请先刷新授权状态，读取成功后再提交。'
              : initialSetup && !identityValid ? '请先填写从美团官网核对的门店编号。'
          : initialSetup && !identityConfirmed ? '请勾选确认本店身份，再提交授权。'
            : hourlyCollectionEnabled ? '每小时自动采集已启用；仅在会话失效时更新本店 Cookie。'
              : binding.collectionEnabled ? '本店允许采集，但系统定时任务未启用，请联系平台管理员核对。'
              : !cookieDraft.trim() ? '请粘贴本店 Cookie，授权和试采通过后才能开启采集。'
            : '仅验证和采集本店，不主动补发播报；需要补发时请到“播报记录”确认。')}</span>
        <button className="secondary" type="button" disabled={submitting || bindingLoading} onClick={() => void refreshBinding()}>刷新授权状态</button>
        <button
          disabled={!ready}
          type="button"
          onClick={() => void repairWithCookie()}
        >
          {submitting ? '正在验证并采集…' : initialSetup ? '验证授权并开启自动采集' : '验证 Cookie 并恢复采集'}
        </button>
      </footer>
      {validation ? (
        <p className="success-note" role="status">
          Cookie 验证通过：{validation.successfulSourceCount}/
          {validation.sourceCount} 个只读来源可用，PMS 营业日
          {' '}{validation.businessDate}。
        </p>
      ) : null}
      {notice ? <p className="success-note" role="status">{notice}</p> : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </article>
  )
}
