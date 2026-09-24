import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const source = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
function component(name, imports = {}) {
  const { outputText } = ts.transpileModule(source(name), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  })
  const exports = {}
  runInNewContext(outputText, {
    exports,
    require: (id) => imports[id] ?? require(id),
  })
  return exports
}
const ui = component('components/ConsoleUi.tsx')
const { CollectionNavigation } = component('components/CollectionNavigation.tsx', {
  './ConsoleUi': ui,
})

test('collection submenu renders an ordinary same-tab link to the fixed cloud collector', () => {
  const html = renderToStaticMarkup(createElement(CollectionNavigation))
  assert.match(html, /<details class="collection-navigation">/u)
  assert.match(html, /<summary>[\s\S]*采集[\s\S]*<\/summary>/u)
  assert.match(html, /<a href="https:\/\/www\.sfgzt\.cn\/ota-collector\/">云端采集/u)
  assert.equal((html.match(/<a /gu) ?? []).length, 1)
  assert.doesNotMatch(html, /target=|iframe|\?token=|\?password=|javascript:/iu)
})

test('collection entry is in authenticated global navigation and is not admin-only', () => {
  const app = source('App.tsx')
  const nav = app.slice(app.indexOf('aria-label="全局导航"'), app.indexOf('</nav>'))
  assert.match(nav, /门店总览[\s\S]*<CollectionNavigation \/>[\s\S]*异常处理/u)
  assert.ok(nav.indexOf('<CollectionNavigation />') < nav.indexOf('{platformAdmin ?'))
  assert.doesNotMatch(source('components/CollectionNavigation.tsx'), /fetch\(|window\.open|localStorage|sessionStorage|token|password/u)
})

test('Escape and focus leaving the submenu close it without intercepting link navigation', () => {
  const menu = CollectionNavigation()
  let focused = false, prevented = false
  const target = { open: true, contains: (node) => node === 'inside', querySelector: () => ({ focus: () => { focused = true } }) }
  menu.props.onBlur({ currentTarget: target, relatedTarget: 'inside' })
  assert.equal(target.open, true)
  menu.props.onBlur({ currentTarget: target, relatedTarget: null })
  assert.equal(target.open, false)
  target.open = true
  menu.props.onKeyDown({ key: 'Enter', currentTarget: target, preventDefault: () => { prevented = true } })
  assert.equal(target.open, true)
  assert.equal(prevented, false)
  menu.props.onKeyDown({ key: 'Escape', currentTarget: target, preventDefault: () => { prevented = true } })
  assert.equal(target.open, false)
  assert.equal(focused, true)
  assert.equal(prevented, true)
})

test('mobile collection submenu stays in navigation flow and both controls have a focus indicator', () => {
  const css = source('console.css')
  assert.match(css, /@media \(max-width: 820px\) \{\s*\.collection-navigation[\s\S]*?\.collection-submenu \{ position: static; width: auto;/u)
  assert.match(css, /\.collection-navigation > summary:focus-visible, \.collection-submenu a:focus-visible/u)
})
