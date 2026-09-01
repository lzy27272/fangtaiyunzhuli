import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const readRepoFile = (relativePath) => readFileSync(fileURLToPath(new URL(
  `../../../${relativePath}`,
  import.meta.url,
)), 'utf8')

test('release scripts provision a distinct persistent pseudonym key without printing it', () => {
  const runtimeExample = readRepoFile(
    'infra/ota-standalone-server/runtime.env.example',
  )
  const dockerBootstrap = readRepoFile(
    'infra/ota-standalone-server/scripts/bootstrap-ubuntu.sh',
  )
  const nativeBootstrap = readRepoFile(
    'infra/ota-standalone-server/scripts/bootstrap-native-ubuntu.sh',
  )
  const nativeDeploy = readRepoFile(
    'infra/ota-standalone-server/scripts/deploy-native.sh',
  )
  const api = readRepoFile('tools/uat/ota-standalone-review-api.mjs')

  assert.match(
    runtimeExample,
    /^OTA_REVIEW_PSEUDONYM_SECRET_KEY=GENERATE_ON_SERVER$/mu,
  )
  for (const bootstrap of [dockerBootstrap, nativeBootstrap]) {
    assert.match(bootstrap, /pseudonym_secret_key="\$\(openssl rand -base64 32/u)
    assert.match(
      bootstrap,
      /^OTA_REVIEW_PSEUDONYM_SECRET_KEY=\$\{pseudonym_secret_key\}$/mu,
    )
    assert.doesNotMatch(bootstrap, /echo[^\n]*pseudonym_secret_key/u)
  }
  assert.match(nativeDeploy, /ensure_pseudonym_secret_key/u)
  assert.match(nativeDeploy, /PSEUDONYM_SECRET_KEY_DUPLICATE/u)
  assert.match(nativeDeploy, /PSEUDONYM_SECRET_KEY_INVALID/u)
  assert.match(nativeDeploy, /\^\[A-Za-z0-9_-\]\{43\}\$/u)
  assert.doesNotMatch(nativeDeploy, /echo[^\n]*generated_key/u)
  assert.match(
    api,
    /Buffer\.from\(pseudonymSecretKey \?\? '', 'base64url'\)\.length !== 32/u,
  )
})

test('release tests expose locked Node modules to root-level collectors', () => {
  const publish = readRepoFile(
    'infra/ota-standalone-server/scripts/Publish-OtaStandaloneServer.ps1',
  )

  assert.match(publish, /\$runtimeNodeModules = Join-Path/u)
  assert.match(publish, /\$env:NODE_PATH = \(/u)
  assert.match(publish, /\$previousNodePath/u)
  assert.match(publish, /Remove-Item Env:NODE_PATH/u)
})
