import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { ERROR_CODES, TreeViewerError } from './errors.js'

const ANSI_RE = /\x1B(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07]*\x07)/g
const REPL_PROMPT_RE = /(?:^|\n)>$/
const ASK_PROMPT_RE = /\[Y\(es\)\/N\(o\)(?:[^\]]*)\] ?$/
const MAX_PROMPTS = 6

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function stripAnsi(text) {
  return String(text).replace(ANSI_RE, '')
}

export function isReplPrompt(text) {
  return REPL_PROMPT_RE.test(text)
}

export function isAskPrompt(text) {
  return ASK_PROMPT_RE.test(text)
}

export function lastPromptText(buffer, limit = 600) {
  const text = stripAnsi(buffer).split('\n').filter((line) => line.trim() !== '').join('\n')
  return text.length > limit ? text.slice(-limit) : text
}

function cleanOutput(raw, command) {
  let text = stripAnsi(raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (text.startsWith('>')) text = text.slice(1)
  if (text.startsWith(command)) {
    const rest = text.slice(command.length)
    text = rest.startsWith('\n') ? rest.slice(1) : rest
  }
  text = text.replace(/\n>$/, '')
  return text.replace(/^\n+/, '').replace(/\s+$/, '')
}

export class CliSession {
  #child = null
  #buffer = ''
  #transcript = ''
  #waiter = null
  #decoderOut = new StringDecoder('utf8')
  #decoderErr = new StringDecoder('utf8')
  #exitInfo = null
  #version = null

  constructor(options = {}) {
    const {
      command,
      args = [],
      cwd = process.cwd(),
      env = process.env,
      defaultTimeoutMs = 120000,
      startupTimeoutMs = 45000,
      settleMs = 35,
      logger = null,
    } = options
    if (!command) throw new TreeViewerError(ERROR_CODES.CLI_START_FAILED, 'No TreeViewer command line executable was resolved.')
    this.command = command
    this.args = args
    this.cwd = cwd
    this.env = env
    this.defaultTimeoutMs = defaultTimeoutMs
    this.startupTimeoutMs = startupTimeoutMs
    this.settleMs = settleMs
    this.logger = logger
  }

  get running() {
    return Boolean(this.#child) && this.#child.exitCode === null && !this.#exitInfo
  }

  get version() {
    return this.#version
  }

  start() {
    if (this.running) return Promise.resolve(this)
    if (this.#child) this.#child = null
    this.#exitInfo = null
    this.#buffer = ''
    this.#transcript = ''

    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.env, NO_COLOR: '1' },
    })
    this.#child = child
    child.stdout.on('data', (chunk) => this.#append(this.#decoderOut.write(chunk)))
    child.stderr.on('data', (chunk) => this.#append(this.#decoderErr.write(chunk)))
    child.stdin.on('error', () => {})
    child.on('error', (error) => {
      this.#exitInfo = { code: null, signal: null, error }
      this.#rejectWaiter(
        new TreeViewerError(ERROR_CODES.CLI_START_FAILED, `Failed to start TreeViewer: ${error.message}`, {
          hint: 'Check the cliPath plugin option.',
          cause: error,
        }),
      )
    })
    child.on('exit', (code, signal) => {
      this.#exitInfo = { code, signal }
      this.#rejectWaiter(
        new TreeViewerError(ERROR_CODES.CLI_EXITED, `TreeViewer exited unexpectedly (code ${code}, signal ${signal}).`, {
          transcript: cleanOutput(this.#transcript + this.#buffer, ''),
        }),
      )
    })

    return this.#waitSettled(isReplPrompt, Date.now() + this.startupTimeoutMs, 'startup banner', null).then(() => {
      const banner = stripAnsi(this.#buffer)
      const match = /TreeViewer v([\w.-]+) \(command-line v([\w.-]+)\)/.exec(banner)
      if (match) this.#version = { treeviewer: match[1], commandLine: match[2] }
      return this
    })
  }

  async exec(command, options = {}) {
    const { timeoutMs = this.defaultTimeoutMs, signal = null, onPrompt = null } = options
    if (signal?.aborted) throw this.#cancelled()

    if (!this.running) await this.start()
    const deadline = Date.now() + timeoutMs

    await this.#waitSettled(isReplPrompt, deadline, 'command prompt', signal)

    this.#buffer = ''
    this.#transcript = ''
    this.#write(command)

    const prompts = []
    for (let index = 0; index <= MAX_PROMPTS; index += 1) {
      await this.#waitSettled(
        (buffer) => isReplPrompt(buffer) || isAskPrompt(buffer),
        deadline,
        `response to "${command}"`,
        signal,
      )
      if (!isAskPrompt(this.#buffer)) break
      const promptText = lastPromptText(this.#buffer)
      const answer = onPrompt ? await onPrompt(promptText, { command, prompts }) : 'N'
      if (!answer || !/^[A-Za-z]$/.test(answer)) {
        throw new TreeViewerError(ERROR_CODES.INTERNAL, `Invalid answer "${answer}" for an interactive prompt.`, {
          details: { command, prompt: promptText },
        })
      }
      prompts.push({ prompt: promptText, answer })
      this.#transcript += this.#buffer
      this.#buffer = ''
      this.#write(answer)
    }

    const raw = this.#transcript + this.#buffer
    this.#transcript = ''
    const output = cleanOutput(raw, command)
    this.logger?.debug?.('[treeviewer-core] cli command', { command, prompts: prompts.map((p) => p.answer) })
    return { command, output, raw, prompts }
  }

  async stop() {
    const child = this.#child
    if (!child) return
    if (child.exitCode === null) {
      try {
        child.stdin.write('exit\n')
      } catch {
        /* stdin already closed */
      }
      for (let i = 0; i < 40 && child.exitCode === null; i += 1) await sleep(25)
      if (child.exitCode === null) child.kill()
    }
    this.#child = null
    this.#buffer = ''
    this.#transcript = ''
  }

  kill() {
    const child = this.#child
    this.#child = null
    if (child && child.exitCode === null) {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
    }
  }

  #cancelled() {
    return new TreeViewerError(ERROR_CODES.CANCELLED, 'The TreeViewer operation was cancelled.')
  }

  #write(text) {
    const child = this.#child
    if (!child || child.exitCode !== null) {
      throw new TreeViewerError(ERROR_CODES.CLI_EXITED, 'TreeViewer is not running.')
    }
    child.stdin.write(`${text}\n`)
  }

  #append(text) {
    if (!text) return
    this.#buffer += text
    const waiter = this.#waiter
    if (waiter && waiter.predicate(this.#buffer)) {
      this.#waiter = null
      clearTimeout(waiter.timer)
      waiter.resolve()
    }
  }

  #rejectWaiter(error) {
    const waiter = this.#waiter
    if (!waiter) return
    this.#waiter = null
    clearTimeout(waiter.timer)
    waiter.reject(error)
  }

  #wait(predicate, timeoutMs, description, signal) {
    if (this.#exitInfo) {
      return Promise.reject(
        this.#exitInfo.error instanceof TreeViewerError
          ? this.#exitInfo.error
          : new TreeViewerError(ERROR_CODES.CLI_EXITED, `TreeViewer exited (code ${this.#exitInfo.code}) while waiting for ${description}.`),
      )
    }
    if (predicate(this.#buffer)) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiter = null
        reject(
          new TreeViewerError(ERROR_CODES.TIMEOUT, `Timed out after ${timeoutMs} ms while waiting for ${description}.`, {
            hint: 'Large trees take longer; raise the timeout option or simplify the pipeline.',
            transcript: cleanOutput(this.#transcript + this.#buffer, ''),
          }),
        )
      }, Math.max(1, timeoutMs))
      const onAbort = () => {
        this.#waiter = null
        clearTimeout(timer)
        this.kill()
        reject(this.#cancelled())
      }
      if (signal) {
        if (signal.aborted) {
          this.kill()
          clearTimeout(timer)
          reject(this.#cancelled())
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      this.#waiter = {
        predicate,
        resolve: () => {
          if (signal) signal.removeEventListener('abort', onAbort)
          resolve()
        },
        reject,
        timer,
      }
    })
  }

  async #waitSettled(predicate, deadline, description, signal) {
    for (;;) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        throw new TreeViewerError(ERROR_CODES.TIMEOUT, `Timed out while waiting for ${description}.`, {
          transcript: cleanOutput(this.#transcript + this.#buffer, ''),
        })
      }
      await this.#wait(predicate, remaining, description, signal)
      const size = this.#buffer.length
      await sleep(this.settleMs)
      if (this.#buffer.length === size) return
    }
  }
}
