import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
const loaded = []
const appended = []

globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      loaded.push(spec)
    },
  },
  localStorage: {
    store: new Map(),
    getItem(key) {
      return this.store.has(key) ? this.store.get(key) : null
    },
    setItem(key, value) {
      this.store.set(key, value)
    },
  },
}
Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' }, configurable: true, writable: true })
globalThis.document = {
  createElement() {
    return {
      setAttribute() {},
      textContent: '',
      parentNode: null,
    }
  },
  head: {
    appendChild(node) {
      appended.push(node)
    },
  },
}

await import('../lib/client.js')

const spec = loaded[0]
const client = spec.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected module: ${name}`)
})

test('the browser half registers through __ModuleLoader__', () => {
  assert.equal(spec.id, 'dsh-treeviewer')
  assert.equal(client.name, 'dsh-treeviewer-client')
  assert.deepEqual(client.inject, ['slots'])
  assert.equal(typeof client.apply, 'function')
})

function fakeSlots() {
  const registrations = []
  const effects = []
  const ctx = {
    effect(callback) {
      effects.push(callback)
      return () => {}
    },
    get(key) {
      if (key === 'slots') {
        return {
          inject(owner, callback) {
            callback()
          },
          register(specification, component) {
            registrations.push({ ...specification, component })
            return () => {}
          },
        }
      }
      return undefined
    },
  }
  return { ctx, registrations, effects }
}

test('apply mounts the main panel and its sidebar entry', () => {
  const { ctx, registrations, effects } = fakeSlots()
  client.apply(ctx)
  assert.equal(appended.length, 1)
  assert.equal(appended[0].textContent.includes('.tv-root'), true)

  const main = registrations.find((entry) => entry.name === 'main')
  assert.ok(main)
  assert.equal(main.key, 'treeviewer')
  assert.equal(typeof main.component, 'function')

  const sidebar = registrations.find((entry) => entry.name === 'sidebar.panellist')
  assert.ok(sidebar)
  assert.equal(sidebar.id, 'treeviewer')
  assert.equal(sidebar.label(), 'TreeViewer render')
  assert.equal(effects.length, 1)
})

test('the panel renders its form and empty preview', () => {
  const { ctx, registrations } = fakeSlots()
  client.apply(ctx)
  const panel = registrations.find((entry) => entry.name === 'main').component
  const markup = renderToStaticMarkup(React.createElement(panel))
  assert.match(markup, /TreeViewer render/)
  assert.match(markup, /Set the options, then press Render/)
  assert.match(markup, /Helvetica 10/)
  assert.match(markup, /Branches/)
  assert.match(markup, /Labels/)
  assert.match(markup, /Rectangular/)
})

test('the panel localizes to Chinese', async () => {
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true, writable: true })
  const spec2 = loaded[0]
  const zhClient = spec2.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected module: ${name}`)
  })
  const { ctx, registrations } = fakeSlots()
  zhClient.apply(ctx)
  const panel = registrations.find((entry) => entry.name === 'main').component
  const markup = renderToStaticMarkup(React.createElement(panel))
  assert.match(markup, /TreeViewer 出图/)
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' }, configurable: true, writable: true })
})
