import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const previewScriptPath = fileURLToPath(new URL(
  '../../../tools/uat/send-combined-operations-test.mjs',
  import.meta.url,
))
const publishScriptPath = fileURLToPath(new URL(
  '../../../infra/ota-standalone-server/scripts/Publish-OtaStandaloneServer.ps1',
  import.meta.url,
))

test('combined operations utility is preview-only and cannot reach WeCom', async () => {
  const source = await readFile(previewScriptPath, 'utf8')

  assert.match(source, /deliveryStatus:\s*'PREVIEW_ONLY'/u)
  assert.match(source, /deliveryType:\s*'COMBINED_OPERATIONS_PREVIEW'/u)
  assert.doesNotMatch(source, /OTA_REVIEW_SECRET_KEY/u)
  assert.doesNotMatch(source, /wecom-webhook-secrets/u)
  assert.doesNotMatch(source, /decryptCookie/u)
  assert.doesNotMatch(source, /sendWeComGroupRobotMessage/u)
  assert.doesNotMatch(source, /(?:globalThis\.)?fetch\s*\(/u)
})

test('combined operations preview does not write delivery or audit state', async () => {
  const source = await readFile(previewScriptPath, 'utf8')

  assert.doesNotMatch(source, /wecom-configs/u)
  assert.doesNotMatch(source, /wecom-combined-test-deliveries/u)
  assert.doesNotMatch(source, /(?:append|rename|write)File(?:Sync)?\s*\(/u)
})

test('production publisher excludes the combined operations preview utility', async () => {
  const source = await readFile(publishScriptPath, 'utf8')

  assert.doesNotMatch(source, /tools\/uat\/send-combined-operations-test\.mjs/u)
})
