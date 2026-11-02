import { defineTool } from '@deepseek-ai/dsh-tools'
import { TreeViewerEngine } from 'treeviewer-core'
import { Config, toEngineConfig } from './config.js'
import { createTools } from './tools.js'
import { mountRoutes } from './routes.js'
import { RenderStore } from './store.js'

export const name = 'dsh-treeviewer'
export const inject = ['tools']

export { Config }

/**
 * Cordis entry.
 *
 * Wire-up: one engine per plugin instance, three model-facing tools, and the
 * panel API on the web carrier. The engine is disposed when the plugin
 * unloads so no TreeViewer process outlives it.
 */
export function apply(ctx, rawConfig = {}) {
  const engine = new TreeViewerEngine(toEngineConfig(rawConfig, ctx.logger))
  const store = new RenderStore()
  const disposers = createTools({ engine, ctx }).map((tool) => ctx.tools.register(defineTool(tool)))

  ctx.provide?.('treeviewer', {
    detect: () => engine.detect(),
    listModules: () => engine.listModules(),
    getModuleOptions: (request) => engine.getModuleOptions(request),
    render: (settings, options) => engine.render(settings, options),
  })

  const releases = []
  const mount = (hostCtx) => {
    const release = mountRoutes(hostCtx, { engine, store, logger: ctx.logger })
    releases.push(release)
    if (typeof hostCtx.effect === 'function') hostCtx.effect(() => release, 'dsh-treeviewer: panel API')
  }
  if (typeof ctx.inject === 'function') {
    ctx.inject(['connection'], (hostCtx) => mount(hostCtx))
  } else if (ctx.get?.('connection') || ctx.get?.('webServer')) {
    mount(ctx)
  }
  if (releases.length === 0 && ctx.get?.('connection') === undefined && ctx.get?.('webServer') === undefined) {
    ctx.logger?.warn?.('[dsh-treeviewer] no connection service; the panel API is unavailable')
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const release of releases.splice(0)) {
        try {
          release()
        } catch {
          /* already released */
        }
      }
      for (const dispose of disposers) {
        try {
          dispose?.()
        } catch {
          /* unloading anyway */
        }
      }
      engine.dispose().catch(() => {})
    }, 'dsh-treeviewer: tools and engine')
  }

  ctx.logger?.info?.('[dsh-treeviewer] treeviewer_render, treeviewer_modules and treeviewer_options registered')
}
