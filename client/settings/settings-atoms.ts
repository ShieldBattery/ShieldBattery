import { atom } from 'jotai'
import { SbUserId } from '../../common/users/sb-user-id'

/**
 * True once the app's local settings have loaded and no game defaults preset has been chosen yet,
 * until the first-run dialog prompting for one has been opened.
 */
export const gameDefaultsChoicePendingAtom = atom<boolean>(false)

/**
 * The user whose account settings the server has delivered to this session. Until then the account
 * settings hold defaults or a cached copy, which can't tell "never answered" from "not loaded yet".
 */
export const accountSettingsSyncedUserAtom = atom<SbUserId | undefined>(undefined)
