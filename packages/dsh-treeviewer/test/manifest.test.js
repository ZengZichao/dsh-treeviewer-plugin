import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('the DSH compatibility range lives in engines.dsh', () => {
  assert.equal(typeof pkg.engines.dsh, 'string')
  assert.match(pkg.engines.dsh, /^>=0\.2\.1-rc\.\d+ <0\.3\.0$/)
  assert.equal(pkg.dsh.engines, undefined, 'a dsh.engines object is ignored by the runtime compatibility check')
})

test('the manifest declares format and composition', () => {
  assert.equal(pkg.dsh.manifestVersion, 1)
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(fs.existsSync(path.join(root, 'cordis.patch.yml')), true)
})

test('host and browser entries are exported', () => {
  assert.equal(pkg.exports['.'], './src/index.js')
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json')
  const client = read('lib/client.js')
  assert.match(client, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(client, /id: 'dsh-treeviewer'/)
})

test('the peer requirement is a range, not a pinned prerelease', () => {
  const peer = pkg.peerDependencies['@deepseek-ai/dsh-tools']
  assert.match(peer, /^>=0\.2\.1-rc\.\d+ <0\.3\.0$/)
})

test('both locale files carry display metadata', () => {
  for (const lang of ['zh', 'en']) {
    const meta = JSON.parse(read(`locale/${lang}.json`))
    assert.equal(typeof meta.meta.title, 'string')
    assert.ok(meta.meta.title.length > 0)
    assert.equal(typeof meta.meta.description, 'string')
    assert.ok(meta.meta.description.length > 0)
  }
})

test('the published file list covers every runtime artifact', () => {
  for (const entry of ['src/', 'lib/', 'locale/', 'cordis.patch.yml', 'README.md', 'README.en.md', 'LICENSE']) {
    assert.ok(pkg.files.includes(entry), `missing ${entry}`)
  }
})
