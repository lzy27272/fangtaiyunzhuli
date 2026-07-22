import type { ReactNode } from 'react'
import styles from './feature.module.css'

export function FeatureHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <header className={styles.header}>
    <div><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
    {actions && <div className={styles.headerActions}>{actions}</div>}
  </header>
}

export function StatusBadge({ value }: { value?: string }) {
  const normalized = (value || 'UNKNOWN').toLowerCase().replaceAll('_', '-')
  return <span className={`${styles.badge} ${styles[normalized] ?? ''}`}>{value || 'UNKNOWN'}</span>
}

export function DataModeBadge({ mode }: { mode: 'REALTIME' | 'SNAPSHOT' }) {
  return <span className={`${styles.modeBadge} ${mode === 'REALTIME' ? styles.realtime : styles.snapshot}`}>
    {mode === 'REALTIME' ? '实时数据' : '日终快照'}
  </span>
}

export function AiRecommendationCard({
  facts,
  analysis,
  recommendation,
  sources,
  actions,
}: {
  facts: string
  analysis: string
  recommendation: string
  sources: string[]
  actions?: ReactNode
}) {
  return <article className={styles.aiCard}>
    <header><div><span>AI 建议 · 不会自动执行</span><h3>事实、分析与建议分区</h3></div></header>
    <dl><div><dt>事实</dt><dd>{facts}</dd></div><div><dt>分析</dt><dd>{analysis}</dd></div><div><dt>建议</dt><dd>{recommendation}</dd></div></dl>
    <p>引用来源：{sources.length ? sources.join('、') : '暂无可核验来源'}</p>
    {actions && <footer>{actions}</footer>}
  </article>
}

export function formatLocalDateTime(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

export { styles as featureStyles }
