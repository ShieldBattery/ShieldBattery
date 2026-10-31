import { useAtomValue } from 'jotai'
import { ReadonlyDeep } from 'type-fest'
import { GameStatusString } from '../../common/games/game-status'
import { findSlotByUserId, getPlayerSlots, Lobby, openSlotCount } from '../../common/lobbies'
import { LobbyVisibility } from '../../common/lobbies/lobby-visibility'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { SlotType } from '../../common/lobbies/slot'
import { RaceChar } from '../../common/races'
import { SbUserId } from '../../common/users/sb-user-id'
import { GameClientState, isInParticipatingGame } from '../active-game/game-client-reducer'
import { useSelfUser } from '../auth/auth-utils'
import {
  participatingGameAtom,
  ParticipatingGameInfo,
  watchedReplayAtom,
  WatchedReplayInfo,
} from '../games/game-atoms'
import { isInLobby } from '../lobbies/lobby-reducer'
import { useAppSelector } from '../redux-hooks'

/** A game the user takes part in, while it's being played. */
export interface GameActivity {
  kind: 'game'
  game: ParticipatingGameInfo
  /** The user's own slot in the game. */
  ownSlot: ParticipatingGameInfo['slots'][number] | undefined
}

/** The lobby the user is in. */
export interface LobbyActivity {
  kind: 'lobby'
  id: SbLobbyId
  name: string
  visibility: LobbyVisibility
  /** The players seated in the lobby, computers included. Observers don't count. */
  playerCount: number
  /** The slots someone could still join as a player. Closed slots don't count. */
  openSlots: number
  /** Whether the lobby's game is loading or running, which makes the lobby unjoinable. */
  inGame: boolean
  mapName?: string
  mapImageUrl?: string
  /** The race picked in the user's slot, or `undefined` while they observe. */
  ownRace?: RaceChar
  /** Whether the user is in one of the lobby's observer slots. */
  observing: boolean
}

/** A replay the user is watching, while it's being played. */
export interface ReplayActivity {
  kind: 'replay'
  /** The map the replay was played on, if its header could be read. */
  mapName?: string
}

/**
 * What the user is doing in the app, for showing it outside the app (e.g. as Discord Rich
 * Presence). Each place that shows it decides how, and whether the user agreed to it.
 */
export type CurrentActivity = GameActivity | LobbyActivity | ReplayActivity

/** The app state the user's current activity is worked out from. */
export interface CurrentActivityState {
  /** The logged-in user, or `undefined` while nobody is logged in. */
  userId: SbUserId | undefined
  /** The lobby the user is in, if any. */
  lobby: Lobby | undefined
  /** Whether the lobby's game is running. */
  lobbyRunning: boolean
  gameClient: ReadonlyDeep<GameClientState>
  participatingGame: ParticipatingGameInfo | undefined
  watchedReplay: WatchedReplayInfo | undefined
}

/** The states in which a game counts as being played, the score screen included. */
const PLAYED_GAME_STATES: ReadonlySet<GameStatusString> = new Set([
  'playing',
  'hasResult',
  'resultSent',
])

/**
 * Returns what the user is doing, or `undefined` if they're logged out or doing none of these. A
 * game the user takes part in comes before the lobby it started from, and either comes before a
 * replay watched at the same time.
 */
export function getCurrentActivity(state: CurrentActivityState): CurrentActivity | undefined {
  const { userId, lobby, gameClient, participatingGame, watchedReplay } = state
  if (userId === undefined) {
    return undefined
  }

  if (
    participatingGame &&
    gameClient.gameId === participatingGame.gameId &&
    gameClient.status &&
    PLAYED_GAME_STATES.has(gameClient.status.state)
  ) {
    return {
      kind: 'game',
      game: participatingGame,
      ownSlot: participatingGame.slots.find(slot => slot.userId === userId),
    }
  }

  if (lobby) {
    const [, , ownSlot] = findSlotByUserId(lobby, userId)
    const observing = ownSlot?.type === SlotType.Observer
    return {
      kind: 'lobby',
      id: lobby.id,
      name: lobby.name,
      visibility: lobby.visibility,
      playerCount: getPlayerSlots(lobby).length,
      openSlots: openSlotCount(lobby),
      inGame: state.lobbyRunning || isInParticipatingGame(gameClient),
      mapName: lobby.map?.name,
      mapImageUrl: lobby.map?.image1024Url ?? lobby.map?.image512Url,
      ownRace: ownSlot && !observing ? ownSlot.race : undefined,
      observing,
    }
  }

  if (Object.values(gameClient.watchOnly).some(status => status.state === 'playing')) {
    // Several replays can run at once, but only the one started last is known by its map.
    const watchedReplayPlaying =
      watchedReplay !== undefined && gameClient.watchOnly[watchedReplay.gameId]?.state === 'playing'
    return { kind: 'replay', mapName: watchedReplayPlaying ? watchedReplay.mapName : undefined }
  }

  return undefined
}

/** Returns what the user is doing in the app right now (see `getCurrentActivity`). */
export function useCurrentActivity(): CurrentActivity | undefined {
  const selfUser = useSelfUser()
  const inLobby = useAppSelector(s => isInLobby(s.lobby))
  const lobbyInfo = useAppSelector(s => s.lobby.info)
  const lobbyRunning = useAppSelector(s => !!s.lobby.runState)
  const gameClient = useAppSelector(s => s.gameClient)
  const participatingGame = useAtomValue(participatingGameAtom)
  const watchedReplay = useAtomValue(watchedReplayAtom)

  return getCurrentActivity({
    userId: selfUser?.id,
    lobby: inLobby ? lobbyInfo : undefined,
    lobbyRunning,
    gameClient,
    participatingGame,
    watchedReplay,
  })
}
