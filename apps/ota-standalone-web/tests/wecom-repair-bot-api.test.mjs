import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { encryptCookie } from '../../../tools/uat/report-source-cookie-crypto.mjs'

const apiScript = fileURLToPath(
  new URL('../../../tools/uat/ota-standalone-review-api.mjs', import.meta.url),
)
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const token = 'wecom-repair-bot-api-test-token'
const secretKey = Buffer.alloc(32, 13).toString('base64url')
const sha256 = (value) =>
  createHash('sha256').update(String(value), 'utf8').digest('hex')

const availablePort = async () => {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const port = typeof address === 'object' ? address.port : 0
  server.close()
  await once(server, 'close')
  return port
}

const startApi = async (runtimePath, { loginProbe = false } = {}) => {
  const port = await availablePort()
  const child = spawn(process.execPath, [apiScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OTA_REVIEW_API_PORT: String(port),
      OTA_REVIEW_USERNAME: 'review-test',
      OTA_REVIEW_PASSWORD: 'example-Review-Test-Password-42',
      OTA_REVIEW_ACCESS_TOKEN: token,
      OTA_REVIEW_DATA_PATH: join(runtimePath, 'report-sources.json'),
      OTA_REVIEW_COOKIE_SECRETS_PATH: join(
        runtimePath,
        'report-source-cookie-secrets.json',
      ),
      OTA_REVIEW_SECRET_KEY: secretKey,
      OTA_REVIEW_PSEUDONYM_SECRET_KEY: Buffer.alloc(32, 14).toString('base64url'),
      OTA_REVIEW_AUTO_COLLECTION_ENABLED: 'false',
      OTA_REVIEW_LUOPAN_ASSISTED_REAUTH_ENABLED: 'false',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  let lastResponse = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8')
  })
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`WECOM_REPAIR_BOT_API_EXITED:${stderr.slice(-1000)}`)
    }
    try {
      const response = loginProbe
        ? await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: 'review-test',
              password: 'example-Review-Test-Password-42',
            }),
          })
        : await fetch(
            `http://127.0.0.1:${port}/api/v1/ota/wecom-repair-bot-config`,
            { headers: { Authorization: `Bearer ${token}` } },
          )
      if (response.ok) {
        if (!loginProbe) return { child, port, accessToken: token }
        const session = await response.json()
        if (typeof session.accessToken === 'string' && session.accessToken) {
          return { child, port, accessToken: session.accessToken }
        }
        lastResponse = 'LOGIN_RESPONSE_MISSING_ACCESS_TOKEN'
      } else {
        lastResponse = `${response.status}:${await response.text()}`
      }
    } catch {
      // Retry while the local test API starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  child.kill()
  throw new Error(
    `WECOM_REPAIR_BOT_API_TIMEOUT:${lastResponse}:${stderr.slice(-1000)}`,
  )
}

const stopApi = async (child) => {
  if (child.exitCode !== null) return
  child.kill()
  await once(child, 'exit')
}

test('WeCom repair bot config encrypts credentials and never returns them', async () => {
  const runtimePath = await mkdtemp(join(os.tmpdir(), 'wecom-repair-bot-'))
  const botId = 'bot-test-01'
  const secret = 'example-bot-secret-2026-rotate'
  let child
  try {
    await writeFile(
      join(runtimePath, 'wecom-repair-bot-config.json'),
      `${JSON.stringify({ enabled: false }, null, 2)}\n`,
      'utf8',
    )
    const started = await startApi(runtimePath)
    child = started.child
    const endpoint =
      `http://127.0.0.1:${started.port}/api/v1/ota/wecom-repair-bot-config`
    const initialResponse = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const initial = (await initialResponse.json()).data
    assert.equal(initial.rowVersion, 0)
    assert.equal(initial.enabled, false)
    assert.equal(initial.allowGlobalRepairActions, false)
    assert.equal(initial.credentialConfigured, false)
    assert.equal(initial.paired, false)
    assert.equal(initial.pairedUserCount, 0)
    assert.equal(initial.pairedUserCapacity, 2)
    assert.equal(initial.hotelPairedUserCount, 0)
    assert.equal(Array.isArray(initial.hotelBindings), true)
    assert.deepEqual(
      initial.hotelBindings.map((binding) => binding.hotelCode),
      ['001', '002'],
    )
    assert.equal(
      initial.hotelBindings.every((binding) =>
        binding.pairedUserCount === 0
        && binding.pairedUserCapacity === 20),
      true,
    )
    assert.deepEqual(initial.allowedUserFingerprints, [])

    const tenantId = '10000000-0000-4000-8000-000000000001'
    const trustedDeviceHotelId = '20000000-0000-4000-8000-000000000001'
    const luopanHotelId = '20000000-0000-4000-8000-000000000002'
    const scopedEndpoint =
      `http://127.0.0.1:${started.port}/api/v1/ota/tenants/`
      + `${tenantId}/hotels/${luopanHotelId}`
    const scopedResponse = await fetch(
      `${scopedEndpoint}/wecom-repair-bot-config`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    assert.equal(scopedResponse.status, 200)
    const scoped = (await scopedResponse.json()).data
    assert.deepEqual(
      scoped.hotelBindings.map((binding) => binding.hotelId),
      [luopanHotelId],
    )
    assert.equal(
      scoped.hotelPairedUserCount,
      scoped.hotelBindings[0].pairedUserCount,
    )

    const trustedDeviceScopedResponse = await fetch(
      `http://127.0.0.1:${started.port}/api/v1/ota/tenants/`
        + `${tenantId}/hotels/${trustedDeviceHotelId}`
        + '/wecom-repair-bot-config',
      { headers: { Authorization: `Bearer ${token}` } },
    )
    assert.equal(trustedDeviceScopedResponse.status, 200)
    const trustedDeviceScoped = (await trustedDeviceScopedResponse.json()).data
    assert.deepEqual(
      trustedDeviceScoped.hotelBindings.map((binding) => binding.hotelId),
      [trustedDeviceHotelId],
    )
    assert.equal(trustedDeviceScoped.hotelPairedUserCount, 0)

    const crossStoreBodyResponse = await fetch(
      `${scopedEndpoint}/wecom-repair-bot-pairing`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hotelId: '20000000-0000-4000-8000-000000000001',
          reasonCode: 'START_WECOM_REPAIR_BOT_PAIRING',
        }),
      },
    )
    assert.equal(crossStoreBodyResponse.status, 400)
    assert.deepEqual(await crossStoreBodyResponse.json(), {
      code: 'WECOM_REPAIR_BOT_PAIRING_REQUEST_INVALID',
    })

    const legacyGlobalPairingResponse = await fetch(
      `http://127.0.0.1:${started.port}/api/v1/ota/wecom-repair-bot-pairing`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hotelId: luopanHotelId,
          reasonCode: 'START_WECOM_REPAIR_BOT_PAIRING',
        }),
      },
    )
    assert.equal(legacyGlobalPairingResponse.status, 404)

    const savedResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expectedRowVersion: initial.rowVersion,
        enabled: false,
        reasonCode: 'UPDATE_WECOM_REPAIR_BOT_CONFIG',
        credentialUpdate: {
          action: 'REPLACE',
          botId,
          secret,
        },
      }),
    })
    assert.equal(savedResponse.status, 200)
    const savedText = await savedResponse.text()
    assert.doesNotMatch(savedText, new RegExp(botId, 'i'))
    assert.doesNotMatch(savedText, new RegExp(secret, 'i'))
    const saved = JSON.parse(savedText).data
    assert.equal(saved.rowVersion, initial.rowVersion + 1)
    assert.equal(saved.credentialConfigured, true)
    assert.equal(saved.allowGlobalRepairActions, false)
    assert.equal(saved.paired, false)
    assert.equal(typeof saved.botIdFingerprint, 'string')

    const persisted = await readFile(
      join(runtimePath, 'wecom-repair-bot-secrets.json'),
      'utf8',
    )
    assert.doesNotMatch(persisted, new RegExp(botId, 'i'))
    assert.doesNotMatch(persisted, new RegExp(secret, 'i'))
    assert.match(persisted, /"ciphertext"/u)

    const configPath = join(runtimePath, 'wecom-repair-bot-config.json')
    await rm(configPath, { force: true })
    await mkdir(configPath)
    const failedAuthorization = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expectedRowVersion: saved.rowVersion,
        enabled: false,
        allowGlobalRepairActions: true,
        reasonCode: 'AUTHORIZE_GLOBAL_WECOM_REPAIR_ACTIONS',
        credentialUpdate: { action: 'KEEP' },
      }),
    })
    assert.equal(failedAuthorization.status, 500)
    const afterFailedAuthorization = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(afterFailedAuthorization.status, 200)
    assert.equal(
      (await afterFailedAuthorization.json()).data.allowGlobalRepairActions,
      false,
    )
    await rm(configPath, { recursive: true, force: true })

    const authorizedResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expectedRowVersion: saved.rowVersion,
        enabled: false,
        allowGlobalRepairActions: true,
        reasonCode: 'AUTHORIZE_GLOBAL_WECOM_REPAIR_ACTIONS',
        credentialUpdate: { action: 'KEEP' },
      }),
    })
    assert.equal(authorizedResponse.status, 200)
    const authorized = (await authorizedResponse.json()).data
    assert.equal(authorized.allowGlobalRepairActions, true)
    assert.equal(authorized.rowVersion, saved.rowVersion + 1)

    const staleResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expectedRowVersion: saved.rowVersion,
        enabled: false,
        allowGlobalRepairActions: false,
        reasonCode: 'UPDATE_WECOM_REPAIR_BOT_CONFIG',
        credentialUpdate: { action: 'KEEP' },
      }),
    })
    assert.equal(staleResponse.status, 409)
    assert.deepEqual(await staleResponse.json(), {
      code: 'WECOM_REPAIR_BOT_CONFIG_VERSION_CONFLICT',
    })

    const adminScopedAfterSave = await fetch(
      `${scopedEndpoint}/wecom-repair-bot-config`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    assert.equal(adminScopedAfterSave.status, 200)
    const adminScopedStatus = (await adminScopedAfterSave.json()).data
    assert.equal(adminScopedStatus.botIdFingerprint, saved.botIdFingerprint)
    assert.equal(adminScopedStatus.allowGlobalRepairActions, true)
    assert.equal(adminScopedStatus.rowVersion, authorized.rowVersion)

    const managerUsername = 'wecom-scoped-manager'
    const managerPassword = 'example-WeCom-Scoped-Manager-42'
    const createManagerResponse = await fetch(
      `http://127.0.0.1:${started.port}/api/v1/auth/accounts`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: managerUsername,
          displayName: '罗盘门店管理员',
          password: managerPassword,
          roles: ['GENERAL_MANAGER'],
          hotelIds: [luopanHotelId],
        }),
      },
    )
    assert.equal(createManagerResponse.status, 201)
    const managerLoginResponse = await fetch(
      `http://127.0.0.1:${started.port}/api/v1/auth/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: managerUsername,
          password: managerPassword,
        }),
      },
    )
    assert.equal(managerLoginResponse.status, 200)
    const managerSession = await managerLoginResponse.json()
    const managerScopedResponse = await fetch(
      `${scopedEndpoint}/wecom-repair-bot-config`,
      {
        headers: {
          Authorization: `Bearer ${managerSession.accessToken}`,
        },
      },
    )
    assert.equal(managerScopedResponse.status, 200)
    const managerScopedStatus = (await managerScopedResponse.json()).data
    assert.equal(managerScopedStatus.botIdFingerprint, null)
    assert.equal(managerScopedStatus.allowedUserFingerprint, null)
    assert.deepEqual(managerScopedStatus.allowedUserFingerprints, [])
    assert.equal(managerScopedStatus.pairedUserCount, 0)
    assert.equal(managerScopedStatus.allowGlobalRepairActions, false)
    assert.equal(
      managerScopedStatus.hotelBindings.every((binding) =>
        binding.userFingerprints.length === 0),
      true,
    )

    const clearedResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expectedRowVersion: authorized.rowVersion,
        enabled: false,
        reasonCode: 'CLEAR_WECOM_REPAIR_BOT_CONFIG',
        credentialUpdate: { action: 'CLEAR' },
      }),
    })
    assert.equal(clearedResponse.status, 200)
    const cleared = (await clearedResponse.json()).data
    assert.equal(cleared.rowVersion, authorized.rowVersion + 1)
    assert.equal(cleared.credentialConfigured, false)
    assert.equal(cleared.allowGlobalRepairActions, false)
    assert.equal(cleared.botIdFingerprint, null)
  } finally {
    if (child) await stopApi(child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})

test('WeCom repair bot transaction journal completes both files after restart', async () => {
  const runtimePath = await mkdtemp(join(os.tmpdir(), 'wecom-repair-bot-tx-'))
  const configPath = join(runtimePath, 'wecom-repair-bot-config.json')
  const secretPath = join(runtimePath, 'wecom-repair-bot-secrets.json')
  const journalPath = join(runtimePath, 'wecom-repair-bot-transaction.json')
  const hotelId = '20000000-0000-4000-8000-000000000002'
  const botId = 'bot-journal-recovery-01'
  const secret = 'journal-recovery-secret-2026'
  const globalUserId = 'journal.global.manager'
  const hotelUserId = 'journal.hotel.manager'
  const credentials = {
    botId,
    secret,
    allowedUserId: globalUserId,
    allowedUserIds: [globalUserId],
    hotelAllowedUserIds: {
      [hotelId]: [hotelUserId],
    },
  }
  const preparedAt = '2026-09-17T08:00:00.000Z'
  const configDocument = {
    rowVersion: 7,
    enabled: false,
    allowGlobalRepairActions: false,
    botIdSha256: sha256(botId),
    allowedUserIdSha256: sha256(globalUserId),
    allowedUserIdSha256s: [sha256(globalUserId)],
    hotelAllowedUserIdSha256s: {
      [hotelId]: [sha256(hotelUserId)],
    },
    updatedAt: preparedAt,
  }
  const secretDocument = {
    record: encryptCookie(
      JSON.stringify(credentials),
      secretKey,
      'wecom-repair-bot:v1',
    ),
  }
  const journal = {
    version: 1,
    transactionId: randomUUID(),
    preparedAt,
    configDocument,
    secretDocument,
  }
  let child
  try {
    await writeFile(configPath, `${JSON.stringify({
      rowVersion: 2,
      enabled: false,
      allowGlobalRepairActions: false,
      botIdSha256: null,
      allowedUserIdSha256: null,
      allowedUserIdSha256s: [],
      hotelAllowedUserIdSha256s: {},
      updatedAt: null,
    }, null, 2)}\n`, { mode: 0o600 })
    await writeFile(secretPath, '{}\n', { mode: 0o600 })
    await writeFile(
      journalPath,
      `${JSON.stringify(journal, null, 2)}\n`,
      { mode: 0o600 },
    )

    const journalText = await readFile(journalPath, 'utf8')
    for (const plaintext of [botId, secret, globalUserId, hotelUserId]) {
      assert.doesNotMatch(journalText, new RegExp(plaintext, 'iu'))
    }
    assert.match(journalText, /"ciphertext"/u)

    let started = await startApi(runtimePath)
    child = started.child
    let response = await fetch(
      `http://127.0.0.1:${started.port}/api/v1/ota/wecom-repair-bot-config`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    assert.equal(response.status, 200)
    let status = (await response.json()).data
    assert.equal(status.rowVersion, configDocument.rowVersion)
    assert.equal(status.credentialConfigured, true)
    assert.equal(status.botIdFingerprint, sha256(botId).slice(0, 16))
    assert.equal(status.pairedUserCount, 1)
    assert.equal(status.hotelPairedUserCount, 1)

    assert.deepEqual(
      JSON.parse(await readFile(configPath, 'utf8')),
      configDocument,
    )
    const recoveredSecret = await readFile(secretPath, 'utf8')
    for (const plaintext of [botId, secret, globalUserId, hotelUserId]) {
      assert.doesNotMatch(recoveredSecret, new RegExp(plaintext, 'iu'))
    }
    assert.match(recoveredSecret, /"ciphertext"/u)
    await assert.rejects(
      readFile(journalPath, 'utf8'),
      (error) => error?.code === 'ENOENT',
    )

    await stopApi(child)
    child = null
    started = await startApi(runtimePath, { loginProbe: true })
    child = started.child
    response = await fetch(
      `http://127.0.0.1:${started.port}/api/v1/ota/wecom-repair-bot-config`,
      { headers: { Authorization: `Bearer ${started.accessToken}` } },
    )
    assert.equal(response.status, 200)
    status = (await response.json()).data
    assert.equal(status.rowVersion, configDocument.rowVersion)
    assert.equal(status.credentialConfigured, true)
    assert.equal(status.botIdFingerprint, sha256(botId).slice(0, 16))
  } finally {
    if (child) await stopApi(child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})
