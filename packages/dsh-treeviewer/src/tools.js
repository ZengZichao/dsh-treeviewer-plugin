import fs from 'node:fs'
import path from 'node:path'

const RENDER_CATEGORIES = ['Transformer', 'Further transformation', 'Coordinates', 'Plot action']

const IMAGE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    attachmentId: { type: 'string', required: true, description: 'Durable attachment id (sha256:...).' },
    mediaType: { type: 'string', required: true, description: 'Image media type.' },
    bytes: { type: 'number', required: true, description: 'Encoded image size.' },
    width: { type: 'number', description: 'Image width in pixels.' },
    height: { type: 'number', description: 'Image height in pixels.' },
    name: { type: 'string', description: 'Suggested file name.' },
  },
}

async function sessionCwd(ctx, exec) {
  try {
    const workingDirectory = ctx.get?.('workingDirectory')
    if (workingDirectory && exec.agent) return await workingDirectory.ensure(exec.agent, exec.signal)
  } catch {
    /* fall through to process cwd */
  }
  return process.cwd()
}

async function resolvePath(ctx, exec, requested) {
  const target = String(requested)
  try {
    const fsService = ctx.get?.('fs')
    if (fsService && typeof fsService.resolve === 'function') {
      const cwd = await sessionCwd(ctx, exec)
      const resolved = await fsService.resolve(target, { cwd, signal: exec.signal })
      const display = typeof fsService.processPath === 'function' ? fsService.processPath(resolved) : resolved?.displayPath ?? resolved?.path
      if (typeof display === 'string' && display.length > 0) return display
    }
  } catch {
    /* plain path resolution below */
  }
  const cwd = await sessionCwd(ctx, exec)
  return path.resolve(cwd, target)
}

async function routeAcceptsImages(ctx, exec) {
  const llm = ctx.get?.('llm')
  if (!llm || typeof llm.resolveModelInfo !== 'function') return true
  const routed = exec.agent?.session?.requestHeader?.()?.config
  const provider = routed?.provider ?? exec.agent?.options?.provider
  const model = routed?.model ?? exec.agent?.options?.model
  if (!provider || !model) return true
  try {
    const info = await llm.resolveModelInfo(provider, model, exec.signal)
    return Array.isArray(info?.inputModalities) && info.inputModalities.includes('image')
  } catch {
    return true
  }
}

async function commitPreview(ctx, exec, result) {
  if (result.format !== 'png') return null
  const attachments = ctx.get?.('attachments')
  if (!attachments || typeof attachments.saveImage !== 'function') return null
  if (!(await routeAcceptsImages(ctx, exec))) return null
  const data = fs.readFileSync(result.imagePath)
  const ref = await attachments.saveImage({ data, mediaType: 'image/png', name: path.basename(result.imagePath) })
  return {
    attachmentId: ref.attachmentId,
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    ...(ref.width === undefined ? {} : { width: ref.width }),
    ...(ref.height === undefined ? {} : { height: ref.height }),
    ...(ref.name === undefined ? {} : { name: ref.name }),
  }
}

function renderEnvelope(value) {
  const lines = [
    `<path>${value.imagePath}</path>`,
    '<type>treeviewer-render</type>',
    '<content>',
    `${value.format.toUpperCase()} image, ${value.width}x${value.height} px, ${value.bytes} bytes, ${value.durationMs} ms`,
    `TreeViewer ${value.treeviewer?.treeviewer ?? '?'} (command-line ${value.treeviewer?.commandLine ?? '?'})`,
    '</content>',
  ]
  if (value.note) lines.push('', value.note)
  lines.push('', 'Applied settings:', '```json', JSON.stringify(value.appliedSettings, null, 2), '```')
  return lines.join('\n')
}

function summarizeModules(catalog) {
  const lines = [`${catalog.total} installed modules (TreeViewer ${catalog.version?.treeviewer ?? '?'})`, '']
  for (const [category, modules] of Object.entries(catalog.categories)) {
    lines.push(`${category} (${modules.length})`)
    for (const module of modules) lines.push(`  - ${module.name}  ${module.id}`)
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

function summarizeOptions(result) {
  const lines = [`${result.module.name} (${result.module.id}) — ${result.category}`, '']
  if (result.parameters.length === 0) lines.push('No configurable options.')
  for (const parameter of result.parameters) {
    const constraints = []
    if (parameter.type === 'enum') constraints.push(`one of ${parameter.enumValues?.join(', ')}`)
    if (parameter.type === 'boolean') constraints.push('true/false')
    if (parameter.min !== undefined || parameter.max !== undefined) {
      constraints.push(`range ${parameter.min ?? '-inf'}..${parameter.max ?? 'inf'}`)
    }
    if (parameter.syntaxHint && parameter.type !== 'enum') constraints.push('see syntax hint')
    lines.push(`- ${parameter.label} [${parameter.type}] = ${JSON.stringify(parameter.value)}${constraints.length ? ` — ${constraints.join('; ')}` : ''}`)
  }
  return lines.join('\n')
}

export function createTools({ engine, ctx }) {
  const render = {
    name: 'treeviewer_render',
    description:
      'Render a phylogenetic tree with TreeViewer and return the preview image plus the exact settings used. '
      + 'Accepts a Newick/NEXUS/TreeViewer tree file and either high-level presets (layout, branch width, fonts, bootstrap labels) '
      + 'or an expert pipeline of TreeViewer modules. PNG previews are attached to the conversation.',
    parameters: {
      input_file: { type: 'string', required: true, description: 'Path to the tree file (.nwk, .newick, .nex, .tbi).' },
      output_path: { type: 'string', description: 'Where to write the image. Defaults to <cwd>/treeviewer-renders/.' },
      format: { type: 'string', enum: ['png', 'svg', 'pdf', 'tiff'], description: 'Export format; default png.' },
      layout: { type: 'string', enum: ['rectangular', 'circular', 'radial'], description: 'Tree layout preset; default rectangular.' },
      dpi: { type: 'number', description: 'Raster resolution in dots per inch (png/tiff only).' },
      width: { type: 'number', description: 'Output width in pixels (png/tiff); height follows the aspect ratio.' },
      height: { type: 'number', description: 'Output height in pixels (png/tiff).' },
      branch_width: { type: 'number', description: 'Branch line weight preset.' },
      branch_color: { type: 'string', description: 'Branch colour preset, e.g. "#333333".' },
      label_font: { type: 'string', description: 'Label font preset as "Family Size", e.g. "Helvetica 10".' },
      label_color: { type: 'string', description: 'Label text colour preset, e.g. "#111111".' },
      show_bootstrap: { type: 'boolean', description: 'Add support values on internal nodes.' },
      pipeline: {
        type: 'object',
        additionalProperties: true,
        description:
          'Expert override: { "Coordinates": { "module": "Circular", "parameters": { "Rotation": 45 } }, '
          + '"Plot action": [{ "module": "Branches", "parameters": { "Line weight": 2 } }] }. '
          + 'Canonical categories are Transformer, Further transformation, Coordinates and Plot action; '
          + 'camelCase keys (coordinates, plotActions, furtherTransformation) are accepted. '
          + 'Use treeviewer_modules / treeviewer_options to discover valid names and option keys.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          imagePath: { type: 'string', required: true, description: 'Absolute path of the rendered file.' },
          format: { type: 'string', required: true },
          bytes: { type: 'number', required: true },
          width: { type: 'number' },
          height: { type: 'number' },
          durationMs: { type: 'number', required: true },
          treeviewer: { type: 'object', additionalProperties: true },
          appliedSettings: { type: 'object', additionalProperties: true, required: true },
          image: IMAGE_VALUE_SCHEMA,
          note: { type: 'string' },
        },
      },
      render(_args, value) {
        const blocks = [{ type: 'text', text: renderEnvelope(value) }]
        if (value.image) blocks.push({ type: 'image', attachment: value.image })
        return blocks
      },
      presentationMeta(_args, value) {
        return { path: value.imagePath, format: value.format, width: value.width ?? null, height: value.height ?? null }
      },
    },
    isConcurrencySafe: () => false,
    timeoutMs: 900000,
    async execute(args, exec) {
      const inputFile = await resolvePath(ctx, exec, args.input_file)
      const baseDir = path.dirname(inputFile)
      const format = args.format || 'png'
      const outputPath = args.output_path
        ? await resolvePath(ctx, exec, args.output_path)
        : path.join(await sessionCwd(ctx, exec), 'treeviewer-renders', `treeviewer-${Date.now()}.${format}`)

      const settings = {
        inputFile,
        output: {
          format,
          path: outputPath,
          ...(args.dpi === undefined ? {} : { dpi: args.dpi }),
          ...(args.width === undefined ? {} : { width: args.width }),
          ...(args.height === undefined ? {} : { height: args.height }),
        },
        presets: {
          ...(args.layout === undefined ? {} : { layout: args.layout }),
          ...(args.branch_width === undefined ? {} : { branchWidth: args.branch_width }),
          ...(args.branch_color === undefined ? {} : { branchColor: args.branch_color }),
          ...(args.label_font === undefined ? {} : { labelFont: args.label_font }),
          ...(args.label_color === undefined ? {} : { labelColor: args.label_color }),
          ...(args.show_bootstrap === undefined ? {} : { showBootstrap: args.show_bootstrap }),
        },
        ...(args.pipeline === undefined ? {} : { pipeline: args.pipeline }),
      }

      const result = await engine.render(settings, { signal: exec.signal, baseDir })
      if (!result.ok) {
        throw new Error(`TreeViewer render failed (${result.error.code}): ${result.error.message}${result.error.hint ? ` Hint: ${result.error.hint}` : ''}`)
      }
      const image = await commitPreview(ctx, exec, result)
      return {
        imagePath: result.imagePath,
        format: result.format,
        bytes: result.bytes,
        ...(result.width === null ? {} : { width: result.width }),
        ...(result.height === null ? {} : { height: result.height }),
        durationMs: result.durationMs,
        treeviewer: result.appliedSettings.treeviewer,
        appliedSettings: result.appliedSettings,
        ...(image ? { image } : { note: 'The preview is available at imagePath; the active model does not accept image input.' }),
      }
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: `Render ${path.basename(String(args.input_file ?? 'tree'))} with TreeViewer`,
        kind: 'execute',
        rawInput: { layout: args.layout, format: args.format, output: args.output_path },
        locations: [{ path: String(args.input_file ?? '') }],
      }
    },
    presentResult(_args, result) {
      if (result.isError) return undefined
      const meta = result.meta
      const size = meta && typeof meta === 'object' && meta.width ? ` · ${meta.width}x${meta.height} ${String(meta.format).toUpperCase()}` : ''
      return { card: 'generic', title: `TreeViewer render complete${size}` }
    },
  }

  const modules = {
    name: 'treeviewer_modules',
    description:
      'List the TreeViewer modules installed on this machine, grouped by category, with the ids needed by treeviewer_render pipeline settings.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          total: { type: 'number' },
          version: { type: 'object', additionalProperties: true },
          categories: { type: 'object', additionalProperties: true },
          cli: { type: 'object', additionalProperties: true },
          error: { type: 'object', additionalProperties: true },
        },
      },
      render(_args, value) {
        if (!value.ok) return [{ type: 'text', text: `TreeViewer is not usable: ${value.error?.message ?? 'unknown error'}` }]
        return [{ type: 'text', text: summarizeModules(value) }]
      },
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const catalog = await engine.listModules({ signal: exec.signal })
      if (!catalog.ok) return { ok: false, error: catalog.error }
      const status = await engine.detect({ signal: exec.signal })
      return {
        ok: true,
        total: catalog.total,
        version: catalog.version,
        categories: catalog.categories,
        ...(status.ok ? { cli: status.cli } : {}),
      }
    },
  }

  const options = {
    name: 'treeviewer_options',
    description:
      'Show the configurable options of one TreeViewer module (types, enum values, ranges) so treeviewer_render parameters can be filled correctly.',
    parameters: {
      module: { type: 'string', required: true, description: 'Module name or id from treeviewer_modules.' },
      category: {
        type: 'string',
        required: true,
        enum: RENDER_CATEGORIES,
        description: 'Module category.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          module: { type: 'object', additionalProperties: true, required: true },
          category: { type: 'string', required: true },
          parameters: { type: 'array', items: { type: 'object', additionalProperties: true }, required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: summarizeOptions(value) }]
      },
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const result = await engine.getModuleOptions({ module: args.module, category: args.category }, { signal: exec.signal })
      if (!result.ok) {
        throw new Error(`Could not read options for ${args.module}: ${result.error.message}${result.error.hint ? ` Hint: ${result.error.hint}` : ''}`)
      }
      return { module: result.module, category: result.category, parameters: result.parameters }
    },
  }

  return [render, modules, options]
}
