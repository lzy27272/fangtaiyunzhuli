import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyFliggyLoginChallengeText,
  fliggyControlledLoginPolicy,
  fliggyCookieHeaderForHost,
  fliggyMtopTokenAvailable,
  normalizeFliggySessionState,
} from '../../../tools/uat/fliggy-controlled-login.mjs'

const cookie = (name, value, domain, path = '/') => ({
  name,
  value,
  domain,
  path,
  expires: -1,
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
})

test('Fliggy session keeps only approved OTA domains', () => {
  const normalized = normalizeFliggySessionState({
    cookies: [
      cookie('_m_h5_tk', 'synthetic_token_1', '.fliggy.com'),
      cookie('sid', 'synthetic_sid', '.taobao.com'),
      cookie('unrelated', 'must-not-survive', '.example.com'),
    ],
    origins: [{ origin: 'https://hotel.fliggy.com', localStorage: [] }],
  })
  assert.deepEqual(
    normalized.cookies.map((item) => item.name),
    ['_m_h5_tk', 'sid'],
  )
  assert.equal(JSON.stringify(normalized).includes('must-not-survive'), false)
})

test('Fliggy cookies are projected only to the requested approved host', () => {
  const state = {
    cookies: [
      cookie('_m_h5_tk', 'synthetic_token_1', '.fliggy.com'),
      cookie('hotel_session', 'synthetic_hotel', 'hotel.fliggy.com'),
      cookie('taobao_session', 'synthetic_taobao', '.taobao.com'),
    ],
  }
  assert.match(
    fliggyCookieHeaderForHost(state, 'h5api.m.fliggy.com'),
    /_m_h5_tk=synthetic_token_1/,
  )
  assert.doesNotMatch(
    fliggyCookieHeaderForHost(state, 'h5api.m.fliggy.com'),
    /taobao_session/,
  )
  assert.equal(fliggyMtopTokenAvailable(state), true)
  assert.throws(
    () => fliggyCookieHeaderForHost(state, 'example.com'),
    /OTA_FLIGGY_COOKIE_HOST_UNSAFE/,
  )
})

test('Fliggy login challenges fail closed and remain human verified', () => {
  assert.deepEqual(
    classifyFliggyLoginChallengeText('请输入短信验证码'),
    {
      status: 'VERIFICATION_REQUIRED',
      reasonCode: 'OTA_FLIGGY_CODE_VERIFICATION_REQUIRED',
      challengeType: 'CODE',
    },
  )
  assert.equal(
    classifyFliggyLoginChallengeText('请拖动滑块完成安全验证').status,
    'EXTERNAL_VERIFICATION_REQUIRED',
  )
  assert.equal(
    classifyFliggyLoginChallengeText('账号或密码错误').status,
    'FAILED',
  )
  assert.deepEqual(
    {
      maxAttemptsPerWindow:
        fliggyControlledLoginPolicy.maxAttemptsPerWindow,
      attemptWindowMinutes:
        fliggyControlledLoginPolicy.attemptWindowMinutes,
      challengeTtlMinutes:
        fliggyControlledLoginPolicy.challengeTtlMinutes,
      maxVerificationAnswers:
        fliggyControlledLoginPolicy.maxVerificationAnswers,
    },
    {
      maxAttemptsPerWindow: 3,
      attemptWindowMinutes: 30,
      challengeTtlMinutes: 10,
      maxVerificationAnswers: 3,
    },
  )
})
