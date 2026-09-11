import { useCallback, useEffect, useState } from 'react'
import {
  loadLuopanBrowserRepair,
  loadPmsLoginConfig,
  loadYilianCloudRepair,
  savePmsLoginConfig,
  startLuopanQuickRepair,
  submitLuopanQuickRepairCaptcha,
  triggerYilianCloudRepair,
  type HotelContext,
  type LuopanBrowserRepairView,
  type PmsSystemCode,
  type YilianCloudRepairView,
} from '../api/business'
import { loadTrustedDeviceStatus } from '../api/trustedDevice'
import { Icon, LoadingState, Status } from '../components/ConsoleUi'
import { TrustedDevicePanel } from './TrustedDevicePanel'
import { BieyanghongCookieRepairPanel } from './BieyanghongCookieRepairPanel'
import {
  businessCodeLabel,
  businessErrorMessage,
  businessReadFailureSummary,
} from '../ui/businessDisplay'

interface Props {
  context: HotelContext
  hotelCode: string
  pmsSystemCode: PmsSystemCode
  canConfigure: boolean
  onStatusChanged: () => void
}

const formatTime = (value: string | null): string =>
  value ? new Date(value).toLocaleString('zh-CN') : '尚未完成'

const yilianStatusLabel = (state: YilianCloudRepairView['state']): string => ({
  DISABLED: '自动修复已停用',
  CREDENTIALS_REQUIRED: '等待录入账号密码',
  IDLE: '等待首次验证',
  RUNNING: '正在云端重登',
  SUCCEEDED: '云端重登可用',
  HUMAN_AUTHORIZATION_REQUIRED: '等待人工授权',
  FAILED: '最近修复失败',
})[state]

const luopanQuickRepairStatusLabel = (
  state: LuopanBrowserRepairView['quickRepair']['state'],
): string => ({
  IDLE: '等待发起',
  PREPARING: '正在打开罗盘',
  WAITING_FOR_CAPTCHA: '等待验证码',
  SUBMITTED: '验证码已提交',
  VERIFYING: '正在验证并恢复',
  COMPLETE: '快速修复完成',
  FAILED: '本次修复未完成',
  EXPIRED: '验证码已过期',
})[state]

const luopanQuickRepairActive = (
  state: LuopanBrowserRepairView['quickRepair']['state'] | undefined,
) => Boolean(state && [
  'PREPARING',
  'WAITING_FOR_CAPTCHA',
  'SUBMITTED',
  'VERIFYING',
].includes(state))

export function StoreRepairPanel({
  context,
  hotelCode,
  pmsSystemCode,
  canConfigure,
  onStatusChanged,
}: Props) {
  const [trustedDeviceEligible, setTrustedDeviceEligible] = useState<boolean | null>(null)
  const [pmsConfigured, setPmsConfigured] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [luopan, setLuopan] = useState<LuopanBrowserRepairView | null>(null)
  const [yilian, setYilian] = useState<YilianCloudRepairView | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [validating, setValidating] = useState(false)
  const [quickRepairing, setQuickRepairing] = useState(false)
  const [submittingCaptcha, setSubmittingCaptcha] = useState(false)
  const [captcha, setCaptcha] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    if (pmsSystemCode === 'OTHER') {
      setTrustedDeviceEligible(false)
      setPmsConfigured(false)
      setLuopan(null)
      setYilian(null)
      setLoading(false)
      return
    }
    const [trustedResult, pmsResult, luopanResult, yilianResult] = await Promise.allSettled([
      loadTrustedDeviceStatus(context),
      loadPmsLoginConfig(context),
      pmsSystemCode === 'LUOPAN_CLOUD'
        ? loadLuopanBrowserRepair(context)
        : Promise.resolve(null),
      pmsSystemCode === 'YILIAN_CLOUD'
        ? loadYilianCloudRepair(context)
        : Promise.resolve(null),
    ])
    setTrustedDeviceEligible(
      trustedResult.status === 'fulfilled' ? trustedResult.value.eligible : false,
    )
    setPmsConfigured(
      pmsResult.status === 'fulfilled' && pmsResult.value.configured,
    )
    setLuopan(luopanResult.status === 'fulfilled' ? luopanResult.value : null)
    setYilian(yilianResult.status === 'fulfilled' ? yilianResult.value : null)
    const requestedResults = [
      trustedResult,
      pmsResult,
      ...(pmsSystemCode === 'LUOPAN_CLOUD' ? [luopanResult] : []),
      ...(pmsSystemCode === 'YILIAN_CLOUD' ? [yilianResult] : []),
    ]
    const failures = requestedResults.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [])
    if (failures.length) {
      const reason = businessReadFailureSummary(
        failures,
        '请刷新后重试；若持续出现，请联系管理员查看服务状态',
      )
      setError(
        failures.length === requestedResults.length
          ? `登录修复状态无法读取：${reason}。`
          : `部分登录修复状态读取失败：${reason}。`,
      )
    } else if (
      yilianResult.status === 'fulfilled'
      && yilianResult.value
      && ['FAILED', 'HUMAN_AUTHORIZATION_REQUIRED'].includes(yilianResult.value.state)
    ) {
      setError(`最近一次云端登录修复未完成：${businessCodeLabel(
        yilianResult.value.lastErrorCode,
        '请重新检查驿联云登录与接口配置',
      )}。`)
    }
    setLoading(false)
  }, [context, pmsSystemCode])

  useEffect(() => {
    setUsername('')
    setPassword('')
    setCaptcha('')
    setNotice('')
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (
      pmsSystemCode !== 'LUOPAN_CLOUD'
      || !luopanQuickRepairActive(luopan?.quickRepair.state)
    ) return undefined
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const pollingContext = {
      tenantId: context.tenantId,
      hotelId: context.hotelId,
    }
    const poll = async () => {
      try {
        const next = await loadLuopanBrowserRepair(pollingContext)
        if (!cancelled) {
          setLuopan(next)
          if (next.quickRepair.state === 'COMPLETE') {
            setNotice('罗盘登录、采集和恢复流程已完成。')
          } else if (next.quickRepair.state === 'FAILED') {
            setError(businessCodeLabel(
              next.quickRepair.reasonCode,
              '本次快速修复未完成，请检查后重新发起',
            ))
          }
        }
      } catch (cause) {
        if (!cancelled) {
          setError(businessErrorMessage(cause, '刷新快速修复状态失败'))
        }
      }
      if (!cancelled) timer = setTimeout(poll, 2_000)
    }
    timer = setTimeout(poll, 2_000)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [
    context.hotelId,
    context.tenantId,
    luopan?.quickRepair.state,
    pmsSystemCode,
  ])

  async function saveRepairCredentials() {
    const normalizedUsername = username.trim()
    if (
      !normalizedUsername
      || !password
      || /[\r\n\u0000]/u.test(normalizedUsername)
      || /[\r\n\u0000]/u.test(password)
    ) {
      setError('请完整填写账号和密码，且不能包含换行或空字符。')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const saved = await savePmsLoginConfig(context, {
        action: 'REPLACE',
        username: normalizedUsername,
        password,
      })
      setPmsConfigured(saved.configured)
      if (pmsSystemCode === 'YILIAN_CLOUD') {
        setYilian(await loadYilianCloudRepair(context))
      }
      setUsername('')
      setPassword('')
      setNotice('修复凭据已安全提交，输入内容已清空且不会回显。')
      onStatusChanged()
    } catch (cause) {
      setError(businessErrorMessage(cause, '修复凭据提交失败'))
    } finally {
      setSaving(false)
    }
  }

  async function repairYilianSession() {
    setValidating(true)
    setError('')
    setNotice('')
    try {
      const next = await triggerYilianCloudRepair(context)
      setYilian(next)
      if (next.state === 'SUCCEEDED') {
        setNotice('云端重登及三个接口的只读影子采集均已通过，新令牌已加密更新；本次未触发播报。')
        onStatusChanged()
      } else if (next.state === 'HUMAN_AUTHORIZATION_REQUIRED') {
        setError(businessErrorMessage(
          new Error(
            next.lastErrorCode ?? 'YILIAN_HUMAN_AUTHORIZATION_REQUIRED',
          ),
          '厂家要求人工确认，自动重试已停止，请先在驿联云官网完成授权',
        ))
      } else {
        setError(businessErrorMessage(
          new Error(next.lastErrorCode ?? 'YILIAN_AUTO_REAUTH_FAILED'),
          '云端重登未完成，旧令牌与接口配置均已保留',
        ))
      }
    } catch (cause) {
      setError(businessErrorMessage(cause, '云端重登未完成，旧令牌与接口配置均已保留'))
    } finally {
      setValidating(false)
    }
  }

  async function beginLuopanQuickRepair() {
    setQuickRepairing(true)
    setError('')
    setNotice('')
    setCaptcha('')
    try {
      const next = await startLuopanQuickRepair(context)
      setLuopan(next)
      if (next.quickRepair.state === 'WAITING_FOR_CAPTCHA') {
        setNotice(next.quickRepair.managerNotificationReady
          ? `验证码已私聊${next.quickRepair.managerRecipientCount}位企业管理员，也可直接在本页填写。`
          : '验证码已生成，可在本页填写；已配置的群修复链接仍可使用。')
      } else if (next.quickRepair.state === 'FAILED') {
        setError(businessCodeLabel(
          next.quickRepair.reasonCode,
          '快速修复未能启动，请检查罗盘配置和企业管理员绑定',
        ))
      } else {
        setNotice('快速修复已启动，系统正在检查罗盘登录状态。')
      }
    } catch (cause) {
      setError(businessErrorMessage(cause, '快速修复未能启动'))
    } finally {
      setQuickRepairing(false)
    }
  }

  async function submitLuopanCaptcha() {
    const answer = captcha.trim()
    if (!/^[a-zA-Z0-9]{4,8}$/u.test(answer)) {
      setError('请输入图片中的4至8位字母或数字。')
      return
    }
    setSubmittingCaptcha(true)
    setError('')
    setNotice('')
    try {
      const next = await submitLuopanQuickRepairCaptcha(context, answer)
      setCaptcha('')
      setLuopan(next)
      setNotice('验证码已安全提交，系统正在验证、重新采集并恢复简报。')
    } catch (cause) {
      setError(businessErrorMessage(cause, '验证码提交失败，请刷新状态后重试'))
    } finally {
      setSubmittingCaptcha(false)
    }
  }

  if (loading) return <LoadingState label="正在读取登录修复状态…" />

  if (pmsSystemCode === 'OTHER') {
    return (
      <section className="content-panel repair-access-intro">
        <span className="role-icon"><Icon name="settings" /></span>
        <div>
          <h2>PMS 厂家待接入</h2>
          <p>该门店已登记其他 PMS 厂家。完成厂家适配、接口校验和单店数据验证后，系统才会开放登录修复与采集。</p>
        </div>
        <Status tone="warning">待适配</Status>
      </section>
    )
  }

  if (pmsSystemCode === 'YILIAN_CLOUD') {
    return (
      <div className="repair-access-layout">
        <section className="content-panel repair-access-intro">
          <span className="role-icon"><Icon name="shield" /></span>
          <div>
            <h2>驿联云云端登录修复</h2>
            <p>令牌失效后，服务器用本店加密保存的账号密码在临时无痕浏览器登录官网；三个接口全部通过后才原子更新令牌并恢复采集。</p>
          </div>
          <Status tone={yilian?.state === 'SUCCEEDED' ? 'ok' : yilian?.state === 'HUMAN_AUTHORIZATION_REQUIRED' || yilian?.state === 'FAILED' ? 'warning' : 'info'}>
            {yilian ? yilianStatusLabel(yilian.state) : '状态不可用'}
          </Status>
        </section>
        <section className="content-panel repair-credential-card">
          <div className="section-heading small">
            <div>
              <h2>云端自动登录凭据</h2>
              <p>账号密码只加密保存在服务端，不会回显，也不会写入接口地址或日志。</p>
            </div>
            <Status tone={pmsConfigured ? 'ok' : 'warning'}>{pmsConfigured ? '已安全配置' : '等待录入'}</Status>
          </div>
          <div className="report-source-form">
            <label>驿联云登录账号<input autoComplete="off" maxLength={256} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="登录账号或绑定手机号" /></label>
            <label>驿联云登录密码<input autoComplete="new-password" maxLength={4096} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入登录密码" /></label>
          </div>
          <div className="button-row">
            <button disabled={saving || !username.trim() || !password} type="button" onClick={() => void saveRepairCredentials()}>{saving ? '正在加密保存…' : pmsConfigured ? '更新账号密码' : '加密保存账号密码'}</button>
          </div>
        </section>
        <section className="content-panel repair-credential-card">
          <div className="section-heading small">
            <div><h2>登录失效自动恢复</h2><p>每次只处理当前门店；影子采集失败保留旧令牌和全部接口配置，不触发播报。</p></div>
            <Status tone={yilian?.active ? 'info' : yilian?.state === 'SUCCEEDED' ? 'ok' : 'warning'}>{yilian ? yilianStatusLabel(yilian.state) : '等待刷新'}</Status>
          </div>
          <dl className="review-list compact">
            <div><dt>最近尝试</dt><dd>{formatTime(yilian?.lastAttemptAt ?? null)}</dd></div>
            <div><dt>最近通过</dt><dd>{formatTime(yilian?.lastSucceededAt ?? null)}</dd></div>
            <div><dt>营业日</dt><dd>{yilian?.lastBusinessDate ?? '尚未确认'}</dd></div>
            <div><dt>接口校验</dt><dd>{yilian ? `${yilian.successfulSourceCount}/${yilian.sourceCount || 3}` : '尚未完成'}</dd></div>
            <div><dt>最近结果</dt><dd>{businessCodeLabel(yilian?.lastErrorCode, yilian?.state === 'SUCCEEDED' ? '三个接口均已通过' : '尚未完成首次验证')}</dd></div>
            <div><dt>企微管理员</dt><dd>{yilian?.managerNotificationReady ? `已连接 ${yilian.managerRecipientCount} 位；人工处理会立即私聊` : '尚未绑定；请先在播报设置中完成绑定'}</dd></div>
          </dl>
          <div className="button-row">
            <a className="button-link secondary" href={yilian?.portalUrl ?? 'https://pms.ygjpms.com/saas/#/login'} rel="noreferrer" target="_blank">打开驿联云官网</a>
            <button disabled={validating || yilian?.active || !pmsConfigured || yilian?.automationEnabled === false} type="button" onClick={() => void repairYilianSession()}>{validating || yilian?.active ? '正在登录并校验…' : '一键快速恢复'}</button>
          </div>
        </section>
        {notice ? <div className="inline-message success" role="status">{notice}</div> : null}
        {error ? <div className="inline-message error" role="alert">{error}</div> : null}
      </div>
    )
  }

  return (
    <div className="repair-access-layout">
      <section className="content-panel repair-access-intro">
        <span className="role-icon"><Icon name="shield" /></span>
        <div>
          <h2>
            {pmsSystemCode === 'MEITUAN_BIEYANGHONG'
              ? 'PMS Cookie 修复'
              : '登录修复'}
          </h2>
          <p>
            {pmsSystemCode === 'MEITUAN_BIEYANGHONG'
              ? '直接更新当前门店 Cookie 并恢复云端采集，无需下载安装门店软件；Cookie 不会在页面回显。'
              : '此页面只提供账号、密码和官方验证等修复操作，不显示采集网址、Cookie、接口参数或采集规则。'}
          </p>
        </div>
        <Status tone="ok">门店范围已校验</Status>
      </section>

      {trustedDeviceEligible ? (
        <TrustedDevicePanel
          canRevokeDevice={canConfigure}
          context={context}
          onStatusChanged={onStatusChanged}
        />
      ) : pmsSystemCode === 'MEITUAN_BIEYANGHONG' ? (
        <BieyanghongCookieRepairPanel
          context={context}
          hotelCode={hotelCode}
          onStatusChanged={onStatusChanged}
        />
      ) : (
        <section className="content-panel repair-credential-card">
          <div className="section-heading small">
            <div>
              <h2>酒店系统账号修复</h2>
              <p>仅用于重新建立当前门店登录；账号和密码不会在页面回显。</p>
            </div>
            <Status tone={pmsConfigured ? 'ok' : 'warning'}>
              {pmsConfigured ? '已提交修复凭据' : '等待填写'}
            </Status>
          </div>
          <div className="report-source-form">
            <label>酒店系统账号<input autoComplete="off" maxLength={256} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="请输入当前门店账号" /></label>
            <label>酒店系统密码<input autoComplete="new-password" maxLength={4096} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" /></label>
          </div>
          <div className="button-row">
            <button disabled={saving || !username.trim() || !password} type="button" onClick={() => void saveRepairCredentials()}>{saving ? '正在安全提交…' : '提交修复凭据'}</button>
          </div>
        </section>
      )}

      {pmsSystemCode === 'LUOPAN_CLOUD' && luopan ? (
        <section className="content-panel repair-credential-card quick-repair-card">
          <div className="section-heading small">
            <div><h2>罗盘验证码快速修复</h2><p>一键打开罗盘登录并生成当前验证码；系统会私聊本店企业管理员，同时允许在后台填写同一个验证码。</p></div>
            <Status tone={luopan.quickRepair.state === 'COMPLETE' ? 'ok' : luopan.quickRepair.state === 'FAILED' || luopan.quickRepair.state === 'EXPIRED' ? 'warning' : 'info'}>{luopanQuickRepairStatusLabel(luopan.quickRepair.state)}</Status>
          </div>
          <dl className="review-list compact">
            <div><dt>企微管理员</dt><dd>{luopan.quickRepair.managerNotificationReady ? `已连接 ${luopan.quickRepair.managerRecipientCount} 位` : '尚未绑定或修复助手未连接'}</dd></div>
            <div><dt>验证码有效期</dt><dd>{luopan.quickRepair.expiresAt ? formatTime(luopan.quickRepair.expiresAt) : '发起后10分钟'}</dd></div>
            <div><dt>剩余次数</dt><dd>{luopan.quickRepair.state === 'WAITING_FOR_CAPTCHA' ? `${luopan.quickRepair.attemptsRemaining} 次` : '—'}</dd></div>
            <div><dt>最近结果</dt><dd>{businessCodeLabel(luopan.quickRepair.reasonCode, luopanQuickRepairStatusLabel(luopan.quickRepair.state))}</dd></div>
          </dl>
          {luopan.quickRepair.state === 'WAITING_FOR_CAPTCHA' && luopan.quickRepair.captchaImageDataUrl ? (
            <div className="quick-repair-challenge">
              <img alt="罗盘当前登录验证码" src={luopan.quickRepair.captchaImageDataUrl} />
              <label>后台填写验证码<input autoComplete="off" maxLength={8} value={captcha} onChange={(event) => setCaptcha(event.target.value)} placeholder="4至8位字母或数字" /></label>
              <button disabled={submittingCaptcha || !/^[a-zA-Z0-9]{4,8}$/u.test(captcha.trim())} type="button" onClick={() => void submitLuopanCaptcha()}>{submittingCaptcha ? '正在提交…' : '提交验证码并修复'}</button>
            </div>
          ) : null}
          <div className="button-row">
            <button disabled={quickRepairing || luopanQuickRepairActive(luopan.quickRepair.state) || !luopan.quickRepair.available} type="button" onClick={() => void beginLuopanQuickRepair()}>{quickRepairing || luopanQuickRepairActive(luopan.quickRepair.state) ? '快速修复进行中…' : luopan.quickRepair.managerNotificationReady ? '一键快速修复（验证码发企微）' : '启动后台验证码修复'}</button>
          </div>
          {!luopan.quickRepair.available ? <div className="inline-message warning" role="status">{businessCodeLabel(luopan.quickRepair.reasonCode, '请先完成罗盘配置、登录凭据和企业管理员绑定。')}</div> : null}
        </section>
      ) : null}

      {pmsSystemCode === 'LUOPAN_CLOUD' && luopan ? (
        <section className="content-panel repair-credential-card">
          <div className="section-heading small">
            <div><h2>罗盘服务器会话状态</h2><p>后台采集使用服务器隔离会话；在电脑普通浏览器登录罗盘官网不会同步到这里。登录失效时请使用上方“一键快速修复”。</p></div>
            <Status tone={luopan.scopeStatus === 'SINGLE_HOTEL_CONFIRMED' ? 'ok' : 'warning'}>{luopan.scopeStatus === 'SINGLE_HOTEL_CONFIRMED' ? '单店会话已确认' : '等待验证'}</Status>
          </div>
          <dl className="review-list compact">
            <div><dt>最近验证</dt><dd>{formatTime(luopan.lastValidatedAt)}</dd></div>
            <div><dt>营业日</dt><dd>{luopan.lastBusinessDate ?? '尚未确认'}</dd></div>
            <div><dt>最近采集</dt><dd>{formatTime(luopan.lastCollectionAt)}</dd></div>
          </dl>
          <div className="button-row">
            <a className="button-link secondary" href={luopan.portalUrl} rel="noreferrer" target="_blank">查看罗盘官网（不会同步登录）</a>
          </div>
        </section>
      ) : null}

      {notice ? <div className="inline-message success" role="status">{notice}</div> : null}
      {error ? <div className="inline-message error" role="alert">{error}</div> : null}
    </div>
  )
}
