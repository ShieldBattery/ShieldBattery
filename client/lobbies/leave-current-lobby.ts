import { humanSlotCount, Lobby } from '../../common/lobbies'
import { SbUserId } from '../../common/users/sb-user-id'
import { useAppSelector } from '../redux-hooks'
import { CurrentLobbyState, isInLobby } from './lobby-reducer'

/**
 * Which "you'll be leaving your current lobby" copy applies to the viewer, given their current
 * lobby. Shared by every surface that lets someone trade their current lobby for a different one
 * (joining elsewhere, creating a new one), so the host/member/alone reasoning lives in one place.
 */
export enum LeaveCurrentLobbyVariant {
  Member = 'member',
  HostWithOthers = 'hostWithOthers',
  HostAlone = 'hostAlone',
}

/**
 * Determines which variant applies. Mirrors `Lobbies.removePlayer`'s host-migration behavior: the
 * lobby closes only when no humans (players or observers) remain after the host leaves, so
 * computers and closed slots don't count as company, while an observer does — they'd inherit the
 * host role.
 */
export function leaveCurrentLobbyVariant(
  currentLobby: Lobby,
  viewerId: SbUserId,
): LeaveCurrentLobbyVariant {
  if (currentLobby.host.userId !== viewerId) {
    return LeaveCurrentLobbyVariant.Member
  }

  return humanSlotCount(currentLobby) <= 1
    ? LeaveCurrentLobbyVariant.HostAlone
    : LeaveCurrentLobbyVariant.HostWithOthers
}

/**
 * Whether the viewer is still in their current lobby's running game. Leaving the lobby doesn't end
 * that game process, but the app runs only one participating game at a time, so it closes once
 * the next lobby's game launches. A member who was benched for the game, or whose game already
 * ended, has nothing running to lose.
 */
export function isInCurrentLobbyGame(lobby: CurrentLobbyState, viewerId: SbUserId): boolean {
  return isInLobby(lobby) && !!lobby.runState?.inGameUsers.includes(viewerId)
}

/**
 * Reads the viewer's leave-current-lobby situation out of the store for a confirmation prompt:
 * which copy variant applies, the current lobby's name to slot into it, and whether the viewer's
 * game from that lobby is still running. Falls back to `Member` when the viewer isn't in a lobby
 * at all (a prompt shown in that state has nothing to warn about, but should still render
 * sensibly).
 */
export function useLeaveCurrentLobbyPrompt(): {
  variant: LeaveCurrentLobbyVariant
  currentLobbyName: string
  inRunningGame: boolean
} {
  const selfId = useAppSelector(s => s.auth.self!.user.id)
  const inCurrentLobby = useAppSelector(s => isInLobby(s.lobby))
  const currentLobbyInfo = useAppSelector(s => s.lobby.info)
  const inRunningGame = useAppSelector(s => isInCurrentLobbyGame(s.lobby, selfId))

  return {
    variant: inCurrentLobby
      ? leaveCurrentLobbyVariant(currentLobbyInfo, selfId)
      : LeaveCurrentLobbyVariant.Member,
    currentLobbyName: currentLobbyInfo.name,
    inRunningGame,
  }
}
