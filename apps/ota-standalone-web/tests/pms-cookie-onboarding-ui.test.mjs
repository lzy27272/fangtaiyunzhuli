import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function component(name, imports = {}, globals = {}) {
  const source = readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
    .replaceAll('import.meta.env', '({})')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  })
  const exports = {}
  runInNewContext(outputText, { exports, Error, ...globals,
    require: (id) => imports[id] ?? require(id) })
  return exports
}
const display = component('ui/businessDisplay.ts')
const context = { tenantId: 'synthetic-tenant', hotelId: 'synthetic-hotel-009' }
const notBound = { status: 'NOT_BOUND', firstTimeSetupRequired: true, canInitialize: true,
  hotelRowVersion: 17, hotelCode: '009', hotelName: 'Synthetic hotel',
  collectionEnabled: false, automaticHourlyCollectionEnabled: true,
  enabledSourceCount: 3, roomForecastConfigured: false }
const bound = { ...notBound, status: 'BOUND', firstTimeSetupRequired: false,
  expectedPmsHotelId: '84521', collectionEnabled: true }
const validation = { status: 'SUCCEEDED', businessDate: '2026-10-22', sourceCount: 3,
  successfulSourceCount: 3, replacedSourceCount: 3, outboundDeliveryAttempted: false }
const collection = { status: 'SUCCEEDED', sourceCount: 3, successfulSourceCount: 3 }
const flush = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

// Only hook storage and fetch are replaced. JSX, event handlers, API serialization,
// effects, and their cleanup execute; the fixture never accesses browser storage.
function panel({ initial = notBound, canSubmit = true, respond } = {}) {
  const state = [], refs = [], effects = [], calls = [], refreshed = [], writes = []
  let stateIndex = 0, refIndex = 0, effectIndex = 0, propsContext = context, mounted = true
  const api = component('api/business.ts', {
    './auth': { refreshSession: async () => { throw new Error('unexpected token refresh') } },
    '../auth/session': { getSession: () => ({ accessToken: 'synthetic-token' }),
      setSession() {}, clearSession() {} },
  }, { fetch: async (url, init) => {
    const call = { url, method: init.method ?? 'GET',
      body: init.body ? JSON.parse(init.body) : undefined }
    calls.push(call)
    let data
    if (respond) data = await respond(call, calls)
    else if (call.method === 'GET') data = calls.length === 1 ? initial : bound
    else data = url.endsWith('/live-collection-runs') ? collection : validation
    return { ok: true, status: 200, json: async () => ({ data }) }
  } })
  const { BieyanghongCookieRepairPanel } = component('pages/BieyanghongCookieRepairPanel.tsx', {
    react: { ...React,
      useState(initialValue) {
        const position = stateIndex++
        if (!(position in state)) state[position] = initialValue
        return [state[position], (value) => {
          writes.push({ mounted, position })
          state[position] = typeof value === 'function' ? value(state[position]) : value
        }]
      },
      useRef(initialValue) {
        const position = refIndex++
        return refs[position] ??= { current: initialValue }
      },
      useEffect(callback, deps) {
        const position = effectIndex++, previous = effects[position]
        if (!previous || deps.some((value, index) => value !== previous.deps[index])) {
          effects[position] = { deps, callback, cleanup: previous?.cleanup, pending: true }
        }
      },
    },
    '../api/business': api,
    '../ui/businessDisplay': display,
  })
  const render = () => {
    stateIndex = refIndex = effectIndex = 0
    const tree = BieyanghongCookieRepairPanel({ context: propsContext, hotelCode: '009',
      canSubmit, onStatusChanged: () => refreshed.push(propsContext.hotelId) })
    for (const effect of effects) {
      if (!effect.pending) continue
      effect.cleanup?.()
      effect.pending = false
      effect.cleanup = effect.callback()
    }
    return tree
  }
  return { calls, refreshed, writes, render,
    async mount() { render(); await flush(); return render() },
    switchContext(next) { propsContext = next; return render() },
    unmount() { for (const effect of effects) effect.cleanup?.(); mounted = false },
  }
}
function find(element, predicate) {
  if (!React.isValidElement(element)) return null
  if (predicate(element)) return element
  for (const child of React.Children.toArray(element.props.children)) {
    const result = find(child, predicate)
    if (result) return result
  }
  return null
}
function control(tree, type, predicate = () => true) {
  const result = find(tree, element => element.type === type && predicate(element.props))
  assert.ok(result, `missing ${type}`)
  return result
}
const cookie = tree => control(tree, 'input', props => props.type === 'password')
const identity = tree => control(tree, 'input', props => props.name === 'pms-official-hotel-name')
const confirm = tree => control(tree, 'input', props => props.type === 'checkbox')
const submit = tree => control(tree, 'button', props => props.className !== 'secondary')
const markup = view => renderToStaticMarkup(view.render())
function fill(view, { name = '四方馆自营 SeeCity·归来酒店', confirmed = true, value = 'session=synthetic; hotelId=99999' } = {}) {
  let tree = view.render()
  const input = find(tree, element => element.type === 'input' && element.props.name === 'pms-official-hotel-name')
  if (input) {
    input.props.onChange({ target: { value: name } })
    tree = view.render()
  }
  cookie(tree).props.onChange({ target: { value } })
  if (input) confirm(view.render()).props.onChange({ target: { checked: confirmed } })
  return view.render()
}

test('first authorization requires an independently entered official store name, identity confirmation and Cookie; submits the row version and immediately clears the secret', async () => {
  const pending = deferred()
  const view = panel({ respond: call => call.method === 'GET'
    ? (view.calls.length === 1 ? notBound : bound)
    : call.url.endsWith('/pms-cookie-validation') ? pending.promise : collection })
  let tree = await view.mount()
  cookie(tree).props.onChange({ target: { value: 'session=synthetic; hotelId=99999' } })
  tree = view.render()
  assert.equal(identity(tree).props.value, '', 'neither Cookie nor the local hotel name may supply the independently confirmed name')
  assert.equal(identity(tree).props.maxLength, 80)
  assert.ok(identity(tree).props.type === undefined || identity(tree).props.type === 'text')
  assert.equal(find(tree, element => element.type === 'input' && element.props.inputMode === 'numeric'), null,
    'first authorization must not require a user-visible numeric PMS ID')
  assert.equal(submit(tree).props.disabled, true)
  assert.match(markup(view), /请先填写美团界面显示的完整门店名称，无需数字编号/u)
  for (const name of ['', '   ', '0', '84521', 'A'.repeat(81),
    '\u0000酒店', '酒店\n', '\t酒店', '酒店\u007f', '酒店\u009f', '酒店\u200b',
    '酒店\u200f', '酒店\u2028', '酒店\u2029', '酒店\u202a', '酒店\u202e', '酒店\u2060', '酒店\u206f', '\ufeff酒店']) {
    tree = fill(view, { name })
    assert.equal(submit(tree).props.disabled, true, `invalid independent name: ${JSON.stringify(name)}`)
    assert.match(markup(view), /请先填写美团界面显示的完整门店名称，无需数字编号/u)
  }
  tree = fill(view, { confirmed: false })
  assert.equal(submit(tree).props.disabled, true)
  assert.match(markup(view), /请勾选确认：美团店名与当前后台门店是同一家店，再提交授权/u)
  tree = fill(view, { value: '' })
  assert.equal(submit(tree).props.disabled, true)
  assert.match(markup(view), /请粘贴本店 Cookie/u)
  tree = fill(view, { name: '店' })
  assert.equal(submit(tree).props.disabled, false, 'one-character official store name is accepted')
  tree = fill(view, { name: '店'.repeat(80) })
  assert.equal(submit(tree).props.disabled, false, '80-character official store name is accepted')
  tree = fill(view)
  assert.equal(submit(tree).props.disabled, false)
  identity(tree).props.onChange({ target: { value: '四方馆自营 SeeCity·归来酒店（新店名）' } })
  tree = view.render()
  assert.equal(confirm(tree).props.checked, false, 'editing the store name invalidates confirmation')
  assert.equal(submit(tree).props.disabled, true)
  tree = fill(view)
  cookie(tree).props.onChange({ target: { value: 'session=another-synthetic-cookie' } })
  tree = view.render()
  assert.equal(confirm(tree).props.checked, false, 'editing Cookie invalidates store identity confirmation')
  assert.equal(submit(tree).props.disabled, true)
  tree = fill(view, { name: '  四方馆自营 SeeCity·归来酒店  ' })
  assert.match(renderToStaticMarkup(tree), /系统只读取授权中的内部标识用于固定本店归属，不代表美团已自动认证该店名/u)
  submit(tree).props.onClick()
  tree = view.render()
  assert.equal(cookie(tree).props.value, '')
  assert.equal(submit(tree).props.disabled, true)
  const post = view.calls.find(call => call.method === 'POST')
  assert.match(post.url, /\/synthetic-hotel-009\/pms-cookie-validation$/u)
  assert.deepEqual(post.body, { cookieHeader: 'session=synthetic; hotelId=99999',
    initialStoreBinding: { independentExpectedPmsHotelName: '四方馆自营 SeeCity·归来酒店',
      confirmStoreIdentity: true, expectedRowVersion: 17 },
    reasonCode: 'VALIDATE_AND_UPDATE_PMS_COOKIE' })
  assert.equal('independentExpectedPmsHotelId' in post.body.initialStoreBinding, false)
  pending.resolve({ ...validation, identityBasis: 'ADMIN_OFFICIAL_NAME_CONFIRMATION',
    declaredPmsHotelName: '四方馆自营 SeeCity·归来酒店', vendorNameVerified: false })
  await flush()
  assert.equal(view.refreshed.length, 1)
  assert.doesNotMatch(markup(view), /session=synthetic|hotelId=99999/u)
  assert.match(markup(view), /本次门店归属由管理员确认：四方馆自营 SeeCity·归来酒店/u)
  assert.match(markup(view), /系统已验证授权可读取报表，不代表自动认证官方店名/u)
  assert.doesNotMatch(markup(view), /已自动识别官方店名|官方店名已认证|美团已认证该店名/u)
})

test('an existing binding submits only Cookie fields and keeps the secret cleared after validation fails', async () => {
  const view = panel({ initial: bound, respond: call => {
    if (call.method === 'GET') return bound
    throw new Error('SYNTHETIC_COOKIE_REJECTED')
  } })
  await view.mount()
  const tree = fill(view)
  assert.equal(find(tree, element => element.type === 'input' && element.props.type === 'checkbox'), null)
  assert.equal(find(tree, element => element.type === 'input' && element.props.name === 'pms-official-hotel-name'), null)
  assert.equal(submit(tree).props.disabled, false)
  submit(tree).props.onClick()
  assert.equal(cookie(view.render()).props.value, '')
  await flush()
  assert.deepEqual(view.calls[1].body, { cookieHeader: 'session=synthetic; hotelId=99999',
    reasonCode: 'VALIDATE_AND_UPDATE_PMS_COOKIE' })
  assert.equal(view.calls.filter(call => call.method === 'POST').length, 1)
  assert.equal(view.refreshed.length, 0)
  assert.doesNotMatch(markup(view), /每小时自动采集已开启/u)
  assert.ok(find(view.render(), element => element.props.role === 'alert'))
})

test('conflicts, missing setup permission, readonly access and status-read failures cannot submit', async t => {
  for (const [name, options] of [
    ['identity conflict', { initial: { ...notBound, status: 'CONFLICT' } }],
    ['missing initialization permission', { initial: { ...notBound, canInitialize: false } }],
    ['readonly access', { initial: bound, canSubmit: false }],
    ['status read failure', { respond: () => { throw new Error('SYNTHETIC_STATUS_UNAVAILABLE') } }],
  ]) {
    await t.test(name, async () => {
      const view = panel(options)
      await view.mount()
      let tree = view.render()
      assert.equal(cookie(tree).props.disabled, true)
      if (name === 'status read failure') {
        assert.ok(find(tree, element => element.props.role === 'alert'))
      }
      const html = renderToStaticMarkup(tree)
      if (name === 'identity conflict') assert.match(html, /身份冲突，不能覆盖绑定/u)
      else if (name === 'missing initialization permission') assert.match(html, /当前门店暂不能首次授权/u)
      else if (name === 'readonly access') assert.match(html, /需要平台管理员配置本店授权/u)
      else assert.match(html, /请先刷新授权状态，读取成功后再提交/u)
      cookie(tree).props.onChange({ target: { value: 'synthetic=blocked' } })
      tree = view.render()
      assert.equal(submit(tree).props.disabled, true)
      submit(tree).props.onClick()
      await flush()
      assert.equal(view.calls.filter(call => call.method === 'POST').length, 0)
    })
  }
})

test('automatic collection is claimed only after complete collection and a confirming status GET', async t => {
  for (const [name, run] of [
    ['partial collection', { ...collection, status: 'PARTIAL', successfulSourceCount: 2 }],
    ['failed collection', new Error('SYNTHETIC_COLLECTION_FAILED')],
  ]) {
    await t.test(name, async () => {
      const view = panel({ respond: call => {
        if (call.method === 'GET') return view.calls.length === 1 ? notBound : { ...bound, collectionEnabled: false }
        if (call.url.endsWith('/pms-cookie-validation')) return validation
        if (run instanceof Error) throw run
        return run
      } })
      await view.mount()
      submit(fill(view)).props.onClick()
      await flush()
      assert.match(markup(view), /本店授权已验证并加密保存/u)
      assert.ok(find(view.render(), element => element.props.role === 'alert'))
      assert.doesNotMatch(markup(view), /每小时自动采集已开启|本店采集已通过/u)
    })
  }
  await t.test('existing binding does not claim hourly collection when the global scheduler is disabled', async () => {
    const view = panel({ initial: { ...bound, automaticHourlyCollectionEnabled: false } })
    await view.mount()
    const html = markup(view)
    assert.match(html, /系统定时任务未启用/u)
    assert.doesNotMatch(html, /每小时自动采集已开启|每小时自动采集已启用/u)
  })
  for (const [enabled, automaticHourlyCollectionEnabled] of [[false, true], [true, true], [true, false]]) {
    await t.test(`complete collection, store enabled=${enabled}, global scheduler enabled=${automaticHourlyCollectionEnabled}`, async () => {
      const status = deferred()
      const view = panel({ respond: call => {
        if (call.method === 'GET') return view.calls.length === 1 ? notBound : status.promise
        return call.url.endsWith('/pms-cookie-validation') ? validation : collection
      } })
      await view.mount()
      submit(fill(view)).props.onClick()
      await flush()
      assert.deepEqual(view.calls.map(call => call.method), ['GET', 'POST', 'POST', 'GET'])
      assert.match(view.calls[2].url, /\/live-collection-runs$/u)
      assert.doesNotMatch(markup(view), /每小时自动采集已开启|本店采集已通过/u)
      status.resolve({ ...bound, collectionEnabled: enabled, automaticHourlyCollectionEnabled })
      await flush()
      const html = markup(view)
      assert.match(html, /本店采集已通过：3\/3/u)
      if (enabled && automaticHourlyCollectionEnabled) assert.match(html, /每小时自动采集已开启/u)
      else if (enabled) {
        assert.match(html, /系统定时任务未启用/u)
        assert.doesNotMatch(html, /每小时自动采集已开启|每小时自动采集已启用/u)
      }
      else {
        assert.match(html, /当前采集仍暂停/u)
        assert.doesNotMatch(html, /每小时自动采集已开启/u)
      }
      assert.equal(view.refreshed.length, 1)
    })
  }
})

test('context changes and unmount invalidate pending results before they can update another hotel', async t => {
  for (const stage of ['validation', 'collection', 'status']) {
    for (const action of ['switch', 'unmount']) {
      await t.test(`${action} during ${stage}`, async () => {
        const pending = deferred()
        const nextContext = { ...context, hotelId: 'synthetic-hotel-010' }
        const view = panel({ respond: call => {
          if (call.url.includes('/synthetic-hotel-010/')) return { ...notBound, hotelCode: '010' }
          if (call.method === 'GET') return view.calls.length === 1 ? notBound : pending.promise
          if (call.url.endsWith('/pms-cookie-validation')) return stage === 'validation' ? pending.promise : validation
          return stage === 'collection' ? pending.promise : collection
        } })
        await view.mount()
        submit(fill(view)).props.onClick()
        await flush()
        if (action === 'switch') { view.switchContext(nextContext); await flush() }
        else view.unmount()
        const callCount = view.calls.length, writeCount = view.writes.length
        pending.resolve(stage === 'validation' ? validation : stage === 'collection' ? collection : bound)
        await flush()
        assert.equal(view.calls.length, callCount, 'old results must not start another collection or refresh')
        assert.equal(view.refreshed.length, 0, 'old results must not call the parent refresh')
        assert.equal(view.writes.length, writeCount, 'old results must not update hook state')
        if (action === 'switch') {
          const tree = view.render()
          assert.equal(cookie(tree).props.value, '')
          assert.equal(identity(tree).props.value, '')
          assert.doesNotMatch(renderToStaticMarkup(tree), /Cookie 验证通过|本店采集已通过|每小时自动采集已开启/u)
        }
      })
    }
  }
})
