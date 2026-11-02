import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ERROR_CODES } from '../../src/errors.js'
import { findOnPath, locateCli } from '../../src/index.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-locate-'))
test.after(() => fs.rmSync(root, { recursive: true, force: true }))

function makeBinary(dir, name) {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, name)
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n')
  return file
}

test('an explicit cliPath wins', () => {
  const file = makeBinary(path.join(root, 'explicit'), process.platform === 'win32' ? 'TreeViewerCommandLine.exe' : 'TreeViewerCommandLine')
  const cli = locateCli({ cliPath: file, env: { PATH: '' } })
  assert.equal(cli.cliPath, file)
  assert.equal(cli.kind, 'native')
  assert.equal(cli.source, 'config')
})

test('TREEVIEWER_CLI is honoured', () => {
  const file = makeBinary(path.join(root, 'env'), process.platform === 'win32' ? 'TreeViewerCommandLine.exe' : 'TreeViewerCommandLine')
  const cli = locateCli({ env: { TREEVIEWER_CLI: file, PATH: '' } })
  assert.equal(cli.cliPath, file)
  assert.equal(cli.source, 'env:TREEVIEWER_CLI')
})

test('the executable is found on PATH', () => {
  const name = process.platform === 'win32' ? 'TreeViewerCommandLine.exe' : 'TreeViewerCommandLine'
  const dir = path.join(root, 'bin')
  const file = makeBinary(dir, name)
  const cli = locateCli({ env: { PATH: [dir, path.join(root, 'missing')].join(path.delimiter) } })
  assert.equal(cli.cliPath, file)
  assert.equal(cli.source, 'PATH')
})

test('a missing explicit path is reported as CLI_NOT_FOUND', () => {
  const missing = path.join(root, 'nope', 'TreeViewerCommandLine')
  assert.throws(() => locateCli({ cliPath: missing, env: { PATH: '' } }), (error) => {
    assert.equal(error.code, ERROR_CODES.CLI_NOT_FOUND)
    assert.match(error.message, /configured path/)
    return true
  })
})

test('nothing found reports CLI_NOT_FOUND with searched locations', () => {
  assert.throws(() => locateCli({ env: { PATH: path.join(root, 'empty') }, platform: 'linux' }), (error) => {
    assert.equal(error.code, ERROR_CODES.CLI_NOT_FOUND)
    assert.ok(Array.isArray(error.details.searched))
    assert.match(error.hint, /treeviewer\.org|cliPath/)
    return true
  })
})

test('a dll without a dotnet host fails with a clear message', () => {
  const dll = makeBinary(path.join(root, 'dll'), 'TreeViewerCommandLine.dll')
  assert.throws(() => locateCli({ cliPath: dll, env: { PATH: '' } }), (error) => {
    assert.equal(error.code, ERROR_CODES.CLI_NOT_FOUND)
    assert.match(error.message, /dotnet/)
    return true
  })
})

test('findOnPath ignores empty PATH entries', () => {
  const name = process.platform === 'win32' ? 'TreeViewerCommandLine.exe' : 'TreeViewerCommandLine'
  const dir = path.join(root, 'path2')
  const file = makeBinary(dir, name)
  const found = findOnPath('TreeViewerCommandLine', { env: { PATH: `${path.delimiter}${dir}${path.delimiter}` } })
  assert.equal(found, file)
  assert.equal(findOnPath('DefinitelyNotInstalledBinary', { env: { PATH: dir } }), null)
})
