import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createCipheriv, createHash, randomUUID } from 'node:crypto'
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
import { fileURLToPath, pathToFileURL } from 'node:url'
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

const startApi = async (runtimePath, { loginProbe = false, preload = null } = {}) => {
  const port = await availablePort()
  const child = spawn(process.execPath, [...(preload ? ['--import', pathToFileURL(preload).href] : []), apiScript], {
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
  if (child.exitCode !== null || child.signalCode !== null) return
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
    for (const method of ['GET', 'POST']) {
      const forbiddenRoster = await fetch(`http://127.0.0.1:${started.port}/api/v1/ota/wecom-repair-admins`, {
        method, headers: { Authorization: `Bearer ${managerSession.accessToken}`, 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify({ action: 'REVOKE', memberId: 'untrusted' }) } : {}),
      })
      assert.equal(forbiddenRoster.status, 403)
      assert.equal((await forbiddenRoster.text()).includes('userProfiles'), false)
    }
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

test('admin roster edits are encrypted, versioned, restart-safe and verified departures revoke all grants', async () => {
  const runtimePath = await mkdtemp(join(os.tmpdir(), 'wecom-admin-api-'))
  const hotelIds = ['20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002']
  const robotUser = 'robot.admin.account'
  const contactUser = 'directory.member.account'
  const credentials = { botId: 'test-admin-bot', secret: 'example-robot-test-secret-1234',
    allowedUserIds: [robotUser], hotelAllowedUserIds: { [hotelIds[0]]: [robotUser] } }
  const directory = { corpId: 'ww-admin-test', token: 'exampleCallbackToken',
    encodingAesKey: Buffer.alloc(32, 19).toString('base64').slice(0, -1) }
  let child
  try {
    await writeFile(join(runtimePath, 'wecom-repair-bot-secrets.json'), JSON.stringify({
      record: encryptCookie(JSON.stringify(credentials), secretKey, 'wecom-repair-bot:v1'),
    }))
    let started = await startApi(runtimePath)
    child = started.child
    let accessToken = started.accessToken
    let base = `http://127.0.0.1:${started.port}`
    const read = async () => (await (await fetch(`${base}/api/v1/ota/wecom-repair-admins`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })).json()).data
    const post = async (body) => fetch(`${base}/api/v1/ota/wecom-repair-admins`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, reasonCode: 'MANAGE_WECOM_REPAIR_ADMINS' }),
    })
    const initial = await read()
    assert.equal(initial.members[0].userId, robotUser)
    assert.equal(initial.members[0].displayName, '待补充姓名')
    assert.equal((await fetch(`${base}/api/v1/ota/wecom-repair-admins`)).status, 401)
    const edited = await post({ action: 'EDIT', expectedRowVersion: initial.rowVersion,
      memberId: initial.members[0].memberId, displayName: '测试运营经理', role: 'OPERATIONS_MANAGER',
      hotelIds, directoryUserId: contactUser, directoryIdentityConfirmed: true })
    assert.equal(edited.status, 200)
    const next = (await edited.json()).data
    assert.equal(next.members[0].globalRecipient, true)
    assert.equal(next.members[0].offboardingLinked, true)
    assert.deepEqual(next.members[0].hotelIds, hotelIds)
    assert.equal((await post({ action: 'REVOKE', expectedRowVersion: initial.rowVersion,
      memberId: initial.members[0].memberId })).status, 409)
    const badStore = await post({ action: 'EDIT', expectedRowVersion: next.rowVersion,
      memberId: initial.members[0].memberId, displayName: '测试运营经理', role: 'OPERATIONS_MANAGER',
      hotelIds: ['out-of-scope-store'], directoryUserId: contactUser })
    assert.equal(badStore.status, 400)
    assert.deepEqual((await read()).members[0].hotelIds, hotelIds)
    const configured = await post({ action: 'DIRECTORY', expectedRowVersion: next.rowVersion,
      directoryUpdate: { action: 'REPLACE', ...directory } })
    assert.equal(configured.status, 200)
    const configuredView = (await configured.json()).data
    assert.equal(configuredView.directory.enabled, true)
    assert.equal(configuredView.directory.verifiedAt, null)
    assert.equal(JSON.stringify(configuredView).includes(directory.token), false)
    const encryptedFile = await readFile(join(runtimePath, 'wecom-repair-bot-secrets.json'), 'utf8')
    for (const raw of [robotUser, contactUser, '测试运营经理', directory.token, directory.encodingAesKey]) {
      assert.equal(encryptedFile.includes(raw), false)
    }

    // Same-bot credential rotation must not silently discard the roster or contact settings.
    const rotated = await fetch(`${base}/api/v1/ota/wecom-repair-bot-config`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false, expectedRowVersion: configuredView.rowVersion,
        reasonCode: 'ROTATE_TEST_CREDENTIAL', credentialUpdate: { action: 'REPLACE',
          botId: credentials.botId, secret: 'example-rotated-bot-secret-1234' } }),
    })
    assert.equal(rotated.status, 200)
    await stopApi(child)
    started = await startApi(runtimePath, { loginProbe: true })
    child = started.child; accessToken = started.accessToken; base = `http://127.0.0.1:${started.port}`
    const reloaded = await read()
    assert.equal(reloaded.members[0].displayName, '测试运营经理')
    assert.equal(reloaded.directory.linkedCount, 1)

    const sign = (message) => {
      const bytes = Buffer.from(message), size = Buffer.alloc(4); size.writeUInt32BE(bytes.length)
      const raw = Buffer.concat([Buffer.alloc(16, 3), size, bytes, Buffer.from(directory.corpId)])
      const pad = 32 - raw.length % 32, key = Buffer.from(`${directory.encodingAesKey}=`, 'base64')
      const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16)); cipher.setAutoPadding(false)
      const encrypted = Buffer.concat([cipher.update(Buffer.concat([raw, Buffer.alloc(pad, pad)])), cipher.final()]).toString('base64')
      const timestamp = String(Math.floor(Date.now() / 1000)), nonce = 'integration-test'
      const signature = createHash('sha1').update([directory.token, timestamp, nonce, encrypted].sort().join('')).digest('hex')
      const params = new URLSearchParams({ timestamp, nonce, msg_signature: signature })
      return { encrypted, params }
    }
    const callbackUrl = `${base}/api/v1/wecom-repair-directory/callback`
    const verification = sign('challenge-verified')
    verification.params.set('echostr', verification.encrypted)
    const challenge = await fetch(`${callbackUrl}?${verification.params}`)
    assert.equal(challenge.status, 200)
    assert.equal(await challenge.text(), 'challenge-verified')
    assert.ok((await read()).directory.verifiedAt)
    const event = `<xml><ToUserName>${directory.corpId}</ToUserName><MsgType>event</MsgType>`
      + `<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime><Event>change_contact</Event>`
      + `<ChangeType>delete_user</ChangeType><UserID>${contactUser}</UserID></xml>`
    const departure = sign(event)
    const forgedParams = new URLSearchParams(departure.params); forgedParams.set('msg_signature', '0'.repeat(40))
    const send = (params) => fetch(`${callbackUrl}?${params}`, {
      method: 'POST', headers: { 'Content-Type': 'application/xml' },
      body: `<xml><Encrypt><![CDATA[${departure.encrypted}]]></Encrypt></xml>`,
    })
    assert.equal((await send(forgedParams)).status, 400)
    assert.equal((await read()).members[0].active, true)
    const configPath = join(runtimePath, 'wecom-repair-bot-config.json')
    await rm(configPath)
    await mkdir(configPath)
    assert.equal((await send(departure.params)).status, 500)
    assert.equal((await read()).members[0].active, true)
    await rm(configPath, { recursive: true })
    assert.equal((await send(departure.params)).status, 200)
    const removed = await read()
    assert.equal(removed.members[0].active, false)
    assert.equal(removed.members[0].globalRecipient, false)
    assert.deepEqual(removed.members[0].hotelIds, [])
    assert.equal(removed.members[0].revokeReason, 'MEMBER_DELETED')
    assert.equal((await send(departure.params)).status, 200)
    assert.equal((await read()).directory.lastEventResult, 'REVOKED')
    const regularStatus = await fetch(`${base}/api/v1/ota/wecom-repair-bot-config`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const regular = (await regularStatus.json()).data
    assert.equal(regular.paired, false)
    assert.equal(JSON.stringify(regular).includes(contactUser), false)
    await stopApi(child)
    started = await startApi(runtimePath, { loginProbe: true })
    child = started.child; accessToken = started.accessToken; base = `http://127.0.0.1:${started.port}`
    assert.equal((await read()).members[0].active, false)
  } finally {
    if (child) await stopApi(child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})

test('first administrator can pair multiple stores through one real API command and one offline bot message', async () => {
  const runtimePath = await mkdtemp(join(os.tmpdir(), 'wecom-batch-pair-api-'))
  const hotelIds = ['20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002']
  let child
  try {
    // Test-only module interception: no production test endpoint or real WeCom connection.
    const fakePath = join(runtimePath, 'fake-sdk.cjs')
    const preload = join(runtimePath, 'preload.mjs')
    const inbox = join(runtimePath, 'fake-inbox.json')
    const replies = join(runtimePath, 'fake-replies.json')
    await writeFile(fakePath, `
      const { EventEmitter } = require('node:events');
      const { existsSync, readFileSync, writeFileSync } = require('node:fs');
      module.exports = { generateReqId: () => 'test-request', WSClient: class extends EventEmitter {
        isConnected = true; timer = null; seen = new Set();
        connect() { this.emit('authenticated'); this.timer = setInterval(() => {
          if (!existsSync(${JSON.stringify(inbox)})) return;
          let frame; try { frame = JSON.parse(readFileSync(${JSON.stringify(inbox)}, 'utf8')); } catch { return; }
          if (this.seen.has(frame.body.msgid)) return;
          this.seen.add(frame.body.msgid); this.emit(frame.body.msgtype === 'event' ? 'event.' + frame.body.event.eventtype : 'message.text', frame);
        }, 15); }
        disconnect() { clearInterval(this.timer); }
        async replyStream(frame, id, content) { writeFileSync(${JSON.stringify(replies)}, JSON.stringify({ msgid: frame.body.msgid, content })); }
        async replyWelcome(frame, body) { writeFileSync(${JSON.stringify(replies)}, JSON.stringify({ msgid: frame.body.msgid, content: body.text.content })); }
      } };
    `)
    await writeFile(preload, `import { registerHooks } from 'node:module';
      registerHooks({ resolve(specifier, context, nextResolve) {
        if (specifier.endsWith('wecom-aibot-sdk-1.0.7.cjs')) return { url: ${JSON.stringify(pathToFileURL(fakePath).href)}, shortCircuit: true };
        return nextResolve(specifier, context);
      } });`)
    await writeFile(join(runtimePath, 'wecom-repair-bot-config.json'), JSON.stringify({ enabled: true }))
    await writeFile(join(runtimePath, 'wecom-repair-bot-secrets.json'), JSON.stringify({ record: encryptCookie(
      JSON.stringify({ botId: 'fake-offline-bot', secret: 'example-offline-robot-secret', allowedUserIds: [], hotelAllowedUserIds: {},
        directorySync: { enabled: true, corpId: 'ww-preauth-test', token: 'exampleCallbackToken',
          encodingAesKey: Buffer.alloc(32, 19).toString('base64').slice(0, -1), verifiedAt: new Date().toISOString() } }),
      secretKey, 'wecom-repair-bot:v1',
    ) }))
    const started = await startApi(runtimePath, { preload }); child = started.child
    const endpoint = `http://127.0.0.1:${started.port}/api/v1/ota/wecom-repair-admins`
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const read = async () => (await (await fetch(endpoint, { headers })).json()).data
    const before = await read()
    assert.equal(before.connected, true)
    assert.deepEqual(before.members, [])
    const pairingRequestedAt = Date.now()
    const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({
      action: 'PAIR', expectedRowVersion: before.rowVersion, reasonCode: 'MANAGE_WECOM_REPAIR_ADMINS',
      hotelIds, displayName: '离线测试运营经理', role: 'OPERATIONS_MANAGER',
    }) })
    assert.equal(response.status, 200)
    const created = (await response.json()).data
    assert.match(created.createdPairing.pairingCode, /^\d{6}$/)
    const pairingExpiresAt = Date.parse(created.createdPairing.expiresAt)
    assert.ok(pairingExpiresAt >= pairingRequestedAt + 24 * 60 * 60_000)
    assert.ok(pairingExpiresAt <= Date.now() + 24 * 60 * 60_000)
    assert.equal(created.createdPairing.attemptsRemaining, 5)
    const send = async (msgid, userId) => {
      await writeFile(inbox, JSON.stringify({ headers: { req_id: msgid }, body: {
        msgid, chattype: 'single', from: { userid: userId },
        text: { content: `绑定 ${created.createdPairing.pairingCode}` },
      } }))
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          const reply = JSON.parse(await readFile(replies, 'utf8'))
          if (reply.msgid === msgid) return reply.content
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      throw new Error('OFFLINE_BOT_REPLY_TIMEOUT')
    }
    assert.match(await send('pair-test-1', 'operations.manager'), /绑定成功.*共2家门店/)
    const bound = await read()
    assert.equal(bound.members.length, 1)
    assert.deepEqual(bound.members[0].hotelIds, hotelIds)
    assert.equal(bound.members[0].displayName, '离线测试运营经理')
    assert.equal(bound.members[0].globalRecipient, false)
    assert.match(await send('pair-test-2', 'uninvited.user'), /无效或已过期/)
    assert.equal((await read()).members.length, 1)
    const authorize = async (userId, expectedRowVersion) => fetch(endpoint, {
      method: 'POST', headers, body: JSON.stringify({ action: 'AUTHORIZE', expectedRowVersion: expectedRowVersion ?? (await read()).rowVersion,
        reasonCode: 'MANAGE_WECOM_REPAIR_ADMINS', userId, directoryUserId: `${userId}.directory`,
        directoryIdentityConfirmed: true, hotelIds, displayName: '预授权测试经理', role: 'OPERATIONS_MANAGER' }),
    })
    const preauthorized = await authorize('pending.manager')
    assert.equal(preauthorized.status, 200)
    const pendingView = (await preauthorized.json()).data
    const pending = pendingView.members.find((m) => m.userId === 'pending.manager')
    assert.equal(pending.activationStatus, 'PENDING')
    assert.equal(pending.active, false)
    assert.deepEqual(pending.hotelIds, [])
    assert.deepEqual(pending.pendingHotelIds, hotelIds)
    assert.equal((await authorize('stale.manager', bound.rowVersion)).status, 409)
    const entry = async (userId, { corpId = 'ww-preauth-test', text = false, content = '激活' } = {}) => {
      const msgid = randomUUID()
      await writeFile(inbox, JSON.stringify({ headers: { req_id: msgid }, body: {
        aibotid: 'fake-offline-bot', msgid, chattype: 'single', from: { userid: userId, corpid: corpId },
        create_time: Math.floor(Date.now() / 1000), msgtype: text ? 'text' : 'event',
        ...(text ? { text: { content } } : { event: { eventtype: 'enter_chat' } }),
      } }))
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          const reply = JSON.parse(await readFile(replies, 'utf8'))
          if (reply.msgid === msgid) return reply.content
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      throw new Error('OFFLINE_ACTIVATION_REPLY_TIMEOUT')
    }
    await entry('pending.manager', { corpId: 'foreign-corp' })
    assert.equal((await read()).members.find((m) => m.userId === 'pending.manager').active, false)
    // Failed persistent write must not acknowledge/grant activation; retry remains possible.
    const configPath = join(runtimePath, 'wecom-repair-bot-config.json')
    await rm(configPath); await mkdir(configPath)
    assert.match(await entry('pending.manager'), /自动绑定未完成/)
    assert.equal((await read()).members.find((m) => m.userId === 'pending.manager').active, false)
    await rm(configPath, { recursive: true })
    assert.match(await entry('pending.manager'), /自动绑定成功.*共2家门店/)
    const activatedView = await read()
    const active = activatedView.members.find((m) => m.userId === 'pending.manager')
    assert.equal(active.activationStatus, 'ACTIVE')
    assert.deepEqual(active.hotelIds, hotelIds)
    assert.deepEqual(active.pendingHotelIds, [])
    assert.match(await entry('pending.manager', { text: true }), /已绑定/)
    assert.equal((await read()).rowVersion, activatedView.rowVersion)
    await authorize('text.manager')
    assert.match(await entry('text.manager', { text: true }), /自动绑定成功/)
    const cancelled = (await (await authorize('cancelled.manager')).json()).data
    const cancelledMember = cancelled.members.find((m) => m.userId === 'cancelled.manager')
    assert.equal((await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({
      action: 'REVOKE', expectedRowVersion: cancelled.rowVersion, reasonCode: 'MANAGE_WECOM_REPAIR_ADMINS', memberId: cancelledMember.memberId,
    }) })).status, 200)
    assert.match(await entry('cancelled.manager'), /已撤销/)
    assert.equal((await read()).members.find((m) => m.userId === 'cancelled.manager').active, false)
    // A fresh sender's explicit activation now creates an encrypted, zero-permission candidate.
    const registrationText = await entry('auto.discovered', { text: true, content: '激活 自动登记店长' })
    assert.match(registrationText, /已自动识别.*待授权/)
    const registered = await read()
    const discovered = registered.members.find((m) => m.userId === 'auto.discovered')
    assert.equal(discovered.activationStatus, 'REQUESTED')
    assert.equal(discovered.active, false)
    assert.equal(discovered.displayName, '自动登记店长')
    assert.deepEqual(discovered.hotelIds, [])
    assert.match(await entry('auto.discovered', { text: true }), /待授权/)
    assert.equal((await read()).rowVersion, registered.rowVersion)
    const approve = (version, extra = {}) => fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({
      action: 'APPROVE_REGISTRATION', expectedRowVersion: version, reasonCode: 'MANAGE_WECOM_REPAIR_ADMINS',
      memberId: discovered.memberId, hotelIds, displayName: '自动登记店长', role: 'OPERATIONS_MANAGER',
      identityConfirmed: true, ...extra,
    }) })
    assert.equal((await approve(before.rowVersion)).status, 409)
    assert.equal((await approve(registered.rowVersion, { identityConfirmed: false })).status, 400)
    // Disk failure must not grant or acknowledge a candidate approval.
    await rm(configPath); await mkdir(configPath)
    assert.equal((await approve(registered.rowVersion)).status, 500)
    assert.equal((await read()).members.find((m) => m.memberId === discovered.memberId).active, false)
    await rm(configPath, { recursive: true })
    assert.equal((await approve(registered.rowVersion, { userId: 'forged-other-account' })).status, 200)
    const approved = await read()
    const granted = approved.members.find((m) => m.memberId === discovered.memberId)
    assert.deepEqual(granted.hotelIds, hotelIds)
    assert.equal(granted.globalRecipient, false)
    assert.equal(granted.offboardingLinked, false)
    assert.equal(approved.members.some((m) => m.userId === 'forged-other-account'), false)
    assert.match(await entry('auto.discovered', { text: true }), /已绑定/)
    assert.equal((await approve(approved.rowVersion)).status, 400)
    // An unsuccessful candidate registration stays unregistered and can be retried safely.
    await rm(configPath); await mkdir(configPath)
    assert.match(await entry('failed.registration', { text: true }), /登记未完成/)
    assert.equal((await read()).members.some((m) => m.userId === 'failed.registration'), false)
    await rm(configPath, { recursive: true })
    assert.match(await entry('failed.registration', { text: true }), /已自动识别/)
    assert.match(await entry('cancelled.manager', { text: true }), /已撤销/)
    assert.match(await entry('foreign.registration', { text: true, corpId: 'foreign' }), /无法核验/)
    assert.equal((await read()).members.some((m) => m.userId === 'foreign.registration'), false)
    const persisted = await readFile(join(runtimePath, 'wecom-repair-bot-secrets.json'), 'utf8')
    assert.equal(persisted.includes('pending.manager'), false)
    assert.equal(persisted.includes('auto.discovered'), false)
    assert.equal(persisted.includes('自动登记店长'), false)
    await stopApi(child)
    const restarted = await startApi(runtimePath, { preload, loginProbe: true }); child = restarted.child
    const reloaded = (await (await fetch(`http://127.0.0.1:${restarted.port}/api/v1/ota/wecom-repair-admins`, {
      headers: { Authorization: `Bearer ${restarted.accessToken}` },
    })).json()).data
    assert.equal(reloaded.members.find((m) => m.userId === 'failed.registration').activationStatus, 'REQUESTED')
    assert.deepEqual(reloaded.members.find((m) => m.userId === 'auto.discovered').hotelIds, hotelIds)
  } finally {
    if (child) await stopApi(child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})

test('binding approvals work through real admin API, offline push and card callbacks, persist once and fail closed', async () => {
  const runtimePath = await mkdtemp(join(os.tmpdir(), 'wecom-binding-approval-api-'))
  let child
  try {
    const fakePath = join(runtimePath, 'fake-sdk.cjs'), preload = join(runtimePath, 'preload.mjs')
    const inbox = join(runtimePath, 'inbox.json'), replies = join(runtimePath, 'replies.json'), messages = join(runtimePath, 'messages.json')
    await writeFile(fakePath, `
      const { EventEmitter } = require('node:events');
      const { existsSync, readFileSync, writeFileSync } = require('node:fs');
      module.exports = { generateReqId: () => 'test-request', WSClient: class extends EventEmitter {
        isConnected = true; seen = new Set(); timer = null;
        connect() { this.emit('authenticated'); this.timer = setInterval(() => {
          let frame; try { frame = JSON.parse(readFileSync(${JSON.stringify(inbox)}, 'utf8')); } catch { return; }
          if (this.seen.has(frame.body.msgid)) return;
          this.seen.add(frame.body.msgid); this.emit(frame.body.msgtype === 'event' ? 'event.' + frame.body.event.eventtype : 'message.text', frame);
        }, 15); }
        disconnect() { clearInterval(this.timer); }
        async replyStream(frame, id, content) { writeFileSync(${JSON.stringify(replies)}, JSON.stringify({ msgid: frame.body.msgid, content })); return { errcode: 0 }; }
        async updateTemplateCard(frame, card) { writeFileSync(${JSON.stringify(replies)}, JSON.stringify({ msgid: frame.body.msgid, content: JSON.stringify(card) })); return { errcode: 0 }; }
        async sendMessage(userId, body) {
          const path = ${JSON.stringify(messages)};
          const rows = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
          rows.push({ userId, body }); writeFileSync(path, JSON.stringify(rows)); return { errcode: 0 };
        }
      } };
    `)
    await writeFile(preload, `import { registerHooks } from 'node:module'; registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier.endsWith('wecom-aibot-sdk-1.0.7.cjs')) return { url: ${JSON.stringify(pathToFileURL(fakePath).href)}, shortCircuit: true };
      return nextResolve(specifier, context);
    } });`)
    await writeFile(join(runtimePath, 'wecom-repair-bot-config.json'), JSON.stringify({ enabled: true }))
    await writeFile(join(runtimePath, 'wecom-repair-bot-secrets.json'), JSON.stringify({ record: encryptCookie(JSON.stringify({
      botId: 'fake-approval-bot', secret: 'example-offline-approval-secret', allowedUserIds: ['owner', 'ops'], hotelAllowedUserIds: {},
      userProfiles: Object.fromEntries(['owner', 'ops'].map((id) => [id, { displayName: `测试${id}`, directoryUserId: id, directoryLinkedAt: new Date().toISOString() }])),
      directorySync: { enabled: true, corpId: 'ww-approval-test', token: 'exampleApprovalToken',
        encodingAesKey: Buffer.alloc(32, 19).toString('base64').slice(0, -1), verifiedAt: new Date().toISOString() },
    }), secretKey, 'wecom-repair-bot:v1') }))
    let started = await startApi(runtimePath, { preload }); child = started.child
    let base = `http://127.0.0.1:${started.port}`, accessToken = started.accessToken
    const headers = () => ({ Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' })
    const read = async () => (await (await fetch(`${base}/api/v1/ota/wecom-repair-admins`, { headers: headers() })).json()).data
    const post = async (body, version) => fetch(`${base}/api/v1/ota/wecom-repair-admins`, { method: 'POST', headers: headers(),
      body: JSON.stringify({ ...body, expectedRowVersion: version ?? (await read()).rowVersion, reasonCode: 'MANAGE_WECOM_REPAIR_ADMINS' }) })
    const until = async (fn) => {
      for (let i = 0; i < 160; i += 1) { try { const value = await fn(); if (value) return value } catch {} await new Promise((r) => setTimeout(r, 30)) }
      throw Error('APPROVAL_TEST_TIMEOUT')
    }
    const send = async (userId, text, event = null) => {
      const msgid = randomUUID()
      await writeFile(inbox, JSON.stringify({ headers: { req_id: msgid }, body: { aibotid: 'fake-approval-bot', msgid,
        msgtype: event ? 'event' : 'text', chattype: 'single', from: { userid: userId, corpid: 'ww-approval-test' },
        create_time: Math.floor(Date.now() / 1000), ...(event ? { event: { eventtype: 'template_card_event', ...event } } : { text: { content: text } }),
      } }))
      return until(async () => { const row = JSON.parse(await readFile(replies, 'utf8')); return row.msgid === msgid && row.content })
    }
    assert.equal((await read()).bindingApproval.enabled, false)
    assert.deepEqual((await read()).bindingApproval.approverMemberIds, [])
    assert.match(await send('employee', '申请 001,002 测试员工'), /尚未启用/)
    assert.equal((await post({ action: 'APPROVAL_CONFIG', approvalEnabled: true, approverMemberIds: ['owner', 'ops'].map(sha256) })).status, 200)
    assert.equal((await post({ action: 'APPROVAL_CONFIG', approvalEnabled: false, approverMemberIds: [] }, 0)).status, 409)
    assert.match(await send('employee', '申请 001,002 测试员工'), /申请已登记/)
    assert.equal((await read()).members.some((m) => m.userId === 'employee'), false)
    await until(async () => (await read()).bindingApproval.requests[0]?.deliveredCount === 2)
    const sent = JSON.parse(await readFile(messages, 'utf8'))
    assert.equal(sent.length, 2)
    const ownerCard = sent.find((m) => m.userId === 'owner').body.template_card
    const opsCard = sent.find((m) => m.userId === 'ops').body.template_card
    assert.match(await send('employee', '申请 001,002 测试员工'), /无需重复提交/)
    assert.match(await send('employee', '申请状态'), /2\/2/)
    const event = (card, key = 'BIND_APPROVE') => ({ task_id: card.task_id, event_key: key })
    assert.match(await send('outsider', null, event(ownerCard)), /没有此卡片的审批权/)
    assert.equal((await read()).bindingApproval.requests[0].status, 'PENDING')
    // Force the same persistence failure production must survive: no granted scopes in memory.
    const configPath = join(runtimePath, 'wecom-repair-bot-config.json')
    await rm(configPath); await mkdir(configPath)
    assert.match(await send('owner', null, event(ownerCard)), /结果未确认/)
    assert.equal((await read()).members.some((m) => m.userId === 'employee'), false)
    await rm(configPath, { recursive: true })
    assert.match(await send('ops', null, event(opsCard)), /已同意绑定/)
    const row = (await read()).members.find((m) => m.userId === 'employee')
    assert.equal(row.hotels.length, 2); assert.equal(row.globalRecipient, false)
    assert.equal(row.offboardingLinked, false); assert.equal(row.nameSource, 'APPLICANT_PROVIDED')
    assert.match(await send('owner', null, event(ownerCard, 'BIND_REJECT')), /本申请已处理/)
    await until(async () => JSON.parse(await readFile(messages, 'utf8')).length === 4)
    assert.equal((await read()).bindingApproval.requests[0].status, 'APPROVED')
    assert.match(await send('employee', '申请状态'), /绑定成功/)
    const persisted = await readFile(join(runtimePath, 'wecom-repair-bot-secrets.json'), 'utf8')
    assert.equal(persisted.includes('测试员工'), false)
    assert.equal(persisted.includes(ownerCard.task_id), false)
    const health = await (await fetch(`${base}/health`)).text()
    assert.equal(health.includes('测试员工'), false)
    assert.equal(health.includes(ownerCard.task_id), false)
    await stopApi(child); child = null
    started = await startApi(runtimePath, { preload, loginProbe: true }); child = started.child
    base = `http://127.0.0.1:${started.port}`; accessToken = started.accessToken
    assert.equal((await read()).bindingApproval.requests[0].status, 'APPROVED')
    assert.match(await send('owner', null, event(ownerCard)), /本申请已处理/)
    assert.equal(JSON.parse(await readFile(messages, 'utf8')).length, 4)
    assert.match(await send('declined.employee', '申请 001 待拒绝员工'), /申请已登记/)
    await until(async () => (await read()).bindingApproval.requests[0]?.deliveredCount === 2)
    const nextCards = JSON.parse(await readFile(messages, 'utf8')).slice(-2)
    assert.match(await send('owner', null, event(nextCards.find((m) => m.userId === 'owner').body.template_card, 'BIND_REJECT')), /已拒绝申请/)
    assert.equal((await read()).members.some((m) => m.userId === 'declined.employee'), false)
    await until(async () => JSON.parse(await readFile(messages, 'utf8')).some((m) => m.userId === 'declined.employee' && m.body.markdown?.content.includes('已拒绝')))
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
