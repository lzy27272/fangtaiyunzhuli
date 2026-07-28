import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createReviewAuthStore } from '../../../tools/uat/review-auth-store.mjs'

const createFixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'review-auth-store-'))
  const statePath = join(directory, 'review-auth-state.json')
  const store = createReviewAuthStore({
    statePath,
    bootstrapUsername: 'review-admin',
    bootstrapPassword: 'example-Initial-Password-42',
    bootstrapAccessToken: 'example-bootstrap-access-token',
  })
  return { directory, statePath, store }
}

test('review auth state hashes passwords and rotates the bootstrap token on login', async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.directory, { recursive: true, force: true }))

  const persisted = await readFile(fixture.statePath, 'utf8')
  assert.doesNotMatch(persisted, /example-Initial-Password-42/)
  assert.doesNotMatch(persisted, /example-bootstrap-access-token/)
  assert.match(persisted, /"algorithm": "scrypt"/)
  assert.equal(
    fixture.store.authenticate('example-bootstrap-access-token'),
    true,
  )

  const session = fixture.store.login(
    'review-admin',
    'example-Initial-Password-42',
  )
  assert.ok(session)
  assert.equal(session.username, 'review-admin')
  assert.equal(session.accessToken.length, 64)
  assert.equal(
    fixture.store.authenticate('example-bootstrap-access-token'),
    false,
  )
  assert.equal(fixture.store.authenticate(session.accessToken), true)
})

test('credential changes persist without plaintext and invalidate the old session', async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.directory, { recursive: true, force: true }))

  const loginSession = fixture.store.login(
    'review-admin',
    'example-Initial-Password-42',
  )
  const changed = fixture.store.changeCredentials({
    currentPassword: 'example-Initial-Password-42',
    newUsername: 'operations-admin',
    newPassword: 'example-New-Secure-Password-84',
  })

  assert.equal(fixture.store.authenticate(loginSession.accessToken), false)
  assert.equal(fixture.store.authenticate(changed.accessToken), true)
  assert.equal(changed.username, 'operations-admin')

  const persisted = await readFile(fixture.statePath, 'utf8')
  assert.doesNotMatch(persisted, /example-Initial-Password-42/)
  assert.doesNotMatch(persisted, /example-New-Secure-Password-84/)
  assert.doesNotMatch(persisted, new RegExp(changed.accessToken))

  const restored = createReviewAuthStore({
    statePath: fixture.statePath,
    bootstrapUsername: 'ignored-admin',
    bootstrapPassword: 'example-Ignored-Password-42',
    bootstrapAccessToken: 'example-ignored-access-token',
  })
  assert.equal(
    restored.login('review-admin', 'example-Initial-Password-42'),
    null,
  )
  assert.ok(
    restored.login('operations-admin', 'example-New-Secure-Password-84'),
  )
})

test('credential changes reject incorrect current passwords and weak replacements', async (t) => {
  const fixture = await createFixture()
  t.after(() => rm(fixture.directory, { recursive: true, force: true }))

  assert.throws(
    () => fixture.store.changeCredentials({
      currentPassword: 'example-incorrect-password',
      newUsername: 'operations-admin',
      newPassword: 'example-New-Secure-Password-84',
    }),
    /REVIEW_AUTH_CURRENT_PASSWORD_INVALID/,
  )
  assert.throws(
    () => fixture.store.changeCredentials({
      currentPassword: 'example-Initial-Password-42',
      newUsername: 'operations-admin',
      newPassword: 'alllowercase',
    }),
    /REVIEW_AUTH_PASSWORD_WEAK/,
  )
  assert.throws(
    () => fixture.store.changeCredentials({
      currentPassword: 'example-Initial-Password-42',
      newUsername: 'bad account',
      newPassword: 'example-New-Secure-Password-84',
    }),
    /REVIEW_AUTH_USERNAME_INVALID/,
  )
})

test('a malformed persisted auth state fails closed', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'review-auth-invalid-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const statePath = join(directory, 'review-auth-state.json')
  await writeFile(statePath, '{"version":1,"username":"review-admin"}\n')

  assert.throws(
    () => createReviewAuthStore({
      statePath,
      bootstrapUsername: 'review-admin',
      bootstrapPassword: 'example-Initial-Password-42',
      bootstrapAccessToken: 'example-bootstrap-access-token',
    }),
    /REVIEW_AUTH_STATE_INVALID/,
  )
})
