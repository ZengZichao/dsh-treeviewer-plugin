import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mountRoutes } from '../src/routes.js'
import { RenderStore } from '../src/store.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-treeviewer-routes-'))
const pngPath = path.join(root, 'preview.png')
fs.writeFileSync(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))

const engine = {
  config: { workDir: path.join(root, 'work') },
  async detect() {
    return { ok: true, version: { treeviewer: '2.2.0', commandLine: '1.3.1' }, cli: { path: 'C:/TreeViewer/TreeViewerCommandLine.exe' }, modules: {} }
  },
  async listModules() {
    return { ok: true, total: 2, categories: { Coordinates: [{ name: 'Rectangular', id: 'x' }] } }
  },
  async getModuleOptions({ module }) {
    if (module === 'missing') return { ok: false, error: { code: 'MODULE_NOT_FOUND', message: 'Unknown module' } }
    return { ok: true, module: { name: 'Branches', id: '7c767b07-71be-48b2-8753-b27f3e973570' }, category: 'Plot action', parameters: [] }
  },
  async render(settings) {
    if (!settings.inputFile) return { ok: false, error: { code: 'INVALID_INPUT', message: 'inputFile is required' } }
    if (settings.inputFile === 'bad') return { ok: false, error: { code: 'RENDER_FAILED', message: 'TreeViewer crashed' } }
    return {
      ok: true,
      imagePath: pngPath,
      format: 'png',
      mediaType: 'image/png',
      bytes: 8,
      width: 900,
      height: 700,
      durationMs: 1200,
      appliedSettings: { input: { path: settings.inputFile } },
    }
  },
}

const registrations = new Map()
const connection = {
  fetch: {
    register(route) {
      registrations.set(route.path, route)
      return () => registrations.delete(route.path)
    },
  },
}
const logger = { info() {}, warn() {} }
const ctx = { get: (name) => (name === 'connection' ? connection : undefined), logger }
const store = new RenderStore()
const release = mountRoutes(ctx, { engine, store, logger })

const call = (target, init) => {
  const url = new URL(`http://local${target}`)
  return registrations.get(url.pathname).fetch(new Request(url, init))
}
const json = async (response) => ({ status: response.status, body: await response.json() })

test.after(() => {
  release()
  fs.rmSync(root, { recursive: true, force: true })
})

test('the connection registers the five exact fetch routes under /api', () => {
  assert.deepEqual([...registrations.keys()].sort(), [
    '/api/treeviewer/image',
    '/api/treeviewer/modules',
    '/api/treeviewer/options',
    '/api/treeviewer/render',
    '/api/treeviewer/status',
  ])
  for (const route of registrations.values()) {
    assert.equal(route.requestBody, 'buffered')
    assert.ok(route.methods.length > 0)
  }
})

test('GET /api/treeviewer/status reports the CLI', async () => {
  const { status, body } = await json(await call('/api/treeviewer/status'))
  assert.equal(status, 200)
  assert.equal(body.version.treeviewer, '2.2.0')
})

test('GET /api/treeviewer/modules lists the catalog', async () => {
  const { body } = await json(await call('/api/treeviewer/modules'))
  assert.equal(body.total, 2)
})

test('GET /api/treeviewer/options forwards category and module', async () => {
  const ok = await json(await call('/api/treeviewer/options?category=Plot%20action&module=Branches'))
  assert.equal(ok.body.ok, true)
  const missing = await json(await call('/api/treeviewer/options?category=Plot%20action&module=missing'))
  assert.equal(missing.status, 400)
})

test('POST /api/treeviewer/render returns an image URL and the image is served', async () => {
  const { status, body } = await json(await call('/api/treeviewer/render', {
    method: 'POST',
    body: JSON.stringify({ settings: { inputFile: 'C:/data/tree.nwk', output: { format: 'png' } } }),
  }))
  assert.equal(status, 200)
  assert.match(body.id, /^[0-9a-f-]{36}$/)
  assert.equal(body.imageUrl, `/api/treeviewer/image?id=${body.id}`)

  const image = await call(`/api/treeviewer/image?id=${body.id}`)
  assert.equal(image.status, 200)
  assert.equal(image.headers.get('content-type'), 'image/png')
  assert.equal(image.headers.get('x-content-type-options'), 'nosniff')
  assert.ok((await image.arrayBuffer()).byteLength > 0)

  const unknown = await call('/api/treeviewer/image?id=00000000-0000-0000-0000-000000000000')
  assert.equal(unknown.status, 404)
})

test('render rejects a body without settings', async () => {
  const { status } = await json(await call('/api/treeviewer/render', { method: 'POST', body: '{}' }))
  assert.equal(status, 400)
})

test('render maps engine failures to 422', async () => {
  const { status, body } = await json(await call('/api/treeviewer/render', {
    method: 'POST',
    body: JSON.stringify({ settings: { inputFile: 'bad', output: { format: 'png' } } }),
  }))
  assert.equal(status, 422)
  assert.equal(body.error.code, 'RENDER_FAILED')
})

test('an oversized render body is rejected with 413', async () => {
  const { status } = await json(await call('/api/treeviewer/render', {
    method: 'POST',
    body: JSON.stringify({ settings: { padding: 'x'.repeat(3 * 1024 * 1024) } }),
  }))
  assert.equal(status, 413)
})

test('a malformed JSON body is rejected with 400', async () => {
  const { status } = await json(await call('/api/treeviewer/render', { method: 'POST', body: '{not json' }))
  assert.equal(status, 400)
})

test('without a connection the same paths fall back to the web server', () => {
  const registered = []
  const webServer = { register(route) { registered.push(route); return () => {} } }
  const fallbackCtx = { get: (name) => (name === 'webServer' ? webServer : undefined), logger }
  const releaseFallback = mountRoutes(fallbackCtx, { engine, store, logger })
  assert.deepEqual(registered.map((route) => route.path).sort(), [
    '/api/treeviewer/image',
    '/api/treeviewer/modules',
    '/api/treeviewer/options',
    '/api/treeviewer/render',
    '/api/treeviewer/status',
  ])
  releaseFallback()
})
