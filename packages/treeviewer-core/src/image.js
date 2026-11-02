import fs from 'node:fs'
import { ERROR_CODES, TreeViewerError } from './errors.js'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const EMPTY_SIDE_LIMIT = 8

function readHead(file, length) {
  const fd = fs.openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const read = fs.readSync(fd, buffer, 0, length, 0)
    return buffer.subarray(0, read)
  } finally {
    fs.closeSync(fd)
  }
}

function pngSize(head) {
  if (head.length < 24 || !head.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  if (head.subarray(12, 16).toString('ascii') !== 'IHDR') return null
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
}

export function inspectOutput(file, format, { bytes } = {}) {
  const stat = fs.statSync(file)
  const size = bytes ?? stat.size
  const result = { bytes: size, width: null, height: null, valid: false }
  if (format === 'png') {
    const sizeInfo = pngSize(readHead(file, 32))
    if (!sizeInfo) return result
    result.width = sizeInfo.width
    result.height = sizeInfo.height
    result.valid = size > 0
    return result
  }
  if (format === 'svg') {
    const head = readHead(file, 8192).toString('utf8')
    const tag = /<svg[^>]*>/i.exec(head)
    if (tag) {
      const width = /\bwidth="([\d.]+)/i.exec(tag[0])
      const height = /\bheight="([\d.]+)/i.exec(tag[0])
      if (width) result.width = Number(width[1])
      if (height) result.height = Number(height[1])
      if (!width || !height) {
        const viewBox = /\bviewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/i.exec(tag[0])
        if (viewBox) {
          result.width = Math.round(Number(viewBox[1]))
          result.height = Math.round(Number(viewBox[2]))
        }
      }
    }
    result.valid = size > 0 && /<svg[\s>]/i.test(head)
    return result
  }
  if (format === 'pdf') {
    result.valid = size > 0 && readHead(file, 5).toString('ascii') === '%PDF-'
    return result
  }
  if (format === 'tiff') {
    const head = readHead(file, 4)
    const littleEndian = head.length === 4 && head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a && head[3] === 0x00
    const bigEndian = head.length === 4 && head[0] === 0x4d && head[1] === 0x4d && head[2] === 0x00 && head[3] === 0x2a
    result.valid = size > 0 && (littleEndian || bigEndian)
    return result
  }
  result.valid = size > 0
  return result
}

export function assertRendered(file, format) {
  let stat
  try {
    stat = fs.statSync(file)
  } catch {
    throw new TreeViewerError(ERROR_CODES.OUTPUT_NOT_WRITTEN, `TreeViewer did not write the expected ${format.toUpperCase()} file.`, {
      hint: 'Check that the output directory is writable and the pipeline contains at least one plot action.',
      details: { output: file },
    })
  }
  if (!stat.isFile() || stat.size === 0) {
    throw new TreeViewerError(ERROR_CODES.OUTPUT_NOT_WRITTEN, `TreeViewer wrote an empty ${format.toUpperCase()} file.`, {
      details: { output: file },
    })
  }
  const info = inspectOutput(file, format, { bytes: stat.size })
  if (!info.valid) {
    throw new TreeViewerError(ERROR_CODES.RENDER_FAILED, `The ${format.toUpperCase()} file is not a valid ${format.toUpperCase()} document.`, {
      details: { output: file, bytes: stat.size },
    })
  }
  if (info.width !== null && info.height !== null && info.width <= EMPTY_SIDE_LIMIT && info.height <= EMPTY_SIDE_LIMIT) {
    throw new TreeViewerError(ERROR_CODES.EMPTY_PLOT, `TreeViewer produced an empty ${info.width}x${info.height} plot.`, {
      hint: 'Enable at least one Plot action module (for example Branches and Labels) and check that the tree file actually loaded.',
      details: { output: file, width: info.width, height: info.height },
    })
  }
  return info
}

export function mediaTypeFor(format) {
  switch (format) {
    case 'png':
      return 'image/png'
    case 'svg':
      return 'image/svg+xml'
    case 'pdf':
      return 'application/pdf'
    case 'tiff':
      return 'image/tiff'
    default:
      return 'application/octet-stream'
  }
}
