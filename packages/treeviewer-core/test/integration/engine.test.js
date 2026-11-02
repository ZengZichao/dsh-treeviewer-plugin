import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ERROR_CODES } from '../../src/errors.js'
import { TreeViewerEngine, locateCli } from '../../src/index.js'

const samples = fileURLToPath(new URL('../../samples/example.nwk', import.meta.url))
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-integration-'))
const outDir = path.join(workDir, 'out')
fs.mkdirSync(outDir, { recursive: true })

let available = true
let unavailableReason = ''
try {
  locateCli()
} catch (error) {
  available = false
  unavailableReason = error.message
}
const skip = available ? false : `TreeViewer command line unavailable: ${unavailableReason}`

let engine

before(async () => {
  if (!available) return
  engine = new TreeViewerEngine({ workDir, idleTimeoutMs: 0 })
  const detected = await engine.detect()
  assert.equal(detected.ok, true, JSON.stringify(detected))
})

after(async () => {
  await engine?.dispose()
  fs.rmSync(workDir, { recursive: true, force: true })
})

const out = (name) => path.join(outDir, name)

test('detect reports the CLI and installed modules', { skip }, async () => {
  const result = await engine.detect()
  assert.equal(result.ok, true)
  assert.match(String(result.version.treeviewer), /^\d+\.\d+/)
  assert.ok(result.modules.coordinates.includes('Rectangular'))
})

test('listModules enumerates every category', { skip }, async () => {
  const result = await engine.listModules()
  assert.equal(result.ok, true)
  assert.ok(result.total > 40)
  assert.deepEqual(result.categories.Coordinates.map((module) => module.name).sort(), ['Circular', 'Radial', 'Rectangular'])
  assert.ok(result.categories['Plot action'].some((module) => module.name === 'Branches'))
})

test('module options are introspected with types and constraints', { skip }, async () => {
  const catalog = await engine.listModules()
  const branches = catalog.categories['Plot action'].find((module) => module.name === 'Branches')
  const result = await engine.getModuleOptions({ module: branches.id, category: 'Plot action' })
  assert.equal(result.ok, true, JSON.stringify(result))
  const byLabel = new Map(result.parameters.map((parameter) => [parameter.label, parameter]))
  assert.equal(byLabel.get('Root branch').type, 'boolean')
  assert.equal(byLabel.get('Line weight').type, 'number')
  assert.equal(byLabel.get('Colour').type, 'color')
  assert.deepEqual(byLabel.get('Line cap').enumValues, ['Butt', 'Round', 'Square'])
  assert.equal(byLabel.get('Rounding').max, 1)
})

test('a default render produces a PNG and a settings record', { skip }, async () => {
  const result = await engine.render({ inputFile: samples, output: { format: 'png', path: out('default.png'), dpi: 96 } })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.ok(result.bytes > 1000)
  assert.ok(result.width > 50 && result.height > 50)
  assert.equal(result.appliedSettings.input.path, samples)
  assert.match(result.appliedSettings.input.sha256, /^[0-9a-f]{64}$/)
  const stages = result.appliedSettings.pipeline.map((entry) => `${entry.category}/${entry.name}`)
  assert.ok(stages.includes('Coordinates/Rectangular'))
  assert.ok(stages.includes('Plot action/Branches'))
  assert.ok(stages.includes('Plot action/Labels'))
  assert.equal(result.appliedSettings.resolution.dpi, 96)
  assert.ok(fs.existsSync(result.imagePath))
})

test('presets change the coordinates module and add a bootstrap layer', { skip }, async () => {
  const result = await engine.render({
    inputFile: samples,
    output: { format: 'png', path: out('preset.png'), width: 700 },
    presets: { layout: 'circular', showBootstrap: true, branchWidth: 2, labelFont: 'Helvetica 11' },
  })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.width, 700)
  const pipeline = result.appliedSettings.pipeline
  assert.ok(pipeline.some((entry) => entry.category === 'Coordinates' && entry.name === 'Circular'))
  const labels = pipeline.filter((entry) => entry.name === 'Labels')
  assert.equal(labels.length, 2)
  assert.ok(labels.some((entry) => entry.options.Attribute === 'Support' && entry.options['Show on'] === 'Internal nodes'))
  const branches = pipeline.find((entry) => entry.name === 'Branches')
  assert.equal(branches.options['Line weight'], '2')
  assert.ok(labels.every((entry) => entry.options.Font === 'Helvetica 11'))
})

test('an explicit pipeline applies module parameters', { skip }, async () => {
  const result = await engine.render({
    inputFile: samples,
    output: { format: 'png', path: out('explicit.png'), dpi: 72 },
    pipeline: {
      Coordinates: { module: 'Rectangular', parameters: { Rotation: 90, Width: 400, 'Coordinate shift': 'None' } },
      'Plot action': [
        { module: 'Branches', parameters: { 'Line weight': 3, Colour: '#cc0000', 'Line cap': 'Round' } },
        { module: 'Labels', parameters: { 'Show on': 'Leaves', 'Text colour': '#112233' } },
      ],
    },
  })
  assert.equal(result.ok, true, JSON.stringify(result))
  const pipeline = result.appliedSettings.pipeline
  const coordinates = pipeline.find((entry) => entry.category === 'Coordinates')
  assert.equal(coordinates.options.Rotation, '90')
  assert.equal(coordinates.options.Width, '400')
  const branches = pipeline.find((entry) => entry.name === 'Branches')
  assert.equal(branches.options['Line weight'], '3')
  assert.equal(branches.options.Colour, '#CC0000')
  assert.equal(branches.options['Line cap'], 'Round')
  const labels = pipeline.find((entry) => entry.name === 'Labels')
  assert.equal(labels.options['Text colour'], '#112233')
})

test('SVG export is validated and measured from its viewBox', { skip }, async () => {
  const result = await engine.render({ inputFile: samples, output: { format: 'svg', path: out('render.svg') } })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.mediaType, 'image/svg+xml')
  assert.ok(result.bytes > 500)
  assert.ok(result.width > 0 && result.height > 0)
  assert.match(fs.readFileSync(result.imagePath, 'utf8').slice(0, 200), /<svg/)
})

test('a missing input file is reported before the CLI runs', { skip }, async () => {
  const result = await engine.render({ inputFile: path.join(workDir, 'absent.nwk'), output: { format: 'png', path: out('absent.png') } })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, ERROR_CODES.INPUT_NOT_FOUND)
})

test('an invalid option value fails with OPTION_FAILED and keeps the engine usable', { skip }, async () => {
  const bad = await engine.render({
    inputFile: samples,
    output: { format: 'png', path: out('bad.png') },
    pipeline: { 'Plot action': [{ module: 'Branches', parameters: { 'Line weight': 'not-a-number' } }] },
  })
  assert.equal(bad.ok, false)
  assert.equal(bad.error.code, ERROR_CODES.OPTION_FAILED)
  assert.match(bad.error.message, /not a valid value/)

  const good = await engine.render({ inputFile: samples, output: { format: 'png', path: out('recovered.png'), width: 320 } })
  assert.equal(good.ok, true, JSON.stringify(good))
})

test('an unknown module fails with MODULE_NOT_FOUND', { skip }, async () => {
  const result = await engine.render({
    inputFile: samples,
    output: { format: 'png', path: out('unknown.png') },
    pipeline: { 'Plot action': [{ module: 'No Such Module' }] },
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, ERROR_CODES.MODULE_NOT_FOUND)
})

test('a pipeline without plot actions is rejected as an empty plot', { skip }, async () => {
  const result = await engine.render({
    inputFile: samples,
    output: { format: 'png', path: out('empty.png') },
    pipeline: { 'Plot action': [] },
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, ERROR_CODES.EMPTY_PLOT)
})

test('cancellation kills the CLI and the next render recovers', { skip }, async () => {
  const controller = new AbortController()
  const pending = engine.render({ inputFile: samples, output: { format: 'png', path: out('cancelled.png') } }, { signal: controller.signal })
  setTimeout(() => controller.abort(), 300)
  const cancelled = await pending
  assert.equal(cancelled.ok, false)
  assert.equal(cancelled.error.code, ERROR_CODES.CANCELLED)

  const recovered = await engine.render({ inputFile: samples, output: { format: 'png', path: out('recovered2.png'), width: 300 } })
  assert.equal(recovered.ok, true, JSON.stringify(recovered))
})

const trustedFile = process.env.TREEVIEWER_TEST_TBI
test('unsigned embedded source is refused unless allow-listed', { skip: skip || (trustedFile ? false : 'set TREEVIEWER_TEST_TBI to a .tbi file with embedded source') }, async () => {
  const denied = await engine.render({ inputFile: trustedFile, output: { format: 'png', path: out('trust-denied.png') } })
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, ERROR_CODES.TRUST_REQUIRED)
  assert.match(denied.error.details.sha256, /^[0-9a-f]{64}$/)

  const permissive = new TreeViewerEngine({ workDir, trust: { allowHashes: [denied.error.details.sha256] }, idleTimeoutMs: 0 })
  try {
    const allowed = await permissive.render({ inputFile: trustedFile, output: { format: 'png', path: out('trust-allowed.png'), dpi: 72 } })
    assert.equal(allowed.ok, true, JSON.stringify(allowed))
    assert.equal(allowed.appliedSettings.input.trusted, true)
  } finally {
    await permissive.dispose()
  }
})
