import path from 'node:path'
import { ERROR_CODES, TreeViewerError } from './errors.js'

export const OUTPUT_FORMATS = Object.freeze(['png', 'svg', 'pdf', 'tiff'])

export const CATEGORY_KEYS = Object.freeze({
  Transformer: ['Transformer', 'transformer'],
  'Further transformation': ['Further transformation', 'furtherTransformation', 'furtherTransformationSteps'],
  Coordinates: ['Coordinates', 'coordinates'],
  'Plot action': ['Plot action', 'plotActions', 'plotAction'],
})

export const LAYOUT_MODULES = Object.freeze({
  rectangular: 'Rectangular',
  circular: 'Circular',
  radial: 'Radial',
})

const PRESET_PARAMETERS = Object.freeze({
  Branches: {
    branchWidth: 'Line weight',
    branchColor: 'Colour',
  },
  Labels: {
    labelFont: 'Font',
    labelColor: 'Text colour',
  },
})

function invalid(message, details) {
  return new TreeViewerError(ERROR_CODES.INVALID_INPUT, message, { details })
}

function assertCleanPath(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw invalid(`${field} must be a non-empty string.`)
  if (/[\r\n"]/.test(value)) throw invalid(`${field} must not contain quotes or line breaks.`)
  return value
}

function toModuleEntries(value, category) {
  if (value === undefined || value === null) return null
  const list = Array.isArray(value) ? value : [value]
  if (list.length === 0) return []
  return list.map((entry, index) => {
    if (typeof entry === 'string') return { module: entry, parameters: {} }
    if (!entry || typeof entry !== 'object') throw invalid(`pipeline.${category}[${index}] must be a module name or an object.`)
    const module = entry.module ?? entry.id ?? entry.name
    if (typeof module !== 'string' || module.trim() === '') {
      throw invalid(`pipeline.${category}[${index}] is missing a module name or id.`)
    }
    const parameters = entry.parameters ?? entry.options ?? {}
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
      throw invalid(`pipeline.${category}[${index}].parameters must be an object.`)
    }
    for (const [key, value2] of Object.entries(parameters)) {
      if (value2 !== null && typeof value2 === 'object') {
        throw invalid(`Parameter "${key}" of ${module} must be a string, number or boolean.`)
      }
    }
    return { module, parameters: { ...parameters } }
  })
}

function pickPipeline(pipeline, category) {
  if (!pipeline || typeof pipeline !== 'object') return { present: false, entries: null }
  for (const key of CATEGORY_KEYS[category]) {
    if (Object.prototype.hasOwnProperty.call(pipeline, key)) {
      return { present: true, entries: toModuleEntries(pipeline[key], category) }
    }
  }
  return { present: false, entries: null }
}

function normalizeOutput(output, baseDir) {
  if (typeof output === 'string') {
    const format = path.extname(output).replace('.', '').toLowerCase()
    if (!OUTPUT_FORMATS.includes(format)) throw invalid(`Cannot infer the output format from "${output}".`)
    return { format, path: path.resolve(baseDir, assertCleanPath(output, 'output')), dpi: null, width: null, height: null }
  }
  if (!output || typeof output !== 'object') throw invalid('output is required: give { format, path } or a file path.')
  const format = String(output.format || path.extname(output.path || '').replace('.', '')).toLowerCase()
  if (!OUTPUT_FORMATS.includes(format)) {
    throw invalid(`output.format must be one of ${OUTPUT_FORMATS.join(', ')}.`, { received: output.format })
  }
  const target = path.resolve(baseDir, assertCleanPath(output.path, 'output.path'))
  const dpi = output.dpi === undefined || output.dpi === null ? null : Number(output.dpi)
  if (dpi !== null && (!Number.isFinite(dpi) || dpi <= 0 || dpi > 2400)) throw invalid('output.dpi must be a number between 1 and 2400.')
  const width = output.width === undefined || output.width === null ? null : Number(output.width)
  const height = output.height === undefined || output.height === null ? null : Number(output.height)
  for (const [name, value] of [['width', width], ['height', height]]) {
    if (value !== null && (!Number.isFinite(value) || value < 1 || value > 100000)) {
      throw invalid(`output.${name} must be a positive number of pixels.`)
    }
  }
  return { format, path: target, dpi, width, height }
}

function applyPresets(entry, category, presets) {
  if (category !== 'Plot action') return entry
  const preset = PRESET_PARAMETERS[entry.module]
  if (!preset) return entry
  const parameters = { ...entry.parameters }
  for (const [presetKey, optionLabel] of Object.entries(preset)) {
    const value = presets[presetKey]
    if (value === undefined || value === null) continue
    if (Object.prototype.hasOwnProperty.call(parameters, optionLabel)) continue
    parameters[optionLabel] = value
  }
  return { ...entry, parameters }
}

export function normalizeSettings(input, { baseDir = process.cwd() } = {}) {
  if (!input || typeof input !== 'object') throw invalid('Render settings must be an object.')

  const inputFile = path.resolve(baseDir, assertCleanPath(input.inputFile ?? input.file, 'inputFile'))
  const output = normalizeOutput(input.output, baseDir)

  const presets = input.presets && typeof input.presets === 'object' ? input.presets : {}
  if (presets.layout !== undefined && !Object.prototype.hasOwnProperty.call(LAYOUT_MODULES, presets.layout)) {
    throw invalid(`presets.layout must be one of ${Object.keys(LAYOUT_MODULES).join(', ')}.`)
  }
  if (presets.showBootstrap !== undefined && typeof presets.showBootstrap !== 'boolean') {
    throw invalid('presets.showBootstrap must be a boolean.')
  }

  const pipeline = input.pipeline

  const transformer = pickPipeline(pipeline, 'Transformer')
  const coordinates = pickPipeline(pipeline, 'Coordinates')
  const plots = pickPipeline(pipeline, 'Plot action')
  const further = pickPipeline(pipeline, 'Further transformation')

  const stages = []

  const transformerEntries = transformer.present ? transformer.entries : [{ module: 'Consensus', parameters: {} }]
  for (const entry of transformerEntries.slice(0, 1)) stages.push({ category: 'Transformer', ...entry, implied: !transformer.present })

  if (further.present) {
    for (const entry of further.entries) stages.push({ category: 'Further transformation', ...entry, implied: false })
  }

  const coordinateEntries = coordinates.present
    ? coordinates.entries.slice(0, 1)
    : [{ module: LAYOUT_MODULES[presets.layout] || LAYOUT_MODULES.rectangular, parameters: {} }]
  for (const entry of coordinateEntries) stages.push({ category: 'Coordinates', ...entry, implied: !coordinates.present })

  let plotEntries = plots.present ? plots.entries : [{ module: 'Branches', parameters: {} }, { module: 'Labels', parameters: {} }]
  if (!plots.present && presets.showBootstrap === true) {
    plotEntries = [...plotEntries, { module: 'Labels', parameters: { Attribute: 'Support', 'Show on': 'Internal nodes' } }]
  }
  for (const entry of plotEntries) {
    stages.push({ category: 'Plot action', ...applyPresets(entry, 'Plot action', presets), implied: !plots.present })
  }

  return { inputFile, output, stages }
}

export function describeStage(stage) {
  return `${stage.category}: ${stage.module}`
}
