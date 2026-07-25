import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(
  new URL(
    '../src/pages/browserAuthorizationRehearsalState.ts',
    import.meta.url,
  ),
  'utf8',
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
})
const moduleUrl = `data:text/javascript;base64,${
  Buffer.from(outputText).toString('base64')
}`
const { selectCurrentConfigAttempt } = await import(moduleUrl)

function attempt(configVersion) {
  return {
    authorizationAttemptId: `attempt-${configVersion}`,
    configVersion,
    rowVersion: 0,
    state: 'OFFLINE_REHEARSAL_COMPLETE',
  }
}

test('restores only an attempt for the exact current connector config', () => {
  const current = attempt(7)

  assert.equal(selectCurrentConfigAttempt(current, 7), current)
  assert.equal(selectCurrentConfigAttempt(null, 7), null)
})

test('an old config attempt cannot occupy the current action state', () => {
  const old = attempt(6)

  assert.equal(selectCurrentConfigAttempt(old, 7), null)
})
