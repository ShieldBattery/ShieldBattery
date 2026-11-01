import { useAtomValue } from 'jotai'
import { ReadonlyDeep } from 'type-fest'
import { GameStatusString } from '../../common/games/game-status'
import {
  findSlotByUserId,
  getHumanSlots,
  getLobbySlots,
  Lobby,
  MAX_BENCH,
} from '../../common/lobbies'
import { LobbyVisibility } from '../../common/lobbies/lobby-visibility'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { SlotType } from '../../common/lobbies/slot'
import { RaceChar } from '../../common/races'
import { SbUserId } from '../../common/users/sb-user-id'
import { GameClientState } from '../active-game/game-client-reducer'
import { useSelfUser } from '../auth/auth-utils'
import {
  participatingGameAtom,
  ParticipatingGameInfo,
  watchedReplayAtom,
  WatchedReplayInfo,
} from '../games/game-atoms'
import { isInLobby } from '../lobbies/lobby-reducer'
import { useAppSelector } from '../redux-hooks'

/**
 * A lobby the user is in, as far as others joining it goes. A lobby takes joins at any time, its
 * games included: while it gathers, a joiner gets an open player slot, or else an open observer
 * slot, and otherwise waits on its bench. While it counts down to a game, loads one or plays one,
 * every joiner waits on its bench.
 */
export interface JoinableLobby {
  id: SbLobbyId
  visibility: LobbyVisibility
  /** The people in the lobby: players and observers in its slots, and those on its bench. */
  memberCount: number
  /**
   * The most people the lobby can hold right now: those in it, the slots open to joiners while it
   * gathers, and the places left on its bench.
   */
  capacity: number
}

/** A game the user takes part in, while it's being played. */
export interface GameActivity {
  kind: 'game'
  game: ParticipatingGameInfo
  /** The user's own slot in the game. */
  ownSlot: ParticipatingGameInfo['slots'][number] | undefined
  /** The lobby the game was started from, which still takes joins while it runs. */
  lobby?: JoinableLobby
}

/** The lobby the user is in. */
export interface LobbyActivity extends JoinableLobby {
  kind: 'lobby'
  name: string
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
  /**
   * Whether the lobby is gathering for its next game, rather than counting down to it, loading it
   * or playing it.
   */
  lobbyGathering: boolean
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

/** The kinds of slot a joiner can be seated in. */
const OPEN_SLOT_TYPES: ReadonlySet<SlotType> = new Set([SlotType.Open, SlotType.ControlledOpen])

function getJoinableLobby(lobby: Lobby, gathering: boolean): JoinableLobby {
  const memberCount = getHumanSlots(lobby).length + lobby.bench.length
  const openSlots = gathering
    ? getLobbySlots(lobby).filter(slot => OPEN_SLOT_TYPES.has(slot.type)).length
    : 0
  // Joins stop at a full bench, but a change of layout can put more people on it than that.
  const benchPlaces = Math.max(0, MAX_BENCH - lobby.bench.length)
  return {
    id: lobby.id,
    visibility: lobby.visibility,
    memberCount,
    capacity: memberCount + openSlots + benchPlaces,
  }
}

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
      // Lobby members can't be in any other game, so one played from a lobby that isn't a match is
      // the lobby's own.
      lobby:
        lobby && participatingGame.matchmakingType === undefined
          ? getJoinableLobby(lobby, state.lobbyGathering)
          : undefined,
    }
  }

  if (lobby) {
    const [, , ownSlot] = findSlotByUserId(lobby, userId)
    const observing = ownSlot?.type === SlotType.Observer
    return {
      kind: 'lobby',
      ...getJoinableLobby(lobby, state.lobbyGathering),
      name: lobby.name,
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
  const lobbyGathering = useAppSelector(
    s =>
      !s.lobby.runState && !s.lobby.loadingState.isCountingDown && !s.lobby.loadingState.isLoading,
  )
  const gameClient = useAppSelector(s => s.gameClient)
  const participatingGame = useAtomValue(participatingGameAtom)
  const watchedReplay = useAtomValue(watchedReplayAtom)

  return getCurrentActivity({
    userId: selfUser?.id,
    lobby: inLobby ? lobbyInfo : undefined,
    lobbyGathering,
    gameClient,
    participatingGame,
    watchedReplay,
  })
}
