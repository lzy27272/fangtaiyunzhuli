import { createHash, randomBytes } from 'node:crypto'
import { bindRepairAdminToHotels, normalizeRepairAdminName, normalizeRepairAdminHotelIds } from './wecom-repair-admins.mjs'

const fail = (code) => { throw new Error(`WECOM_REPAIR_APPROVAL_${code}`) }
const hash = (value) => createHash('sha256').update(value).digest('hex')
const idValid = (value) => typeof value === 'string' && /^[^\s\x00-\x1f\x7f]{1,128}$/u.test(value)
const isoValid = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const statuses = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED']
const deliveryStatuses = ['QUEUED', 'SENDING', 'SENT', 'UNKNOWN', 'CANCELLED']
const token = () => randomBytes(24).toString('hex')
const DAY = 86_400_000

// This state is part of the encrypted credential transaction, never public health.
export const normalizeRepairApprovalState = (candidate) => {
  const value = candidate?.bindingApproval
  if (value == null) return { enabled: false, revision: 0, approverUserIds: [], requests: [] }
  if (typeof value !== 'object' || Array.isArray(value) || typeof value.enabled !== 'boolean'
    || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !Array.isArray(value.approverUserIds) || value.approverUserIds.length > 2
    || value.approverUserIds.some((id) => !idValid(id))
    || !Array.isArray(value.requests) || value.requests.length > 500) fail('STATE_INVALID')
  const seen = new Set()
  const requests = value.requests.map((r) => {
    if (!r || !/^[a-f0-9]{48}$/u.test(r.id ?? '') || seen.has(r.id) || !idValid(r.userId)
      || !/^[a-f0-9]{64}$/u.test(r.profileGuard ?? '') || !/^[a-f0-9]{64}$/u.test(r.messageHash ?? '')
      || !Number.isSafeInteger(r.configRevision) || !statuses.includes(r.status)
      || !isoValid(r.createdAt) || !isoValid(r.expiresAt)
      || !Array.isArray(r.cards) || r.cards.length > 2 || !Array.isArray(r.notices) || r.notices.length > 3
      || !/^[A-Za-z0-9_-]{3,128}$/u.test(r.corpId ?? '')) fail('STATE_INVALID')
    seen.add(r.id)
    const tasks = new Set()
    const normalizeDelivery = (d, card) => {
      if (!d || !idValid(d.userId) || !deliveryStatuses.includes(d.status)
        || !/^(?:bind_|notice_)[a-f0-9]{48}$/u.test(d.id ?? '') || tasks.has(d.id)
        || (card && !d.id.startsWith('bind_'))) fail('STATE_INVALID')
      tasks.add(d.id)
      return { id: d.id, userId: d.userId, status: d.status,
        attemptedAt: isoValid(d.attemptedAt) ? d.attemptedAt : null }
    }
    const hotelIds = normalizeRepairAdminHotelIds(r.hotelIds)
    if (!hotelIds.length || hotelIds.length > 20) fail('STATE_INVALID')
    return { id: r.id, userId: r.userId, claimedName: normalizeRepairAdminName(r.claimedName), hotelIds,
      profileGuard: r.profileGuard, messageHash: r.messageHash, corpId: r.corpId,
      configRevision: r.configRevision, createdAt: r.createdAt, expiresAt: r.expiresAt, status: r.status,
      decidedAt: isoValid(r.decidedAt) ? r.decidedAt : null,
      decidedBy: idValid(r.decidedBy) ? r.decidedBy : null,
      reason: ['DECIDED', 'EXPIRED', 'CONFIG_CHANGED', 'ACCESS_CHANGED', 'APPLICANT_CANCELLED'].includes(r.reason) ? r.reason : null,
      cards: r.cards.map((d) => normalizeDelivery(d, true)), notices: r.notices.map((d) => normalizeDelivery(d, false)),
    }
  })
  return { enabled: value.enabled, revision: value.revision,
    approverUserIds: [...new Set(value.approverUserIds)], requests }
}

export const repairApprovalEligible = (credentials, userId) => {
  const profile = credentials?.userProfiles?.[userId]
  return Boolean(!profile?.revokedAt && profile?.directoryUserId && profile?.directoryLinkedAt
    && ((credentials.allowedUserIds ?? []).includes(userId)
      || Object.values(credentials.hotelAllowedUserIds ?? {}).some((ids) => ids.includes(userId))))
}
const ready = (c) => c?.bindingApproval?.enabled && c.directorySync?.enabled && c.directorySync?.verifiedAt
const guard = (c, userId) => hash(JSON.stringify({ profile: c.userProfiles?.[userId] ?? null,
  global: (c.allowedUserIds ?? []).includes(userId),
  hotelIds: Object.entries(c.hotelAllowedUserIds ?? {}).filter(([, ids]) => ids.includes(userId)).map(([id]) => id).sort(),
}))
const replaceRequest = (c, request) => ({ ...c, bindingApproval: { ...c.bindingApproval,
  requests: c.bindingApproval.requests.map((r) => r.id === request.id ? request : r) } })
const terminal = (r, status, reason, now, decidedBy = null) => ({ ...r, status, reason,
  decidedAt: now.toISOString(), decidedBy,
  cards: r.cards.map((d) => d.status === 'QUEUED' ? { ...d, status: 'CANCELLED' } : d),
})

export const configureRepairApprovals = ({ credentials, enabled, approverMemberIds, now = new Date() }) => {
  if (typeof enabled !== 'boolean' || !Array.isArray(approverMemberIds) || approverMemberIds.length > 2
    || approverMemberIds.some((id) => !/^[a-f0-9]{64}$/u.test(id))) fail('CONFIG_INVALID')
  const known = new Set([...(credentials.allowedUserIds ?? []), ...Object.values(credentials.hotelAllowedUserIds ?? {}).flat()])
  const selected = [...new Set(approverMemberIds)].map((id) => [...known].find((u) => hash(u) === id))
  if (selected.some((id) => !id || !repairApprovalEligible(credentials, id))) fail('APPROVER_INVALID')
  if (enabled && (!selected.length || !credentials.directorySync?.enabled || !credentials.directorySync.verifiedAt)) fail('DIRECTORY_REQUIRED')
  const previous = credentials.bindingApproval ?? normalizeRepairApprovalState(null)
  if (previous.enabled === enabled && [...previous.approverUserIds].sort().join('\n') === [...selected].sort().join('\n')) return credentials
  return { ...credentials, bindingApproval: { enabled, approverUserIds: selected, revision: previous.revision + 1,
    requests: previous.requests.map((r) => r.status === 'PENDING' ? terminal(r, 'CANCELLED', 'CONFIG_CHANGED', now) : r),
  } }
}

export const reconcileRepairApprovals = (credentials, now = new Date(), restarting = false) => {
  if (!credentials?.bindingApproval) return credentials
  let changed = false
  const requests = credentials.bindingApproval.requests.map((r) => {
    let next = r
    if (r.status === 'PENDING') {
      if (Date.parse(r.expiresAt) <= now.getTime()) next = terminal(r, 'EXPIRED', 'EXPIRED', now)
      else if (!ready(credentials) || r.configRevision !== credentials.bindingApproval.revision || r.corpId !== credentials.directorySync.corpId) next = terminal(r, 'CANCELLED', 'CONFIG_CHANGED', now)
      else if (guard(credentials, r.userId) !== r.profileGuard || !r.cards.some((d) => credentials.bindingApproval.approverUserIds.includes(d.userId) && repairApprovalEligible(credentials, d.userId))) next = terminal(r, 'CANCELLED', 'ACCESS_CHANGED', now)
    }
    if (restarting) {
      const recover = (d) => d.status === 'SENDING' ? { ...d, status: 'UNKNOWN' } : d
      if ([...next.cards, ...next.notices].some((d) => d.status === 'SENDING')) next = { ...next, cards: next.cards.map(recover), notices: next.notices.map(recover) }
    }
    if (next !== r) changed = true
    return next
  })
  return changed ? { ...credentials, bindingApproval: { ...credentials.bindingApproval, requests } } : credentials
}

export const parseRepairApprovalText = (content) => {
  const text = String(content ?? '').trim()
  if (text === '申请状态') return { type: 'STATUS' }
  if (text === '取消申请') return { type: 'CANCEL' }
  if (!/^(?:申请|申请绑定)(?:\s|$)/u.test(text)) return null
  const match = text.match(/^(?:申请|申请绑定)\s+(\d{3}(?:\s*[,，、]\s*\d{3})*)\s+([^\r\n]+)$/u)
  if (!match) return { type: 'INVALID' }
  return { type: 'APPLY', hotelCodes: [...new Set(match[1].split(/\s*[,，、]\s*/u))], claimedName: match[2].trim() }
}

const assertFrame = (c, frame, event, now) => {
  const b = frame?.body
  if (!b || b.aibotid !== c?.botId || !idValid(b.from?.userid) || b.chatid
    || (event ? b.msgtype !== 'event' || b.event?.eventtype !== 'template_card_event' : b.msgtype !== 'text')
    || (event ? (b.chattype && b.chattype !== 'single') : b.chattype !== 'single')
    || (b.from.corpid && b.from.corpid !== c.directorySync?.corpId)
    || (b.create_time != null && (!Number.isFinite(Number(b.create_time))
      || Math.abs(now.getTime() - Number(b.create_time) * 1000) > 10 * 60_000))) fail('IDENTITY_INVALID')
  return b.from.userid
}

export const ownRepairApproval = ({ credentials, frame, now = new Date() }) => {
  const userId = assertFrame(credentials, frame, false, now)
  if (credentials?.userProfiles?.[userId]?.revokedAt) fail('MEMBER_REVOKED')
  return [...(credentials?.bindingApproval?.requests ?? [])].reverse().find((r) => r.userId === userId) ?? null
}

export const repairApprovalErrorText = (error) => ({
  WECOM_REPAIR_APPROVAL_NOT_ENABLED: '简易绑定审批尚未启用，请联系管理员配置审批人，或使用备用配对码。',
  WECOM_REPAIR_APPROVAL_IDENTITY_INVALID: '消息身份无法核验，请在正确的企业微信机器人单聊中重新发送。',
  WECOM_REPAIR_APPROVAL_MEMBER_REVOKED: '你的权限已被撤销，请联系平台管理员核对人员状态，不能自行重新申请。',
  WECOM_REPAIR_ADMIN_MEMBER_REVOKED: '申请人的权限已被撤销，本次不会重新授权。',
  WECOM_REPAIR_APPROVAL_HOTELS_INVALID: '门店编号无效或超过20家，请核对后发送“申请 003 你的姓名”；多店用逗号分隔。',
  WECOM_REPAIR_APPROVAL_NAME_INVALID: '请填写真实姓名（最多60字），不要包含换行或特殊控制字符。',
  WECOM_REPAIR_ADMIN_NAME_INVALID: '请填写真实姓名（最多60字），不要包含换行或特殊控制字符。',
  WECOM_REPAIR_APPROVAL_PENDING_EXISTS: '你已有待审批申请，请发送“申请状态”查看；需要变更时先发送“取消申请”。',
  WECOM_REPAIR_APPROVAL_RATE_LIMITED: '申请过于频繁，每个账号24小时内最多提交5次，请稍后再试。',
  WECOM_REPAIR_APPROVAL_ALREADY_BOUND: '你已经绑定所选门店，无需再次申请。发送“状态”查看任务。',
  WECOM_REPAIR_APPROVAL_NO_APPROVER: '没有可处理这次申请的审批人（不能自己批准自己），请联系平台管理员。',
  WECOM_REPAIR_APPROVAL_CAPACITY_REACHED: '申请记录已达安全容量，请联系平台管理员处理。',
  WECOM_REPAIR_ADMIN_CAPACITY_REACHED: '申请门店的管理员人数已满，本次未授权。请联系平台管理员处理后再申请。',
  WECOM_REPAIR_ADMIN_HOTELS_INVALID: '申请门店配置已变更，本次未授权，请取消后重新申请。',
  WECOM_REPAIR_APPROVAL_FORBIDDEN: '当前账号没有此卡片的审批权，或审批配置已变更。转发卡片不能代批。',
  WECOM_REPAIR_APPROVAL_STALE: '申请已过期或人员权限已变更，本次未授权，请重新申请。',
}[error?.message] ?? '本次操作结果未确认，请发送“申请状态”查询或请管理员核对后台记录；不要将此提示当作审批成功。')

export const submitRepairApproval = ({ credentials, frame, hotels, command, now = new Date() }) => {
  if (!ready(credentials)) fail('NOT_ENABLED')
  const userId = assertFrame(credentials, frame, false, now)
  if (credentials.userProfiles?.[userId]?.revokedAt) fail('MEMBER_REVOKED')
  if (!idValid(frame.body.msgid)) fail('IDENTITY_INVALID')
  if (!Array.isArray(command.hotelCodes) || !command.hotelCodes.length || command.hotelCodes.length > 20) fail('HOTELS_INVALID')
  const requested = command.hotelCodes.map((code) => hotels.filter((h) => h.hotelCode === code))
  if (requested.some((rows) => rows.length !== 1)) fail('HOTELS_INVALID')
  const hotelIds = normalizeRepairAdminHotelIds(requested.map(([h]) => h.hotelId))
  const claimedName = normalizeRepairAdminName(command.claimedName)
  if (!claimedName || /[<>\u202a-\u202e\u2066-\u2069]/u.test(claimedName)) fail('NAME_INVALID')
  const messageHash = hash(frame.body.msgid)
  const requests = credentials.bindingApproval.requests
  const duplicate = requests.find((r) => r.userId === userId && r.messageHash === messageHash)
  if (duplicate) return { credentials, request: duplicate, duplicate: true }
  const existing = requests.find((r) => r.userId === userId && r.status === 'PENDING')
  if (existing) {
    if (existing.hotelIds.join() !== hotelIds.join() || existing.claimedName !== claimedName) fail('PENDING_EXISTS')
    return { credentials, request: existing, duplicate: true }
  }
  if (requests.filter((r) => r.userId === userId && now.getTime() - Date.parse(r.createdAt) < DAY).length >= 5) fail('RATE_LIMITED')
  if (hotelIds.every((id) => (credentials.hotelAllowedUserIds?.[id] ?? []).includes(userId))) fail('ALREADY_BOUND')
  const approvers = credentials.bindingApproval.approverUserIds.filter((id) => id !== userId && repairApprovalEligible(credentials, id))
  if (!approvers.length) fail('NO_APPROVER')
  // Histories remain for 30 days, with a hard bound; never silently evict an active request.
  const retained = requests.filter((r) => r.status === 'PENDING' || now.getTime() - Date.parse(r.createdAt) < 30 * DAY)
  if (retained.length >= 500) fail('CAPACITY_REACHED')
  const request = { id: token(), userId, claimedName, hotelIds, profileGuard: guard(credentials, userId),
    messageHash, configRevision: credentials.bindingApproval.revision, corpId: credentials.directorySync.corpId,
    status: 'PENDING', createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + DAY).toISOString(),
    decidedAt: null, decidedBy: null, reason: null,
    cards: approvers.map((id) => ({ id: `bind_${token()}`, userId: id, status: 'QUEUED', attemptedAt: null })), notices: [],
  }
  return { credentials: { ...credentials, bindingApproval: { ...credentials.bindingApproval, requests: [...retained, request] } }, request, duplicate: false }
}

export const cancelRepairApproval = ({ credentials, frame, now = new Date() }) => {
  const userId = assertFrame(credentials, frame, false, now)
  const request = credentials.bindingApproval.requests.find((r) => r.userId === userId && r.status === 'PENDING')
  return request ? replaceRequest(credentials, terminal(request, 'CANCELLED', 'APPLICANT_CANCELLED', now)) : credentials
}

export const decideRepairApproval = ({ credentials, frame, hotels, now = new Date() }) => {
  const userId = assertFrame(credentials, frame, true, now)
  const taskId = frame.body.event?.task_id
  const request = credentials.bindingApproval.requests.find((r) => r.cards.some((d) => d.id === taskId && d.userId === userId))
  if (!request || request.userId === userId || !ready(credentials)
    || !credentials.bindingApproval.approverUserIds.includes(userId) || !repairApprovalEligible(credentials, userId)
    || !['BIND_APPROVE', 'BIND_REJECT'].includes(frame.body.event?.event_key)) fail('FORBIDDEN')
  if (request.status !== 'PENDING') return { credentials, request, changed: false }
  if (!['SENDING', 'SENT', 'UNKNOWN'].includes(request.cards.find((d) => d.id === taskId).status)) fail('FORBIDDEN')
  if (Date.parse(request.expiresAt) <= now.getTime() || request.configRevision !== credentials.bindingApproval.revision
    || request.corpId !== credentials.directorySync.corpId || guard(credentials, request.userId) !== request.profileGuard) fail('STALE')
  const approved = frame.body.event.event_key === 'BIND_APPROVE'
  let next = credentials
  if (approved) {
    const previous = credentials.userProfiles?.[request.userId]
    next = bindRepairAdminToHotels({ credentials, userId: request.userId, hotelIds: request.hotelIds,
      displayName: previous?.displayName || request.claimedName,
      role: previous?.role === 'OPERATIONS_MANAGER' || request.hotelIds.length > 1 ? 'OPERATIONS_MANAGER' : 'STORE_MANAGER', hotels, now })
    if (!previous?.displayName) next.userProfiles[request.userId].nameSource = 'APPLICANT_PROVIDED'
    // No guessed directory identity or global/approver role is ever added here.
  }
  const decided = terminal(request, approved ? 'APPROVED' : 'REJECTED', 'DECIDED', now, userId)
  decided.notices = [...new Set([request.userId, ...request.cards.map((d) => d.userId)])]
    .filter((id) => id !== userId).map((id) => ({ id: `notice_${token()}`, userId: id, status: 'QUEUED', attemptedAt: null }))
  return { credentials: replaceRequest(next, decided), request: decided, changed: true }
}

const labels = (r, hotels) => r.hotelIds.map((id) => hotels.find((h) => h.hotelId === id))
  .map((h) => h ? `${h.hotelCode} ${h.hotelName}` : '门店已移除').join('、')
export const repairApprovalCard = (request, delivery, hotels) => ({
  card_type: 'button_interaction', task_id: delivery.id,
  main_title: { title: '门店管理员绑定申请', desc: '任一指定审批人处理即可；请核实申请人身份' },
  sub_title_text: `姓名（员工填写）：${request.claimedName}\n企微账号：${request.userId}\n申请门店：${labels(request, hotels)}\n只授予所列门店的修复权限，不授予审批权。\n姓名及通讯录身份未自动核验；请确认是本人后批准。有效期 24 小时。`,
  button_list: [{ text: '同意绑定', key: 'BIND_APPROVE', style: 1 }, { text: '拒绝', key: 'BIND_REJECT', style: 2 }],
})
export const repairApprovalStatusText = (request, hotels) => {
  if (!request) return '当前没有绑定申请。请发送“申请 003 你的姓名”；多店示例：“申请 003,005 你的姓名”。'
  const status = { PENDING: '等待管理员审批', APPROVED: '审批通过，绑定成功', REJECTED: '申请已拒绝', EXPIRED: '申请已过期，请重新申请', CANCELLED: '申请已取消或授权配置已变更，请重新申请' }[request.status]
  const sent = request.cards.filter((d) => d.status === 'SENT').length
  const unknown = request.cards.some((d) => d.status === 'UNKNOWN')
  return `申请 ${request.id.slice(0, 8)}：${status}。\n门店：${labels(request, hotels)}。`
    + (request.status === 'PENDING' ? `\n审批卡片已确认送达 ${sent}/${request.cards.length} 人。${unknown ? '部分发送结果待确认，请联系审批人核对，系统不会自动重复推送。' : ''}\n可发送“申请状态”查询；需要重提时先发送“取消申请”。` : '')
    + (request.status === 'APPROVED' ? '\n发送“状态”查看任务。通讯录身份未关联时，离职自动解绑尚未生效，请管理员补充核对。' : '')
}

export const repairApprovalView = (credentials, hotels, now = new Date()) => {
  const c = reconcileRepairApprovals(credentials, now)
  const config = c?.bindingApproval ?? normalizeRepairApprovalState(null)
  return { enabled: config.enabled, approverMemberIds: config.approverUserIds.map(hash), maximumApprovers: 2,
    pendingCount: config.requests.filter((r) => r.status === 'PENDING').length,
    eligibleMemberIds: [...new Set([...(c?.allowedUserIds ?? []), ...Object.values(c?.hotelAllowedUserIds ?? {}).flat()])].filter((id) => repairApprovalEligible(c, id)).map(hash),
    requests: [...config.requests].reverse().slice(0, 50).map((r) => ({ id: r.id, userId: r.userId, claimedName: r.claimedName,
      hotels: labels(r, hotels), status: r.status, createdAt: r.createdAt, expiresAt: r.expiresAt,
      decidedAt: r.decidedAt, decidedBy: r.decidedBy ? c.userProfiles?.[r.decidedBy]?.displayName || r.decidedBy : null,
      cardCount: r.cards.length, deliveredCount: r.cards.filter((d) => d.status === 'SENT').length,
      deliveryUncertain: r.cards.some((d) => d.status === 'UNKNOWN'),
    })),
  }
}

// Single-process outbox: claim BEFORE I/O; an interrupted/ambiguous send is never replayed.
// Every post-I/O update merges into the latest credential state, not a stale snapshot.
export const createRepairApprovalOutbox = ({ getCredentials, commit, getHotels, runtime, enabled, now = () => new Date() }) => {
  let running = false
  const allowed = (job) => {
    const c = getCredentials(), r = c?.bindingApproval?.requests.find((r) => r.id === job.requestId)
    const d = r?.[job.kind]?.find((d) => d.id === job.id && d.userId === job.userId)
    if (!d || d.status !== 'SENDING' || c.userProfiles?.[job.userId]?.revokedAt) return false
    if (job.kind === 'cards') return ready(c) && r.status === 'PENDING' && Date.parse(r.expiresAt) > now().getTime()
      && r.corpId === c.directorySync.corpId
      && r.configRevision === c.bindingApproval.revision && guard(c, r.userId) === r.profileGuard
      && c.bindingApproval.approverUserIds.includes(job.userId) && repairApprovalEligible(c, job.userId)
    return ['APPROVED', 'REJECTED'].includes(r.status)
      && (job.userId === r.userId || (c.bindingApproval.approverUserIds.includes(job.userId) && repairApprovalEligible(c, job.userId)))
  }
  const patch = (job, status) => {
    const c = getCredentials(), r = c?.bindingApproval?.requests.find((r) => r.id === job.requestId)
    if (!r || !r[job.kind].some((d) => d.id === job.id)) return
    commit(replaceRequest(c, { ...r, [job.kind]: r[job.kind].map((d) => d.id === job.id ? { ...d, status, attemptedAt: d.attemptedAt ?? now().toISOString() } : d) }))
  }
  const flush = async () => {
    if (running) return
    running = true
    try {
      const before = getCredentials(), current = reconcileRepairApprovals(before, now())
      if (current !== before) commit(current)
      if (!enabled() || !runtime().status().connected) return
      const jobs = (getCredentials()?.bindingApproval?.requests ?? []).flatMap((r) => ['cards', 'notices'].flatMap((kind) =>
        r[kind].filter((d) => d.status === 'QUEUED').map((d) => ({ ...d, requestId: r.id, kind })))).slice(0, 20)
      for (const job of jobs) {
        patch(job, 'SENDING')
        if (!allowed(job)) { patch(job, 'CANCELLED'); continue }
        const request = getCredentials().bindingApproval.requests.find((r) => r.id === job.requestId)
        const body = job.kind === 'cards' ? { msgtype: 'template_card', template_card: repairApprovalCard(request, job, getHotels()) }
          : { msgtype: 'markdown', markdown: { content: `绑定审批结果：${request.status === 'APPROVED' ? '已通过' : '已拒绝'}。申请编号 ${request.id.slice(0, 8)}。${job.userId === request.userId ? '发送“申请状态”查看详情。' : '另一位审批人已处理，无需重复操作。'}` } }
        let status
        try { const ack = await runtime().sendBindingMessage({ ...job, body }); status = ack?.errcode === 0 ? 'SENT' : 'UNKNOWN' }
        catch { status = 'UNKNOWN' }
        patch(job, status)
      }
    } finally { running = false }
  }
  return { allowed, flush }
}
