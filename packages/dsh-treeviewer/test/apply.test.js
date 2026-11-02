import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, inject, name, Config } from '../src/index.js'

function fakeContext() {
  const tools = []
  const provided = {}
  const effects = []
  const routes = new Map()
  const ctx = {
    logger: { info() {}, warn() {} },
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {}
      },
    },
    provide(key, value) {
      provided[key] = value
    },
    effect(callback) {
      effects.push(callback)
      return () => {}
    },
    get(key) {
      if (key === 'webServer') {
        return {
          register({ kind, path, handler }) {
            routes.set(`${kind}:${path}`, handler)
            return () => routes.delete(`${kind}:${path}`)
          },
        }
      }
      return undefined
    },
  }
  return { ctx, tools, provided, effects, routes }
}

test('the plugin exports a Cordis shape', () => {
  assert.equal(name, 'dsh-treeviewer')
  assert.deepEqual(inject, ['tools'])
  assert.ok(Config['~standard'])
})

test('apply registers three tools, the service and the panel routes', async () => {
  const { ctx, tools, provided, effects, routes } = fakeContext()
  apply(ctx, {})
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['treeviewer_modules', 'treeviewer_options', 'treeviewer_render'])
  assert.deepEqual(Object.keys(provided.treeviewer).sort(), ['detect', 'getModuleOptions', 'listModules', 'render'])
  assert.deepEqual([...routes.keys()].sort(), [
    'exact:/api/treeviewer/image',
    'exact:/api/treeviewer/modules',
    'exact:/api/treeviewer/options',
    'exact:/api/treeviewer/render',
    'exact:/api/treeviewer/status',
  ])
  assert.equal(effects.length, 2)

  for (const effect of effects) {
    const cleanup = await effect()
    assert.equal(typeof cleanup, 'function')
    await cleanup()
  }
})

test('apply prefers the connection fetch registry when present', () => {
  const { ctx, tools } = fakeContext()
  const registered = []
  const connection = { fetch: { register: (route) => { registered.push(route.path); return () => {} } } }
  const original = ctx.get
  ctx.get = (key) => (key === 'connection' ? connection : original(key))
  apply(ctx, {})
  assert.equal(tools.length, 3)
  assert.deepEqual(registered.sort(), [
    '/api/treeviewer/image',
    '/api/treeviewer/modules',
    '/api/treeviewer/options',
    '/api/treeviewer/render',
    '/api/treeviewer/status',
  ])
})

test('apply survives a context without a web carrier', () => {
  const { ctx, tools } = fakeContext()
  ctx.get = () => undefined
  ctx.inject = undefined
  apply(ctx, { cliPath: '', trust: { allow: [] } })
  assert.equal(tools.length, 3)
})
