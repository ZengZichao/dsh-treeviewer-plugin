export const ERROR_CODES = Object.freeze({
  CLI_NOT_FOUND: 'CLI_NOT_FOUND',
  CLI_START_FAILED: 'CLI_START_FAILED',
  CLI_EXITED: 'CLI_EXITED',
  MODULES_NOT_INSTALLED: 'MODULES_NOT_INSTALLED',
  INPUT_NOT_FOUND: 'INPUT_NOT_FOUND',
  UNSUPPORTED_FILE: 'UNSUPPORTED_FILE',
  TRUST_REQUIRED: 'TRUST_REQUIRED',
  MODULE_NOT_FOUND: 'MODULE_NOT_FOUND',
  MODULE_ENABLE_FAILED: 'MODULE_ENABLE_FAILED',
  OPTION_FAILED: 'OPTION_FAILED',
  RENDER_FAILED: 'RENDER_FAILED',
  EMPTY_PLOT: 'EMPTY_PLOT',
  OUTPUT_NOT_WRITTEN: 'OUTPUT_NOT_WRITTEN',
  UNSUPPORTED_OUTPUT: 'UNSUPPORTED_OUTPUT',
  TIMEOUT: 'TIMEOUT',
  CANCELLED: 'CANCELLED',
  INVALID_INPUT: 'INVALID_INPUT',
  INTERNAL: 'INTERNAL',
})

export class TreeViewerError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined)
    this.name = 'TreeViewerError'
    this.code = code
    this.hint = options.hint
    this.details = options.details
    this.transcript = options.transcript
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.hint ? { hint: this.hint } : {}),
      ...(this.details ? { details: this.details } : {}),
    }
  }
}

export function toErrorPayload(error) {
  if (error instanceof TreeViewerError) return error.toJSON()
  return {
    code: ERROR_CODES.INTERNAL,
    message: error && error.message ? error.message : String(error),
  }
}

export function failure(error) {
  return { ok: false, error: toErrorPayload(error) }
}

export function isAbortError(error) {
  return Boolean(error) && (error.name === 'AbortError' || error.code === ERROR_CODES.CANCELLED)
}
