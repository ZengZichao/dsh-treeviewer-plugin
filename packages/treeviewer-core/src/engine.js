import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CliSession } from './cli-session.js'
import { locateCli, MODULE_CATEGORIES } from './locate.js'
import { normalizeSettings } from './settings.js'
import {
  CLI_MESSAGES,
  mergeOptionSpec,
  parseEnabledModules,
  parseModuleCatalog,
  parseOptionHint,
  parseOptionRows,
  parseResolution,
} from './parse.js'
import { createTrustPolicy, hashFile } from './trust.js'
import { assertRendered, inspectOutput, mediaTypeFor } from './image.js'
import { ERROR_CODES, TreeViewerError, failure } from './errors.js'

const SAMPLE_TREE = fileURLToPath(new URL('../samples/example.nwk', import.meta.url))
const INTROSPECTABLE = new Set(['Transformer', 'Further transformation', 'Coordinates', 'Plot action'])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function errorText(output) {
  const match = /Error message:\s*\n?\s*(.+)/.exec(output)
  return match ? match[1].trim() : null
}

function isCliException(output) {
  return output.includes('An error occurred while executing command')
}

function normalizeConfig(config = {}) {
  const credentials = config.trust || {}
  const hashes = []
  const files = []
  for (const entry of credentials.allow || credentials.allowFiles || []) {
    const value = String(entry)
    if (/^[0-9a-f]{64}$/i.test(value)) hashes.push(value.toLowerCase())
    else files.push(path.resolve(value))
  }
  for (const entry of credentials.allowHashes || []) hashes.push(String(entry).toLowerCase())
  const timeouts = config.timeouts || {}
  let workDir = path.resolve(config.workDir || path.join(os.tmpdir(), 'dsh-treeviewer'))
  if (process.platform === 'win32' && /[^\x20-\x7E]/.test(workDir)) {
    workDir = path.join(os.tmpdir(), 'dsh-treeviewer')
  }
  return {
    cliPath: config.cliPath ? path.resolve(config.cliPath) : null,
    workDir,
    sampleTree: config.sampleTree ? path.resolve(config.sampleTree) : SAMPLE_TREE,
    env: config.env || {},
    trust: { allowHashes: hashes, allowFiles: files, rememberKeys: credentials.rememberKeys === true },
    timeouts: {
      startupMs: Number(timeouts.startupMs) || 45000,
      commandMs: Number(timeouts.commandMs) || 300000,
      introspectionMs: Number(timeouts.introspectionMs) || 120000,
    },
    idleTimeoutMs: config.idleTimeoutMs === undefined ? 300000 : Number(config.idleTimeoutMs),
    logger: config.logger || null,
  }
}

function needsAsciiPath(file) {
  return process.platform === 'win32' || /[^\x20-\x7E]/.test(file)
}

function formatOptionValue(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TreeViewerError(ERROR_CODES.INVALID_INPUT, 'Numeric option values must be finite.')
    return String(value)
  }
  if (typeof value === 'string') {
    if (/[\r\n]/.test(value)) throw new TreeViewerError(ERROR_CODES.INVALID_INPUT, 'Option values must not contain line breaks.')
    if (value.trim() === '') throw new TreeViewerError(ERROR_CODES.INVALID_INPUT, 'Option values must not be empty.')
    return value
  }
  throw new TreeViewerError(ERROR_CODES.INVALID_INPUT, 'Option values must be a string, number or boolean.')
}

export class TreeViewerEngine {
  #config
  #session = null
  #cli = null
  #queue = Promise.resolve()
  #catalog = null
  #optionCache = new Map()
  #idleTimer = null

  constructor(config = {}) {
    this.#config = normalizeConfig(config)
  }

  get config() {
    return { ...this.#config, trust: { ...this.#config.trust, allowHashes: [...this.#config.trust.allowHashes] } }
  }

  get running() {
    return this.#session?.running === true
  }

  get version() {
    return this.#session?.version || null
  }

  async detect(options = {}) {
    return this.#enqueue(async () => {
      try {
        const cli = this.#resolveCli()
        const session = await this.#ensureSession()
        const { output } = await session.exec('module list available Coordinates', {
          timeoutMs: this.#config.timeouts.introspectionMs,
          signal: options.signal || null,
        })
        const coordinates = parseModuleCatalog(output)
        this.#assertModulesInstalled(output, coordinates)
        return {
          ok: true,
          cli: { path: cli.cliPath, kind: cli.kind, source: cli.source },
          version: session.version,
          modules: { coordinates: coordinates.map((module) => module.name) },
          workDir: this.#config.workDir,
          sampleTree: this.#config.sampleTree,
        }
      } catch (error) {
        this.#handleSessionFailure(error)
        return failure(error)
      } finally {
        this.#touchIdle()
      }
    })
  }

  async listModules(options = {}) {
    return this.#enqueue(async () => {
      try {
        const session = await this.#ensureSession()
        const catalog = await this.#readCatalog(session, options.signal || null)
        return {
          ok: true,
          version: session.version,
          categories: catalog,
          total: Object.values(catalog).reduce((sum, list) => sum + list.length, 0),
        }
      } catch (error) {
        this.#handleSessionFailure(error)
        return failure(error)
      } finally {
        this.#touchIdle()
      }
    })
  }

  async getModuleOptions({ module, category }, options = {}) {
    return this.#enqueue(async () => {
      try {
        if (typeof module !== 'string' || module.trim() === '') {
          throw new TreeViewerError(ERROR_CODES.INVALID_INPUT, 'module must be a module name or id.')
        }
        if (!INTROSPECTABLE.has(category)) {
          throw new TreeViewerError(ERROR_CODES.INVALID_INPUT, `Options can only be introspected for ${[...INTROSPECTABLE].join(', ')} modules.`, {
            details: { category },
          })
        }
        const cacheKey = `${category}:${module}`
        if (this.#optionCache.has(cacheKey)) return { ok: true, ...this.#optionCache.get(cacheKey), cached: true }

        const session = await this.#ensureSession()
        const signal = options.signal || null
        const timeoutMs = this.#config.timeouts.introspectionMs

        await this.#openForIntrospection(session, timeoutMs, signal)
        const resolved = await this.#enableStage(session, { category, module, parameters: {} }, timeoutMs, signal)
        const { output } = await session.exec('option list', { timeoutMs, signal })
        const rows = parseOptionRows(output)
        const parameters = []
        for (const row of rows) {
          const hint = await session.exec(`option select #${row.index}`, { timeoutMs, signal })
          parameters.push(mergeOptionSpec(row, parseOptionHint(hint.output)))
        }
        const result = { module: resolved, category, parameters }
        this.#optionCache.set(cacheKey, result)
        return { ok: true, ...result, cached: false }
      } catch (error) {
        this.#handleSessionFailure(error)
        return failure(error)
      } finally {
        this.#touchIdle()
      }
    })
  }

  async render(settings, options = {}) {
    return this.#enqueue(async () => {
      const first = await this.#renderOnce(settings, options)
      if (!first.ok && first.error.code === ERROR_CODES.CLI_EXITED) {
        this.#config.logger?.warn?.('[treeviewer-core] TreeViewer exited during a render; retrying once with a fresh process')
        return this.#renderOnce(settings, options)
      }
      return first
    })
  }

  async #renderOnce(settings, options = {}) {
    const startedAt = Date.now()
    const signal = options.signal || null
    try {
      const normalized = normalizeSettings(settings, { baseDir: options.baseDir || process.cwd() })
      const stat = fs.existsSync(normalized.inputFile) ? fs.statSync(normalized.inputFile) : null
      if (!stat || !stat.isFile()) {
        throw new TreeViewerError(ERROR_CODES.INPUT_NOT_FOUND, `Tree file not found: ${normalized.inputFile}`, {
          hint: 'Pass an absolute path to a Newick, NEXUS or TreeViewer binary tree file.',
        })
      }
      fs.mkdirSync(path.dirname(normalized.output.path), { recursive: true })

      const session = await this.#ensureSession()
      const timeoutMs = this.#config.timeouts.commandMs
      const fileHash = await hashFile(normalized.inputFile)
      const policy = createTrustPolicy(this.#config.trust)
      const cliInput = this.#materializeInput(normalized.inputFile, fileHash)
      const cliOutput = this.#cliOutputPath(normalized.output)

      const opened = await session.exec(`open ${cliInput}`, {
        timeoutMs,
        signal,
        onPrompt: (text) => policy.answer(text, { fileHash, filePath: normalized.inputFile }),
      })
      if (policy.state.refused) {
        throw new TreeViewerError(
          ERROR_CODES.TRUST_REQUIRED,
          'The tree file contains embedded source code whose signature is not trusted, so TreeViewer refused to load it.',
          {
            hint: `Review the file, then add its SHA-256 (${fileHash}) to the plugin's trust.allow list to allow it.`,
            details: { file: normalized.inputFile, sha256: fileHash },
          },
        )
      }
      if (opened.output.includes(CLI_MESSAGES.fileNotFound)) {
        throw new TreeViewerError(ERROR_CODES.INPUT_NOT_FOUND, `Tree file not found: ${normalized.inputFile}`)
      }
      if (opened.output.includes(CLI_MESSAGES.unsupportedFile)) {
        throw new TreeViewerError(ERROR_CODES.UNSUPPORTED_FILE, 'No installed TreeViewer module supports this file type.', {
          hint: 'Install the file-type module in TreeViewer, or convert the tree to Newick/NEXUS.',
          details: { file: normalized.inputFile },
        })
      }
      if (isCliException(opened.output)) {
        throw new TreeViewerError(ERROR_CODES.RENDER_FAILED, errorText(opened.output) || 'TreeViewer could not open the file.', {
          details: { file: normalized.inputFile },
        })
      }

      const enabled = []
      const ready = { transformer: false, coordinates: false }
      for (const stage of normalized.stages) {
        const resolved = await this.#enableStage(session, stage, timeoutMs, signal, ready)
        enabled.push({ ...resolved, category: stage.category })
        if (stage.category === 'Transformer') ready.transformer = true
        if (stage.category === 'Coordinates') ready.coordinates = true
        await this.#applyParameters(session, stage, timeoutMs, signal)
        await this.#update(session, timeoutMs, signal)
      }

      await this.#applyResolution(session, normalized.output, timeoutMs, signal)

      const fontValues = normalized.stages.flatMap((stage) =>
        Object.entries(stage.parameters)
          .filter(([label]) => /font/i.test(label))
          .map(([, value]) => String(value)),
      )

      const exported = await session.exec(`${normalized.output.format} ${cliOutput}`, { timeoutMs, signal })
      if (isCliException(exported.output)) {
        const message = errorText(exported.output) || 'TreeViewer failed to export the image.'
        const hint =
          /Object reference/i.test(message) && fontValues.length > 0
            ? `TreeViewer could not render the font "${fontValues[0]}". Use a family TreeViewer ships, for example "Helvetica 10".`
            : undefined
        throw new TreeViewerError(ERROR_CODES.RENDER_FAILED, message, {
          ...(hint ? { hint } : {}),
          details: { output: normalized.output.path },
        })
      }
      const image = assertRendered(cliOutput, normalized.output.format)
      if (cliOutput !== normalized.output.path) {
        fs.copyFileSync(cliOutput, normalized.output.path)
        fs.rmSync(cliOutput, { force: true })
      }

      const appliedSettings = await this.#captureApplied(session, {
        normalized,
        enabled,
        image,
        fileHash,
        trusted: policy.state.trusted,
        timeoutMs,
        signal,
      })

      return {
        ok: true,
        imagePath: normalized.output.path,
        format: normalized.output.format,
        mediaType: mediaTypeFor(normalized.output.format),
        bytes: image.bytes,
        width: image.width,
        height: image.height,
        durationMs: Date.now() - startedAt,
        appliedSettings,
      }
    } catch (error) {
      this.#handleSessionFailure(error)
      return failure(error)
    } finally {
      this.#touchIdle()
    }
  }

  async dispose() {
    clearTimeout(this.#idleTimer)
    this.#idleTimer = null
    const session = this.#session
    this.#session = null
    if (session) await session.stop()
  }

  #enqueue(task) {
    const run = this.#queue.then(task, task)
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  #resolveCli() {
    if (!this.#cli) {
      this.#cli = locateCli({ cliPath: this.#config.cliPath || undefined, env: { ...process.env, ...this.#config.env } })
    }
    return this.#cli
  }

  async #ensureSession() {
    if (this.#session?.running) return this.#session
    const cli = this.#resolveCli()
    fs.mkdirSync(this.#config.workDir, { recursive: true })
    const session = new CliSession({
      command: cli.command,
      args: cli.args,
      cwd: this.#config.workDir,
      env: this.#config.env,
      defaultTimeoutMs: this.#config.timeouts.commandMs,
      startupTimeoutMs: this.#config.timeouts.startupMs,
      logger: this.#config.logger,
    })
    await session.start()
    this.#session = session
    this.#catalog = null
    this.#config.logger?.info?.(`[treeviewer-core] TreeViewer ${session.version?.treeviewer ?? 'unknown'} ready at ${cli.cliPath}`)
    return session
  }

  #handleSessionFailure(error) {
    if (error instanceof TreeViewerError && [ERROR_CODES.TIMEOUT, ERROR_CODES.CANCELLED, ERROR_CODES.CLI_EXITED, ERROR_CODES.CLI_START_FAILED].includes(error.code)) {
      this.#session?.kill()
      this.#session = null
    } else if (this.#session && !this.#session.running) {
      this.#session = null
    }
  }

  #touchIdle() {
    clearTimeout(this.#idleTimer)
    this.#idleTimer = null
    if (!this.#session || this.#config.idleTimeoutMs <= 0) return
    this.#idleTimer = setTimeout(() => {
      const session = this.#session
      this.#session = null
      session?.stop().catch(() => {})
    }, this.#config.idleTimeoutMs)
    this.#idleTimer.unref?.()
  }

  #assertModulesInstalled(output, coordinates) {
    if (coordinates.length > 0) return
    throw new TreeViewerError(
      ERROR_CODES.MODULES_NOT_INSTALLED,
      'TreeViewer is installed but no modules are available.',
      {
        hint: 'Run `TreeViewer -I` once to install the module library, then try again.',
        details: { output: output.slice(0, 400) },
      },
    )
  }

  async #readCatalog(session, signal) {
    if (this.#catalog) return this.#catalog
    const categories = {}
    for (const category of MODULE_CATEGORIES) {
      const { output } = await session.exec(`module list available ${category}`, {
        timeoutMs: this.#config.timeouts.introspectionMs,
        signal,
      })
      categories[category] = parseModuleCatalog(output)
    }
    this.#assertModulesInstalled('', categories.Coordinates || [])
    this.#catalog = categories
    return categories
  }

  #materializeInput(file, hash) {
    if (!needsAsciiPath(file)) return file
    const ext = path.extname(file).replace(/[^\w.]/g, '').slice(0, 20)
    const target = path.join(this.#config.workDir, `input-${String(hash).slice(0, 16)}${ext}`)
    if (!fs.existsSync(target)) {
      fs.mkdirSync(this.#config.workDir, { recursive: true })
      try {
        fs.linkSync(file, target)
      } catch {
        fs.copyFileSync(file, target)
      }
    }
    return target
  }

  #materializeSample() {
    const source = this.#config.sampleTree
    if (!needsAsciiPath(source)) return source
    fs.mkdirSync(this.#config.workDir, { recursive: true })
    const target = path.join(this.#config.workDir, 'sample.nwk')
    fs.copyFileSync(source, target)
    return target
  }

  #cliOutputPath(output) {
    if (!needsAsciiPath(output.path)) return output.path
    fs.mkdirSync(this.#config.workDir, { recursive: true })
    return path.join(this.#config.workDir, `render-${process.pid}-${Date.now()}.${output.format}`)
  }

  async #openForIntrospection(session, timeoutMs, signal) {
    const { output } = await session.exec(`open ${this.#materializeSample()}`, {
      timeoutMs,
      signal,
      onPrompt: () => 'N',
    })
    if (isCliException(output) || output.includes(CLI_MESSAGES.fileNotFound)) {
      throw new TreeViewerError(ERROR_CODES.INTERNAL, 'Could not open the bundled sample tree used for option introspection.', {
        details: { sample: this.#config.sampleTree, output: output.slice(0, 400) },
      })
    }
  }

  async #enableStage(session, stage, timeoutMs, signal, ready = {}) {
    const prerequisite = {
      Transformer: () => null,
      'Further transformation': () => (ready.transformer ? null : this.#enablePrerequisite(session, 'Transformer', 'Consensus', timeoutMs, signal)),
      Coordinates: () => (ready.transformer ? null : this.#enablePrerequisite(session, 'Transformer', 'Consensus', timeoutMs, signal)),
      'Plot action': async () => {
        if (!ready.transformer) await this.#enablePrerequisite(session, 'Transformer', 'Consensus', timeoutMs, signal)
        if (!ready.coordinates) await this.#enablePrerequisite(session, 'Coordinates', 'Rectangular', timeoutMs, signal)
      },
    }[stage.category]
    if (!prerequisite) {
      throw new TreeViewerError(ERROR_CODES.INVALID_INPUT, `Modules in category "${stage.category}" cannot be part of a render pipeline.`, {
        details: { supported: [...INTROSPECTABLE] },
      })
    }
    await prerequisite()

    const { output } = await session.exec(`module enable ${stage.module}`, {
      timeoutMs,
      signal,
      onPrompt: (text) => (text.includes(CLI_MESSAGES.pendingUpdates) ? 'I' : 'N'),
    })
    if (CLI_MESSAGES.unknownModule.test(output)) {
      throw new TreeViewerError(ERROR_CODES.MODULE_NOT_FOUND, `Unknown TreeViewer module: ${stage.module}`, {
        hint: 'Call treeviewer_modules to list the installed modules.',
        details: { category: stage.category },
      })
    }
    if (/Ambiguous module selection/.test(output)) {
      throw new TreeViewerError(ERROR_CODES.MODULE_NOT_FOUND, `The module name "${stage.module}" is ambiguous; use its id instead.`, {
        details: { category: stage.category },
      })
    }
    if (/File type modules cannot be enabled|Load file modules cannot be enabled/.test(output)) {
      throw new TreeViewerError(ERROR_CODES.MODULE_ENABLE_FAILED, `"${stage.module}" is a file reader and cannot be added to the pipeline.`, {
        hint: 'Choose a Transformer, Coordinates or Plot action module.',
        details: { category: stage.category },
      })
    }
    if (/can only be enabled once/.test(output)) {
      throw new TreeViewerError(ERROR_CODES.MODULE_ENABLE_FAILED, `"${stage.module}" can only be enabled once per render.`, {
        details: { category: stage.category },
      })
    }
    if (/No Transformer module has been enabled|No Coordinates module has been enabled|No file has been loaded/.test(output)) {
      throw new TreeViewerError(ERROR_CODES.MODULE_ENABLE_FAILED, `Could not enable "${stage.module}": ${output.trim().split('\n').pop()}`, {
        hint: 'The file may not have loaded, or the module needs a preceding pipeline stage.',
        details: { category: stage.category },
      })
    }
    if (isCliException(output)) {
      throw new TreeViewerError(ERROR_CODES.MODULE_ENABLE_FAILED, errorText(output) || `Could not enable "${stage.module}".`, {
        details: { category: stage.category },
      })
    }
    const match = /Options for module (.+?) \(([0-9a-f-]{36})\)/i.exec(output)
    return { name: match ? match[1].trim() : stage.module, id: match ? match[2] : null }
  }

  async #enablePrerequisite(session, category, moduleName, timeoutMs, signal) {
    const { output } = await session.exec(`module enable ${moduleName}`, {
      timeoutMs,
      signal,
      onPrompt: (text) => (text.includes(CLI_MESSAGES.pendingUpdates) ? 'I' : 'N'),
    })
    if (CLI_MESSAGES.unknownModule.test(output) || isCliException(output) || /No file has been loaded/.test(output)) {
      throw new TreeViewerError(
        ERROR_CODES.MODULE_ENABLE_FAILED,
        `TreeViewer could not enable the ${category} module "${moduleName}" required by this pipeline.`,
        { details: { category, module: moduleName, output: output.slice(0, 400) } },
      )
    }
    await this.#update(session, timeoutMs, signal)
  }

  async #applyParameters(session, stage, timeoutMs, signal) {
    for (const [label, value] of Object.entries(stage.parameters)) {
      if (typeof label !== 'string' || /[\r\n]/.test(label)) {
        throw new TreeViewerError(ERROR_CODES.INVALID_INPUT, 'Option names must not contain line breaks.')
      }
      const selected = await session.exec(`option select ${label}`, { timeoutMs, signal })
      if (/Unknown option:/.test(selected.output)) {
        throw new TreeViewerError(ERROR_CODES.OPTION_FAILED, `Module ${stage.module} has no option named "${label}".`, {
          details: { module: stage.module, option: label },
        })
      }
      if (/Ambiguous option selection/.test(selected.output)) {
        throw new TreeViewerError(ERROR_CODES.OPTION_FAILED, `The option name "${label}" is ambiguous.`, {
          details: { module: stage.module, option: label },
        })
      }
      if (!/Selected option #\d+/.test(selected.output)) {
        throw new TreeViewerError(ERROR_CODES.OPTION_FAILED, `Could not select option "${label}" of ${stage.module}.`, {
          details: { module: stage.module, option: label, output: selected.output.slice(0, 300) },
        })
      }
      const applied = await session.exec(`option set ${formatOptionValue(value)}`, { timeoutMs, signal })
      const invalid = CLI_MESSAGES.invalidValue.exec(applied.output)
      if (invalid) {
        throw new TreeViewerError(ERROR_CODES.OPTION_FAILED, invalid[0], {
          details: { module: stage.module, option: label, value: String(value) },
        })
      }
      if (/No option has been selected/.test(applied.output) || isCliException(applied.output)) {
        throw new TreeViewerError(ERROR_CODES.OPTION_FAILED, `Could not set option "${label}" of ${stage.module}.`, {
          details: { module: stage.module, option: label, value: String(value), output: applied.output.slice(0, 300) },
        })
      }
    }
  }

  async #update(session, timeoutMs, signal) {
    const { output } = await session.exec('update', {
      timeoutMs,
      signal,
      onPrompt: (text) => (text.includes(CLI_MESSAGES.pendingUpdates) ? 'I' : 'N'),
    })
    if (isCliException(output)) {
      throw new TreeViewerError(ERROR_CODES.RENDER_FAILED, errorText(output) || 'TreeViewer could not apply the module updates.', {
        details: { output: output.slice(0, 400) },
      })
    }
  }

  async #applyResolution(session, output, timeoutMs, signal) {
    const commands = []
    if (output.dpi !== null) commands.push(`resolution dpi ${output.dpi}`)
    if (output.width !== null) commands.push(`resolution width ${output.width} px`)
    if (output.height !== null) commands.push(`resolution height ${output.height} px`)
    for (const command of commands) {
      const result = await session.exec(command, { timeoutMs, signal })
      if (/Invalid value specified!|Invalid unit specified!/.test(result.output)) {
        throw new TreeViewerError(ERROR_CODES.INVALID_INPUT, `TreeViewer rejected "${command}".`)
      }
      if (/No tree has been loaded!/.test(result.output)) {
        throw new TreeViewerError(ERROR_CODES.EMPTY_PLOT, 'TreeViewer reports that no tree was loaded.', {
          hint: 'Check the tree file format and the modules used to load it.',
        })
      }
    }
  }

  async #captureApplied(session, context) {
    const { normalized, enabled, image, fileHash, trusted, timeoutMs, signal } = context
    const listing = await session.exec('module list enabled', { timeoutMs, signal })
    const modules = parseEnabledModules(listing.output)
    const pipeline = []
    for (const module of modules) {
      const options = {}
      if (INTROSPECTABLE.has(module.category)) {
        await session.exec(`module select #${module.index}`, { timeoutMs, signal })
        const list = await session.exec('option list', { timeoutMs, signal })
        for (const row of parseOptionRows(list.output)) options[row.label] = row.value
      }
      pipeline.push({ category: module.category, name: module.name, id: module.id, options })
    }
    const resolution = parseResolution((await session.exec('resolution', { timeoutMs, signal })).output)
    return {
      schema: 'dsh-treeviewer/settings@1',
      generatedAt: new Date().toISOString(),
      treeviewer: session.version,
      input: { path: normalized.inputFile, sha256: fileHash, trusted },
      requestedStages: normalized.stages.map((stage) => ({
        category: stage.category,
        module: stage.module,
        parameters: { ...stage.parameters },
        implied: stage.implied,
      })),
      pipeline,
      resolution,
      output: {
        format: normalized.output.format,
        path: normalized.output.path,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
      },
      resolvedModules: enabled,
    }
  }
}

export { MODULE_CATEGORIES }
