import test from 'node:test'
import assert from 'node:assert/strict'
import { Config, toEngineConfig } from '../src/config.js'

const validate = (value) => Config['~standard'].validate(value)

test('defaults cover every tunable', () => {
  const { value } = validate(undefined)
  assert.deepEqual(value, {
    cliPath: '',
    workDir: '',
    trustAllow: [],
    trustRememberKeys: false,
    commandTimeoutMs: 300000,
    introspectionTimeoutMs: 120000,
    idleTimeoutMs: 300000,
  })
})

test('trust entries are trimmed and rememberKeys is boolean', () => {
  const { value } = validate({ trust: { allow: ['  ' + 'a'.repeat(64) + ' ', 'C:/data/trusted.tbi'], rememberKeys: true } })
  assert.deepEqual(value.trustAllow, ['a'.repeat(64), 'C:/data/trusted.tbi'])
  assert.equal(value.trustRememberKeys, true)
})

test('invalid values produce issues instead of throwing', () => {
  assert.ok(validate([]).issues)
  assert.ok(validate({ cliPath: 42 }).issues)
  assert.ok(validate({ commandTimeoutMs: 0 }).issues)
  assert.ok(validate({ introspectionTimeoutMs: 'soon' }).issues)
  assert.ok(validate({ trust: { allow: 'nope' } }).issues)
  assert.ok(validate({ trust: { allow: [42] } }).issues)
})

test('idleTimeoutMs accepts an explicit zero', () => {
  assert.equal(validate({ idleTimeoutMs: 0 }).value.idleTimeoutMs, 0)
})

test('toEngineConfig maps the plugin config onto engine options', () => {
  const config = validate({
    cliPath: 'C:/TreeViewer/TreeViewerCommandLine.exe',
    workDir: 'C:/work',
    trust: { allow: ['b'.repeat(64)], rememberKeys: true },
    commandTimeoutMs: 1000,
    introspectionTimeoutMs: 2000,
    idleTimeoutMs: 3000,
  }).value
  const engineConfig = toEngineConfig(config)
  assert.equal(engineConfig.cliPath, 'C:/TreeViewer/TreeViewerCommandLine.exe')
  assert.equal(engineConfig.workDir, 'C:/work')
  assert.deepEqual(engineConfig.trust, { allow: ['b'.repeat(64)], rememberKeys: true })
  assert.deepEqual(engineConfig.timeouts, { commandMs: 1000, introspectionMs: 2000 })
  assert.equal(engineConfig.idleTimeoutMs, 3000)
})
