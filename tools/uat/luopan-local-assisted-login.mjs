import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { decryptCookie } from './report-source-cookie-crypto.mjs'
import { startLuopanAssistedLogin } from './luopan-assisted-login.mjs'
import { luopanProfilePaths } from './luopan-profile.mjs'

const toolRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(toolRoot, '..', '..')
const runtimeRoot = path.join(repoRoot, '.uat-runtime', 'ota-review')
const hotelId = process.argv[2]?.trim()
const secretKey = process.env.OTA_REVIEW_SECRET_KEY?.trim()

if (!/^[0-9a-f-]{36}$/iu.test(hotelId ?? '')) {
  throw new Error('HOTEL_ID_INVALID')
}
if (!secretKey) throw new Error('OTA_REVIEW_SECRET_KEY_MISSING')

const [encryptedByHotel, browserConfigsByHotel] = await Promise.all([
  readFile(path.join(runtimeRoot, 'pms-login-secrets.json'), 'utf8')
    .then(JSON.parse),
  readFile(path.join(runtimeRoot, 'luopan-browser-configs.json'), 'utf8')
    .then(JSON.parse),
])
const encrypted = encryptedByHotel[hotelId]
const browserConfig = browserConfigsByHotel[hotelId]
if (!encrypted) throw new Error('PMS_LOGIN_CREDENTIALS_NOT_CONFIGURED')
if (
  !browserConfig
  || browserConfig.providerCode !== 'LUOPAN_CLOUD'
  || browserConfig.enabled !== true
  || typeof browserConfig.profileRef !== 'string'
) {
  throw new Error('LUOPAN_BROWSER_CONFIG_NOT_READY')
}

let credentials
try {
  credentials = JSON.parse(
    decryptCookie(encrypted, secretKey, `pms-login:${hotelId}`),
  )
  if (
    typeof credentials?.username !== 'string'
    || typeof credentials?.password !== 'string'
  ) {
    throw new Error('PMS_LOGIN_CREDENTIALS_INVALID')
  }
} catch (error) {
  throw new Error(
    error?.message === 'PMS_LOGIN_CREDENTIALS_INVALID'
      ? error.message
      : 'PMS_LOGIN_CREDENTIALS_UNREADABLE',
  )
}

const login = await startLuopanAssistedLogin({
  profileRef: browserConfig.profileRef,
  credentials,
})
credentials = null

const { runtimeRoot: profileRuntimeRoot } = luopanProfilePaths({
  repoRoot,
  profileName: browserConfig.profileRef,
})
const captchaPath = path.join(profileRuntimeRoot, 'local-login-captcha.png')

try {
  if (login.alreadyAuthenticated) {
    process.stdout.write(`${JSON.stringify({
      status: 'ALREADY_AUTHENTICATED',
      hotelId,
      profileRef: browserConfig.profileRef,
    })}\n`)
    process.exitCode = 0
  } else {
    await writeFile(captchaPath, login.captcha)
    process.stdout.write(`${JSON.stringify({
      status: 'WAITING_FOR_CAPTCHA',
      hotelId,
      profileRef: browserConfig.profileRef,
      captchaPath,
    })}\n`)
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    })
    const answer = (await readline.question('CAPTCHA> ')).trim()
    readline.close()
    if (!/^[a-z0-9]{4,8}$/iu.test(answer)) {
      throw new Error('CAPTCHA_FORMAT_INVALID')
    }
    const result = await login.submit(answer)
    if (result.authenticated) {
      process.stdout.write(`${JSON.stringify({
        status: 'AUTHENTICATED',
        hotelId,
        profileRef: browserConfig.profileRef,
      })}\n`)
      process.exitCode = 0
    } else {
      if (result.captcha) await writeFile(captchaPath, result.captcha)
      process.stdout.write(`${JSON.stringify({
        status: 'AUTHENTICATION_NOT_COMPLETED',
        hotelId,
        profileRef: browserConfig.profileRef,
        reasonCode: result.reasonCode,
        captchaPath: result.captcha ? captchaPath : null,
      })}\n`)
      process.exitCode = 2
    }
  }
} finally {
  await login.close()
}
