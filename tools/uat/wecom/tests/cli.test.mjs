import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test, { after, before } from 'node:test'
import { fileURLToPath } from 'node:url'

const testDirectory = dirname(fileURLToPath(import.meta.url))
const cliPath = join(testDirectory, '..', 'Send-OtaJsonToWeCom.mjs')
const wrapperPath = join(
  testDirectory,
  '..',
  'Invoke-OtaJsonWeComUat.ps1',
)
const fingerprintCliPath = join(
  testDirectory,
  '..',
  'Fingerprint-WeComWebhook.mjs',
)
const powershellPath =
  'C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const inboxRoot = resolve(
  testDirectory,
  '../../../../.uat-runtime/wecom/inbox',
)
let runtimeDirectory
let fixturePath
let truncatedFixturePath
let fixtureSha256
let truncatedFixtureSha256
const wrapperNonce = '1'.repeat(32)
const sha256 = (value) =>
  createHash('sha256').update(value, 'utf8').digest('hex')

before(async () => {
  await mkdir(inboxRoot, { recursive: true })
  runtimeDirectory = await mkdtemp(join(inboxRoot, 'test-'))
  fixturePath = join(runtimeDirectory, 'fixture.json')
  const fixtureText = JSON.stringify({
    code: 10000,
    data: {
      variables: {
        currentTime: '2026-07-25 15:39:18',
        startDate: '2026-07-25',
        endDate: '2026-07-25',
      },
      dataList: [
        {
          customerLevel: '美团',
          roomType: '测试房型',
          roomCount: 1,
          roomPrice: 399,
        },
      ],
    },
  })
  fixtureSha256 = sha256(fixtureText)
  await writeFile(fixturePath, fixtureText, 'utf8')
  truncatedFixturePath = join(runtimeDirectory, 'truncated.json')
  const truncatedFixtureText = `${fixtureText.slice(0, -1)},`
  truncatedFixtureSha256 = sha256(truncatedFixtureText)
  await writeFile(
    truncatedFixturePath,
    truncatedFixtureText,
    'utf8',
  )
})

after(async () => {
  await rm(runtimeDirectory, { recursive: true, force: true })
})

const runCliWithInput = (
  inputPath,
  extraArguments,
  extraEnvironment = {},
) =>
  spawnSync(
    process.execPath,
    [
      cliPath,
      '--input',
      inputPath,
      '--hotel',
      'UAT测试酒店',
      ...extraArguments,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        WECOM_GROUP_ROBOT_WEBHOOK: '',
        WECOM_GROUP_ROBOT_ENDPOINT_SHA256: '',
        WECOM_UAT_EXPECTED_HOTEL_NAME: '',
        OTA_WECOM_UAT_APPROVED_INPUT_SHA256: '',
        OTA_WECOM_UAT_SEND_ENABLED: '',
        OTA_WECOM_UAT_WRAPPER_NONCE: '',
        ...extraEnvironment,
      },
    },
  )

const runCli = (extraArguments, extraEnvironment = {}) =>
  runCliWithInput(fixturePath, extraArguments, extraEnvironment)

test('CLI defaults to dry-run and performs no network call', () => {
  const result = runCli([])
  assert.equal(result.status, 0)
  const output = JSON.parse(result.stdout)
  assert.equal(output.status, 'DRY_RUN_OK')
  assert.equal(output.networkCalled, false)
  assert.match(output.inputSha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(output.mentionedList, ['@all'])
})

test('CLI refuses real send when the independent gate is disabled', () => {
  const result = runCli(['--send'])
  assert.equal(result.status, 2)
  const output = JSON.parse(result.stderr)
  assert.equal(output.reasonCode, 'WECOM_UAT_SEND_GATE_DISABLED')
})

test('CLI requires a locally injected webhook after the send gate opens', () => {
  const result = runCli(
    ['--send', '--wrapper-nonce', wrapperNonce],
    {
    OTA_WECOM_UAT_SEND_ENABLED: 'true',
    OTA_WECOM_UAT_WRAPPER_NONCE: wrapperNonce,
    WECOM_UAT_EXPECTED_HOTEL_NAME: 'UAT测试酒店',
    OTA_WECOM_UAT_APPROVED_INPUT_SHA256: fixtureSha256,
    },
  )
  assert.equal(result.status, 2)
  const output = JSON.parse(result.stderr)
  assert.equal(output.reasonCode, 'WECOM_WEBHOOK_ENV_MISSING')
})

test('CLI requires exact hotel and endpoint bindings before HTTP', () => {
  const hotelMismatch = runCli(
    ['--send', '--wrapper-nonce', wrapperNonce],
    {
      OTA_WECOM_UAT_SEND_ENABLED: 'true',
      OTA_WECOM_UAT_WRAPPER_NONCE: wrapperNonce,
      WECOM_UAT_EXPECTED_HOTEL_NAME: '另一家酒店',
      WECOM_GROUP_ROBOT_WEBHOOK:
        'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=00000000-0000-0000-0000-000000000000',
    },
  )
  assert.equal(hotelMismatch.status, 2)
  assert.equal(
    JSON.parse(hotelMismatch.stderr).reasonCode,
    'WECOM_UAT_HOTEL_BINDING_MISMATCH',
  )

  const fingerprintMissing = runCli(
    ['--send', '--wrapper-nonce', wrapperNonce],
    {
      OTA_WECOM_UAT_SEND_ENABLED: 'true',
      OTA_WECOM_UAT_WRAPPER_NONCE: wrapperNonce,
      WECOM_UAT_EXPECTED_HOTEL_NAME: 'UAT测试酒店',
      OTA_WECOM_UAT_APPROVED_INPUT_SHA256: fixtureSha256,
      WECOM_GROUP_ROBOT_WEBHOOK:
        'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=00000000-0000-0000-0000-000000000000',
    },
  )
  assert.equal(fingerprintMissing.status, 3)
  assert.equal(
    JSON.parse(fingerprintMissing.stderr).reasonCode,
    'WECOM_ENDPOINT_FINGERPRINT_REQUIRED',
  )
})

test('CLI requires explicit recovery switch for approved truncated input', () => {
  const result = runCliWithInput(
    truncatedFixturePath,
    ['--send', '--wrapper-nonce', wrapperNonce],
    {
      OTA_WECOM_UAT_SEND_ENABLED: 'true',
      OTA_WECOM_UAT_WRAPPER_NONCE: wrapperNonce,
      WECOM_UAT_EXPECTED_HOTEL_NAME: 'UAT测试酒店',
      OTA_WECOM_UAT_APPROVED_INPUT_SHA256:
        truncatedFixtureSha256,
    },
  )
  assert.equal(result.status, 2)
  assert.equal(
    JSON.parse(result.stderr).reasonCode,
    'PMS_JSON_RECOVERY_EXPLICIT_APPROVAL_REQUIRED',
  )
})

test('CLI binds every real send to the dry-run input hash', () => {
  const result = runCli(
    ['--send', '--wrapper-nonce', wrapperNonce],
    {
      OTA_WECOM_UAT_SEND_ENABLED: 'true',
      OTA_WECOM_UAT_WRAPPER_NONCE: wrapperNonce,
      WECOM_UAT_EXPECTED_HOTEL_NAME: 'UAT测试酒店',
      OTA_WECOM_UAT_APPROVED_INPUT_SHA256: 'f'.repeat(64),
    },
  )
  assert.equal(result.status, 2)
  assert.equal(
    JSON.parse(result.stderr).reasonCode,
    'PMS_JSON_INPUT_SHA_MISMATCH',
  )
})

test('CLI refuses accidental direct send without the wrapper handoff nonce', () => {
  const result = runCli(['--send'], {
    OTA_WECOM_UAT_SEND_ENABLED: 'true',
  })
  assert.equal(result.status, 2)
  assert.equal(
    JSON.parse(result.stderr).reasonCode,
    'WECOM_UAT_WRAPPER_HANDOFF_REQUIRED',
  )
})

test('CLI rejects conflicting mode switches in either order', () => {
  for (const argumentsList of [
    ['--dry-run', '--send'],
    ['--send', '--dry-run'],
  ]) {
    const result = runCli(argumentsList)
    assert.equal(result.status, 2)
    const output = JSON.parse(result.stderr)
    assert.equal(output.reasonCode, 'CLI_MODE_CONFLICT')
  }
})

test('CLI rejects UNC, device and out-of-inbox paths before reading', () => {
  for (const unsafePath of [
    '\\\\server\\share\\pms.json',
    '\\\\?\\UNC\\server\\share\\pms.json',
    resolve(testDirectory, 'outside.json'),
  ]) {
    const result = runCliWithInput(unsafePath, [])
    assert.equal(result.status, 2)
    const output = JSON.parse(result.stderr)
    assert.equal(output.reasonCode, 'INPUT_FILE_READ_FAILED')
  }
})

test('fingerprint CLI validates locally without exposing the webhook', () => {
  const dummyWebhook =
    'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=00000000-0000-0000-0000-000000000000'
  const result = spawnSync(process.execPath, [fingerprintCliPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      WECOM_GROUP_ROBOT_WEBHOOK: dummyWebhook,
    },
  })
  assert.equal(result.status, 0)
  const output = JSON.parse(result.stdout)
  assert.equal(output.status, 'FINGERPRINT_OK')
  assert.equal(output.networkCalled, false)
  assert.match(output.endpointSha256, /^[a-f0-9]{64}$/)
  assert.equal(result.stdout.includes(dummyWebhook), false)
  assert.equal(result.stdout.includes('00000000-'), false)
})

test(
  'PowerShell wrapper resolves the signed bundled Node for dry-run',
  { skip: process.platform !== 'win32' },
  () => {
    const result = spawnSync(
      powershellPath,
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        wrapperPath,
        '-InputPath',
        fixturePath,
        '-HotelName',
        'UAT测试酒店',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          WECOM_GROUP_ROBOT_WEBHOOK:
            'must-be-cleared-before-wrapper-executes',
          OTA_WECOM_UAT_SEND_ENABLED: '',
          NODE_OPTIONS:
            '--require=C:\\definitely-missing\\must-not-load.cjs',
          NODE_TLS_REJECT_UNAUTHORIZED: '0',
          NODE_USE_ENV_PROXY: '1',
          HTTPS_PROXY: 'http://127.0.0.1:9',
        },
      },
    )
    assert.equal(result.status, 0)
    const output = JSON.parse(result.stdout)
    assert.equal(output.status, 'DRY_RUN_OK')
    assert.equal(output.networkCalled, false)
  },
)

test(
  'PowerShell wrapper refuses send before prompting when gate is disabled',
  { skip: process.platform !== 'win32' },
  () => {
    const result = spawnSync(
      powershellPath,
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        wrapperPath,
        '-InputPath',
        fixturePath,
        '-HotelName',
        'UAT测试酒店',
        '-Send',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          WECOM_GROUP_ROBOT_WEBHOOK:
            'must-not-be-reused-by-wrapper',
          OTA_WECOM_UAT_SEND_ENABLED: '',
        },
        timeout: 10_000,
      },
    )
    assert.notEqual(result.status, 0)
    assert.equal(
      `${result.stdout}\n${result.stderr}`.includes(
        'WECOM_UAT_SEND_GATE_DISABLED',
      ),
      true,
    )
  },
)
