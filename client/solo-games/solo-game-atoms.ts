import { atom } from 'jotai'

/**
 * Whether this client has asked for a solo game and is waiting to hear how its launch turned out,
 * with the "Launching game…" dialog up for it.
 */
export const soloLaunchPendingAtom = atom(false)
