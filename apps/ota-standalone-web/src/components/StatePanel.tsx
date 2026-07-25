import type { ReactNode } from 'react'

interface Props {
  loading?: boolean
  error?: string
  empty?: boolean
  emptyText?: string
  children: ReactNode
}

export function StatePanel({
  loading,
  error,
  empty,
  emptyText = '暂无数据',
  children,
}: Props) {
  if (loading) return <div className="state-panel">正在读取独立后台数据…</div>
  if (error) return <div className="state-panel error-state" role="alert">{error}</div>
  if (empty) return <div className="state-panel">{emptyText}</div>
  return <>{children}</>
}
