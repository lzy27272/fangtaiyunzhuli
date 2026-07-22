import { ApiError } from '../api/client'

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return '当前任职没有读取该数据的权限。'
    if (error.status === 404) return '请求的数据不存在，或已经不在当前组织范围内。'
    return error.message
  }
  return error instanceof Error ? error.message : '数据读取失败'
}
export function AsyncState({
  loading,
  error,
  empty,
  onRetry,
  emptyTitle = '当前范围暂无数据',
  emptyDescription = '这里显示真实业务结果；暂无数据不代表接口不可用。',
}: {
  loading: boolean
  error?: unknown
  empty?: boolean
  onRetry?: () => void | Promise<void>
  emptyTitle?: string
  emptyDescription?: string
}) {
  if (loading) return <div className="state-card" aria-live="polite"><div className="spinner" /><strong>正在读取业务数据</strong><span>数据范围由当前任职与组织权限决定。</span></div>
  if (error) return <div className="state-card error-state" role="alert"><b>!</b><strong>数据暂时不可用</strong><span>{errorMessage(error)}</span>{onRetry && <button type="button" className="secondary" onClick={() => void onRetry()}>重新加载</button>}</div>
  if (empty) return <div className="state-card"><b>○</b><strong>{emptyTitle}</strong><span>{emptyDescription}</span>{onRetry && <button type="button" className="secondary" onClick={() => void onRetry()}>刷新</button>}</div>
  return null
}

export function PartialDataNotice({ sources }: { sources: string[] }) {
  if (!sources.length) return null
  return <div className="inline-warning" role="status">
    部分数据源暂时不可用：{sources.join('、')}。页面保留已成功读取的数据，不会把缺失数据按零值计算。
  </div>
}
