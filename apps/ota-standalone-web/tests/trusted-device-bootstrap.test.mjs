import assert from 'node:assert/strict'
import test from 'node:test'

import {
  renderTrustedDeviceBootstrapPowerShell,
} from '../../../tools/uat/trusted-device-bootstrap.mjs'

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])

const bundledFiles = (script) => Array.from(
  script.matchAll(/Write-B64File '([^']+)' '([^']+)'/gu),
  ([, target, encoded]) => ({
    target,
    content: Buffer.from(encoded, 'base64'),
  }),
)

test('bootstrap adds a UTF-8 BOM to PowerShell payloads for Windows PowerShell 5.1', () => {
  const script = renderTrustedDeviceBootstrapPowerShell({
    enrollmentCode: '001-ABCD-EFGH-IJKL',
    serverOrigin: 'https://www.sfgzt.cn',
  })
  const powershellFiles = bundledFiles(script)
    .filter(({ target }) => target.toLowerCase().endsWith('.ps1'))

  assert.deepEqual(
    powershellFiles.map(({ target }) => target),
    [
      'tools/trusted-device/Install-001TrustedDevice.ps1',
      'tools/trusted-device/Start-001Login.ps1',
    ],
  )
  for (const { content } of powershellFiles) {
    assert.equal(content.subarray(0, UTF8_BOM.length).equals(UTF8_BOM), true)
  }
})
