import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const source = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
function component(name, imports = {}) {
  const { outputText } = ts.transpileModule(source(name), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  })
  const exports = {}
  runInNewContext(outputText, { exports, Error, require: (id) => imports[id] ?? require(id) })
  return exports
}
const display = component('ui/businessDisplay.ts')
const hotel = { tenantId: 'synthetic-tenant', hotelId: 'synthetic-hotel-009', hotelCode: '009',
  hotelName: 'Synthetic hotel', pmsSystemCode: 'LUOPAN_CLOUD', pmsSystemName: '罗盘 PMS',
  collectionEnabled: true, rowVersion: 7 }

// Host-element rendering and event handlers stay real; only React hook storage
// and the network boundary are substituted, matching the other static UI tests.
function panel({ canConfigure = true, current = hotel, api = {} } = {}) {
  const state = [current, current?.pmsSystemCode ?? 'LUOPAN_CLOUD', '', false, false, false, '']
  let index = 0
  const saved = [], refreshed = [], calls = []
  const { PmsSystemSelectionPanel } = component('pages/PmsSystemSelectionPanel.tsx', {
    react: { ...React, useEffect() {}, useState(initial) {
      const position = index++
      if (!(position in state)) state[position] = initial
      return [state[position], (value) => {
        state[position] = typeof value === 'function' ? value(state[position]) : value
      }]
    } },
    '../api/business': {
      loadPmsSystem: async () => current,
      changePmsSystem: async (context, input) => {
        calls.push({ context, input })
        return { ...current, ...input, pmsSystemName: '驿联云 PMS', rowVersion: current.rowVersion + 1 }
      },
      ...api,
    },
    '../ui/businessDisplay': display,
  })
  const render = () => {
    index = 0
    return PmsSystemSelectionPanel({ context: { tenantId: hotel.tenantId, hotelId: hotel.hotelId },
      canConfigure, onSaved: (value) => saved.push(value), onRefreshed: (value) => refreshed.push(value) })
  }
  return { state, render, saved, refreshed, calls }
}
function find(element, predicate) {
  if (!React.isValidElement(element)) return null
  if (predicate(element)) return element
  for (const child of React.Children.toArray(element.props.children)) {
    const match = find(child, predicate)
    if (match) return match
  }
  return null
}
const control = (tree, type, predicate = () => true) => {
  const result = find(tree, (element) => element.type === type && predicate(element.props))
  assert.ok(result, `missing ${type}`)
  return result
}

test('PMS manufacturer is selectable for administrators and requires an explicit confirmed change', async () => {
  const view = panel()
  let tree = view.render()
  assert.equal(control(tree, 'select').props.disabled, false)
  assert.equal(control(tree, 'button', props => props.type === 'submit').props.disabled, true)
  control(tree, 'select').props.onChange({ target: { value: 'YILIAN_CLOUD' } })
  tree = view.render()
  assert.equal(control(tree, 'button', props => props.type === 'submit').props.disabled, true)
  assert.match(renderToStaticMarkup(tree), /确认 009/u)
  control(tree, 'input', props => props.type === 'checkbox').props.onChange({ target: { checked: true } })
  tree = view.render()
  assert.equal(control(tree, 'button', props => props.type === 'submit').props.disabled, false)
  await tree.props.onSubmit({ preventDefault() {} })
  assert.equal(view.calls.length, 1)
  assert.equal(view.calls[0].context.hotelId, hotel.hotelId)
  assert.equal(view.calls[0].input.pmsSystemCode, 'YILIAN_CLOUD')
  assert.equal(view.calls[0].input.expectedRowVersion, 7)
  assert.equal(view.saved[0].pmsSystemCode, 'YILIAN_CLOUD')
  const command = source('api/business.ts').split('export function changePmsSystem')[1]
    .split('export function initializeSimulationHotel')[0]
  assert.match(command, /scopedPath\(context, '\/pms-system'\)/u)
  assert.match(command, /confirmChange: true/u)
  assert.match(command, /reasonCode: 'CHANGE_HOTEL_PMS_SYSTEM'/u)
})

test('missing permission, missing data, busy operations, and unnamed other vendors cannot submit', () => {
  assert.equal(control(panel({ canConfigure: false }).render(), 'select').props.disabled, true)
  assert.equal(find(panel({ canConfigure: false }).render(), element => element.type === 'button' && element.props.type === 'submit'), null)
  assert.equal(control(panel({ current: null }).render(), 'select').props.disabled, true)
  const view = panel()
  view.state[1] = 'OTHER'
  view.state[3] = true
  let tree = view.render()
  assert.equal(control(tree, 'button', props => props.type === 'submit').props.disabled, true)
  control(tree, 'input', props => props['aria-label'] === 'PMS 厂家名称').props.onChange({ target: { value: 'Synthetic PMS' } })
  tree = view.render()
  assert.equal(control(tree, 'input', props => props.type === 'checkbox').props.checked, false)
  view.state[3] = true
  view.state[5] = true
  tree = view.render()
  assert.equal(control(tree, 'select').props.disabled, true)
  assert.equal(control(tree, 'button', props => props.type === 'submit').props.disabled, true)
})

test('save conflicts display an actionable error and refreshing synchronizes the latest manufacturer', async () => {
  const latest = { ...hotel, pmsSystemCode: 'MEITUAN_BIEYANGHONG', pmsSystemName: '美团别样红 PMS', rowVersion: 8 }
  const view = panel({ api: { changePmsSystem: async () => { throw new Error('PMS_SYSTEM_VERSION_CONFLICT') },
    loadPmsSystem: async () => latest } })
  view.state[1] = 'YILIAN_CLOUD'
  view.state[3] = true
  await view.render().props.onSubmit({ preventDefault() {} })
  const tree = view.render()
  assert.equal(view.saved.length, 0)
  assert.match(renderToStaticMarkup(control(tree, 'div', props => props.role === 'alert')), /刷新配置/u)
  control(tree, 'button', props => props.children === '刷新配置').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(view.refreshed.length, 1)
  assert.equal(view.refreshed[0].pmsSystemCode, 'MEITUAN_BIEYANGHONG')
  assert.equal(view.state[4], false)
  const paused = panel({ current: { ...hotel, collectionEnabled: false } })
  assert.match(renderToStaticMarkup(paused.render()), /采集仍暂停/u)
})

test('PMS navigation locates the selector and saving or refreshing replaces stale manufacturer forms', () => {
  const selector = source('pages/PmsSystemSelectionPanel.tsx')
  const page = source('pages/ReportSourceConfigPage.tsx')
  const store = source('pages/StoreConsolePage.tsx')
  const app = source('App.tsx')
  assert.match(selector, /<form[^>]*id="pms-system-config-panel"/u)
  assert.doesNotMatch(page, /id="pms-system-config-panel"/u)
  assert.match(page, /section === 'pms'[\s\S]*?'pms-system-config-panel'/u)
  assert.match(page, /onSaved=\{onPmsSystemChanged\}/u)
  assert.match(page, /onRefreshed=\{onPmsSystemRefreshed\}/u)
  assert.match(store, /<ReportSourceConfigPage key=\{`\$\{hotel.hotelId\}:\$\{hotel.pmsSystemCode\}:\$\{hotel.rowVersion\}`\}/u)
  for (const eventName of ['onPmsSystemChanged', 'onPmsSystemRefreshed']) {
    const handler = store.split(`${eventName}={(updated) => {`)[1]?.split('}}')[0] ?? ''
    assert.match(handler, /setData\(emptyDetail\)/u)
    assert.match(handler, /setLoading\(true\)/u)
    assert.match(handler, /onHotelChanged\(updated\)/u)
  }
  assert.match(app, /setHotels\(\(current\) => current\.map\(\(hotel\) => hotel\.hotelId === updated\.hotelId \? updated : hotel\)\)/u)
  assert.match(app, /setSelectedHotel\(\(current\) => current\?\.hotelId === updated\.hotelId \? updated : current\)/u)
})
