import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readSource = (relativePath) => readFile(
  new URL(relativePath, import.meta.url),
  'utf8',
)

test('001 configuration page uses trusted device mode and never requests credentials', async () => {
  const [page, panel, client, agent] = await Promise.all([
    readSource('../src/pages/ReportSourceConfigPage.tsx'),
    readSource('../src/pages/TrustedDevicePanel.tsx'),
    readSource('../src/api/trustedDevice.ts'),
    readSource('../../../tools/trusted-device/trusted-device-agent.mjs'),
  ])
  assert.match(page, /<TrustedDevicePanel/u)
  assert.doesNotMatch(page, /<BieyanghongCloudWorkspacePanel/u)
  assert.match(panel, /登录会话只留在门店电脑/u)
  assert.match(panel, /生成15分钟安装码/u)
  assert.match(panel, /Ed25519设备签名/u)
  assert.doesNotMatch(panel, /type=["']password["']|手机号|短信验证码/u)
  assert.match(client, /\/trusted-device\/enrollment/u)
  assert.match(agent, /https:\/\/pms\.meituan\.com/u)
  assert.match(agent, /launchPersistentContext/u)
  assert.doesNotMatch(agent, /console\.log\(.*cookie|writeFileSync\(.*cookie/iu)
})
