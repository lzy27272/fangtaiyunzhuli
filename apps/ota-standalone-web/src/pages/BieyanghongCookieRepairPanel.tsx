import { useEffect, useState } from 'react'
import {
  triggerLiveCollection,
  validateAndUpdatePmsCookie,
  type HotelContext,
  type PmsCookieValidationView,
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

  useEffect(() => {
    setCookieDraft('')
    setValidation(null)
    setError('')
    setNotice('')
  }, [context.hotelId])

  async function repairWithCookie() {
    if (!canSubmit || submitting) return
    const cookieHeader = cookieDraft.trim()
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
    try {
      const nextValidation = await validateAndUpdatePmsCookie(
        context,
        cookieHeader,
      )
      setCookieDraft('')
      setValidation(nextValidation)
      try {
        const collection = await triggerLiveCollection(context)
        setNotice(
          `Cookie 已加密更新并完成本店采集：${collection.successfulSourceCount}`
          + `/${collection.sourceCount} 个来源可用。播报将按原有规则自动恢复。`,
        )
      } catch (cause) {
        setNotice('Cookie 已验证并加密更新。')
        setError(
          businessErrorMessage(
            cause,
            'Cookie 已保存，但本次立即采集未完成；系统会按计划自动重试',
          ),
        )
      }
      await onStatusChanged()
    } catch (cause) {
      setCookieDraft('')
      setError(
        businessErrorMessage(cause, 'Cookie 验证失败；旧 Cookie 未被覆盖'),
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <article className="report-source-card pms-login-card pms-cookie-validation-card">
      <header>
        <div>
          <span>{hotelCode} · 云端 Cookie 修复</span>
          <strong>验证 Cookie 并恢复采集</strong>
        </div>
        <span className="mode-chip">无需安装软件</span>
      </header>
      <p>
        粘贴当前 {hotelCode} 门店的 Cookie 后，服务器只读取营业日和本店已配置报表。
        全部验证通过才会加密替换并立即采集；失败保留旧 Cookie，不影响其他门店。
      </p>
      <div className="report-source-form">
        <label className="wide-field cookie-field">
          PMS Cookie 原文
          <input
            autoComplete="off"
            disabled={!canSubmit || submitting}
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
      </div>
      <footer>
        <span>采集恢复后继续沿用原播报时间与去重规则；需要补发时请到“播报记录”确认。</span>
        <button
          disabled={!canSubmit || submitting || !cookieDraft.trim()}
          type="button"
          onClick={() => void repairWithCookie()}
        >
          {submitting ? '正在验证并采集…' : '验证 Cookie 并恢复采集'}
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
