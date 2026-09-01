export type OtaRole =
  | 'PLATFORM_ADMIN'
  | 'OTA_OPERATION_ASSISTANT'
  | 'OTA_OPERATION_MANAGER'
  | 'CEO'
  | 'REGIONAL_MANAGER'
  | 'GENERAL_MANAGER'
  | 'REVENUE_MANAGER'
  | 'HOTEL_P1_HANDLER'

export interface AuthenticatedAccount {
  id: string
  displayName: string
  roles: OtaRole[]
  hotelIds: string[] | null
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
      hotelIds: session.account.hotelIds
        ? Object.freeze([...session.account.hotelIds]) as string[]
        : null,
    }),
  })
}

export function clearSession(): void {
  currentSession = null
}
