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
import { participatingGameAtom } from '../games/game-atoms'
import { isInLobby } from '../lobbies/lobby-reducer'
import { useAppSelector } from '../redux-hooks'
import { ActivityLobby, getDiscordActivity } from './discord-activity'

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
  const lobbyState = useAppSelector(s => s.lobby)
  const gameClient = useAppSelector(s => s.gameClient)
  const participatingGame = useAtomValue(participatingGameAtom)

  const inParticipatingGame = isInParticipatingGame(gameClient)
  let lobby: ActivityLobby | undefined
  if (isInLobby(lobbyState)) {
    const { info } = lobbyState
    const [, , ownSlot] = selfUser ? findSlotByUserId(info, selfUser.id) : []
    lobby = {
      id: info.id,
      name: info.name,
      visibility: info.visibility,
      playerCount: getPlayerSlots(info).length,
      openSlots: openSlotCount(info),
      inGame: !!lobbyState.runState || inParticipatingGame,
      mapName: info.map?.name,
      mapImageUrl: info.map?.image1024Url ?? info.map?.image512Url,
      ownRace: ownSlot && ownSlot.type !== SlotType.Observer ? ownSlot.race : undefined,
    }
  }
  const playedGame =
    participatingGame &&
    gameClient.gameId === participatingGame.gameId &&
    gameClient.status &&
    PLAYED_GAME_STATES.has(gameClient.status.state)
      ? participatingGame
      : undefined

  const activity: DiscordActivity | null =
    getDiscordActivity({ sharing, userId: selfUser?.id, lobby, game: playedGame }, t) ?? null
  // Compared as text, since every render builds a new object even when nothing in it changed.
  const serializedActivity = JSON.stringify(activity)

  useEffect(() => {
    ipcRenderer.send('discordSetActivity', JSON.parse(serializedActivity) as DiscordActivity | null)
  }, [serializedActivity])

  return null
}
