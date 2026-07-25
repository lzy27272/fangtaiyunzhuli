import { useEffect, useMemo, useState } from 'react'
import {
  listConnectorOnboardingTemplates,
  loadConnectorOnboarding,
  upsertConnectorOnboarding,
  type ConnectorConnectionMethod,
  type ConnectorOnboardingInput,
  type ConnectorOnboardingTemplate,
  type ConnectorOnboardingView,
  type ConnectorSecretBindingInput,
  type ConnectorSourceCode,
  type HotelContext,
} from '../api/business'
import { BrowserAuthorizationRehearsalPanel } from './BrowserAuthorizationRehearsalPanel'

interface Props {
  context: HotelContext
  canConfigure: boolean
}

interface EditableConnector {
  connectorId: string
  expectedRowVersion: number
  templateCode: ConnectorOnboardingTemplate['templateCode']
  sourceCode: ConnectorSourceCode
  vendorCode: string
  vendorName: string
  productName: string
  productVersion: string
  connectionMethod: ConnectorConnectionMethod
  externalHotelCode: string
  accountAlias: string
  networkRouteCode: string
  pollIntervalMinutes: number
  secretBindings: ConnectorSecretBindingInput[]
  saved?: ConnectorOnboardingView
}

const SOURCE_ORDER: ConnectorSourceCode[] = ['PMS', 'CTRIP', 'MEITUAN']

const CONNECTION_METHOD_LABELS: Record<ConnectorConnectionMethod, string> = {
  OFFICIAL_API: '官方 API',
  READ_ONLY_DATABASE: '只读数据库',
  AUTOMATED_REPORT: '官方自动报表',
  LOCAL_AGENT: '门店受控 Agent',
  CONTROLLED_BROWSER: '受控浏览器',
}

const SECRET_PROVIDER_BY_SCHEME: Record<string, string> = {
  kms: 'KMS',
  vault: 'VAULT',
  secretstore: 'SECRETSTORE',
  oskeyring: 'OSKEYRING',
  envref: 'ENVREF',
}

function requiredSecretPurposes(
  sourceCode: ConnectorSourceCode,
  connectionMethod: ConnectorConnectionMethod,
): string[] {
  if (connectionMethod === 'CONTROLLED_BROWSER') {
    return ['BROWSER_SESSION']
  }
  if (sourceCode === 'PMS') {
    if (connectionMethod === 'READ_ONLY_DATABASE') {
      return ['PMS_READ_ONLY_CREDENTIAL']
    }
    if (connectionMethod === 'LOCAL_AGENT') {
      return ['AGENT_MTLS_IDENTITY', 'PMS_READ_ONLY_CREDENTIAL']
    }
    return ['SOURCE_AUTH']
  }
  return ['SOURCE_AUTH']
}

function initialSecretBindings(
  sourceCode: ConnectorSourceCode,
  connectionMethod: ConnectorConnectionMethod,
): ConnectorSecretBindingInput[] {
  return requiredSecretPurposes(sourceCode, connectionMethod).map((purpose) => ({
    purpose,
    providerCode: 'SECRETSTORE',
    secretReference: '',
    secretVersion: 'PENDING',
  }))
}

function editableFrom(
  template: ConnectorOnboardingTemplate,
  saved?: ConnectorOnboardingView,
): EditableConnector {
  const connectionMethod =
    saved?.connectionMethod ?? template.connectionMethods[0]
  return {
    connectorId: saved?.connectorId ?? globalThis.crypto.randomUUID(),
    expectedRowVersion: saved?.rowVersion ?? 0,
    templateCode: template.templateCode,
    sourceCode: template.sourceCode,
    vendorCode: saved?.vendorCode ?? '',
    vendorName: saved?.vendorName ?? '',
    productName: saved?.productName ?? '',
    productVersion: saved?.productVersion ?? '',
    connectionMethod,
    externalHotelCode: saved?.externalHotelCode ?? '',
    accountAlias: saved?.accountAlias ?? '',
    networkRouteCode: saved?.networkRouteCode ?? '',
    pollIntervalMinutes: saved?.pollIntervalMinutes
      ?? template.allowedPollIntervalsMinutes[0],
    secretBindings: initialSecretBindings(template.sourceCode, connectionMethod),
    saved,
  }
}

function nonEmptySecretBindings(
  bindings: ConnectorSecretBindingInput[],
): ConnectorSecretBindingInput[] {
  return bindings
    .filter((binding) => binding.secretReference.trim())
    .map((binding) => {
      const secretReference = binding.secretReference.trim()
      const scheme = secretReference.slice(0, secretReference.indexOf('://'))
        .toLowerCase()
      return {
        ...binding,
        providerCode: SECRET_PROVIDER_BY_SCHEME[scheme]
          ?? binding.providerCode,
        secretReference,
      }
    })
}

export function RealConnectorPrepPanel({ context, canConfigure }: Props) {
  const [templates, setTemplates] = useState<ConnectorOnboardingTemplate[]>([])
  const [drafts, setDrafts] = useState<EditableConnector[]>([])
  const [reasonCode, setReasonCode] = useState('SPRINT2B_REAL_PREP')
  const [loading, setLoading] = useState(true)
  const [savingSource, setSavingSource] =
    useState<ConnectorSourceCode | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([
      listConnectorOnboardingTemplates(),
      loadConnectorOnboarding(context),
    ])
      .then(([catalog, connectors]) => {
        if (cancelled) return
        setTemplates(catalog)
        setDrafts(
          SOURCE_ORDER.flatMap((sourceCode) => {
            const template = catalog.find((item) =>
              item.sourceCode === sourceCode)
            if (!template) return []
            const saved = connectors.find((item) =>
              item.sourceCode === sourceCode)
            return [editableFrom(template, saved)]
          }),
        )
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error
            ? cause.message
            : '读取真实接入准备状态失败')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [context])

  const runtimeLocked = useMemo(
    () => drafts.every((draft) => draft.saved?.runtimeBlocked ?? true),
    [drafts],
  )

  function changeDraft(
    sourceCode: ConnectorSourceCode,
    update: (current: EditableConnector) => EditableConnector,
  ) {
    setDrafts((current) => current.map((draft) =>
      draft.sourceCode === sourceCode ? update(draft) : draft))
  }

  function addSecretPurpose(sourceCode: ConnectorSourceCode) {
    changeDraft(sourceCode, (draft) => ({
      ...draft,
      secretBindings: [
        ...draft.secretBindings,
        {
          purpose: '',
          providerCode: 'SECRETSTORE',
          secretReference: '',
          secretVersion: 'PENDING',
        },
      ],
    }))
  }

  async function save(draft: EditableConnector) {
    const normalizedReason = reasonCode.trim().toUpperCase()
    if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(normalizedReason)) {
      setError('变更原因码必须为 3–64 位，首位为大写字母，其余仅可使用大写字母、数字或下划线。')
      return
    }
    const submittedBindings = nonEmptySecretBindings(draft.secretBindings)
    const submittedPurposes = new Set(submittedBindings.map(
      (binding) => binding.purpose.trim().toUpperCase(),
    ))
    const missingPurposes = requiredSecretPurposes(
      draft.sourceCode,
      draft.connectionMethod,
    ).filter((purpose) => !submittedPurposes.has(purpose))
    if (
      (draft.expectedRowVersion === 0 || submittedBindings.length > 0)
      && missingPurposes.length > 0
    ) {
      setError(`首次配置或轮换凭据时必须完整填写：${missingPurposes.join('、')}。`)
      return
    }
    setSavingSource(draft.sourceCode)
    setError('')
    setNotice('')
    const input: ConnectorOnboardingInput = {
      connectorId: draft.connectorId,
      expectedRowVersion: draft.expectedRowVersion,
      reasonCode: normalizedReason,
      templateCode: draft.templateCode,
      sourceCode: draft.sourceCode,
      vendorCode: draft.vendorCode.trim().toUpperCase(),
      vendorName: draft.vendorName.trim(),
      productName: draft.productName.trim(),
      productVersion: draft.productVersion.trim(),
      connectionMethod: draft.connectionMethod,
      externalHotelCode: draft.externalHotelCode.trim(),
      accountAlias: draft.accountAlias.trim(),
      networkRouteCode: draft.networkRouteCode.trim().toUpperCase(),
      pollIntervalMinutes: draft.pollIntervalMinutes,
      secretBindings: submittedBindings.map(
        (binding) => ({
          purpose: binding.purpose.trim().toUpperCase(),
          providerCode: binding.providerCode.trim().toUpperCase(),
          secretReference: binding.secretReference.trim(),
          secretVersion: binding.secretVersion.trim(),
        }),
      ),
    }
    try {
      await upsertConnectorOnboarding(context, input)
      const connectors = await loadConnectorOnboarding(context)
      setDrafts((current) => current.map((item) => {
        if (item.sourceCode !== draft.sourceCode) return item
        const template = templates.find((candidate) =>
          candidate.sourceCode === item.sourceCode)
        const saved = connectors.find((candidate) =>
          candidate.sourceCode === item.sourceCode)
        return template ? editableFrom(template, saved) : item
      }))
      setNotice(
        `${draft.sourceCode} 接入准备草稿已保存；未执行登录、连通测试或数据抓取。`,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存接入准备草稿失败')
    } finally {
      setSavingSource(null)
    }
  }

  return (
    <section className="real-prep-panel" aria-labelledby="real-prep-title">
      <div className="real-prep-heading">
        <div>
          <p className="eyebrow">SPRINT 2B · REAL INTEGRATION PREP</p>
          <h3 id="real-prep-title">真实接入准备（只配置、不执行）</h3>
          <p>
            登记厂商、产品版本、外部酒店编码、接入方式和 SecretStore 引用。
            当前不会登录 PMS/OTA、不会发起网络请求，也不会启用采集计划。
          </p>
        </div>
        <span className="mode-chip">RUNTIME BLOCKED</span>
      </div>

      <div className="safety-lock">
        <strong>凭据安全边界</strong>
        <span>
          这里只能填写服务端允许的SecretStore不透明引用；系统按引用协议自动绑定提供方。
          禁止粘贴密码、Cookie、Token、验证码、Webhook、连接串、SQL、脚本或HTTP URL。
        </span>
      </div>

      {loading
        ? <div className="state-panel">正在读取接入准备状态…</div>
        : null}
      {error
        ? <div className="error-state state-panel" role="alert">{error}</div>
        : null}

      {!loading ? (
        <div className="real-prep-grid">
          {drafts.map((draft) => {
            const template = templates.find((item) =>
              item.templateCode === draft.templateCode)
            if (!template) return null
            return (
              <article className="real-prep-card" key={draft.sourceCode}>
                <header>
                  <div>
                    <strong>{template.displayName}</strong>
                    <small>{draft.sourceCode} · {draft.templateCode}</small>
                  </div>
                  <b>{draft.saved?.readinessCode ?? 'INCOMPLETE'}</b>
                </header>

                <div className="real-prep-fields">
                  <label>
                    厂商编码
                    <input
                      disabled={!canConfigure}
                      placeholder="例如 PMS_VENDOR"
                      value={draft.vendorCode}
                      onChange={(event) =>
                        changeDraft(draft.sourceCode, (current) => ({
                          ...current,
                          vendorCode: event.target.value,
                        }))}
                    />
                  </label>
                  <label>
                    厂商名称
                    <input
                      disabled={!canConfigure}
                      value={draft.vendorName}
                      onChange={(event) =>
                        changeDraft(draft.sourceCode, (current) => ({
                          ...current,
                          vendorName: event.target.value,
                        }))}
                    />
                  </label>
                  <label>
                    产品名称
                    <input
                      disabled={!canConfigure}
                      value={draft.productName}
                      onChange={(event) =>
                        changeDraft(draft.sourceCode, (current) => ({
                          ...current,
                          productName: event.target.value,
                        }))}
                    />
                  </label>
                  <label>
                    产品版本
                    <input
                      disabled={!canConfigure}
                      value={draft.productVersion}
                      onChange={(event) =>
                        changeDraft(draft.sourceCode, (current) => ({
                          ...current,
                          productVersion: event.target.value,
                        }))}
                    />
                  </label>
                  <label>
                    接入方式
                    <select
                      disabled={!canConfigure}
                      value={draft.connectionMethod}
                      onChange={(event) =>
                        changeDraft(draft.sourceCode, (current) => ({
                          ...current,
                          connectionMethod:
                            event.target.value as ConnectorConnectionMethod,
                          secretBindings: initialSecretBindings(
                            current.sourceCode,
                            event.target.value as ConnectorConnectionMethod,
                          ),
                        }))}
                    >
                      {template.connectionMethods.map((method) => (
                        <option key={method} value={method}>
                          {CONNECTION_METHOD_LABELS[method]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    外部酒店编码
                    <input
                      disabled={!canConfigure}
                      value={draft.externalHotelCode}
                      onChange={(event) =>
                        changeDraft(draft.sourceCode, (current) => ({
                          ...current,
                          externalHotelCode: event.target.value,
                        }))}
                    />
                  </label>
                  <label>
                    账号别名
                    <input
                      disabled={!canConfigure}
                      placeholder="只填别名，不填用户名或密码"
                      value={draft.accountAlias}
                      onChange={(event) =>
                        changeDraft(draft.sourceCode, (current) => ({
                          ...current,
                          accountAlias: event.target.value,
                        }))}
                    />
                  </label>
                  <label>
                    受控网络路由编码
                    <input
                      disabled={!canConfigure}
                      placeholder="例如 UAT_EGRESS_01"
                      value={draft.networkRouteCode}
                      onChange={(event) =>
                        changeDraft(draft.sourceCode, (current) => ({
                          ...current,
                          networkRouteCode: event.target.value,
                        }))}
                    />
                  </label>
                  <label>
                    计划轮询间隔（分钟）
                    <select
                      disabled={!canConfigure}
                      value={draft.pollIntervalMinutes}
                      onChange={(event) =>
                        changeDraft(draft.sourceCode, (current) => ({
                          ...current,
                          pollIntervalMinutes: Number(event.target.value),
                        }))}
                    >
                      {template.allowedPollIntervalsMinutes.map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes} 分钟
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="secret-prep-list">
                  <strong>SecretStore 引用（写入后不回显）</strong>
                  {draft.connectionMethod === 'CONTROLLED_BROWSER' ? (
                    <small className="security-note">
                      这里只填写 vault://、oskeyring:// 或 secretstore://
                      不透明引用；不要粘贴 Cookie。PMS 登录将在隔离浏览器助手中由授权人员完成。
                    </small>
                  ) : null}
                  {draft.saved?.secretBindings.map((binding) => (
                    <div
                      className="secret-status"
                      key={`${binding.purpose}-${binding.providerCode}`}
                    >
                      <span>{binding.purpose}</span>
                      <small>
                        {binding.providerCode} · {binding.status}
                      </small>
                    </div>
                  ))}
                  {draft.secretBindings.map((binding, index) => (
                    <div
                      className="secret-input-row"
                      key={`${draft.sourceCode}-${index}`}
                    >
                      <input
                        aria-label={`${draft.sourceCode} Secret用途`}
                        disabled={!canConfigure}
                        placeholder="用途，例如 PRIMARY_CREDENTIAL"
                        value={binding.purpose}
                        onChange={(event) =>
                          changeDraft(draft.sourceCode, (current) => ({
                            ...current,
                            secretBindings: current.secretBindings.map(
                              (item, itemIndex) => itemIndex === index
                                ? { ...item, purpose: event.target.value }
                                : item,
                            ),
                          }))}
                      />
                      <input
                        aria-label={`${draft.sourceCode} SecretStore引用`}
                        autoComplete="off"
                        disabled={!canConfigure}
                        placeholder="secretstore://受控路径"
                        type="password"
                        value={binding.secretReference}
                        onChange={(event) =>
                          changeDraft(draft.sourceCode, (current) => ({
                            ...current,
                            secretBindings: current.secretBindings.map(
                              (item, itemIndex) => itemIndex === index
                                ? {
                                    ...item,
                                    secretReference: event.target.value,
                                  }
                                : item,
                            ),
                          }))}
                      />
                    </div>
                  ))}
                  {canConfigure ? (
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => addSecretPurpose(draft.sourceCode)}
                    >
                      增加凭据用途
                    </button>
                  ) : null}
                </div>

                {draft.saved?.blockers.length ? (
                  <ul className="prep-blockers">
                    {draft.saved.blockers.map((blocker) =>
                      <li key={blocker}>{blocker}</li>)}
                  </ul>
                ) : null}

                {draft.saved?.sourceCode === 'PMS'
                  && draft.saved.connectionMethod === 'CONTROLLED_BROWSER' ? (
                    <BrowserAuthorizationRehearsalPanel
                      canConfigure={canConfigure}
                      configVersion={draft.saved.rowVersion}
                      connectorId={draft.saved.connectorId}
                      context={context}
                    />
                  ) : null}

                <button
                  disabled={!canConfigure || savingSource !== null}
                  type="button"
                  onClick={() => save(draft)}
                >
                  {savingSource === draft.sourceCode
                    ? '正在保存草稿…'
                    : `保存 ${draft.sourceCode} 准备草稿`}
                </button>
              </article>
            )
          })}
        </div>
      ) : null}

      <div className="configuration-form real-prep-footer">
        <label className="wide-field">
          变更原因码
          <input
            disabled={!canConfigure}
            pattern="[A-Z][A-Z0-9_]{2,63}"
            value={reasonCode}
            onChange={(event) =>
              setReasonCode(event.target.value.toUpperCase())}
          />
        </label>
        <div className="safety-lock wide-field">
          <strong>运行闸门：{runtimeLocked ? '已锁定' : '状态异常'}</strong>
          <span>
            草稿不会创建启用计划；真实适配器、Secret解析、网络访问、企微投递和生产发布仍未开放。
          </span>
        </div>
        {!canConfigure
          ? <p className="muted">当前角色只能跨租户查看准备状态，不能修改。</p>
          : null}
        {notice ? <p className="success-note">{notice}</p> : null}
      </div>
    </section>
  )
}
