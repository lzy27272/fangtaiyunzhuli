import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const serverFile = (name) => readFileSync(
  new URL(`../../../infra/ota-standalone-server/${name}`, import.meta.url),
  'utf8',
)

test('public app documents revalidate without changing the collector or hashed assets', () => {
  const config = serverFile('caddy/ota-console-public.caddy')
  assert.match(config, /@ota_console_document \{\s*path \/ota-console\/\*\s*not path \/ota-console\/assets\/\*\s*\}/u)
  assert.match(config, /header @ota_console_document Cache-Control "no-cache"/u)
  assert.match(config, /@ota_console_assets path \/ota-console\/assets\/\*\s*header @ota_console_assets Cache-Control "public, max-age=31536000, immutable"/u)
  assert.doesNotMatch(config, /ota-collector|header\s+Cache-Control/u)
})

test('tunnel app documents revalidate at both root and subpath while excluding APIs', () => {
  const config = serverFile('Caddyfile.native')
  assert.match(config, /@ota_console_document \{\s*not path \/assets\/\* \/ota-console\/assets\/\* \/api \/api\/\*\s*\}/u)
  assert.match(config, /header @ota_console_document Cache-Control "no-cache"/u)
  assert.match(config, /handle_path \/ota-console\/\*/u)
  assert.match(config, /handle \{\s*root \*[^\n]+\/dist/u)
  assert.doesNotMatch(config, /header\s+Cache-Control/u)
})
