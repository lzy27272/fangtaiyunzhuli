import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isLuopanNavigationTimeout,
  navigateLuopanPage,
} from '../../../tools/uat/luopan-controlled-browser-collector.mjs'

test('Luopan navigation timeout falls through to DOM validation', async () => {
  let waited = 0
  const page = {
    goto: async () => {
      throw new Error('page.goto: Timeout 30000ms exceeded')
    },
    waitForTimeout: async (milliseconds) => { waited += milliseconds },
  }
  await navigateLuopanPage(
    page,
    'http://bj.chinapms.com:8880/pms-web/home/hg_index.do',
  )
  assert.equal(waited, 500)
  assert.equal(
    isLuopanNavigationTimeout(
      new Error('page.goto: Timeout 30000ms exceeded'),
    ),
    true,
  )
})

test('Luopan non-timeout navigation failures remain closed', async () => {
  const page = {
    goto: async () => { throw new Error('net::ERR_CONNECTION_REFUSED') },
    waitForTimeout: async () => undefined,
  }
  await assert.rejects(
    navigateLuopanPage(
      page,
      'http://bj.chinapms.com:8880/pms-web/home/hg_index.do',
    ),
    /ERR_CONNECTION_REFUSED/,
  )
})
