import { atom, Getter, Setter } from 'jotai'
import { observe } from 'jotai-effect'
import { jotaiStore } from '../jotai-store'

export const isConnectedAtom = atom<boolean>(false)

export type Effect = (get: Getter, set: Setter) => void

/** Runs a jotai store update whenever the socket becomes connected. */
export function updateOnConnect(updater: Effect) {
  return observe((get, set) => {
    const isConnected = get(isConnectedAtom)
    // This only runs on changes, so if we're connected it means we *just* connected
    if (isConnected) {
      updater(get, set)
    }
  }, jotaiStore)
}
