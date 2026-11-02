/** @typedef {{ cliPath: string, workDir: string, trustAllow: string[], trustRememberKeys: boolean, commandTimeoutMs: number, introspectionTimeoutMs: number, idleTimeoutMs: number }} PluginConfig */

function issue(message, path) {
  return path === undefined ? { message } : { message, path: [path] }
}

function stringField(value, fallback, name, issues) {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string') {
    issues.push(issue(`${name} must be a string`, name))
    return fallback
  }
  return value.trim()
}

function positiveNumber(value, fallback, name, issues) {
  if (value === undefined || value === null) return fallback
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) {
    issues.push(issue(`${name} must be a positive number`, name))
    return fallback
  }
  return number
}

/**
 * StandardSchemaV1 validator; Cordis runs it before apply().
 * Every key can be overridden from cordis.patch.yml.
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-treeviewer',
    validate(value) {
      if (value === undefined || value === null) value = {}
      if (typeof value !== 'object' || Array.isArray(value)) {
        return { issues: [issue('插件配置必须是一个对象 / plugin config must be an object')] }
      }
      const issues = []
      const trust = value.trust && typeof value.trust === 'object' && !Array.isArray(value.trust) ? value.trust : {}
      const allow = []
      if (trust.allow !== undefined) {
        if (!Array.isArray(trust.allow)) {
          issues.push(issue('trust.allow must be an array of SHA-256 hashes or file paths', 'trust.allow'))
        } else {
          for (const entry of trust.allow) {
            if (typeof entry !== 'string' || entry.trim() === '') {
              issues.push(issue('trust.allow entries must be non-empty strings', 'trust.allow'))
            } else {
              allow.push(entry.trim())
            }
          }
        }
      }
      const normalized = {
        cliPath: stringField(value.cliPath, '', 'cliPath', issues),
        workDir: stringField(value.workDir, '', 'workDir', issues),
        trustAllow: allow,
        trustRememberKeys: trust.rememberKeys === true,
        commandTimeoutMs: positiveNumber(value.commandTimeoutMs, 300000, 'commandTimeoutMs', issues),
        introspectionTimeoutMs: positiveNumber(value.introspectionTimeoutMs, 120000, 'introspectionTimeoutMs', issues),
        idleTimeoutMs: value.idleTimeoutMs === 0 ? 0 : positiveNumber(value.idleTimeoutMs, 300000, 'idleTimeoutMs', issues),
      }
      if (issues.length > 0) return { issues }
      return { value: normalized }
    },
  },
}

export function toEngineConfig(config, logger) {
  return {
    cliPath: config.cliPath || undefined,
    workDir: config.workDir || undefined,
    ...(logger ? { logger } : {}),
    trust: { allow: config.trustAllow, rememberKeys: config.trustRememberKeys },
    timeouts: { commandMs: config.commandTimeoutMs, introspectionMs: config.introspectionTimeoutMs },
    idleTimeoutMs: config.idleTimeoutMs,
  }
}
