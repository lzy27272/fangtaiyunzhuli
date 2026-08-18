import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import test from 'node:test'

import {
  isRecoverableLuopanProfileLaunchFailure,
  launchLuopanBrowserContext,
} from '../../../tools/uat/luopan-controlled-browser-collector.mjs'

const sessionState = {
  cookies: [{
    name: 'synthetic_session',
    value: 'synthetic_value',
    domain: 'bj.chinapms.com',
    path: '/',
    expires: -1,
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  }],
  origins: [],
}

test('Luopan collection falls back to an isolated context after profile launch closes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'luopan-fallback-'))
  const previousBase = process.env.LUOPAN_BROWSER_PROFILE_BASE
  try {
    process.env.LUOPAN_BROWSER_PROFILE_BASE = root
    await mkdir(join(root, 'hotel-profile', 'browser-profile'), {
      recursive: true,
    })
    const calls = []
    let cookiesApplied = 0
    const fallbackContext = {
      addCookies: async (cookies) => { cookiesApplied += cookies.length },
      addInitScript: async () => undefined,
      close: async () => undefined,
    }
    const chromium = {
      launchPersistentContext: async (profileRoot) => {
        calls.push(profileRoot)
        if (calls.length === 1) {
          throw new Error('Target page, context or browser has been closed')
        }
        return fallbackContext
      },
    }
    const result = await launchLuopanBrowserContext(
      'hotel-profile',
      sessionState,
      { chromium, executablePath: process.execPath },
    )
    assert.equal(result.context, fallbackContext)
    assert.equal(result.profileMode, 'EPHEMERAL_SESSION_FALLBACK')
    assert.equal(calls.length, 2)
    assert.equal(calls[1], '')
    assert.equal(cookiesApplied, 1)
  } finally {
    if (previousBase === undefined) {
      delete process.env.LUOPAN_BROWSER_PROFILE_BASE
    } else {
      process.env.LUOPAN_BROWSER_PROFILE_BASE = previousBase
    }
    await rm(root, { recursive: true, force: true })
  }
})

test('Luopan profile launch does not fall back without a stored session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'luopan-no-fallback-'))
  const previousBase = process.env.LUOPAN_BROWSER_PROFILE_BASE
  try {
    process.env.LUOPAN_BROWSER_PROFILE_BASE = root
    await mkdir(join(root, 'hotel-profile', 'browser-profile'), {
      recursive: true,
    })
    let calls = 0
    const chromium = {
      launchPersistentContext: async () => {
        calls += 1
        throw new Error('Target page, context or browser has been closed')
      },
    }
    await assert.rejects(
      launchLuopanBrowserContext(
        'hotel-profile',
        null,
        { chromium, executablePath: process.execPath },
      ),
      /Target page, context or browser has been closed/,
    )
    assert.equal(calls, 1)
    assert.equal(
      isRecoverableLuopanProfileLaunchFailure(
        new Error('Target page, context or browser has been closed'),
      ),
      true,
    )
  } finally {
    if (previousBase === undefined) {
      delete process.env.LUOPAN_BROWSER_PROFILE_BASE
    } else {
      process.env.LUOPAN_BROWSER_PROFILE_BASE = previousBase
    }
    await rm(root, { recursive: true, force: true })
  }
})
