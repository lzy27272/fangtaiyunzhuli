import type {
  OtaProviderDatasetSummary,
  OtaSourceView,
} from '../api/business'
import {
  EmptyState,
  PlatformIcon,
  Status,
  type PlatformIconName,
} from '../components/ConsoleUi'
import { otaSourceGuidance } from './otaSourceGuidance'
import {
  buildOtaHotelReviewDashboard,
  type OtaHotelReviewRateStatus,
} from './otaReviewDashboard'
import {
  groupOtaOperatingSources,
  otaDimensionLabel,
  otaOperatingDataKind,
  otaOperatingDataState,
  otaPlatformLabel,
  otaReviewDashboardSources,
} from './otaOperatingData'

interface Props {
  sources: OtaSourceView[]
  canConfigure: boolean
  onOpenSource: (sourceId?: string) => void
}

const OTA_PEER_RANK_LABELS: Record<string, string> = {
  OVERALL: '综合表现',
  ORDER_COUNT: '订单量',
  REVIEW_SCORE: '评价表现',
  STAY_ROOM_NIGHTS: '入住间夜',
  ROOM_REVENUE: '房费收入',
  SOLD_ROOM_NIGHTS: '销售间夜',
  GMV: '销售额',
  EXPOSURE: '曝光',
  VIEWS: '浏览',
  VIEW_CONVERSION: '浏览转化',
  PAYMENT_CONVERSION: '支付转化',
}

const otaProviderLabel = (provider?: string): string => {
  if (provider === 'MEITUAN') return '美团'
  if (provider === 'DOUYIN') return '抖音'
  if (provider === 'FLIGGY') return '飞猪'
  return 'OTA'
}

const pollingIntervalLabel = (minutes: number): string => {
  if (!minutes) return '按平台计划'
  if (minutes === 30) return '每30分钟'
  if (minutes % 1_440 === 0) return `每${minutes / 1_440}天`
  if (minutes % 60 === 0) return `每${minutes / 60}小时`
  return `每${minutes}分钟`
}

const observedAtLabel = (value?: string | null): string => {
  if (!value) return '尚未成功采集'
  const observedAt = new Date(value)
  return Number.isNaN(observedAt.getTime())
    ? '采集时间待核验'
    : `采集于 ${observedAt.toLocaleString('zh-CN', { hour12: false })}`
}

const otaPairingStatusLabel = (status?: string): string => {
  if (status === 'AVAILABLE') return '订单与评价已配对'
  if (status === 'ZERO_DENOMINATOR') return '截止昨日有效订单为0'
  if (status === 'ORDER_SOURCE_MISSING') return '待配置同平台订单接口'
  if (status === 'ORDER_DATA_INCOMPLETE') return '订单数据未完整分页'
  if (status === 'REVIEW_SCORE_METRICS_UNAVAILABLE') return '评价评分字段待映射'
  if (status === 'PERIOD_MISMATCH') return '订单与评价统计期不一致'
  return '等待订单与评价配对'
}

const otaHotelReviewRateStatusLabel = (
  status: OtaHotelReviewRateStatus,
): string => {
  if (status === 'AVAILABLE') return '已按全渠道汇总口径计算'
  if (status === 'NO_REVIEW_DATA') return '等待渠道评价数据'
  if (status === 'PERIOD_MISMATCH') return '各渠道统计期不一致'
  if (status === 'ZERO_DENOMINATOR') return '截止昨日全渠道有效订单为0'
  return '部分渠道订单分母尚未就绪'
}

function HotelReviewSummary({ sources }: { sources: OtaSourceView[] }) {
  const dashboard = buildOtaHotelReviewDashboard(
    otaReviewDashboardSources(sources),
  )
  if (dashboard.channels.length === 0) return null

  return (
    <section className="ota-peer-rank-board ota-review-board ota-hotel-review-board">
      <header>
        <div>
          <strong>门店全渠道评价总览</strong>
          <small>
            本月 {dashboard.monthStart ?? '统计期待对齐'} 起
            {' · '}已纳入 {dashboard.channels.length} 个渠道
          </small>
        </div>
        <span>{observedAtLabel(dashboard.latestObservedAt)}</span>
      </header>
      <div className="ota-peer-rank-metrics">
        <div><span>本月全渠道好评</span><strong>{dashboard.monthlyGoodCount} 条</strong></div>
        <div>
          <span>截止昨日全渠道好评率</span>
          <strong>
            {dashboard.goodRatePercent === null
              ? otaHotelReviewRateStatusLabel(dashboard.rateStatus)
              : `${dashboard.goodRatePercent}%`}
          </strong>
        </div>
        <div><span>本月全渠道差评</span><strong>{dashboard.monthlyNegativeCount} 条</strong></div>
        <div><span>昨日全渠道新增差评</span><strong>{dashboard.yesterdayNegativeCount} 条</strong></div>
        <div>
          <span>截止昨日全渠道差评率</span>
          <strong>
            {dashboard.negativeRatePermille === null
              ? otaHotelReviewRateStatusLabel(dashboard.rateStatus)
              : `${dashboard.negativeRatePermille}‰`}
          </strong>
        </div>
      </div>
      <small>
        评价率仅使用同门店、同渠道、同统计期的未取消订单作为分母；
        不展示订单明细、评价正文、用户名或订单号。
      </small>
    </section>
  )
}

function PeerRankingBoard({ source }: { source: OtaSourceView }) {
  const ranking = source.lastSummary?.peerRanking
  if (!ranking) return null
  return (
    <section className="ota-peer-rank-board">
      <header>
        <div>
          <strong>{otaProviderLabel(ranking.provider)}排名实时看板</strong>
          <small>最近一次采集 · {pollingIntervalLabel(source.pollIntervalMinutes)}更新</small>
        </div>
        <span>{observedAtLabel(source.lastSummary?.observedAt)}</span>
      </header>
      <div className="ota-peer-rank-metrics">
        {ranking.metrics.map((metric) => (
          <div key={metric.code}>
            <span>{OTA_PEER_RANK_LABELS[metric.code] ?? metric.code}</span>
            <strong>{metric.rank === null ? '平台暂未返回' : `第 ${metric.rank} 名`}</strong>
          </div>
        ))}
      </div>
      <small>排名空值保持“平台暂未返回”，不推算或填零。</small>
    </section>
  )
}

function ReviewMetricsBoard({ source }: { source: OtaSourceView }) {
  const summary = source.lastSummary
  const metrics = summary?.reviewMetrics
  if (!summary || !metrics) return null
  const goodLabel = metrics.provider === 'DOUYIN'
    ? '本月新增平台好评'
    : '本月新增 ≥4.8分'
  const negativeLabel = metrics.provider === 'DOUYIN'
    ? '本月平台差评'
    : '本月差评 <3.0分'
  return (
    <section className="ota-peer-rank-board ota-review-board">
      <header>
        <div>
          <strong>{otaProviderLabel(metrics.provider)}评价经营看板</strong>
          <small>本月 {metrics.monthStart} 起 · {pollingIntervalLabel(source.pollIntervalMinutes)}更新</small>
        </div>
        <span>{observedAtLabel(summary.observedAt)}</span>
      </header>
      <div className="ota-peer-rank-metrics">
        <div><span>{goodLabel}</span><strong>{metrics.monthlyGoodCount} 条</strong></div>
        <div>
          <span>本月截止昨日好评率</span>
          <strong>
            {metrics.goodRatePercent === null
              ? otaPairingStatusLabel(summary.reviewOrderPairing?.status)
              : `${metrics.goodRatePercent}%`}
          </strong>
        </div>
        <div><span>{negativeLabel}</span><strong>{metrics.monthlyNegativeCount} 条</strong></div>
        <div><span>昨日新增差评</span><strong>{metrics.yesterdayNegativeCount} 条</strong></div>
        <div>
          <span>本月截止昨日差评率</span>
          <strong>
            {metrics.negativeRatePermille === null
              ? otaPairingStatusLabel(summary.reviewOrderPairing?.status)
              : `${metrics.negativeRatePermille}‰`}
          </strong>
        </div>
      </div>
      <small>仅保存日期、评分和数量汇总，不保存评价正文、用户名或订单号。</small>
    </section>
  )
}

function ReviewDatasetBoard({
  source,
  dataset,
}: {
  source: OtaSourceView
  dataset: OtaProviderDatasetSummary
}) {
  return (
    <section className="ota-peer-rank-board ota-review-board">
      <header>
        <div>
          <strong>{otaProviderLabel(dataset.provider)}评价数据看板</strong>
          <small>
            {dataset.scope === 'BUSINESS_MONTH_TO_DATE'
              ? `${dataset.rangeStart ?? '起始日待确认'} 至 ${dataset.rangeEnd ?? '截止日待确认'}`
              : '接口累计与当前页'}
            {' · '}{pollingIntervalLabel(source.pollIntervalMinutes)}更新
          </small>
        </div>
        <span>{observedAtLabel(source.lastSummary?.observedAt)}</span>
      </header>
      <div className="ota-peer-rank-metrics">
        <div>
          <span>平台评价总数</span>
          <strong>{dataset.totalCount === null ? '平台暂未返回' : `${dataset.totalCount} 条`}</strong>
        </div>
        <div><span>本次返回记录</span><strong>{dataset.returnedCount} 条</strong></div>
        {dataset.hasMore !== undefined ? (
          <div><span>平台是否还有更多</span><strong>{dataset.hasMore ? '是' : '否'}</strong></div>
        ) : null}
      </div>
      <small>尚未形成可确认的完整评分分页时，不推算好评率和差评率。</small>
    </section>
  )
}

function GenericSummaryBoard({ source }: { source: OtaSourceView }) {
  const summary = source.lastSummary
  if (!summary) return null
  const dimensions = summary.detectedDimensions ?? []
  return (
    <section className="ota-peer-rank-board ota-generic-summary-board">
      <header>
        <div>
          <strong>{dimensions.length ? '已采集数据结构' : '尚未形成经营数据'}</strong>
          <small>{observedAtLabel(summary.observedAt)}</small>
        </div>
        <span>
          {dimensions.length
            ? `${summary.recordCount} 条结构化记录`
            : '无可用经营记录'}
        </span>
      </header>
      {dimensions.length ? (
        <div className="ota-data-tags" aria-label="已识别的数据类别">
          {dimensions.map((dimension) => <span key={dimension}>{otaDimensionLabel(dimension)}</span>)}
        </div>
      ) : (
        <div className="ota-data-warning" role="status">
          接口有响应，但返回内容未识别到订单、评价、排名、房态或价格等经营字段；
          不能把接口元数据误报为经营数据。
        </div>
      )}
      <small>
        {dimensions.length
          ? '仅展示脱敏后的数据类别和数量，不展示原始字段或记录内容。'
          : '接口未返回可确认的业务数据。'}
      </small>
    </section>
  )
}

function SourceDataBody({ source }: { source: OtaSourceView }) {
  const view = otaOperatingDataState(source)
  const kind = otaOperatingDataKind(source)
  if (
    view.state === 'FAILED'
    || (
      view.state === 'UNRECOGNIZED'
      && source.lastRefreshStatus === 'FAILED'
    )
  ) {
    const guidance = otaSourceGuidance(source.lastErrorCode)
    return (
      <div className="ota-monitor-error" role="alert">
        <strong>{guidance.reason}</strong>
        <span>核对：{guidance.fields.join('、')}</span>
        <span>{guidance.action}</span>
      </div>
    )
  }
  if (view.state === 'NOT_COLLECTED') {
    return <div className="ota-data-warning">来源已配置，等待首次成功采集；当前没有经营数据可展示。</div>
  }
  if (view.state === 'DISABLED') {
    return <div className="ota-data-muted">该来源已停用，保留历史配置但不参与自动采集。</div>
  }
  if (kind === 'ORDER') {
    return (
      <div className="ota-data-muted">
        订单汇总已采集，并按现行口径仅用于评价率分母；不展示订单明细或住客信息。
      </div>
    )
  }
  const reviewDataset = source.lastSummary?.providerDataset
  return (
    <>
      <PeerRankingBoard source={source} />
      <ReviewMetricsBoard source={source} />
      {reviewDataset?.dataset === 'REVIEW' && !source.lastSummary?.reviewMetrics
        ? <ReviewDatasetBoard source={source} dataset={reviewDataset} />
        : null}
      {kind === 'GENERIC' ? <GenericSummaryBoard source={source} /> : null}
    </>
  )
}

export function OtaOperatingDataPanel({
  sources,
  canConfigure,
  onOpenSource,
}: Props) {
  const groups = groupOtaOperatingSources(sources)
  return (
    <section className="ota-monitor-panel ota-operating-data-panel" aria-labelledby="ota-operating-data-title">
      <div className="section-heading small">
        <div>
          <h2 id="ota-operating-data-title">OTA平台数据</h2>
          <p>展示每个已配置来源实际形成的数据；接口响应不等于经营数据完整。</p>
        </div>
        {canConfigure ? (
          <button className="text-link" onClick={() => onOpenSource()} type="button">OTA平台配置</button>
        ) : null}
      </div>
      <HotelReviewSummary sources={sources} />
      {groups.length ? (
        <div className="ota-platform-data-list">
          {groups.map((group) => (
            <section className="ota-platform-data-group" key={group.platformCode}>
              <header>
                <strong className="connection-name">
                  <PlatformIcon name={group.platformCode as PlatformIconName} />
                  {otaPlatformLabel(group.platformCode)}
                </strong>
                <Status tone={group.state.tone}>{group.state.label}</Status>
                <span>{group.sources.length} 个数据来源</span>
              </header>
              <div className="ota-monitor-grid">
                {group.sources.map((source) => {
                  const view = otaOperatingDataState(source)
                  return (
                    <article className={`ota-monitor-source ${view.state === 'FAILED' ? 'failed' : ''}`} key={source.sourceId}>
                      <header>
                        <div className="ota-source-title">
                          <strong>{source.displayName || `${otaPlatformLabel(source.platformCode)}数据来源`}</strong>
                          <small>{observedAtLabel(source.lastRefreshAt)}</small>
                        </div>
                        <Status tone={view.tone}>{view.label}</Status>
                      </header>
                      <SourceDataBody source={source} />
                      {canConfigure ? (
                        <button className="inline-action-link" onClick={() => onOpenSource(source.sourceId)} type="button">
                          {source.lastErrorCode === 'OTA_CTRIP_ORDER_SCHEMA_UNRECOGNIZED'
                            ? '查看适配说明'
                            : view.state === 'FAILED' || view.state === 'UNRECOGNIZED'
                              ? '核对来源配置'
                              : '查看来源配置'}
                        </button>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState title="尚未配置OTA数据来源" detail="进入OTA平台配置后，已保存的来源会逐项显示采集结果和缺失原因。" />
      )}
    </section>
  )
}
