import { atom } from 'jotai'

/**
 * True once the app's local settings have loaded and no game defaults preset has been chosen yet,
 * until the first-run dialog prompting for one has been opened.
 */
export const gameDefaultsChoicePendingAtom = atom<boolean>(false)
