import crypto from 'node:crypto'

/** Bounded in-memory registry of renders the browser half can fetch by id. */
export class RenderStore {
  #items = new Map()

  constructor(limit = 24) {
    this.limit = limit
  }

  add(result) {
    const id = crypto.randomUUID()
    this.#items.set(id, { id, createdAt: Date.now(), ...result })
    while (this.#items.size > this.limit) {
      const oldest = this.#items.keys().next().value
      this.#items.delete(oldest)
    }
    return id
  }

  get(id) {
    return this.#items.get(id)
  }
}
