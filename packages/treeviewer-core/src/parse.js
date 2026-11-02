import { MODULE_CATEGORIES } from './locate.js'
import { stripAnsi } from './cli-session.js'

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const UUID_RE = new RegExp(UUID_PATTERN, 'i')
const CATALOG_ROW_RE = new RegExp(`^\\s{2,}(.+?)\\s{2,}(${UUID_PATTERN})\\s*$`, 'i')
const ENABLED_ROW_RE = new RegExp(`^\\s*#(\\d+)\\s+(.+?)\\s{2,}(${UUID_PATTERN})\\s*$`, 'i')
const OPTION_ROW_RE = /^\s*#(\d+)\s+(.*?)\s*$/
const CHECKBOX_GLYPHS = new Set(['□', '√', '☑', '☐', '✓'])

export function stripBoxDrawing(text) {
  return String(text).replace(/[\u2500-\u257F]/g, ' ')
}

export function normalize(text) {
  return stripBoxDrawing(stripAnsi(String(text))).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function looksLikeUuid(value) {
  return UUID_RE.test(String(value))
}

export function parseModuleCatalog(output) {
  const rows = []
  for (const line of normalize(output).split('\n')) {
    const match = CATALOG_ROW_RE.exec(line)
    if (match) rows.push({ name: match[1].trim(), id: match[2] })
  }
  return rows
}

export function parseEnabledModules(output) {
  const modules = []
  let category = null
  for (const line of normalize(output).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const categoryMatch = MODULE_CATEGORIES.find((name) => name === trimmed)
    if (categoryMatch) {
      category = categoryMatch
      continue
    }
    const match = ENABLED_ROW_RE.exec(line)
    if (match) {
      modules.push({ index: Number(match[1]), category, name: match[2].trim(), id: match[3] })
    }
  }
  return modules
}

function parseOptionValue(raw) {
  const value = raw.replace(/\s+$/, '')
  if (value.endsWith('▼')) {
    return { value: value.slice(0, -1).trim(), dropdown: true }
  }
  if (value.endsWith('…')) {
    return { value: value.slice(0, -1).trim(), dropdown: false, ellipsis: true }
  }
  return { value: value.trim(), dropdown: false }
}

export function parseOptionRows(output) {
  const options = []
  for (const line of normalize(output).split('\n')) {
    const row = OPTION_ROW_RE.exec(line)
    if (!row) continue
    const index = Number(row[1])
    const rest = row[2].trimEnd()
    const first = rest.trimStart().charAt(0)
    if (CHECKBOX_GLYPHS.has(first)) {
      const label = rest.trimStart().slice(1).trim()
      options.push({
        index,
        label,
        control: 'checkbox',
        value: first === '√' || first === '☑' || first === '✓',
        raw: rest,
      })
      continue
    }
    const split = /^(.*?):\s{2,}(.*)$/.exec(rest)
    let label
    let valueRaw
    if (split) {
      label = split[1].trim()
      valueRaw = split[2]
    } else {
      const loose = /^(.*?):\s*(.*)$/.exec(rest)
      const spaced = /^(.*?)\s{2,}(\[?[^ ].*)$/.exec(rest)
      if (loose) {
        label = loose[1].trim()
        valueRaw = loose[2]
      } else if (spaced) {
        label = spaced[1].trim()
        valueRaw = spaced[2]
      } else {
        options.push({ index, label: rest.trim(), control: 'unknown', value: rest.trim(), raw: rest })
        continue
      }
    }
    const parsed = parseOptionValue(valueRaw)
    let control = 'text'
    let value = parsed.value
    if (/^\[(Source code|Markdown)\]$/.test(value)) {
      control = 'complex'
    } else if (/^\[Default .+\]$/.test(value)) {
      control = 'complex'
    } else if (parsed.dropdown) {
      control = 'select'
    } else if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value) && (/colour/i.test(label) || parsed.ellipsis)) {
      control = 'color'
    } else if (parsed.ellipsis && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) {
      control = 'color'
    }
    if (control === 'text') {
      if (/^-?\d+(\.\d+)?$/.test(value)) control = 'number'
      else if (/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(value)) control = 'point'
      else if (/^[A-Za-z][\w -]* \d+(\.\d+)?$/.test(value) && /font/i.test(label)) control = 'font'
    }
    options.push({ index, label, control, value, raw: rest })
  }
  return options
}

export function parseOptionHint(output) {
  const text = normalize(output)
  const selected = /Selected option #(\d+) (.*)/.exec(text)
  const hint = { index: selected ? Number(selected[1]) : null, label: selected ? selected[2].trim() : null, kind: 'none' }

  const range = /Range:\s*(-?[\d.]+)\s*-\s*(Infinity|-?[\d.]+)/.exec(text)
  if (range) {
    hint.kind = 'range'
    hint.min = range[1] === 'Infinity' ? null : Number(range[1])
    hint.max = range[2] === 'Infinity' ? null : Number(range[2])
    return hint
  }

  const possible = /Possible values:\s*\n([\s\S]*?)(?:\n\s*\n|\n\s*Selected option|$)/.exec(text)
  if (possible) {
    hint.kind = 'enum'
    hint.enumValues = possible[1]
      .split('\n')
      .join(' ')
      .split(/\s{2,}/)
      .map((value) => value.trim())
      .filter(Boolean)
    return hint
  }

  const syntax = /^[ \t]*([A-Za-z][A-Za-z ]*?) syntax:[ \t]*$/m.exec(text)
  if (syntax) {
    hint.kind = 'syntax'
    hint.syntaxKind = syntax[1].toLowerCase().replace(/\s+/g, '-')
    hint.text = text.trim()
    return hint
  }

  return hint
}

const TYPE_BY_SYNTAX = {
  colour: 'color',
  color: 'color',
  number: 'number',
  string: 'string',
  font: 'font',
  point: 'point',
  node: 'string',
  formatter: 'string',
}

export function mergeOptionSpec(row, hint) {
  const spec = {
    key: row.label,
    index: row.index,
    label: row.label,
    control: row.control,
    type: 'string',
    value: row.value,
  }
  if (row.control === 'checkbox') {
    spec.type = 'boolean'
    if (hint && hint.kind === 'enum' && Array.isArray(hint.enumValues)) spec.enumValues = hint.enumValues
    return spec
  }
  if (row.control === 'complex') {
    spec.type = 'complex'
    return spec
  }
  if (hint && hint.kind === 'range') {
    spec.type = 'number'
    if (hint.min !== null && hint.min !== undefined) spec.min = hint.min
    if (hint.max !== null && hint.max !== undefined) spec.max = hint.max
    return spec
  }
  if (hint && hint.kind === 'enum' && Array.isArray(hint.enumValues)) {
    spec.enumValues = hint.enumValues
    const isBoolean = hint.enumValues.length === 2 && hint.enumValues.every((value) => /^(true|false)$/i.test(value))
    spec.type = isBoolean ? 'boolean' : 'enum'
    return spec
  }
  if (hint && hint.kind === 'syntax') {
    const base = hint.syntaxKind.replace(/-by-node$/, '')
    spec.type = TYPE_BY_SYNTAX[base] || TYPE_BY_SYNTAX[hint.syntaxKind] || 'string'
    if (hint.text) spec.syntaxHint = hint.text
    return spec
  }
  if (row.control === 'color') spec.type = 'color'
  else if (row.control === 'number') spec.type = 'number'
  else if (row.control === 'font') spec.type = 'font'
  else if (row.control === 'point') spec.type = 'point'
  else if (row.control === 'select') spec.type = 'enum'
  return spec
}

export function parseResolution(output) {
  const text = normalize(output)
  const width = /Width:\s*([\d.]+)\s*px/.exec(text)
  const height = /Height:\s*([\d.]+)\s*px/.exec(text)
  const dpi = /DPI:\s*([\d.]+)/.exec(text)
  return {
    widthPx: width ? Number(width[1]) : null,
    heightPx: height ? Number(height[1]) : null,
    dpi: dpi ? Number(dpi[1]) : null,
  }
}

export function parseCliVersion(banner) {
  const match = /TreeViewer v([\w.-]+) \(command-line v([\w.-]+)\)/.exec(String(banner))
  return match ? { treeviewer: match[1], commandLine: match[2] } : null
}

export const CLI_MESSAGES = Object.freeze({
  noModuleSelected: 'No module has been selected!',
  noOptionSelected: 'No option has been selected!',
  noTreeLoaded: 'No tree has been loaded!',
  unknownModule: /^Unknown module: (.+)$/m,
  unknownOption: /^Unknown option: (.+)$/m,
  invalidValue: /^(.+) is not a valid value for option (.+)!$/m,
  unsupportedFile: 'The file type is not supported by any of the currently installed modules!',
  fileNotFound: 'The specified file does not exist!',
  emptyPlot: 'The plot is empty!',
  noTransformer: 'No Transformer module has been enabled!',
  noCoordinates: 'No Coordinates module has been enabled!',
  noFileLoaded: 'No file has been loaded!',
  pendingUpdates: 'The state of some modules needs to be updated!',
  sourceTrust: 'The selected file contains source code',
  addPublicKey: "Would you like to add the file's public key",
  suggestedModules: 'Would you like to load the suggested modules?',
})
