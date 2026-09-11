import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readSource = (relativePath) => readFile(
  new URL(relativePath, import.meta.url),
  'utf8',
)

test('authenticated store console starts one existing Luopan challenge and submits by scoped hash', async () => {
  const api = await readSource('../../../tools/uat/ota-standalone-review-api.mjs')
  const routeStart = api.indexOf("suffix === '/luopan-quick-repair'")
  const routeEnd = api.indexOf("suffix === '/pms-login-config'", routeStart)
  const routes = api.slice(routeStart, routeEnd)

  assert.ok(routeStart > 0)
  assert.match(routes, /selected\.pmsSystemCode !== 'LUOPAN_CLOUD'/u)
  assert.match(routes, /START_LUOPAN_QUICK_REPAIR/u)
  assert.match(
    routes,
    /startLuopanRepairChallenge\([\s\S]{0,120}'MANUAL_CONSOLE_QUICK_REPAIR'/u,
  )
  assert.match(routes, /SUBMIT_LUOPAN_QUICK_REPAIR_CAPTCHA/u)
  assert.match(routes, /activeLuopanRepairsByHotel\.get\(hotelId\)/u)
  assert.match(routes, /processLuopanRepairSubmissionByHash/u)
  assert.doesNotMatch(routes, /tokenSha256:\s*body\./u)
})

test('quick repair view exposes only the active captcha and safe control metadata', async () => {
  const api = await readSource('../../../tools/uat/ota-standalone-review-api.mjs')
  const viewStart = api.indexOf('const luopanQuickRepairFor')
  const viewEnd = api.indexOf('const safeBieyanghongRepairReason', viewStart)
  const view = api.slice(viewStart, viewEnd)

  assert.ok(viewStart > 0)
  assert.match(view, /challenge\?\.status === 'WAITING_FOR_CAPTCHA'/u)
  assert.match(view, /data:image\/png;base64/u)
  assert.match(view, /managerNotificationReady/u)
  assert.match(view, /managerRecipientCount/u)
  assert.match(view, /config\.lastErrorCode === 'LUOPAN_REAUTH_REQUIRED'/u)
  assert.match(view, /luopanRepairProfileReady\(config\)/u)
  assert.match(view, /LUOPAN_QUICK_REPAIR_NOT_REQUIRED/u)
  assert.match(view, /attemptsRemaining/u)
  assert.doesNotMatch(view, /tokenSha256:/u)
  assert.doesNotMatch(view, /username|password|cookie/iu)
})

test('repair UI supports WeCom or console captcha submission and honest Yilian fallback', async () => {
  const [panel, client, api] = await Promise.all([
    readSource('../src/pages/StoreRepairPanel.tsx'),
    readSource('../src/api/business.ts'),
    readSource('../../../tools/uat/ota-standalone-review-api.mjs'),
  ])

  assert.match(panel, /一键快速修复（验证码发企微）/u)
  assert.match(panel, /普通浏览器登录罗盘官网不会同步到这里/u)
  assert.doesNotMatch(panel, /登录完成，开始验证/u)
  assert.match(panel, /提交验证码并修复/u)
  assert.match(panel, /captchaImageDataUrl/u)
  assert.match(panel, /loadLuopanBrowserRepair\(pollingContext\)/u)
  assert.match(client, /startLuopanQuickRepair/u)
  assert.match(client, /submitLuopanQuickRepairCaptcha/u)
  assert.match(api, /YILIAN_REPAIR_BOT_REQUIRED/u)
  assert.match(api, /系统无法代收厂家发送的短信验证码/u)
  assert.match(panel, /一键快速恢复/u)
})

test('a previously validated Luopan profile remains repairable after reauthentication validation fails', async () => {
  const api = await readSource('../../../tools/uat/ota-standalone-review-api.mjs')
  const profileReadyStart = api.indexOf('const luopanRepairProfileReady')
  const profileReadyEnd = api.indexOf('const luopanBrowserConfigRecordFor', profileReadyStart)
  const profileReady = api.slice(profileReadyStart, profileReadyEnd)
  const challengeStart = api.indexOf('const startLuopanRepairChallenge')
  const challengeEnd = api.indexOf('const processSubmittedLuopanRepair', challengeStart)
  const challenge = api.slice(challengeStart, challengeEnd)
  const validationStart = api.indexOf("suffix === '/luopan-browser-session-validations'")
  const validationEnd = api.indexOf("suffix === '/pms-login-config'", validationStart)
  const validation = api.slice(validationStart, validationEnd)

  assert.match(profileReady, /config\.lastErrorCode === 'LUOPAN_REAUTH_REQUIRED'/u)
  assert.match(profileReady, /config\.expectedHotelFingerprint/u)
  assert.match(profileReady, /config\.lastValidatedAt/u)
  assert.match(challenge, /!luopanRepairProfileReady\(config\)/u)
  assert.doesNotMatch(challenge, /\|\| !config\.enabled/u)
  assert.match(validation, /const preserveConfirmedScope/u)
  assert.match(validation, /errorCode === 'LUOPAN_REAUTH_REQUIRED'/u)
  assert.match(validation, /scopeStatus: preserveConfirmedScope/u)
})
