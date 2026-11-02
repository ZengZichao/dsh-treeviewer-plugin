import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createTools } from '../src/tools.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-treeviewer-tools-'))
const png = path.join(root, 'preview.png')
fs.writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))

test.after(() => fs.rmSync(root, { recursive: true, force: true }))

function makeHarness(options = {}) {
  const calls = { render: [], saveImage: [] }
  const engine = {
    async render(settings) {
      calls.render.push(settings)
      if (options.renderResult) return options.renderResult
      return {
        ok: true,
        imagePath: png,
        format: settings.output.format,
        mediaType: 'image/png',
        bytes: 8,
        width: settings.output.width ?? 640,
        height: 480,
        durationMs: 1234,
        appliedSettings: { schema: 'dsh-treeviewer/settings@1', treeviewer: { treeviewer: '2.2.0', commandLine: '1.3.1' } },
      }
    },
    async listModules() {
      return {
        ok: true,
        total: 1,
        version: { treeviewer: '2.2.0', commandLine: '1.3.1' },
        categories: { Coordinates: [{ name: 'Rectangular', id: '68e25ec6-5911-4741-8547-317597e1b792' }] },
      }
    },
    async detect() {
      return { ok: true, cli: { path: 'C:/TreeViewer/TreeViewerCommandLine.exe' }, version: { treeviewer: '2.2.0' } }
    },
    async getModuleOptions({ module }) {
      if (module === 'missing') return { ok: false, error: { code: 'MODULE_NOT_FOUND', message: 'Unknown module' } }
      return {
        ok: true,
        module: { name: 'Branches', id: '7c767b07-71be-48b2-8753-b27f3e973570' },
        category: 'Plot action',
        parameters: [
          { label: 'Root branch', type: 'boolean', value: true },
          { label: 'Line cap', type: 'enum', value: 'Round', enumValues: ['Butt', 'Round', 'Square'] },
          { label: 'Rounding', type: 'number', value: '0.00', min: 0, max: 1 },
        ],
      }
    },
  }
  const ctx = {
    get(name) {
      if (name === 'attachments' && options.attachments !== false) {
        return {
          async saveImage({ mediaType, name }) {
            calls.saveImage.push({ mediaType, name })
            return { attachmentId: 'sha256:' + 'a'.repeat(64), mediaType, bytes: 8, width: 640, height: 480, name }
          },
        }
      }
      if (name === 'llm') return options.llm
      return undefined
    },
  }
  return { engine, ctx, calls, tools: createTools({ engine, ctx }) }
}

const exec = { signal: new AbortController().signal, agent: undefined }
const agentExec = {
  signal: new AbortController().signal,
  agent: { session: { requestHeader: () => ({ config: { provider: 'deepseek', model: 'deepseek-chat' } }) }, options: {} },
}

test('all three tools satisfy defineTool', () => {
  const { tools } = makeHarness()
  assert.equal(tools.length, 3)
  for (const tool of tools) {
    const defined = defineTool(tool)
    assert.equal(defined.name, tool.name)
    assert.ok(defined.parameters)
    assert.equal(typeof defined.execute, 'function')
  }
})

test('treeviewer_render forwards presets and an explicit pipeline', async () => {
  const { tools, calls } = makeHarness()
  const render = tools.find((tool) => tool.name === 'treeviewer_render')
  const outputPath = path.join(root, 'explicit.png')
  const value = await render.execute({
    input_file: 'C:/data/tree.nwk',
    output_path: outputPath,
    format: 'png',
    layout: 'circular',
    width: 1200,
    dpi: 96,
    branch_width: 2,
    label_font: 'Helvetica 10',
    show_bootstrap: true,
    pipeline: { Coordinates: { module: 'Circular', parameters: { Rotation: 45 } } },
  }, exec)

  const settings = calls.render[0]
  assert.equal(settings.inputFile, path.resolve('C:/data/tree.nwk'))
  assert.equal(settings.output.path, outputPath)
  assert.equal(settings.output.width, 1200)
  assert.equal(settings.output.dpi, 96)
  assert.deepEqual(settings.presets, {
    layout: 'circular',
    branchWidth: 2,
    labelFont: 'Helvetica 10',
    showBootstrap: true,
  })
  assert.deepEqual(settings.pipeline, { Coordinates: { module: 'Circular', parameters: { Rotation: 45 } } })
  assert.equal(value.format, 'png')
  assert.equal(value.width, 1200)
  assert.equal(value.appliedSettings.schema, 'dsh-treeviewer/settings@1')
})

test('the default output path sits under the session directory', async () => {
  const { tools, calls } = makeHarness()
  const render = tools.find((tool) => tool.name === 'treeviewer_render')
  await render.execute({ input_file: 'C:/data/tree.nwk', format: 'svg' }, exec)
  const target = calls.render[0].output.path.replaceAll('\\', '/')
  assert.ok(target.endsWith('.svg'))
  assert.ok(target.includes('treeviewer-renders'))
})

test('a PNG preview is attached through the attachment service', async () => {
  const { tools } = makeHarness({ llm: { async resolveModelInfo() { return { inputModalities: ['text', 'image'] } } } })
  const render = tools.find((tool) => tool.name === 'treeviewer_render')
  const value = await render.execute({ input_file: 'C:/data/tree.nwk', output_path: path.join(root, 'a.png') }, agentExec)
  assert.equal(value.image.attachmentId, 'sha256:' + 'a'.repeat(64))
  const blocks = render.output.render({}, value)
  assert.equal(blocks[0].type, 'text')
  assert.match(blocks[0].text, /PNG image, \d+x\d+ px/)
  assert.equal(blocks[1].type, 'image')
  assert.equal(blocks[1].attachment.attachmentId, value.image.attachmentId)
})

test('a text-only model gets the path and a note instead of an image block', async () => {
  const { tools } = makeHarness({ llm: { async resolveModelInfo() { return { inputModalities: ['text'] } } } })
  const render = tools.find((tool) => tool.name === 'treeviewer_render')
  const value = await render.execute({ input_file: 'C:/data/tree.nwk', output_path: path.join(root, 'b.png') }, agentExec)
  assert.equal(value.image, undefined)
  assert.match(value.note, /image input/)
  const blocks = render.output.render({}, value)
  assert.equal(blocks.length, 1)
})

test('non-PNG formats are never attached as images', async () => {
  const { tools } = makeHarness({ llm: { async resolveModelInfo() { return { inputModalities: ['image'] } } } })
  const render = tools.find((tool) => tool.name === 'treeviewer_render')
  const value = await render.execute({ input_file: 'C:/data/tree.nwk', format: 'svg', output_path: path.join(root, 'c.svg') }, exec)
  assert.equal(value.image, undefined)
})

test('engine failures become tool errors with the hint', async () => {
  const { tools } = makeHarness({ renderResult: { ok: false, error: { code: 'TRUST_REQUIRED', message: 'source refused', hint: 'add the hash' } } })
  const render = tools.find((tool) => tool.name === 'treeviewer_render')
  await assert.rejects(
    () => render.execute({ input_file: 'C:/data/tree.nwk' }, exec),
    (error) => {
      assert.match(error.message, /TRUST_REQUIRED/)
      assert.match(error.message, /add the hash/)
      return true
    },
  )
})

test('treeviewer_modules renders a readable catalog', async () => {
  const { tools } = makeHarness()
  const modules = tools.find((tool) => tool.name === 'treeviewer_modules')
  const value = await modules.execute({}, exec)
  assert.equal(value.total, 1)
  assert.equal(value.ok, true)
  const text = modules.output.render({}, value)[0].text
  assert.match(text, /Coordinates \(1\)/)
  assert.match(text, /Rectangular/)
})

test('treeviewer_options lists types and constraints', async () => {
  const { tools } = makeHarness()
  const options = tools.find((tool) => tool.name === 'treeviewer_options')
  const value = await options.execute({ module: 'Branches', category: 'Plot action' }, exec)
  const text = options.output.render({}, value)[0].text
  assert.match(text, /Root branch \[boolean\]/)
  assert.match(text, /Line cap \[enum\].*Butt, Round, Square/)
  assert.match(text, /range 0\.\.1/)
  await assert.rejects(() => options.execute({ module: 'missing', category: 'Plot action' }, exec))
})

test('presentCall describes the pending render', () => {
  const { tools } = makeHarness()
  const render = tools.find((tool) => tool.name === 'treeviewer_render')
  const view = render.presentCall({ input_file: 'C:/data/tree.nwk', layout: 'circular', format: 'png' })
  assert.equal(view.card, 'generic')
  assert.match(view.title, /tree\.nwk/)
  assert.deepEqual(view.locations, [{ path: 'C:/data/tree.nwk' }])
})
