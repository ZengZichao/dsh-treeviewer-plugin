import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeOptionSpec,
  parseEnabledModules,
  parseModuleCatalog,
  parseOptionHint,
  parseOptionRows,
  parseResolution,
  stripBoxDrawing,
} from '../../src/index.js'

const CATALOG = `
                      Coordinates                    
  ───────────────────────────────────────────────────
  Module name    Module Id
  ───────────────────────────────────────────────────
  Radial         95b61284-b870-48b9-b51c-3276f7d89df1
  Rectangular    68e25ec6-5911-4741-8547-317597e1b792
  Circular       92aac276-3af7-4506-a263-7220e0df5797
`

const ENABLED = `
                            File type
  ─────────────────────────────────────────────────────────────
  #       Module name      Module Id
  ─────────────────────────────────────────────────────────────
  #1      Newick           79dfb9b2-ff10-4ed9-aa74-f7b3ae93c3d2

                           Plot action
  ─────────────────────────────────────────────────────────────
  #       Module name      Module Id
  ─────────────────────────────────────────────────────────────
  #5      Branches         7c767b07-71be-48b2-8753-b27f3e973570
  #6      Labels           ac496677-2650-4d92-8646-0812918bab03
`

const OPTIONS = `
  Options for module Labels (ac496677-2650-4d92-8646-0812918bab03):

    ┌─────────── Attribute ───────────┐
    │ #1   Attribute:    Name ▼        │
    │ #2   Attribute type:    String ▼ │
    │ #3   Attribute format...    [Default String] │
    └──────────────────────────────────┘
    #4   Show on:    Leaves ▼
    #5   √ Exclude cartoon nodes
    #11  Font:    Helvetica 10
    #12  □ Auto colour by node
    #14  Text colour:    #000000  …
    #9   Custom script:    [Source code]
`

test('parseModuleCatalog reads name and id rows only', () => {
  const modules = parseModuleCatalog(CATALOG)
  assert.deepEqual(modules, [
    { name: 'Radial', id: '95b61284-b870-48b9-b51c-3276f7d89df1' },
    { name: 'Rectangular', id: '68e25ec6-5911-4741-8547-317597e1b792' },
    { name: 'Circular', id: '92aac276-3af7-4506-a263-7220e0df5797' },
  ])
})

test('parseModuleCatalog tolerates empty and error output', () => {
  assert.deepEqual(parseModuleCatalog(''), [])
  assert.deepEqual(parseModuleCatalog('An error occurred while executing command\nError message:\nSequence contains no elements'), [])
})

test('parseEnabledModules tracks the current category', () => {
  const modules = parseEnabledModules(ENABLED)
  assert.equal(modules.length, 3)
  assert.deepEqual(modules[0], { index: 1, category: 'File type', name: 'Newick', id: '79dfb9b2-ff10-4ed9-aa74-f7b3ae93c3d2' })
  assert.equal(modules[2].category, 'Plot action')
  assert.equal(modules[2].name, 'Labels')
})

test('parseOptionRows recognises every control style', () => {
  const rows = parseOptionRows(OPTIONS)
  const byIndex = new Map(rows.map((row) => [row.index, row]))
  assert.deepEqual({ ...byIndex.get(1) }, { index: 1, label: 'Attribute', control: 'select', value: 'Name', raw: 'Attribute:    Name ▼' })
  assert.equal(byIndex.get(3).control, 'complex')
  assert.equal(byIndex.get(3).label, 'Attribute format...')
  assert.equal(byIndex.get(5).control, 'checkbox')
  assert.equal(byIndex.get(5).value, true)
  assert.equal(byIndex.get(12).value, false)
  assert.equal(byIndex.get(11).control, 'font')
  assert.equal(byIndex.get(14).control, 'color')
  assert.equal(byIndex.get(14).value, '#000000')
  assert.equal(byIndex.get(9).control, 'complex')
})

test('stripBoxDrawing removes frame glyphs but keeps text', () => {
  const text = stripBoxDrawing('│ #1   Width:    140 │\n└──────────┘')
  assert.match(text, /#1 {3}Width: {4}140/)
  assert.doesNotMatch(text, /[│└─]/)
})

test('parseOptionHint reads ranges, enumerations and syntax help', () => {
  const range = parseOptionHint('  Selected option #3 Rotation\n\n  Range: 0 - 360')
  assert.deepEqual({ kind: range.kind, min: range.min, max: range.max }, { kind: 'range', min: 0, max: 360 })

  const open = parseOptionHint('  Selected option #1 Width\n\n  Range: 0 - Infinity')
  assert.equal(open.max, null)

  const values = parseOptionHint('  Selected option #4 Show on\n\n  Possible values:\n    Leaves            Internal nodes    All nodes         \n')
  assert.deepEqual(values.enumValues, ['Leaves', 'Internal nodes', 'All nodes'])

  const syntax = parseOptionHint('  Selected option #6 Line weight\n\n  Number by node syntax:\n    option set <value>')
  assert.equal(syntax.kind, 'syntax')
  assert.equal(syntax.syntaxKind, 'number-by-node')
})

test('mergeOptionSpec applies hint types over inferred controls', () => {
  const number = mergeOptionSpec({ index: 6, label: 'Line weight', control: 'number', value: '1' }, { kind: 'syntax', syntaxKind: 'number-by-node' })
  assert.equal(number.type, 'number')

  const colour = mergeOptionSpec({ index: 5, label: 'Colour', control: 'color', value: '#000000' }, { kind: 'syntax', syntaxKind: 'colour-by-node' })
  assert.equal(colour.type, 'color')

  const bool = mergeOptionSpec({ index: 1, label: 'Root branch', control: 'checkbox', value: true }, { kind: 'enum', enumValues: ['true', 'false'] })
  assert.equal(bool.type, 'boolean')
  assert.deepEqual(bool.enumValues, ['true', 'false'])

  const ranged = mergeOptionSpec({ index: 2, label: 'Rounding', control: 'number', value: '0.00' }, { kind: 'range', min: 0, max: 1 })
  assert.equal(ranged.type, 'number')
  assert.equal(ranged.min, 0)
  assert.equal(ranged.max, 1)

  const complex = mergeOptionSpec({ index: 9, label: 'Custom script', control: 'complex', value: '[Source code]' }, { kind: 'none' })
  assert.equal(complex.type, 'complex')
})

test('parseResolution extracts the export panel values', () => {
  const panel = `
    Width: 1200 px
            317.50 mm

    Height: 1016 px
            268.83 mm

       DPI: 96.00
`
  assert.deepEqual(parseResolution(panel), { widthPx: 1200, heightPx: 1016, dpi: 96 })
  assert.deepEqual(parseResolution('No tree has been loaded!'), { widthPx: null, heightPx: null, dpi: null })
})
