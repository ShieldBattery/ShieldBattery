import { useAtomValue } from 'jotai'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { DiscordActivity } from '../../common/discord-presence'
import { GameStatusString } from '../../common/games/game-status'
import { TypedIpcRenderer } from '../../common/ipc'
import { findSlotByUserId, getPlayerSlots, openSlotCount } from '../../common/lobbies'
import { SlotType } from '../../common/lobbies/slot'
import { isInParticipatingGame } from '../active-game/game-client-reducer'
import { useSelfUser } from '../auth/auth-utils'
import { participatingGameAtom, watchedReplayAtom } from '../games/game-atoms'
import { isInLobby } from '../lobbies/lobby-reducer'
import { useAppSelector } from '../redux-hooks'
import { ActivityLobby, ActivityReplay, getDiscordActivity } from './discord-activity'

const ipcRenderer = new TypedIpcRenderer()

/** The states in which a game counts as being played, the score screen included. */
const PLAYED_GAME_STATES: ReadonlySet<GameStatusString> = new Set([
  'playing',
  'hasResult',
  'resultSent',
])

/**
 * Keeps the user's Discord Rich Presence in line with their lobby and game, sending the activity to
 * the main process whenever it changes. Renders nothing.
 */
export function DiscordActivitySync() {
  const { t } = useTranslation()
  const selfUser = useSelfUser()
  const sharing = useAppSelector(s => s.settings.account.shareDiscordActivity)
  const inLobby = useAppSelector(s => isInLobby(s.lobby))
  const lobbyInfo = useAppSelector(s => s.lobby.info)
  const lobbyRunning = useAppSelector(s => !!s.lobby.runState)
  const gameClient = useAppSelector(s => s.gameClient)
  const participatingGame = useAtomValue(participatingGameAtom)
  const watchedReplay = useAtomValue(watchedReplayAtom)

  const inParticipatingGame = isInParticipatingGame(gameClient)
  let lobby: ActivityLobby | undefined
  if (inLobby) {
    const [, , ownSlot] = selfUser ? findSlotByUserId(lobbyInfo, selfUser.id) : []
    lobby = {
      id: lobbyInfo.id,
      name: lobbyInfo.name,
      visibility: lobbyInfo.visibility,
      playerCount: getPlayerSlots(lobbyInfo).length,
      openSlots: openSlotCount(lobbyInfo),
      inGame: lobbyRunning || inParticipatingGame,
      mapName: lobbyInfo.map?.name,
      mapImageUrl: lobbyInfo.map?.image1024Url ?? lobbyInfo.map?.image512Url,
      ownRace: ownSlot && ownSlot.type !== SlotType.Observer ? ownSlot.race : undefined,
      observing: ownSlot?.type === SlotType.Observer,
    }
  }
  const playedGame =
    participatingGame &&
    gameClient.gameId === participatingGame.gameId &&
    gameClient.status &&
    PLAYED_GAME_STATES.has(gameClient.status.state)
      ? participatingGame
      : undefined

  const replayPlaying = Object.values(gameClient.watchOnly).some(
    status => status.state === 'playing',
  )
  // Several replays can run at once, but only the one started last is known by its map.
  const watchedReplayPlaying =
    watchedReplay !== undefined && gameClient.watchOnly[watchedReplay.gameId]?.state === 'playing'
  const replay: ActivityReplay | undefined = replayPlaying
    ? { mapName: watchedReplayPlaying ? watchedReplay.mapName : undefined }
    : undefined

  const activity: DiscordActivity | null =
    getDiscordActivity({ sharing, userId: selfUser?.id, lobby, game: playedGame, replay }, t) ??
    null
  // Compared as text, since every render builds a new object even when nothing in it changed.
  const serializedActivity = JSON.stringify(activity)

  useEffect(() => {
    ipcRenderer.send('discordSetActivity', JSON.parse(serializedActivity) as DiscordActivity | null)
  }, [serializedActivity])

  return null
}
