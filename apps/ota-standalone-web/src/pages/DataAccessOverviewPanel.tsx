import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  loadBriefs,
  loadLuopanBrowserConfig,
  loadMonitor,
  loadOtaSources,
  type BriefView,
  type HotelContext,
  type LuopanBrowserConfigView,
  type MonitorView,
  type OtaSourceView,
  type ReportSourceView,
} from '../api/business'

interface Props {
  context: HotelContext
  pmsLoginConfigured: boolean
  refreshVersion: number
  reportSources: ReportSourceView[]
}

interface OverviewState {
  briefs: BriefView[]
  luopan: LuopanBrowserConfigView
  monitor: MonitorView
  otaSources: OtaSourceView[]
}

const localTime = (value: string | null | undefined) => {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed)
}

const completenessText = (
  value: MonitorView['completeness'] | string | null | undefined,
) => {
  switch (value) {
    case 'COMPLETE':
      return '完整'
    case 'PARTIAL':
      return '部分形成'
    case 'UNAVAILABLE':
      return '不可用'
    default:
      return '尚未形成'
  }
}

export function DataAccessOverviewPanel({
  context,
  pmsLoginConfigured,
  refreshVersion,
  reportSources,
}: Props) {
  const [state, setState] = useState<OverviewState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [otaSources, luopan, monitor, briefs] = await Promise.all([
        loadOtaSources(context),
        loadLuopanBrowserConfig(context),
        loadMonitor(context),
        loadBriefs(context),
      ])
      setState({ otaSources, luopan, monitor, briefs })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : '读取门店数据接入状态失败',
      )
    } finally {
      setLoading(false)
    }
  }, [context])

  useEffect(() => {
    void reload()
  }, [reload, refreshVersion])

  const reportStatus = useMemo(() => {
    const enabled = reportSources.filter((source) => source.enabled)
    return {
      cookieCount: enabled.filter((source) => source.cookieConfigured).length,
      enabledCount: enabled.length,
      validCount: enabled.filter(
        (source) => source.validationStatus === 'FORMAT_VALID',
      ).length,
    }
  }, [reportSources])

  const otaStatus = useMemo(() => {
    const enabled = state?.otaSources.filter((source) => source.enabled) ?? []
    return {
      completeCount: enabled.filter(
        (source) => source.lastRefreshStatus === 'COMPLETE',
      ).length,
      enabledCount: enabled.length,
      failedCount: enabled.filter(
        (source) => source.lastRefreshStatus === 'FAILED',
      ).length,
      recordCount: enabled.reduce(
        (sum, source) => sum + (source.lastSummary?.recordCount ?? 0),
        0,
      ),
    }
  }, [state?.otaSources])

  const monitor = state?.monitor
  const latestBrief = state?.briefs[0] ?? null
  const dataFormed = Boolean(monitor?.collectionRunId)
  const completeSources = monitor?.sources.filter(
    (source) => source.completeness === 'COMPLETE',
  ).length ?? 0
  const sourceCount = monitor?.sources.length ?? 0
  const luopan = state?.luopan

  return (
    <section className="data-access-overview" id="data-access-overview">
      <div className="page-heading compact-heading">
        <div>
          <p className="eyebrow">STORE DATA STATUS</p>
          <h3>当前门店数据接入总览</h3>
          <p>
            集中查看报表接口、罗盘云和OTA配置，以及最近一次采集是否已经形成经营数据和简报。
          </p>
        </div>
        <button
          className="secondary"
          disabled={loading}
          type="button"
          onClick={() => void reload()}
        >
          {loading ? '刷新中…' : '刷新状态'}
        </button>
      </div>

      {error ? <div className="error" role="alert">{error}</div> : null}

      <div className="data-access-overview-grid">
        <article>
          <span>报表接口配置</span>
          <strong>
            {reportStatus.enabledCount > 0
              ? `${reportStatus.enabledCount} 个已启用`
              : '尚未启用'}
          </strong>
          <small>
            Cookie {reportStatus.cookieCount}/{reportStatus.enabledCount}
            {' · '}
            格式有效 {reportStatus.validCount}/{reportStatus.enabledCount}
            {' · '}
            PMS登录{pmsLoginConfigured ? '已配置' : '未配置'}
          </small>
        </article>

        <article className={luopan?.lastErrorCode ? 'status-warning' : ''}>
          <span>罗盘云采集</span>
          <strong>
            {luopan?.enabled
              ? '单店采集已启用'
              : luopan?.scopeStatus === 'SINGLE_HOTEL_CONFIRMED'
                ? '单店已验证，尚未启用'
                : '尚未完成单店验证'}
          </strong>
          <small>
            最近采集 {luopan?.lastCollectionStatus ?? 'NEVER'}
            {' · '}
            营业日 {luopan?.lastBusinessDate ?? '—'}
            {luopan?.lastErrorCode
              ? ` · ${luopan.lastErrorCode}`
              : ''}
          </small>
        </article>

        <article
          className={
            dataFormed && monitor?.completeness !== 'UNAVAILABLE'
              ? 'status-ok'
              : 'status-warning'
          }
        >
          <span>经营数据形成</span>
          <strong>
            {dataFormed
              ? completenessText(monitor?.completeness)
              : '尚未形成'}
          </strong>
          <small>
            数据来源 {completeSources}/{sourceCount}
            {' · '}
            营业日 {monitor?.businessDate ?? '—'}
            {' · '}
            采集 {localTime(monitor?.cutoffAt)}
          </small>
        </article>

        <article className={latestBrief ? 'status-ok' : 'status-warning'}>
          <span>经营简报</span>
          <strong>{latestBrief ? '已形成' : '尚未形成'}</strong>
          <small>
            {latestBrief
              ? `${completenessText(latestBrief.completenessCode)} · `
                + `${localTime(latestBrief.publishedAt)} · `
                + `发送状态 ${latestBrief.deliveryStatus}`
              : '完成一次有效采集后自动生成，发送与生成状态分开显示'}
          </small>
        </article>

        <article
          className={otaStatus.failedCount > 0 ? 'status-warning' : ''}
        >
          <span>OTA平台数据</span>
          <strong>
            {otaStatus.enabledCount > 0
              ? `${otaStatus.completeCount}/${otaStatus.enabledCount} 已形成`
              : '尚未配置'}
          </strong>
          <small>
            最近结构化记录 {otaStatus.recordCount}
            {' · '}
            失败 {otaStatus.failedCount}
            {' · '}
            仅显示数据结构与数量，不显示敏感凭据
          </small>
        </article>
      </div>

      <div className="button-row overview-actions">
        <a className="button-link" href="#ota-source-config-panel">
          配置OTA平台数据
        </a>
        <a
          className="button-link secondary"
          href="#luopan-browser-config-panel"
        >
          核对罗盘云配置
        </a>
        <a
          className="button-link secondary"
          href="#report-source-list"
        >
          核对报表接口
        </a>
      </div>
    </section>
  )
}
