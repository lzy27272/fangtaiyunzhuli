import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readSource = (relativePath) => readFile(
  new URL(relativePath, import.meta.url),
  'utf8',
)

test('001 admin workspace is fixed-entry, admin-authenticated and does not send credentials', async () => {
  const [api, client, panel, broker] = await Promise.all([
    readSource('../../../tools/uat/ota-standalone-review-api.mjs'),
    readSource('../src/api/bieyanghongWorkspace.ts'),
    readSource('../src/pages/BieyanghongCloudWorkspacePanel.tsx'),
    readSource('../../../tools/uat/bieyanghong-browser-broker.mjs'),
  ])

  assert.match(api, /suffix === '\/bieyanghong-workspace'/u)
  assert.match(api, /'ADMIN_FIXED_WORKSPACE'/u)
  assert.match(api, /notifyManager: false/u)
  assert.match(api, /challengeTtlMs: BIEYANGHONG_ADMIN_WORKSPACE_TTL_MS/u)
  assert.match(api, /includeWorkspaceUrl: true/u)
  assert.match(api, /BIEYANGHONG_ADMIN_WORKSPACE_TTL_MS = 45 \* 60_000/u)
  assert.match(broker, /const maxSessionMs = 60 \* 60_000/u)

  assert.match(client, /Authorization: `Bearer \$\{session\.accessToken\}`/u)
  assert.match(client, /\/bieyanghong-workspace`/u)
  assert.match(client, /workspace\.protocol !== 'https:'/u)
  assert.match(panel, /打开001云端登录工作台/u)
  assert.match(panel, /popup\.location\.replace\(started\.workspaceUrl\)/u)
  assert.match(panel, /账号、密码、验证码及滑块均只在/u)
  assert.doesNotMatch(panel, /type=["']password["']|localStorage|sessionStorage/u)
  assert.doesNotMatch(
    client,
    /(?:password|cookie|verificationCode)\s*:/iu,
  )
})
