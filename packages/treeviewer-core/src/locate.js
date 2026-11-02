import fs from 'node:fs'
import path from 'node:path'
import { ERROR_CODES, TreeViewerError } from './errors.js'

export const MODULE_CATEGORIES = Object.freeze([
  'File type',
  'Load file',
  'Transformer',
  'Further transformation',
  'Coordinates',
  'Plot action',
  'Selection action',
  'Action',
  'Menu action',
])

const EXE_NAME = 'TreeViewerCommandLine'

function isWindows(platform) {
  return platform === 'win32'
}

function candidateNames(platform) {
  return isWindows(platform) ? [`${EXE_NAME}.exe`, `${EXE_NAME}.cmd`, EXE_NAME] : [EXE_NAME]
}

function dllNames() {
  return [`${EXE_NAME}.dll`]
}

export function findOnPath(binary, { env = process.env, platform = process.platform, exists = fs.existsSync } = {}) {
  const raw = env.PATH || env.Path || ''
  const separator = isWindows(platform) ? ';' : ':'
  const names = isWindows(platform) && !/\.\w+$/.test(binary) ? [binary, `${binary}.exe`] : [binary]
  for (const entry of raw.split(separator)) {
    const dir = entry.trim().replace(/^"|"$/g, '')
    if (!dir) continue
    for (const name of names) {
      const full = path.join(dir, name)
      try {
        if (exists(full)) return full
      } catch {
        /* unreadable PATH entry */
      }
    }
  }
  return null
}

function defaultPaths(platform, env) {
  if (platform === 'darwin') {
    return [
      '/Applications/TreeViewer.app/Contents/MacOS',
      path.join(env.HOME || '', 'Applications', 'TreeViewer.app', 'Contents', 'MacOS'),
    ]
  }
  if (isWindows(platform)) {
    const roots = [env['ProgramFiles'], env['ProgramFiles(x86)'], env['ProgramW6432'], 'C:\\Program Files', 'C:\\Program Files (x86)']
    const found = []
    for (const root of roots) {
      if (!root) continue
      found.push(path.join(root, 'TreeViewer'))
      found.push(path.join(root, 'TreeViewer 2'))
    }
    return found
  }
  return ['/usr/bin', '/usr/local/bin', '/opt/TreeViewer', '/opt/treeviewer']
}

export function locateCli(options = {}) {
  const {
    cliPath,
    env = process.env,
    platform = process.platform,
    exists = fs.existsSync,
  } = options

  const checked = []

  const acceptFile = (file, source) => {
    checked.push(file)
    try {
      if (!exists(file)) return null
      const stat = fs.statSync(file)
      if (!stat.isFile()) return null
      if (file.toLowerCase().endsWith('.dll')) {
        const dotnet = findOnPath('dotnet', { env, platform, exists })
        if (!dotnet) {
          throw new TreeViewerError(
            ERROR_CODES.CLI_NOT_FOUND,
            `Found the TreeViewer command line assembly at ${file} but no dotnet host on PATH.`,
            { hint: 'Install the .NET 7 runtime or point cliPath at a self-contained TreeViewerCommandLine executable.' },
          )
        }
        return { command: dotnet, args: [file], source, kind: 'dotnet', cliPath: file }
      }
      return { command: file, args: [], source, kind: 'native', cliPath: file }
    } catch (error) {
      if (error instanceof TreeViewerError) throw error
      return null
    }
  }

  if (cliPath) {
    const resolved = path.resolve(cliPath)
    const found = acceptFile(resolved, 'config')
    if (found) return found
    if (!exists(resolved)) {
      throw new TreeViewerError(ERROR_CODES.CLI_NOT_FOUND, `TreeViewer command line not found at the configured path: ${resolved}`, {
        hint: 'Check the cliPath setting or install TreeViewer from https://treeviewer.org/.',
        details: { checked: [resolved] },
      })
    }
    throw new TreeViewerError(ERROR_CODES.CLI_NOT_FOUND, `The configured cliPath is not a file: ${resolved}`, { details: { checked: [resolved] } })
  }

  const fromEnv = env.TREEVIEWER_CLI
  if (fromEnv) {
    const found = acceptFile(path.resolve(fromEnv), 'env:TREEVIEWER_CLI')
    if (found) return found
  }

  const pathHit = findOnPath(EXE_NAME, { env, platform, exists })
  if (pathHit) {
    const found = acceptFile(pathHit, 'PATH')
    if (found) return found
  }

  for (const dir of defaultPaths(platform, env)) {
    if (!dir) continue
    for (const name of candidateNames(platform)) {
      const found = acceptFile(path.join(dir, name), 'default')
      if (found) return found
    }
  }

  for (const dir of defaultPaths(platform, env)) {
    if (!dir) continue
    for (const name of dllNames()) {
      const found = acceptFile(path.join(dir, name), 'default')
      if (found) return found
    }
  }

  throw new TreeViewerError(
    ERROR_CODES.CLI_NOT_FOUND,
    'Could not find the TreeViewer command line executable.',
    {
      hint:
        'Install TreeViewer (https://treeviewer.org/) or set the cliPath plugin option (or the TREEVIEWER_CLI environment variable) to the TreeViewerCommandLine binary.',
      details: { platform, searched: checked },
    },
  )
}
