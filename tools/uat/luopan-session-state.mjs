const allowedCookieDomain = (value) => {
  const domain = String(value ?? '').trim().toLowerCase()
  return [
    'chinapms.com',
    '.chinapms.com',
    'bj.chinapms.com',
    '.bj.chinapms.com',
  ].includes(domain)
}

const allowedOrigin = (value) =>
  String(value ?? '').trim().toLowerCase()
    === 'http://bj.chinapms.com:8880'

const boundedText = (value, minimum, maximum) =>
  typeof value === 'string'
  && value.length >= minimum
  && value.length <= maximum
  && !/[\r\n\u0000]/.test(value)

export const normalizeLuopanSessionState = (candidate) => {
  if (
    !candidate
    || typeof candidate !== 'object'
    || Array.isArray(candidate)
    || !Array.isArray(candidate.cookies)
    || candidate.cookies.length < 1
    || candidate.cookies.length > 200
    || !Array.isArray(candidate.origins)
    || candidate.origins.length > 10
  ) {
    throw new Error('LUOPAN_SESSION_STATE_INVALID')
  }

  const cookies = candidate.cookies.map((cookie) => {
    if (
      !cookie
      || typeof cookie !== 'object'
      || Array.isArray(cookie)
      || !boundedText(cookie.name, 1, 256)
      || !boundedText(cookie.value, 0, 8192)
      || !allowedCookieDomain(cookie.domain)
      || !boundedText(cookie.path, 1, 1024)
      || !String(cookie.path).startsWith('/')
      || !Number.isFinite(cookie.expires)
      || typeof cookie.httpOnly !== 'boolean'
      || typeof cookie.secure !== 'boolean'
      || !['Strict', 'Lax', 'None'].includes(cookie.sameSite)
    ) {
      throw new Error('LUOPAN_SESSION_STATE_INVALID')
    }
    return {
      name: cookie.name,
      value: cookie.value,
      domain: String(cookie.domain).trim().toLowerCase(),
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
    }
  })

  const origins = candidate.origins.map((origin) => {
    if (
      !origin
      || typeof origin !== 'object'
      || Array.isArray(origin)
      || !allowedOrigin(origin.origin)
      || !Array.isArray(origin.localStorage)
      || origin.localStorage.length > 100
    ) {
      throw new Error('LUOPAN_SESSION_STATE_INVALID')
    }
    return {
      origin: 'http://bj.chinapms.com:8880',
      localStorage: origin.localStorage.map((entry) => {
        if (
          !entry
          || typeof entry !== 'object'
          || Array.isArray(entry)
          || !boundedText(entry.name, 1, 512)
          || !boundedText(entry.value, 0, 8192)
        ) {
          throw new Error('LUOPAN_SESSION_STATE_INVALID')
        }
        return { name: entry.name, value: entry.value }
      }),
    }
  })

  return { cookies, origins }
}

export const applyLuopanSessionState = async (context, candidate) => {
  if (!candidate) return
  const state = normalizeLuopanSessionState(candidate)
  await context.addCookies(state.cookies)
  if (state.origins.some((origin) => origin.localStorage.length > 0)) {
    await context.addInitScript(({ origins }) => {
      const current = origins.find(
        (entry) => entry.origin === window.location.origin,
      )
      for (const entry of current?.localStorage ?? []) {
        window.localStorage.setItem(entry.name, entry.value)
      }
    }, { origins: state.origins })
  }
}
