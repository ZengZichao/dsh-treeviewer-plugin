import crypto from 'node:crypto'
import fs from 'node:fs'
import { CLI_MESSAGES } from './parse.js'

export function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(file)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export function createTrustPolicy(options = {}) {
  const allowHashes = new Set((options.allowHashes || []).map((value) => String(value).toLowerCase()))
  const allowFiles = new Set((options.allowFiles || []).map((value) => String(value)))
  const rememberKeys = options.rememberKeys === true
  const state = { refused: false, trusted: false, prompts: [] }

  return {
    state,
    answer(text, context = {}) {
      const prompt = String(text)
      if (prompt.includes(CLI_MESSAGES.suggestedModules)) return 'N'
      if (prompt.includes(CLI_MESSAGES.pendingUpdates)) return 'I'
      if (prompt.includes(CLI_MESSAGES.sourceTrust)) {
        const hash = context.fileHash ? String(context.fileHash).toLowerCase() : ''
        const trusted = (hash && allowHashes.has(hash)) || (context.filePath && allowFiles.has(String(context.filePath)))
        state.prompts.push({ prompt: 'source-trust', answer: trusted ? 'Y' : 'N' })
        if (!trusted) {
          state.refused = true
          return 'N'
        }
        state.trusted = true
        return 'Y'
      }
      if (prompt.includes(CLI_MESSAGES.addPublicKey)) {
        const answer = rememberKeys && state.trusted ? 'Y' : 'N'
        state.prompts.push({ prompt: 'add-public-key', answer })
        return answer
      }
      state.prompts.push({ prompt: 'unclassified', answer: 'N' })
      return 'N'
    },
  }
}
