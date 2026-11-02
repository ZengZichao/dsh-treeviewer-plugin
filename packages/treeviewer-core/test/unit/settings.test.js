import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { normalizeSettings } from '../../src/index.js'
import { ERROR_CODES } from '../../src/errors.js'

const BASE = { inputFile: 'tree.nwk', output: { format: 'png', path: 'out.png' } }

function stages(settings, baseDir = '/work') {
  return normalizeSettings(settings, { baseDir }).stages.map((stage) => ({
    category: stage.category,
    module: stage.module,
    parameters: stage.parameters,
    implied: stage.implied,
  }))
}

test('defaults build a complete, renderable pipeline', () => {
  assert.deepEqual(stages(BASE), [
    { category: 'Transformer', module: 'Consensus', parameters: {}, implied: true },
    { category: 'Coordinates', module: 'Rectangular', parameters: {}, implied: true },
    { category: 'Plot action', module: 'Branches', parameters: {}, implied: true },
    { category: 'Plot action', module: 'Labels', parameters: {}, implied: true },
  ])
})

test('layout preset swaps the coordinates module', () => {
  for (const [layout, module] of [['circular', 'Circular'], ['radial', 'Radial'], ['rectangular', 'Rectangular']]) {
    const coordinates = stages({ ...BASE, presets: { layout } }).find((stage) => stage.category === 'Coordinates')
    assert.equal(coordinates.module, module)
  }
})

test('showBootstrap adds a Support labels layer only for default pipelines', () => {
  const withBootstrap = stages({ ...BASE, presets: { showBootstrap: true } }).filter((stage) => stage.category === 'Plot action')
  assert.equal(withBootstrap.length, 3)
  assert.deepEqual(withBootstrap[2], {
    category: 'Plot action',
    module: 'Labels',
    parameters: { Attribute: 'Support', 'Show on': 'Internal nodes' },
    implied: true,
  })

  const explicit = stages({
    ...BASE,
    presets: { showBootstrap: true },
    pipeline: { 'Plot action': ['Branches'] },
  })
  assert.equal(explicit.filter((stage) => stage.category === 'Plot action').length, 1)
})

test('style presets reach the default modules and explicit parameters win', () => {
  const preset = stages({ ...BASE, presets: { branchWidth: 4, labelFont: 'Arial 12', labelColor: '#ff0000', branchColor: '#00ff00' } })
  assert.deepEqual(preset.find((stage) => stage.module === 'Branches').parameters, { 'Line weight': 4, Colour: '#00ff00' })
  assert.deepEqual(preset.find((stage) => stage.module === 'Labels').parameters, { Font: 'Arial 12', 'Text colour': '#ff0000' })

  const explicit = stages({
    ...BASE,
    presets: { branchWidth: 4 },
    pipeline: { 'Plot action': [{ module: 'Branches', parameters: { 'Line weight': 7 } }] },
  })
  assert.equal(explicit.find((stage) => stage.module === 'Branches').parameters['Line weight'], 7)
})

test('pipeline categories replace only their own stage', () => {
  const result = stages({
    ...BASE,
    presets: { layout: 'circular' },
    pipeline: {
      Transformer: { module: 'Consensus' },
      'Further transformation': [{ module: 'Sort nodes' }, { module: 'Unroot tree' }],
      Coordinates: { module: 'Radial', parameters: { Rotation: 45 } },
      'Plot action': [{ module: 'Scale bar' }],
    },
  })
  assert.deepEqual(result.map((stage) => `${stage.category}:${stage.module}`), [
    'Transformer:Consensus',
    'Further transformation:Sort nodes',
    'Further transformation:Unroot tree',
    'Coordinates:Radial',
    'Plot action:Scale bar',
  ])
  assert.equal(result.find((stage) => stage.category === 'Coordinates').implied, false)
  assert.equal(result.find((stage) => stage.category === 'Coordinates').parameters.Rotation, 45)
})

test('camelCase pipeline keys are accepted', () => {
  const result = stages({
    ...BASE,
    pipeline: { transformer: 'Consensus', furtherTransformation: 'Sort nodes', coordinates: 'Circular', plotActions: ['Branches', 'Labels'] },
  })
  assert.deepEqual(result.map((stage) => stage.module), ['Consensus', 'Sort nodes', 'Circular', 'Branches', 'Labels'])
})

test('output accepts a path string and object form', () => {
  const fromString = normalizeSettings({ inputFile: 'tree.nwk', output: 'render.svg' }, { baseDir: '/work' })
  assert.equal(fromString.output.format, 'svg')
  assert.equal(fromString.output.path, path.resolve('/work', 'render.svg'))

  const object = normalizeSettings(
    { inputFile: '/data/tree.nwk', output: { format: 'png', path: 'x.png', dpi: 150, width: 800, height: 600 } },
    { baseDir: '/work' },
  )
  assert.deepEqual(
    { format: object.output.format, dpi: object.output.dpi, width: object.output.width, height: object.output.height },
    { format: 'png', dpi: 150, width: 800, height: 600 },
  )
  assert.equal(object.inputFile, path.resolve('/data/tree.nwk'))
})

test('invalid settings raise INVALID_INPUT with a useful message', () => {
  const cases = [
    [{ ...BASE, output: undefined }],
    [{ ...BASE, output: { format: 'gif', path: 'x.gif' } }],
    [{ ...BASE, output: { format: 'png', path: '' } }],
    [{ ...BASE, output: { format: 'png', path: 'bad\nname.png' } }],
    [{ ...BASE, inputFile: '' }],
    [{ ...BASE, inputFile: 'bad"name.nwk' }],
    [{ ...BASE, presets: { layout: 'spiral' } }],
    [{ ...BASE, pipeline: { 'Plot action': [{ module: 'Branches', parameters: { nested: { a: 1 } } }] } }],
    [{ ...BASE, pipeline: { Coordinates: { parameters: { Width: 1 } } } }],
    [{ ...BASE, output: { format: 'png', path: 'x.png', dpi: -5 } }],
    [{ ...BASE, output: { format: 'png', path: 'x.png', width: 0 } }],
  ]
  for (const [settings] of cases) {
    assert.throws(() => normalizeSettings(settings, { baseDir: '/work' }), (error) => {
      assert.equal(error.code, ERROR_CODES.INVALID_INPUT)
      return true
    })
  }
})

test('a non-object pipeline entry is rejected', () => {
  assert.throws(
    () => normalizeSettings({ ...BASE, pipeline: { Coordinates: [42] } }, { baseDir: '/work' }),
    (error) => error.code === ERROR_CODES.INVALID_INPUT,
  )
})
