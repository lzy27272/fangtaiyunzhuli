import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('overview configuration actions switch to mounted PMS and OTA sections', async () => {
  const [overview, reportPage] = await Promise.all([
    source('../src/pages/DataAccessOverviewPanel.tsx'),
    source('../src/pages/ReportSourceConfigPage.tsx'),
  ])
  assert.match(overview, /onClick=\{onOpenOtaConfiguration\}/u)
  assert.match(overview, /onClick=\{onOpenPmsConfiguration\}/u)
  assert.doesNotMatch(overview, /href="#(?:ota|luopan|report)/u)
  assert.doesNotMatch(overview, /核对罗盘云配置|核对报表接口/u)
  assert.match(reportPage, /PMS系统配置/u)
  assert.match(reportPage, /initialSection\?: CollectionSection/u)
  assert.match(reportPage, /setCollectionSection\(initialSection\)/u)
  assert.match(reportPage, /onSectionChange\?\.\(section\)/u)
  assert.match(
    reportPage,
    /厂家链接和报表入口由系统根据门店档案自动生成或加载，无需再次输入/u,
  )
  assert.match(
    reportPage,
    /collectionSection === 'pms' && pmsSystemCode === 'OTHER'/u,
  )
})

test('one-click navigation preserves the exact failed OTA source and platform end to end', async () => {
  const [app, storePage, reportPage, otaPanel] = await Promise.all([
    source('../src/App.tsx'),
    source('../src/pages/StoreConsolePage.tsx'),
    source('../src/pages/ReportSourceConfigPage.tsx'),
    source('../src/pages/OtaSourceConfigPanel.tsx'),
  ])
  assert.match(
    storePage,
    /otaAttentionPlatformCode\?: OtaPlatformCode \| null/u,
  )
  assert.match(storePage, /otaAttentionSourceId: failedOta\.sourceId/u)
  assert.match(storePage, /otaAttentionPlatformCode: failedOta\.platformCode/u)
  assert.match(storePage, /direct\?\.options/u)
  assert.match(storePage, /initialSection=\{collectionSection\}/u)
  assert.match(
    storePage,
    /otaAttentionPlatformCode=\{otaAttentionPlatformCode\}/u,
  )
  assert.match(storePage, /otaAttentionSourceId=\{otaAttentionSourceId\}/u)
  assert.match(storePage, /canRepairLogin/u)
  assert.match(app, /setSelectedOtaAttentionSourceId/u)
  assert.match(
    app,
    /setSelectedOtaAttentionPlatformCode\([\s\S]*options\.otaAttentionPlatformCode \?\? null/u,
  )
  assert.match(app, /setStoreNavigationSequence\(\(current\) => current \+ 1\)/u)
  assert.match(
    app,
    /initialOtaAttentionPlatformCode=\{selectedOtaAttentionPlatformCode\}/u,
  )
  assert.match(
    app,
    /initialOtaAttentionSourceId=\{selectedOtaAttentionSourceId\}/u,
  )
  assert.match(storePage, /setCollectionNavigationSequence/u)
  assert.match(
    reportPage,
    /attentionPlatformCode=\{otaAttentionPlatformCode\}/u,
  )
  assert.match(
    reportPage,
    /attentionRequestSequence=\{navigationSequence\}/u,
  )
  assert.match(
    otaPanel,
    /attentionSourceId === null && attentionPlatformCode === null/u,
  )
  assert.match(otaPanel, /let targetPlatformCode = attentionPlatformCode/u)
  assert.match(
    otaPanel,
    /document\.getElementById\(otaPlatformId\(targetPlatformCode\)\)/u,
  )
  assert.match(otaPanel, /id=\{otaPlatformId\(group\.platformCode\)\}/u)
  assert.match(
    otaPanel,
    /attentionRequestSequence,[\s\S]*attentionPlatformCode,[\s\S]*attentionSourceId/u,
  )
  assert.match(otaPanel, /setExpandedSourceIds/u)
})

test('Fliggy login reports progress and terminal results in-card with repair actions', async () => {
  const [panel, businessApi, reviewApi] = await Promise.all([
    source('../src/pages/OtaSourceConfigPanel.tsx'),
    source('../src/api/business.ts'),
    source('../../../tools/uat/ota-standalone-review-api.mjs'),
  ])
  assert.match(panel, /正在登录飞猪/u)
  assert.match(panel, /飞猪登录成功/u)
  assert.match(panel, /飞猪登录失败/u)
  assert.match(panel, /需要在飞猪官网确认/u)
  assert.match(panel, /定位账号密码/u)
  assert.match(panel, /打开飞猪官网验证/u)
  assert.match(panel, /CONTROLLED_LOGIN_TIMEOUT_MS = 120_000/u)
  assert.match(panel, /Promise\.race\(\[request\(controller\.signal\), timeout\]\)/u)
  assert.match(panel, /controlledLogin\?\.challengeAttemptId/u)
  assert.doesNotMatch(panel, /controlledLoginResult\?\.attemptId/u)
  assert.match(panel, /尚未配置飞猪账号密码/u)
  assert.match(panel, /请先保存或撤销当前修改/u)
  const cookieField = panel.slice(
    panel.indexOf('渠道登录凭据'),
    panel.indexOf('OTA账号'),
  )
  const accountField = panel.slice(
    panel.indexOf('OTA账号'),
    panel.indexOf('OTA密码'),
  )
  assert.doesNotMatch(cookieField, /otaAccountInputId/u)
  assert.match(accountField, /id=\{otaAccountInputId\(source\.sourceId\)\}/u)
  assert.match(businessApi, /challengeExpiresAt: string \| null/u)
  assert.match(businessApi, /options: \{ signal\?: AbortSignal \} = \{\}/u)
  const routeStart = reviewApi.indexOf(
    "suffix === '/ota-controlled-logins'",
    reviewApi.indexOf("request.method === 'POST'"),
  )
  const routeEnd = reviewApi.indexOf(
    "suffix === '/ota-controlled-login-verifications'",
    routeStart,
  )
  const loginRoute = reviewApi.slice(routeStart, routeEnd)
  assert.match(loginRoute, /refreshedSources: \[\]/u)
  assert.doesNotMatch(loginRoute, /refreshOtaPlatformSourcesFor/u)
})
