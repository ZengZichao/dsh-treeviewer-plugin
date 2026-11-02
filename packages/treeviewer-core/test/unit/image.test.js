import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ERROR_CODES } from '../../src/errors.js'
import { assertRendered, inspectOutput, mediaTypeFor } from '../../src/index.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-image-'))
test.after(() => fs.rmSync(root, { recursive: true, force: true }))

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function writePng(name, width, height) {
  const buffer = Buffer.alloc(41)
  PNG_SIGNATURE.copy(buffer, 0)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  const file = path.join(root, name)
  fs.writeFileSync(file, buffer)
  return file
}

test('inspectOutput reads PNG dimensions from IHDR', () => {
  const file = writePng('ok.png', 640, 480)
  const info = inspectOutput(file, 'png')
  assert.equal(info.width, 640)
  assert.equal(info.height, 480)
  assert.equal(info.valid, true)
})

test('a placeholder-sized PNG is reported as EMPTY_PLOT', () => {
  const file = writePng('tiny.png', 4, 4)
  assert.throws(() => assertRendered(file, 'png'), (error) => {
    assert.equal(error.code, ERROR_CODES.EMPTY_PLOT)
    assert.match(error.hint, /Plot action/)
    return true
  })
})

test('a file that is not a PNG is rejected', () => {
  const file = path.join(root, 'fake.png')
  fs.writeFileSync(file, 'this is not a png')
  assert.throws(() => assertRendered(file, 'png'), (error) => error.code === ERROR_CODES.RENDER_FAILED)
})

test('a missing output file is reported as OUTPUT_NOT_WRITTEN', () => {
  assert.throws(() => assertRendered(path.join(root, 'absent.png'), 'png'), (error) => error.code === ERROR_CODES.OUTPUT_NOT_WRITTEN)
})

test('an empty output file is reported as OUTPUT_NOT_WRITTEN', () => {
  const file = path.join(root, 'empty.svg')
  fs.writeFileSync(file, '')
  assert.throws(() => assertRendered(file, 'svg'), (error) => error.code === ERROR_CODES.OUTPUT_NOT_WRITTEN)
})

test('SVG dimensions fall back to the viewBox', () => {
  const file = path.join(root, 'drawing.svg')
  fs.writeFileSync(file, '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 158.4 376.32" version="1.1"><g/></svg>')
  const info = inspectOutput(file, 'svg')
  assert.deepEqual({ w: info.width, h: info.height, valid: info.valid }, { w: 158, h: 376, valid: true })
  assert.doesNotThrow(() => assertRendered(file, 'svg'))
})

test('PDF and TIFF magic numbers are validated', () => {
  const pdf = path.join(root, 'x.pdf')
  fs.writeFileSync(pdf, '%PDF-1.7\n%...')
  assert.equal(inspectOutput(pdf, 'pdf').valid, true)

  const tiff = path.join(root, 'x.tiff')
  fs.writeFileSync(tiff, Buffer.from([0x49, 0x49, 0x2a, 0x00, 0, 0, 0, 0]))
  assert.equal(inspectOutput(tiff, 'tiff').valid, true)

  const broken = path.join(root, 'broken.tiff')
  fs.writeFileSync(broken, Buffer.from([1, 2, 3, 4]))
  assert.equal(inspectOutput(broken, 'tiff').valid, false)
})

test('mediaTypeFor maps every supported format', () => {
  assert.equal(mediaTypeFor('png'), 'image/png')
  assert.equal(mediaTypeFor('svg'), 'image/svg+xml')
  assert.equal(mediaTypeFor('pdf'), 'application/pdf')
  assert.equal(mediaTypeFor('tiff'), 'image/tiff')
})
