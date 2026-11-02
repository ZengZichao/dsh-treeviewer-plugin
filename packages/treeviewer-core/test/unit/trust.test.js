import test from 'node:test'
import assert from 'node:assert/strict'
import { createTrustPolicy } from '../../src/index.js'

const SOURCE_PROMPT =
  'Attention! The selected file contains source code and its signature does not match any known keys. Do you want to load and compile it? [Y(es)/N(o)] '
const KEY_PROMPT = "Would you like to add the file's public key to the local storage? [Y(es)/N(o)] "
const SUGGEST_PROMPT = '  Would you like to load the suggested modules? [Y(es)/N(o)] '
const UPDATE_PROMPT =
  'The state of some modules needs to be updated! Do you want to update them? [Y(es)/N(o)/I( know what I\'m doing, never ask again)] '

test('suggested modules are declined so the engine controls the pipeline', () => {
  const policy = createTrustPolicy()
  assert.equal(policy.answer(SUGGEST_PROMPT), 'N')
  assert.equal(policy.state.refused, false)
})

test('pending module updates proceed without further questions', () => {
  const policy = createTrustPolicy()
  assert.equal(policy.answer(UPDATE_PROMPT), 'I')
})

test('unsigned source is refused by default and records the refusal', () => {
  const policy = createTrustPolicy()
  assert.equal(policy.answer(SOURCE_PROMPT, { fileHash: 'a'.repeat(64) }), 'N')
  assert.equal(policy.state.refused, true)
  assert.equal(policy.state.trusted, false)
  assert.deepEqual(policy.state.prompts, [{ prompt: 'source-trust', answer: 'N' }])
})

test('an allow-listed hash unlocks the source prompt', () => {
  const hash = 'b'.repeat(64)
  const policy = createTrustPolicy({ allowHashes: [hash] })
  assert.equal(policy.answer(SOURCE_PROMPT, { fileHash: hash }), 'Y')
  assert.equal(policy.state.trusted, true)
  assert.equal(policy.state.refused, false)
})

test('path trust matches an exact resolved path', () => {
  const policy = createTrustPolicy({ allowFiles: ['/data/trusted.tbi'] })
  assert.equal(policy.answer(SOURCE_PROMPT, { filePath: '/data/trusted.tbi' }), 'Y')
  const other = createTrustPolicy({ allowFiles: ['/data/trusted.tbi'] })
  assert.equal(other.answer(SOURCE_PROMPT, { filePath: '/data/other.tbi' }), 'N')
})

test('the public-key prompt only answers yes when remembering keys for a trusted file', () => {
  const strict = createTrustPolicy({ allowHashes: ['c'.repeat(64)], rememberKeys: false })
  strict.answer(SOURCE_PROMPT, { fileHash: 'c'.repeat(64) })
  assert.equal(strict.answer(KEY_PROMPT), 'N')

  const remembering = createTrustPolicy({ allowHashes: ['c'.repeat(64)], rememberKeys: true })
  remembering.answer(SOURCE_PROMPT, { fileHash: 'c'.repeat(64) })
  assert.equal(remembering.answer(KEY_PROMPT), 'Y')
})

test('unknown prompts are declined', () => {
  const policy = createTrustPolicy()
  assert.equal(policy.answer('Do you wish to proceed anyways? [Y(es)/N(o)] '), 'N')
  assert.deepEqual(policy.state.prompts, [{ prompt: 'unclassified', answer: 'N' }])
})
