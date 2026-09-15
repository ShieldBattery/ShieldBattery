import { atom } from 'jotai'
import { SbUserId } from '../../common/users/sb-user-id'

/**
 * The user who most recently whispered this user, i.e. who `/reply` (`/r`) sends to. Updated on
 * every incoming whisper that isn't from a blocked user, so a reply always reaches whoever wrote
 * most recently rather than whoever this user last answered. Cleared on logout, since a reply
 * target belongs to the account that was whispered.
 */
export const lastWhisperSenderAtom = atom<SbUserId | undefined>(undefined)
