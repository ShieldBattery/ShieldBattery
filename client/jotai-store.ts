import { createStore } from 'jotai'

let store: ReturnType<typeof createStore> | undefined

export function getJotaiStore() {
  if (!store) {
    store = createStore()
  }
  return store
}
