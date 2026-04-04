type Listener = (event: { data?: unknown; error?: unknown }) => void

export class BroadcastChannel {
  name: string
  onmessage: Listener | null
  #listeners: Listener[]

  constructor(name: string) {
    this.name = name
    this.onmessage = null
    this.#listeners = []
  }

  addEventListener(_type: string, listener: Listener) {
    this.#listeners.push(listener)
  }

  removeEventListener(_type: string, listener: Listener) {
    this.#listeners = this.#listeners.filter((candidate) => candidate !== listener)
  }

  postMessage(data: unknown) {
    const event = { data }
    this.onmessage?.(event)
    for (const listener of this.#listeners) {
      listener(event)
    }
  }

  close() {
    this.#listeners = []
    this.onmessage = null
  }
}
