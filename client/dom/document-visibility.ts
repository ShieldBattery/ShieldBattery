import { useSyncExternalStore } from 'react'

function subscribe(onStoreChange: () => void): () => void {
  document.addEventListener('visibilitychange', onStoreChange)
  return () => document.removeEventListener('visibilitychange', onStoreChange)
}

function getSnapshot(): boolean {
  return document.visibilityState === 'visible'
}

/**
 * Hook that returns whether the document is currently visible. This is distinct from window focus:
 * an unfocused window that is still on screen remains visible. The document only becomes hidden
 * when the window is minimized or fully occluded by other windows (e.g. by the game).
 *
 * While the document is hidden, the browser stops delivering animation frames entirely, so any
 * rAF-driven animation started in that state will not progress (and timers are throttled to ~1/s).
 * Use this to skip animations that something else is waiting on — e.g. an unmount that only
 * happens once an exit animation completes.
 */
export function useIsDocumentVisible(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot)
}
