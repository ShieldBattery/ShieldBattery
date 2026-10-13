import { atom } from 'jotai'
import { ReplaySessionPlaybackControl } from '../../common/games/game-launch-config'
import { ReplaySessionInviteJson, ReplaySessionJson } from '../../common/replay-sessions'
import { CommonTextMessage } from '../messaging/message-records'

/** The replay session this client is in, as of the newest snapshot the server sent. */
export const replaySessionAtom = atom<ReplaySessionJson | undefined>(undefined)

/** Chat sent in the current replay session since this client joined it. */
export const replaySessionChatAtom = atom<CommonTextMessage[]>([])

/** Every replay session invite the local user currently holds. */
export const replaySessionInvitesAtom = atom<ReplaySessionInviteJson[]>([])

export interface ReplaySessionGame {
  gameId: string
  /** The hash the replay's bytes were verified against. */
  hash: string
  /** Whether the game has loaded the replay and is holding it at the start. */
  ready: boolean
  /** The playback state last sent to the game, so it is only sent again when it changes. */
  playback?: ReplaySessionPlaybackControl
}

/** The local game launched to play the current session's replay. */
export const replaySessionGameAtom = atom<ReplaySessionGame | undefined>(undefined)
