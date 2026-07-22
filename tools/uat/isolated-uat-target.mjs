import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve a browser target from the active disposable UAT state file.
 * Mutating browser scripts must never accept PILOT_WEB_BASE or a public host.
 */
export async function resolveIsolatedUatWebBase(repoRoot) {
  if (process.env.PILOT_WEB_BASE) {
    throw new Error('PILOT_WEB_BASE is disabled for mutating UAT scripts; use a disposable UAT environment.')
  }
  const stateFile = path.resolve(
    process.env.HOTEL_AI_OS_UAT_STATE_FILE
      ?? path.join(repoRoot, 'docs', 'uat', 'evidence', 'runtime', 'uat-processes.json'),
  )
  if (!existsSync(stateFile)) {
    throw new Error(`Disposable UAT state is missing: ${stateFile}. Run Start-UatEnvironment.ps1 first.`)
  }
  const state = JSON.parse(await readFile(stateFile, 'utf8'))
  if (state.purpose !== 'ISOLATED_UAT') throw new Error('UAT state does not declare purpose=ISOLATED_UAT.')
  if (!state.webUrl) throw new Error('The disposable UAT state has no webUrl. Start it without -SkipWeb.')

  const target = new URL(state.webUrl)
  if (target.protocol !== 'http:' || !LOOPBACK_HOSTS.has(target.hostname)) {
    throw new Error(`Mutating UAT scripts require a loopback HTTP target, received ${target.origin}.`)
  }
  const createdAt = Date.parse(state.createdAt)
  const expiresAt = Date.parse(state.expiresAt)
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    throw new Error('Disposable UAT state is missing a valid lifetime or has expired. Restart the UAT environment.')
  }
  if (!processIsRunning(Number(state.webPid))) {
    throw new Error('The web process recorded by the disposable UAT state is no longer running.')
  }
  return target.origin
}

export function requireExplicitUatFile(variableName) {
  const value = process.env[variableName]
  if (!value) throw new Error(`${variableName} must explicitly point to disposable-UAT credentials.`)
  return path.resolve(value)
}
