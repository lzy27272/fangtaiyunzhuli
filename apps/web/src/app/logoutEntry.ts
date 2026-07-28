type LogoutBrowser = {
  location: Pick<Location, 'href'>
  history: Pick<History, 'replaceState'>
}

export function consumeLogoutEntry(
  clearSession: () => void,
  browser: LogoutBrowser = window,
): boolean {
  let url: URL
  try {
    url = new URL(browser.location.href)
  } catch {
    return false
  }

  if (url.searchParams.get('logout') !== '1') return false

  clearSession()
  url.searchParams.delete('logout')
  const search = url.searchParams.toString()
  browser.history.replaceState(null, '', `${url.pathname}${search ? `?${search}` : ''}#/`)
  return true
}
