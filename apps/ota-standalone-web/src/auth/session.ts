export type OtaRole =
  | 'PLATFORM_ADMIN'
  | 'OTA_OPERATION_ASSISTANT'
  | 'OTA_OPERATION_MANAGER'
  | 'CEO'
  | 'REGIONAL_MANAGER'
  | 'REVENUE_MANAGER'
  | 'HOTEL_P1_HANDLER'

export interface AuthenticatedAccount {
  id: string
  displayName: string
  roles: OtaRole[]
}

export interface AuthSession {
  accessToken: string
  expiresInSeconds: number
  username: string
  account: AuthenticatedAccount
}

let currentSession: AuthSession | null = null

export function getSession(): AuthSession | null {
  return currentSession
}

export function setSession(session: AuthSession): void {
  currentSession = Object.freeze({
    ...session,
    account: Object.freeze({
      ...session.account,
      roles: Object.freeze([...session.account.roles]) as OtaRole[],
    }),
  })
}

export function clearSession(): void {
  currentSession = null
}
