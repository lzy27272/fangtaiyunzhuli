import type { BrowserAuthorizationRehearsalView } from '../api/business'

export function selectCurrentConfigAttempt(
  latest: BrowserAuthorizationRehearsalView | null,
  currentConfigVersion: number,
): BrowserAuthorizationRehearsalView | null {
  if (latest === null || latest.configVersion !== currentConfigVersion) {
    return null
  }
  return latest
}
