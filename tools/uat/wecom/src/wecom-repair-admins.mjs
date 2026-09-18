import { createHash, createDecipheriv, timingSafeEqual } from 'node:crypto'
import { normalizeDirectoryRead } from './wecom-directory-read.mjs'

const userIdPattern = /^[^\s\x00-\x1f\x7f]{1,128}$/u
const hotelIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u
const fail = (code) => { throw new Error(`WECOM_REPAIR_ADMIN_${code}`) }
const fingerprint = (value) => createHash('sha256').update(value).digest('hex')
const plainObject = (value) => value && typeof value === 'object' && !Array.isArray(value)
const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const registrationTtl = 24 * 60 * 60_000
const normalizeRegistration = (value) => {
  if (value == null) return null
  if (!plainObject(value) || !validTime(value.requestedAt)
    || !/^[a-f0-9]{64}$/u.test(value.botFingerprint ?? '')
    || typeof value.corpId !== 'string' || value.corpId.length > 128) fail('REGISTRATION_INVALID')
  return { requestedAt: value.requestedAt, botFingerprint: value.botFingerprint, corpId: value.corpId }
}
const registrationCurrent = (credentials, registration, now) => Boolean(registration
  && registration.botFingerprint === fingerprint(credentials.botId)
  && registration.corpId === (credentials.directorySync?.corpId ?? '')
  && Date.parse(registration.requestedAt) <= now.getTime()
  && now.getTime() - Date.parse(registration.requestedAt) < registrationTtl)

export const normalizeRepairAdminName = (value) => {
  const name = String(value ?? '').trim()
  if (name.length > 60 || /[\x00-\x1f\x7f]/u.test(name)) fail('NAME_INVALID')
  return name
}

export const normalizeRepairAdminHotelIds = (value) => {
  if (!Array.isArray(value) || value.length > 200
    || value.some((id) => typeof id !== 'string' || !hotelIdPattern.test(id))) {
    fail('HOTELS_INVALID')
  }
  return [...new Set(value)].sort()
}

export const normalizeRepairDirectory = (value) => {
  if (value == null) return null
  if (!plainObject(value) || typeof value.enabled !== 'boolean'
    || !/^[A-Za-z0-9_-]{3,128}$/u.test(value.corpId ?? '')
    || !/^[A-Za-z0-9]{3,32}$/u.test(value.token ?? '')
    || !/^[A-Za-z0-9+/]{43}$/u.test(value.encodingAesKey ?? '')
    || Buffer.from(`${value.encodingAesKey}=`, 'base64').length !== 32) {
    fail('DIRECTORY_CONFIG_INVALID')
  }
  return {
    enabled: value.enabled, corpId: value.corpId,
    token: value.token, encodingAesKey: value.encodingAesKey,
    verifiedAt: validTime(value.verifiedAt) ? value.verifiedAt : null,
    lastEventAt: validTime(value.lastEventAt) ? value.lastEventAt : null,
    lastEventResult: ['REVOKED', 'UPDATED', 'UNMATCHED', 'IGNORED'].includes(value.lastEventResult)
      ? value.lastEventResult : null,
  }
}

// Stored inside the existing encrypted credential transaction, never in public status.
export const normalizeRepairAdminState = (candidate) => {
  const input = candidate?.userProfiles ?? {}
  if (!plainObject(input) || Object.keys(input).length > 4000) fail('PROFILES_INVALID')
  const userProfiles = Object.fromEntries(Object.entries(input).map(([userId, value]) => {
    if (!userIdPattern.test(userId) || !plainObject(value)) fail('PROFILES_INVALID')
    const directoryUserId = String(value.directoryUserId ?? '').trim()
    if (directoryUserId && !userIdPattern.test(directoryUserId)) fail('DIRECTORY_USER_INVALID')
    return [userId, {
      displayName: normalizeRepairAdminName(value.displayName),
      nameSource: value.nameSource === 'APPLICANT_PROVIDED' ? 'APPLICANT_PROVIDED' : 'ADMIN_REMARK',
      role: value.role === 'OPERATIONS_MANAGER' ? 'OPERATIONS_MANAGER' : 'STORE_MANAGER',
      directoryUserId,
      directoryLinkedAt: validTime(value.directoryLinkedAt) ? value.directoryLinkedAt : null,
      boundAt: validTime(value.boundAt) ? value.boundAt : null,
      updatedAt: validTime(value.updatedAt) ? value.updatedAt : null,
      revokedAt: validTime(value.revokedAt) ? value.revokedAt : null,
      revokeReason: ['MANUAL', 'MEMBER_DELETED', 'MEMBER_DISABLED'].includes(value.revokeReason)
        ? value.revokeReason : null,
      pendingHotelIds: normalizeRepairAdminHotelIds(value.pendingHotelIds ?? []),
      preauthorizedAt: validTime(value.preauthorizedAt) ? value.preauthorizedAt : null,
      activationCorpId: String(value.activationCorpId ?? ''),
      activatedAt: validTime(value.activatedAt) ? value.activatedAt : null,
      ...(value.registration == null ? {} : { registration: normalizeRegistration(value.registration) }),
    }]
  }))
  return { userProfiles, directorySync: normalizeRepairDirectory(candidate?.directorySync),
    directoryRead: normalizeDirectoryRead(candidate?.directoryRead) }
}

export const repairAdminRoster = (credentials, hotels, now = new Date()) => {
  const profiles = credentials?.userProfiles ?? {}
  const globalUsers = credentials?.allowedUserIds ?? []
  const scopes = credentials?.hotelAllowedUserIds ?? {}
  const directoryRead = credentials?.directoryRead
  const names = new Map(directoryRead?.enabled && directoryRead.corpId === credentials?.directorySync?.corpId
    ? directoryRead.members.map((m) => [m.userId, m.name]) : [])
  const allUsers = new Set([...globalUsers, ...Object.values(scopes).flat(), ...Object.keys(profiles)])
  return [...allUsers].map((userId) => {
    const profile = profiles[userId] ?? {}
    const hotelIds = Object.entries(scopes).filter(([, ids]) => ids.includes(userId)).map(([id]) => id)
    const globalRecipient = globalUsers.includes(userId)
    const pendingHotelIds = profile.revokedAt ? [] : profile.pendingHotelIds ?? []
    // Names are presentation only: never infer an offboarding link or a grant.
    // A reviewed directory ID takes precedence; never fall back if it is missing.
    const linkedAccount = profile.directoryUserId && profile.directoryLinkedAt ? profile.directoryUserId : null
    const wecomName = profile.revokedAt ? null : names.get(linkedAccount || userId) ?? null
    return {
      memberId: fingerprint(userId),
      // Account identifiers are visible only on the platform-admin endpoint.
      userId, displayName: profile.displayName || '待补充姓名',
      nameSource: profile.displayName ? profile.nameSource ?? 'ADMIN_REMARK' : 'UNSET',
      wecomName, wecomNameMatch: wecomName ? linkedAccount ? 'LINKED_ACCOUNT' : 'EXACT_ACCOUNT' : 'UNMATCHED',
      role: profile.role ?? (hotelIds.length > 1 ? 'OPERATIONS_MANAGER' : 'STORE_MANAGER'),
      globalRecipient, hotelIds,
      hotels: hotels.filter((hotel) => hotelIds.includes(hotel.hotelId))
        .map(({ hotelId, hotelCode, hotelName }) => ({ hotelId, hotelCode, displayName: hotelName })),
      active: globalRecipient || hotelIds.length > 0,
      activationStatus: profile.revokedAt ? 'REVOKED' : globalRecipient || hotelIds.length > 0
        ? 'ACTIVE' : pendingHotelIds.length ? 'PENDING' : profile.registration ? 'REQUESTED' : 'UNASSIGNED',
      registrationRequestedAt: profile.registration?.requestedAt ?? null,
      registrationCurrent: registrationCurrent(credentials, profile.registration, now),
      pendingHotelIds,
      identityReviewRequired: pendingHotelIds.length > 0 && profile.activationCorpId !== credentials?.directorySync?.corpId,
      pendingHotels: hotels.filter((hotel) => pendingHotelIds.includes(hotel.hotelId))
        .map(({ hotelId, hotelCode, hotelName }) => ({ hotelId, hotelCode, displayName: hotelName })),
      preauthorizedAt: profile.preauthorizedAt ?? null,
      activatedAt: profile.activatedAt ?? null,
      directoryUserId: profile.directoryUserId ?? '',
      offboardingLinked: Boolean(profile.directoryUserId && profile.directoryLinkedAt),
      boundAt: profile.boundAt ?? null,
      revokedAt: profile.revokedAt ?? null, revokeReason: profile.revokeReason ?? null,
    }
  }).sort((a, b) => Number(b.active) - Number(a.active) || a.displayName.localeCompare(b.displayName))
}

export const bindRepairAdminToHotels = ({ credentials, userId, hotelIds, hotels,
  displayName, role, now = new Date() }) => {
  const selected = normalizeRepairAdminHotelIds(hotelIds)
  if (!selected.length || selected.some((id) => !hotels.some((h) => h.hotelId === id))) fail('HOTELS_INVALID')
  if (!userIdPattern.test(userId)) fail('USER_INVALID')
  if (credentials.userProfiles?.[userId]?.revokedAt) fail('MEMBER_REVOKED')
  const scopes = { ...credentials.hotelAllowedUserIds }
  for (const id of selected) {
    const ids = [...new Set([...(scopes[id] ?? []), userId])]
    if (ids.length > 20) fail('CAPACITY_REACHED')
    scopes[id] = ids
  }
  const profile = credentials.userProfiles?.[userId] ?? {}
  return {
    ...credentials, hotelAllowedUserIds: scopes,
    userProfiles: { ...credentials.userProfiles, [userId]: {
      ...profile,
      displayName: normalizeRepairAdminName(displayName || profile.displayName),
      role: role ?? profile.role ?? (selected.length > 1 ? 'OPERATIONS_MANAGER' : 'STORE_MANAGER'),
      pendingHotelIds: [],
      registration: null,
      boundAt: profile.boundAt ?? now.toISOString(), updatedAt: now.toISOString(),
    } },
  }
}

export const updateRepairAdmin = ({ credentials, memberId, action, displayName,
  role, hotelIds, directoryUserId, directoryIdentityConfirmed, hotels, now = new Date() }) => {
  const member = repairAdminRoster(credentials, hotels).find((row) => row.memberId === memberId)
  if (!member || (!member.active && !['PENDING', 'REQUESTED'].includes(member.activationStatus))) fail('MEMBER_NOT_FOUND')
  const userId = member.userId
  const timestamp = now.toISOString()
  const profile = credentials.userProfiles?.[userId] ?? {}
  if (action === 'REVOKE') return revokeRepairAdmin(credentials, userId, 'MANUAL', timestamp)
  if (!member.active) fail('ACTION_INVALID')
  if (action !== 'EDIT') fail('ACTION_INVALID')
  const selected = normalizeRepairAdminHotelIds(hotelIds)
  if ((!member.globalRecipient && !selected.length)
    || selected.some((id) => !hotels.some((h) => h.hotelId === id))) fail('HOTELS_INVALID')
  const name = normalizeRepairAdminName(displayName)
  if (!name || !['STORE_MANAGER', 'OPERATIONS_MANAGER'].includes(role)) fail('NAME_INVALID')
  const directoryId = String(directoryUserId ?? '').trim()
  if (directoryId && !userIdPattern.test(directoryId)) fail('DIRECTORY_USER_INVALID')
  const changedIdentity = directoryId !== (profile.directoryUserId ?? '')
  if (changedIdentity && directoryId && directoryIdentityConfirmed !== true) fail('IDENTITY_CONFIRM_REQUIRED')
  if (directoryId && Object.entries(credentials.userProfiles ?? {}).some(([id, p]) =>
    id !== userId && p.directoryUserId === directoryId && !p.revokedAt)) fail('DIRECTORY_USER_DUPLICATE')
  const scopes = Object.fromEntries(Object.entries(credentials.hotelAllowedUserIds ?? {})
    .map(([id, ids]) => [id, ids.filter((candidate) => candidate !== userId)]))
  for (const id of selected) {
    const ids = [...(scopes[id] ?? []), userId]
    if (ids.length > 20) fail('CAPACITY_REACHED')
    scopes[id] = ids
  }
  return { ...credentials, hotelAllowedUserIds: scopes,
    userProfiles: { ...credentials.userProfiles, [userId]: {
      ...profile, displayName: name, nameSource: 'ADMIN_REMARK', role, directoryUserId: directoryId,
      pendingHotelIds: [],
      directoryLinkedAt: directoryId
        ? (changedIdentity ? timestamp : profile.directoryLinkedAt ?? timestamp) : null,
      updatedAt: timestamp,
    } } }
}

const revokeRepairAdmin = (credentials, userId, reason, timestamp) => ({
  ...credentials,
  allowedUserId: null,
  allowedUserIds: credentials.allowedUserIds.filter((id) => id !== userId),
  hotelAllowedUserIds: Object.fromEntries(Object.entries(credentials.hotelAllowedUserIds)
    .map(([id, ids]) => [id, ids.filter((candidate) => candidate !== userId)])),
  userProfiles: { ...credentials.userProfiles, [userId]: {
    ...credentials.userProfiles?.[userId], revokedAt: timestamp,
    pendingHotelIds: [],
    registration: null,
    revokeReason: reason, updatedAt: timestamp,
  } },
})

// Only explicit private messages from the configured bot create candidates, never grants.
export const registerRepairAdmin = ({ credentials, frame, now = new Date() }) => {
  const b = frame?.body
  const userId = b?.from?.userid
  if (!credentials || b?.aibotid !== credentials.botId || typeof userId !== 'string' || !userIdPattern.test(userId)
    || b?.msgtype !== 'text' || b?.chattype !== 'single' || b.chatid
    || typeof b.msgid !== 'string' || !userIdPattern.test(b.msgid)
    || (b.from.corpid && credentials.directorySync?.corpId && b.from.corpid !== credentials.directorySync.corpId)
    || (b.create_time != null && (!Number.isFinite(Number(b.create_time))
      || Math.abs(now.getTime() - Number(b.create_time) * 1000) > 10 * 60_000))) fail('REGISTRATION_IDENTITY_INVALID')
  const match = String(b.text?.content ?? '').trim().match(/^激活(?:\s+([^\r\n]+))?$/u)
  if (!match) fail('REGISTRATION_INVALID')
  const name = normalizeRepairAdminName(match[1])
  if (/[<>\u202a-\u202e\u2066-\u2069]/u.test(name)) fail('NAME_INVALID')
  const previous = credentials.userProfiles?.[userId]
  if (previous?.revokedAt) fail('MEMBER_REVOKED')
  if ((credentials.allowedUserIds ?? []).includes(userId)
    || Object.values(credentials.hotelAllowedUserIds ?? {}).some((ids) => ids.includes(userId))) return { credentials, status: 'ACTIVE' }
  if (previous?.pendingHotelIds?.length) return { credentials, status: 'PREAUTHORIZED' }
  // Do not invalidate a pending private-card approval by changing its applicant profile.
  if (credentials.bindingApproval?.requests?.some((r) => r.userId === userId && r.status === 'PENDING'
    && Date.parse(r.expiresAt) > now.getTime())) return { credentials, status: 'APPROVAL_PENDING' }
  if (registrationCurrent(credentials, previous?.registration, now)
    && (previous.displayName || !name)) return { credentials, status: 'REQUESTED' }
  const profiles = credentials.userProfiles ?? {}
  if ((!previous && Object.keys(profiles).length >= 4000)
    || (!previous?.registration && Object.values(profiles).filter((p) => p.registration).length >= 500)) fail('REGISTRATION_CAPACITY_REACHED')
  return { status: 'REQUESTED', credentials: { ...credentials, userProfiles: { ...profiles, [userId]: {
    ...previous, displayName: previous?.displayName || name,
    nameSource: previous?.displayName ? previous.nameSource : 'APPLICANT_PROVIDED',
    registration: { requestedAt: now.toISOString(), botFingerprint: fingerprint(credentials.botId),
      corpId: credentials.directorySync?.corpId ?? '' },
    updatedAt: now.toISOString(),
  } } } }
}

export const approveRepairAdminRegistration = ({ credentials, memberId, hotelIds, displayName,
  role, identityConfirmed, hotels, now = new Date() }) => {
  const member = repairAdminRoster(credentials, hotels, now).find((m) => m.memberId === memberId)
  if (!member || member.activationStatus !== 'REQUESTED' || !member.registrationCurrent) fail('REGISTRATION_STALE')
  if (identityConfirmed !== true) fail('REGISTRATION_CONFIRM_REQUIRED')
  const name = normalizeRepairAdminName(displayName)
  if (!name || !['STORE_MANAGER', 'OPERATIONS_MANAGER'].includes(role)) fail('NAME_INVALID')
  const selected = normalizeRepairAdminHotelIds(hotelIds)
  // Respect seats already reserved for manually preauthorized staff as well.
  for (const id of selected) {
    const occupants = new Set(credentials.hotelAllowedUserIds[id] ?? [])
    for (const [userId, profile] of Object.entries(credentials.userProfiles ?? {})) {
      if (!profile.revokedAt && profile.pendingHotelIds?.includes(id)) occupants.add(userId)
    }
    occupants.add(member.userId)
    if (occupants.size > 20) fail('CAPACITY_REACHED')
  }
  const next = bindRepairAdminToHotels({ credentials, userId: member.userId, hotelIds: selected,
    displayName: name, role, hotels, now })
  next.userProfiles[member.userId] = { ...next.userProfiles[member.userId], nameSource: 'ADMIN_REMARK', activatedAt: now.toISOString() }
  return next
}

// An administrator preauthorizes an exact account; names are never used as identity.
// Pending scopes are NOT put in the runtime allowlists until a matching bot event arrives.
export const preauthorizeRepairAdmin = ({ credentials, userId, displayName, role,
  hotelIds, directoryUserId, directoryIdentityConfirmed, hotels, now = new Date() }) => {
  if (!userIdPattern.test(userId ?? '')) fail('USER_INVALID')
  const member = repairAdminRoster(credentials, hotels).find((m) => m.userId === userId)
  if (credentials.userProfiles?.[userId]?.revokedAt) fail('MEMBER_REVOKED')
  if (member?.active) {
    return updateRepairAdmin({ credentials, memberId: member.memberId, action: 'EDIT',
      displayName, role, hotelIds, directoryUserId: member.directoryUserId, hotels, now })
  }
  const directory = credentials.directorySync
  if (!directory?.enabled || !directory.verifiedAt) fail('DIRECTORY_NOT_VERIFIED')
  if (directoryIdentityConfirmed !== true) fail('IDENTITY_CONFIRM_REQUIRED')
  if (!userIdPattern.test(directoryUserId ?? '')) fail('DIRECTORY_USER_INVALID')
  if (Object.entries(credentials.userProfiles ?? {}).some(([id, p]) => id !== userId
    && p.directoryUserId === directoryUserId)) fail('DIRECTORY_USER_DUPLICATE')
  const selected = normalizeRepairAdminHotelIds(hotelIds)
  const name = normalizeRepairAdminName(displayName)
  if (!name || !['STORE_MANAGER', 'OPERATIONS_MANAGER'].includes(role)) fail('NAME_INVALID')
  if (!selected.length || selected.some((id) => !hotels.some((h) => h.hotelId === id))) fail('HOTELS_INVALID')
  for (const id of selected) {
    const occupants = new Set(credentials.hotelAllowedUserIds[id] ?? [])
    for (const [candidateId, p] of Object.entries(credentials.userProfiles ?? {})) {
      if (!p.revokedAt && p.pendingHotelIds?.includes(id)) occupants.add(candidateId)
    }
    occupants.add(userId)
    if (occupants.size > 20) fail('CAPACITY_REACHED')
  }
  const timestamp = now.toISOString()
  const previous = credentials.userProfiles?.[userId]
  return { ...credentials, userProfiles: { ...credentials.userProfiles, [userId]: {
    ...previous, displayName: name, nameSource: 'ADMIN_REMARK', role,
    directoryUserId, directoryLinkedAt: previous?.directoryUserId === directoryUserId
      ? previous.directoryLinkedAt ?? timestamp : timestamp,
    pendingHotelIds: selected, preauthorizedAt: timestamp,
    registration: null,
    activationCorpId: directory.corpId, updatedAt: timestamp,
  } } }
}

export const activatePreauthorizedRepairAdmin = ({ credentials, frame, hotels, now = new Date() }) => {
  const body = frame?.body
  const userId = body?.from?.userid
  const profile = credentials?.userProfiles?.[userId]
  const unchanged = { credentials, activated: false }
  if (!profile?.pendingHotelIds?.length || profile.revokedAt) return unchanged
  const isEntry = body?.msgtype === 'event' && body?.event?.eventtype === 'enter_chat'
  if ((!isEntry && (body?.chattype !== 'single' || body?.msgtype !== 'text')) || body?.chattype === 'group'
    || body?.chatid || body?.aibotid !== credentials.botId) return unchanged
  const directory = credentials.directorySync
  if (!directory?.enabled || !directory.verifiedAt || directory.corpId !== profile.activationCorpId
    || (body.from.corpid && body.from.corpid !== profile.activationCorpId)) return unchanged
  // enter_chat always carries create_time; messages from older clients may not.
  const eventTime = Number(body.create_time) * 1000
  if (isEntry && (!Number.isFinite(eventTime) || eventTime <= 0)) return unchanged
  if (body.create_time != null && (!Number.isFinite(eventTime)
    || eventTime < Math.floor(Date.parse(profile.preauthorizedAt) / 1000) * 1000
    || eventTime > now.getTime() + 60_000 || now.getTime() - eventTime > 10 * 60_000)) return unchanged
  const next = bindRepairAdminToHotels({ credentials, userId, hotelIds: profile.pendingHotelIds,
    displayName: profile.displayName, role: profile.role, hotels, now })
  next.userProfiles[userId] = { ...next.userProfiles[userId], pendingHotelIds: [], activatedAt: now.toISOString() }
  return { credentials: next, activated: true, userId, hotelIds: profile.pendingHotelIds }
}

// WeCom uses SHA-1 signatures and AES-256-CBC with a 32-byte PKCS#7 block.
// Same protocol as core-api's WeComCallbackCrypto, with bounded XML and freshness checks.
export const decryptRepairDirectoryCallback = ({ config, signature, timestamp, nonce,
  encrypted, now = new Date() }) => {
  const current = normalizeRepairDirectory(config)
  if (!current?.enabled) fail('DIRECTORY_DISABLED')
  if (!/^[a-f0-9]{40}$/iu.test(signature ?? '') || !/^\d{10}$/u.test(timestamp ?? '')
    || Math.abs(now.getTime() - Number(timestamp) * 1000) > 10 * 60_000
    || typeof nonce !== 'string' || !nonce.length || nonce.length > 128
    || typeof encrypted !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encrypted)
    || encrypted.length > 90_000) fail('CALLBACK_INVALID')
  const expected = createHash('sha1').update([current.token, timestamp, nonce, encrypted].sort().join('')).digest()
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) fail('CALLBACK_INVALID')
  try {
    const key = Buffer.from(`${current.encodingAesKey}=`, 'base64')
    const cipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16))
    cipher.setAutoPadding(false)
    const padded = Buffer.concat([cipher.update(Buffer.from(encrypted, 'base64')), cipher.final()])
    const pad = padded.at(-1)
    if (!pad || pad > 32 || padded.length < pad
      || !padded.subarray(-pad).every((byte) => byte === pad)) fail('CALLBACK_INVALID')
    const plain = padded.subarray(0, -pad)
    if (plain.length < 20) fail('CALLBACK_INVALID')
    const length = plain.readUInt32BE(16)
    if (20 + length >= plain.length || plain.subarray(20 + length).toString('utf8') !== current.corpId) fail('CALLBACK_INVALID')
    return plain.subarray(20, 20 + length).toString('utf8')
  } catch { fail('CALLBACK_INVALID') }
}

export const repairDirectoryXmlField = (xml, field, required = true) => {
  if (typeof xml !== 'string' || xml.length > 65_536 || /<!DOCTYPE|<!ENTITY/iu.test(xml)
    || !/^\s*(?:<\?xml[^?]*\?>\s*)?<xml>[\s\S]*<\/xml>\s*$/u.test(xml)) fail('CALLBACK_INVALID')
  const matches = [...xml.matchAll(new RegExp(`<${field}>([\\s\\S]*?)<\\/${field}>`, 'gu'))]
  if (!matches.length && !required) return ''
  if (matches.length !== 1) fail('CALLBACK_INVALID')
  const text = matches[0][1]
  if (text.startsWith('<![CDATA[') && text.endsWith(']]>')) return text.slice(9, -3)
  if (/[<>]/u.test(text)) fail('CALLBACK_INVALID')
  return text.replace(/&(amp|lt|gt|quot|apos);/gu, (_, entity) =>
    ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity])
}

export const applyRepairDirectoryEvent = ({ credentials, xml, now = new Date() }) => {
  const config = credentials.directorySync
  if (!config?.enabled) fail('DIRECTORY_DISABLED')
  if (repairDirectoryXmlField(xml, 'ToUserName') !== config.corpId) fail('CALLBACK_INVALID')
  const eventType = repairDirectoryXmlField(xml, 'Event', false)
  const change = repairDirectoryXmlField(xml, 'ChangeType', false)
  if (repairDirectoryXmlField(xml, 'MsgType') !== 'event' || eventType !== 'change_contact'
    || !['delete_user', 'update_user'].includes(change)) return { credentials, changed: false, result: 'IGNORED', revoked: [] }
  const userId = repairDirectoryXmlField(xml, 'UserID')
  const createTime = repairDirectoryXmlField(xml, 'CreateTime')
  if (!userIdPattern.test(userId) || !/^\d{10}$/u.test(createTime)
    || Number(createTime) * 1000 > now.getTime() + 60_000) fail('CALLBACK_INVALID')
  const disabled = change === 'update_user' && repairDirectoryXmlField(xml, 'Status', false) === '2'
  const mapped = Object.entries(credentials.userProfiles ?? {}).filter(([, profile]) =>
    profile.directoryUserId === userId && profile.directoryLinkedAt
    && Math.floor(Date.parse(profile.directoryLinkedAt) / 1000) <= Number(createTime) && !profile.revokedAt)
  if (!mapped.length && Object.values(credentials.userProfiles ?? {}).some((p) =>
    p.directoryUserId === userId && p.revokedAt)) {
    return { credentials, changed: false, result: 'IGNORED', revoked: [] }
  }
  let next = credentials
  const revoked = []
  let updated = false
  for (const [botUserId] of mapped) {
    if (change === 'delete_user' || disabled) {
      next = revokeRepairAdmin(next, botUserId, disabled ? 'MEMBER_DISABLED' : 'MEMBER_DELETED', now.toISOString())
      revoked.push(fingerprint(botUserId))
    } else if (change === 'update_user') {
      const newUserId = repairDirectoryXmlField(xml, 'NewUserID', false)
      if (newUserId && newUserId !== userId) {
        if (!userIdPattern.test(newUserId) || Object.entries(next.userProfiles).some(([id, p]) =>
          id !== botUserId && !p.revokedAt && p.directoryUserId === newUserId)) fail('DIRECTORY_USER_DUPLICATE')
        next = { ...next, userProfiles: { ...next.userProfiles, [botUserId]: {
          ...next.userProfiles[botUserId], directoryUserId: newUserId, updatedAt: now.toISOString(),
          // Do not let a renamed/reused account consume an old pending authorization.
          ...(next.userProfiles[botUserId].pendingHotelIds?.length ? { activationCorpId: '' } : {}),
        } } }
        updated = true
      }
    }
  }
  const result = revoked.length ? 'REVOKED' : updated ? 'UPDATED' : mapped.length ? 'IGNORED' : 'UNMATCHED'
  return { credentials: { ...next, directorySync: {
    ...config, lastEventAt: now.toISOString(), lastEventResult: result,
  } }, changed: true, result, revoked }
}
