import type { ReactNode } from 'react'
import { hasAllPermissions, hasAnyPermission } from '../app/permissions'

export function PageAccessBoundary({
  permissions,
  requiredAny,
  requiredAll = [],
  children,
}: {
  permissions: string[]
  requiredAny: readonly string[]
  requiredAll?: readonly string[]
  children: ReactNode
}) {
  if (hasAllPermissions(permissions, requiredAll) && hasAnyPermission(permissions, requiredAny)) return children
  return <section className="page-section">
    <div className="state-card error-state" role="alert">
      <b>!</b>
      <strong>无权访问此页面</strong>
      <span>当前任职没有该页面所需权限。系统不会发起业务数据请求，请切换有效任职或联系管理员授权。</span>
    </div>
  </section>
}
