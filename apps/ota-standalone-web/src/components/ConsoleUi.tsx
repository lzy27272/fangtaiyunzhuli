import type { ReactNode } from 'react'

export type IconName =
  | 'hotel'
  | 'alert'
  | 'users'
  | 'plus'
  | 'refresh'
  | 'chevron'
  | 'search'
  | 'settings'
  | 'radio'
  | 'shield'
  | 'logout'
  | 'check'
  | 'close'
  | 'arrow'

export type PlatformIconName =
  | 'PMS'
  | 'CTRIP'
  | 'MEITUAN'
  | 'FLIGGY'
  | 'DOUYIN'
  | 'QUNAR'
  | 'TONGCHENG'
  | 'OTHER'
  | 'BROADCAST'

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  const paths: Record<IconName, ReactNode> = {
    hotel: <><path d="M4 21V4h12v17M16 9h4v12M8 8h4M8 12h4M8 16h4M2 21h20" /></>,
    alert: <><path d="M12 3 2.6 20h18.8L12 3Z" /><path d="M12 9v4M12 17h.01" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    refresh: <><path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.3V9.6h.1A1.7 1.7 0 0 0 4.1 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.5 4.1a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.3h4v.1A1.7 1.7 0 0 0 15 4.1a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.5a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7 1.1Z" /></>,
    radio: <><circle cx="12" cy="12" r="2" /><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 0 0-2-2h-6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  }
  return <svg {...common}>{paths[name]}</svg>
}

export function PlatformIcon({ name, size = 24 }: { name: PlatformIconName; size?: number }) {
  const className = `platform-icon platform-icon-${name.toLowerCase()}`
  const style = { width: size, height: size }

  if (name === 'PMS') {
    return <span aria-hidden="true" className={className} style={style}><Icon name="hotel" size={Math.round(size * .64)} /></span>
  }
  if (name === 'CTRIP') {
    return (
      <span aria-hidden="true" className={className} style={style}>
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M7 13.5c3.5-4.7 6.2-5.2 10-2.4M9.2 16.5l6.1-7" /></svg>
      </span>
    )
  }
  if (name === 'DOUYIN') {
    return (
      <span aria-hidden="true" className={className} style={style}>
        <svg viewBox="0 0 24 24"><path d="M14 5v9.1a3.6 3.6 0 1 1-2.8-3.5V7.2c2.3 2.2 4 2.7 6.1 2.8V7.2C15.9 7 14.8 6.3 14 5Z" /></svg>
      </span>
    )
  }

  const glyph = {
    MEITUAN: '美',
    FLIGGY: '飞',
    QUNAR: '去',
    TONGCHENG: '同',
    OTHER: '+',
    BROADCAST: '播',
  }[name]
  return <span aria-hidden="true" className={className} style={style}>{glyph}</span>
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`console-brand${compact ? ' compact' : ''}`}>
      <span className="brand-mark"><Icon name="hotel" size={18} /></span>
      <span><strong>四方馆</strong>{compact ? null : <small>酒店经营中心</small>}</span>
    </div>
  )
}

export type Tone = 'ok' | 'warning' | 'error' | 'muted' | 'info'

export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`status-label ${tone}`}><i />{children}</span>
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><strong>{title}</strong><span>{detail}</span></div>
}

export function LoadingState({ label = '正在读取最新数据…' }: { label?: string }) {
  return <div className="loading-state" role="status"><span className="spinner" />{label}</div>
}
